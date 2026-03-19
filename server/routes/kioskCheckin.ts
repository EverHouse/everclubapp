import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { logAndRespond, logger } from '../core/logger';
import { getSessionUser } from '../types/session';
import { processWalkInCheckin } from '../core/walkInCheckinService';
import { logFromRequest } from '../core/auditLog';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';
import { getSettingValue } from '../core/settingsHelper';

const router = Router();

router.post('/api/kiosk/checkin', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { memberId } = req.body;
    if (!memberId || typeof memberId !== 'string') {
      return res.status(400).json({ error: 'Member ID is required' });
    }

    const memberResult = await db.execute(sql`
      SELECT id, membership_status FROM users WHERE id = ${memberId} LIMIT 1
    `);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found. Please ask staff for help.' });
    }

    const member = memberResult.rows[0] as { id: number | string; membership_status: string | null };
    const status = String(member.membership_status || '').toLowerCase();
    const blockedStatuses = ['cancelled', 'suspended', 'terminated', 'inactive', 'archived'];
    if (blockedStatuses.includes(status)) {
      return res.status(403).json({ error: 'Membership is not active. Please speak to staff.' });
    }

    const result = await processWalkInCheckin({
      memberId: String(member.id),
      checkedInBy: `kiosk:${sessionUser.email}`,
      checkedInByName: 'Kiosk Self-Service',
      source: 'kiosk'
    });

    if (result.alreadyCheckedIn) {
      return res.status(409).json({
        error: 'Already checked in',
        alreadyCheckedIn: true,
        memberName: result.memberName,
        tier: result.tier
      });
    }

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    logFromRequest(req, 'kiosk_checkin', 'member', String(member.id), result.memberName, {
      memberEmail: result.memberEmail,
      tier: result.tier,
      lifetimeVisits: result.lifetimeVisits,
      type: 'walk_in',
      source: 'kiosk_qr',
      staffEmail: sessionUser.email
    });

    logger.info('[Kiosk] Self-service check-in via kiosk QR scan', {
      extra: {
        memberEmail: result.memberEmail,
        memberName: result.memberName,
        lifetimeVisits: result.lifetimeVisits,
        staffEmail: sessionUser.email
      }
    });

    res.json({
      success: true,
      memberName: result.memberName,
      tier: result.tier,
      lifetimeVisits: result.lifetimeVisits,
      membershipStatus: result.membershipStatus
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to process kiosk check-in', error);
  }
});

router.get('/api/kiosk/verify-staff', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ authenticated: false });
    }
    res.json({ authenticated: true, staffName: sessionUser.name || sessionUser.email });
  } catch (error: unknown) {
    res.status(500).json({ authenticated: false, error: getErrorMessage(error) });
  }
});

const passcodeAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

router.post('/api/kiosk/verify-passcode', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    const key = sessionUser?.email || req.ip || 'unknown';

    const record = passcodeAttempts.get(key);
    if (record && record.count >= MAX_ATTEMPTS) {
      const elapsed = Date.now() - record.lastAttempt;
      if (elapsed < LOCKOUT_MS) {
        return res.status(429).json({ valid: false, error: 'Too many attempts. Please wait 1 minute.' });
      }
      passcodeAttempts.delete(key);
    }

    const { passcode } = req.body;
    if (!passcode || typeof passcode !== 'string') {
      return res.status(400).json({ valid: false, error: 'Passcode is required' });
    }

    const storedPasscode = await getSettingValue('kiosk.exit_passcode');
    if (!storedPasscode) {
      logger.error('[Kiosk] No exit passcode configured in system settings');
      return res.status(503).json({ valid: false, error: 'Kiosk exit passcode not configured. Contact an administrator.' });
    }
    if (passcode === storedPasscode) {
      passcodeAttempts.delete(key);
      return res.json({ valid: true });
    }

    const current = passcodeAttempts.get(key) || { count: 0, lastAttempt: 0 };
    current.count += 1;
    current.lastAttempt = Date.now();
    passcodeAttempts.set(key, current);

    logger.warn('[Kiosk] Failed passcode attempt', { extra: { email: key, attempts: current.count } });
    return res.status(401).json({ valid: false, error: 'Invalid passcode' });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to verify kiosk passcode', error);
  }
});

export default router;
