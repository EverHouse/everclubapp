import { Router, Request, Response } from 'express';
import { isAuthenticated } from '../../core/middleware';
import { getMemberTierByEmail, getTierLimits, getDailyBookedMinutes } from '../../core/tierService';
import { calculateOverageCents } from '../../core/billing/pricingConfig';
import { normalizeEmail } from '../../core/utils/emailNormalization';
import { getSessionUser } from '../../types/session';
import { logger } from '../../core/logger';
import { logFromRequest } from '../../core/auditLog';
import { getErrorMessage } from '../../utils/errorUtils';

const router = Router();

interface PrepayEstimateRequest {
  memberEmail: string;
  date: string;
  startTime: string;
  durationMinutes: number;
}

interface PrepayEstimateResponse {
  totalCents: number;
  overageMinutes: number;
  dailyAllowance: number;
  usedToday: number;
  paymentRequired: boolean;
}

router.post('/api/member/conference/prepay/estimate', isAuthenticated, async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { memberEmail: rawMemberEmail, date, startTime, durationMinutes } = req.body as PrepayEstimateRequest;
    const memberEmail = rawMemberEmail?.trim()?.toLowerCase();

    if (!memberEmail || !date || !startTime || !durationMinutes) {
      return res.status(400).json({ error: 'Missing required fields: memberEmail, date, startTime, durationMinutes' });
    }

    if (typeof durationMinutes !== 'number' || durationMinutes <= 0) {
      return res.status(400).json({ error: 'durationMinutes must be a positive number' });
    }

    const normalizedEmail = normalizeEmail(memberEmail);
    
    const isStaff = sessionUser.role === 'admin' || sessionUser.role === 'staff';
    const isOwnEmail = normalizedEmail.toLowerCase() === sessionUser.email.toLowerCase();
    
    if (!isOwnEmail && !isStaff) {
      return res.status(403).json({ error: 'Can only estimate prepayment for your own bookings' });
    }

    const tierName = await getMemberTierByEmail(normalizedEmail);
    if (!tierName) {
      return res.status(400).json({ error: 'Member not found or inactive membership' });
    }

    const tierLimits = await getTierLimits(tierName);
    const dailyAllowance = tierLimits.daily_conf_room_minutes || 0;

    const usedToday = await getDailyBookedMinutes(normalizedEmail, date, 'conference_room');

    const remainingAllowance = Math.max(0, dailyAllowance - usedToday);
    const overageMinutes = Math.max(0, durationMinutes - remainingAllowance);

    const totalCents = calculateOverageCents(overageMinutes);

    const response: PrepayEstimateResponse = {
      totalCents,
      overageMinutes,
      dailyAllowance,
      usedToday,
      paymentRequired: totalCents > 0
    };

    logger.info('[ConferencePrepay] Estimate calculated', {
      extra: { memberEmail: normalizedEmail, date, durationMinutes, overageMinutes, totalCents }
    });

    try { logFromRequest(req, { action: 'create_conference_prepayment', resourceType: 'payment', details: { memberEmail: normalizedEmail, date, startTime, durationMinutes, overageMinutes, totalCents, estimateOnly: true } }); } catch (auditErr) { logger.warn('[Audit] Failed to log create_conference_prepayment estimate:', { error: getErrorMessage(auditErr) }); }

    res.json(response);
  } catch (error: unknown) {
    logger.error('[ConferencePrepay] Error calculating estimate', { error: getErrorMessage(error) });
    res.status(500).json({ error: 'Failed to calculate prepayment estimate' });
  }
});

export default router;
