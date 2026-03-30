import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { isStaffOrAdmin } from '../core/middleware';
import { logAndRespond, logger } from '../core/logger';
import { getSessionUser } from '../types/session';
import { processWalkInCheckin } from '../core/walkInCheckinService';
import { checkinBooking } from '../core/bookingService/approvalCheckin';
import { logFromRequest } from '../core/auditLog';
import { logPaymentAudit } from '../core/auditLog';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';
import { getSettingValue } from '../core/settingsHelper';
import { validateBody } from '../middleware/validate';

const kioskCheckinSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
  paymentConfirmed: z.boolean().optional(),
});

const kioskPreflightSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
});

const kioskPasscodeSchema = z.object({
  passcode: z.string().min(1, 'Passcode is required'),
});

const router = Router();

interface UpcomingBookingRow {
  booking_id: number;
  session_id: number | null;
  start_time: string;
  end_time: string;
  declared_player_count: number;
  owner_email: string;
  resource_name: string;
  resource_type: string;
  owner_name: string | null;
  unpaid_fee_cents: number;
}

async function lookupMember(memberId: string) {
  const memberResult = await db.execute(sql`
    SELECT id, email, first_name, last_name, membership_status, tier, lifetime_visits
    FROM users WHERE id = ${memberId} LIMIT 1
  `);

  if (memberResult.rows.length === 0) return null;

  const member = memberResult.rows[0] as {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    membership_status: string | null;
    tier: string | null;
    lifetime_visits: number | null;
  };

  return member;
}

interface BookingLookupResult {
  booking: UpcomingBookingRow | null;
  error: boolean;
}

async function findUpcomingBooking(memberEmail: string, memberId: string): Promise<BookingLookupResult> {
  try {
    const bookingResult = await db.execute(sql`
      SELECT 
        br.id as booking_id,
        br.session_id,
        br.start_time::text,
        br.end_time::text,
        br.declared_player_count,
        br.user_email as owner_email,
        r.name as resource_name,
        r.type as resource_type,
        COALESCE(
          NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), ''),
          br.user_name,
          br.user_email
        ) as owner_name,
        GREATEST(
          COALESCE(
            (SELECT SUM(bp2.cached_fee_cents)
             FROM booking_participants bp2
             WHERE bp2.session_id = br.session_id
               AND bp2.payment_status NOT IN ('paid', 'waived', 'refunded')),
            0
          )
          -
          COALESCE(
            (SELECT SUM(cp.amount_cents)
             FROM conference_prepayments cp
             WHERE cp.booking_id = br.id
               AND cp.status IN ('succeeded', 'completed')),
            0
          ),
          0
        )::int as unpaid_fee_cents
      FROM booking_requests br
      JOIN resources r ON br.resource_id = r.id
      LEFT JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
      WHERE br.request_date = (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
        AND br.status IN ('confirmed', 'approved')
        AND br.end_time > (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::time
        AND (
          LOWER(br.user_email) = LOWER(${memberEmail})
          OR br.user_id = ${String(memberId)}
          OR br.session_id IN (
            SELECT bp.session_id FROM booking_participants bp
            WHERE bp.user_id = ${String(memberId)}
          )
        )
      ORDER BY br.start_time ASC
      LIMIT 1
    `);

    if (bookingResult.rows.length > 0) {
      return { booking: bookingResult.rows[0] as unknown as UpcomingBookingRow, error: false };
    }
    return { booking: null, error: false };
  } catch (bookingErr: unknown) {
    const pgCode = (bookingErr as Record<string, unknown>)?.code;
    const isDbTypeError = pgCode === '22P02' || pgCode === '42804';
    const level = isDbTypeError ? 'error' : 'warn';
    logger[level]('[Kiosk] Failed to fetch upcoming booking for member', {
      extra: { error: getErrorMessage(bookingErr), pgCode },
    });
    return { booking: null, error: true };
  }
}

function formatBookingResponse(booking: UpcomingBookingRow) {
  return {
    bookingId: Number(booking.booking_id),
    sessionId: booking.session_id ? Number(booking.session_id) : null,
    startTime: String(booking.start_time),
    endTime: String(booking.end_time),
    resourceName: String(booking.resource_name),
    resourceType: String(booking.resource_type),
    declaredPlayerCount: Number(booking.declared_player_count || 1),
    ownerEmail: String(booking.owner_email),
    ownerName: String(booking.owner_name || ''),
    unpaidFeeCents: Number(booking.unpaid_fee_cents || 0),
  };
}

router.post('/api/kiosk/checkin-preflight', isStaffOrAdmin, validateBody(kioskPreflightSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { memberId } = req.body;

    const member = await lookupMember(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found. Please ask staff for help.' });
    }

    const memberEmail = member.email;
    const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || memberEmail?.split('@')[0] || '';
    const status = String(member.membership_status || '').toLowerCase();
    const blockedStatuses = ['cancelled', 'suspended', 'terminated', 'inactive', 'archived'];
    if (blockedStatuses.includes(status)) {
      return res.status(403).json({ error: 'Membership is not active. Please speak to staff.' });
    }

    const bookingLookup = await findUpcomingBooking(memberEmail, String(member.id));

    if (bookingLookup.error) {
      return res.status(500).json({ error: 'Unable to look up booking. Please see staff for assistance.' });
    }

    const upcomingBooking = bookingLookup.booking;

    const isBookingOwner = upcomingBooking
      ? memberEmail.toLowerCase() === String(upcomingBooking.owner_email).toLowerCase()
      : false;

    const unpaidFeeCents = upcomingBooking ? Number(upcomingBooking.unpaid_fee_cents || 0) : 0;

    if (upcomingBooking && unpaidFeeCents > 0) {
      const bookingId = Number(upcomingBooking.booking_id);

      if (!isBookingOwner) {
        await logPaymentAudit({
          bookingId,
          sessionId: upcomingBooking.session_id,
          action: 'kiosk_nonowner_directed_to_staff',
          staffEmail: `kiosk:${sessionUser.email}`,
          staffName: 'Kiosk Self-Service',
          amountAffected: unpaidFeeCents / 100,
          metadata: { memberId: String(member.id), memberEmail, reason: 'Non-owner participant with outstanding fees directed to staff at kiosk' },
        });
      } else {
        await logPaymentAudit({
          bookingId,
          sessionId: upcomingBooking.session_id,
          action: 'kiosk_checkin_blocked_for_payment',
          staffEmail: `kiosk:${sessionUser.email}`,
          staffName: 'Kiosk Self-Service',
          amountAffected: unpaidFeeCents / 100,
          metadata: { memberId: String(member.id), memberEmail, reason: 'Owner must pay outstanding fees before kiosk check-in' },
        });
      }

      logger.info('[Kiosk Preflight] Outstanding fees detected', {
        extra: { memberEmail, memberName, bookingId, unpaidFeeCents, isBookingOwner, staffEmail: sessionUser.email }
      });
    }

    res.json({
      memberName,
      memberId: String(member.id),
      memberEmail,
      tier: member.tier,
      membershipStatus: member.membership_status,
      upcomingBooking: upcomingBooking ? formatBookingResponse(upcomingBooking) : null,
      isBookingOwner,
      requiresPayment: unpaidFeeCents > 0,
      unpaidFeeCents,
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to process kiosk check-in preflight', error);
  }
});

router.post('/api/kiosk/checkin', isStaffOrAdmin, validateBody(kioskCheckinSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { memberId, paymentConfirmed } = req.body;

    const member = await lookupMember(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found. Please ask staff for help.' });
    }

    const memberEmail = member.email;
    const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || memberEmail?.split('@')[0] || '';
    const status = String(member.membership_status || '').toLowerCase();
    const blockedStatuses = ['cancelled', 'suspended', 'terminated', 'inactive', 'archived'];
    if (blockedStatuses.includes(status)) {
      return res.status(403).json({ error: 'Membership is not active. Please speak to staff.' });
    }

    const bookingLookup = await findUpcomingBooking(memberEmail, String(member.id));

    if (bookingLookup.error) {
      return res.status(500).json({ error: 'Unable to look up booking. Please see staff for assistance.' });
    }

    const upcomingBooking = bookingLookup.booking;

    if (upcomingBooking) {
      const bookingId = Number(upcomingBooking.booking_id);

      let verifiedFeesCleared = false;
      if (paymentConfirmed && upcomingBooking.session_id) {
        const freshFeeCheck = await db.execute(sql`
          SELECT
            GREATEST(
              COALESCE(
                (SELECT SUM(bp.cached_fee_cents)
                 FROM booking_participants bp
                 WHERE bp.session_id = ${upcomingBooking.session_id}
                   AND bp.payment_status NOT IN ('paid', 'waived', 'refunded')
                   AND COALESCE(bp.cached_fee_cents, 0) > 0),
                0
              )
              -
              COALESCE(
                (SELECT SUM(cp.amount_cents)
                 FROM conference_prepayments cp
                 WHERE cp.booking_id = ${bookingId}
                   AND cp.status IN ('succeeded', 'completed')),
                0
              ),
              0
            )::int as remaining_unpaid_cents
        `);
        const remainingUnpaidCents = Number((freshFeeCheck.rows[0] as { remaining_unpaid_cents: number })?.remaining_unpaid_cents || 0);
        verifiedFeesCleared = remainingUnpaidCents === 0;

        if (!verifiedFeesCleared) {
          logger.warn('[Kiosk] paymentConfirmed sent but fees still outstanding server-side', {
            extra: { bookingId, remainingUnpaidCents, memberId: member.id, memberEmail }
          });
        }
      }

      const currentUnpaidFeeCents = Number(upcomingBooking.unpaid_fee_cents || 0);
      const isBookingOwner = memberEmail.toLowerCase() === String(upcomingBooking.owner_email).toLowerCase();

      if (currentUnpaidFeeCents > 0 && !isBookingOwner) {
        await logPaymentAudit({
          bookingId,
          sessionId: upcomingBooking.session_id,
          action: 'kiosk_nonowner_directed_to_staff',
          staffEmail: `kiosk:${sessionUser.email}`,
          staffName: 'Kiosk Self-Service',
          amountAffected: currentUnpaidFeeCents / 100,
          metadata: { memberId: String(member.id), memberEmail, reason: 'Non-owner participant blocked at check-in endpoint' },
        });
        return res.status(403).json({
          error: 'Please see staff for check-in assistance.',
          code: 'NON_OWNER_UNPAID',
        });
      }

      if (currentUnpaidFeeCents > 0 && !verifiedFeesCleared) {
        await logPaymentAudit({
          bookingId,
          sessionId: upcomingBooking.session_id,
          action: 'kiosk_checkin_blocked_for_payment',
          staffEmail: `kiosk:${sessionUser.email}`,
          staffName: 'Kiosk Self-Service',
          amountAffected: currentUnpaidFeeCents / 100,
          metadata: { memberId: String(member.id), memberEmail, reason: 'Check-in endpoint blocked: outstanding fees unpaid' },
        });
        return res.status(402).json({
          error: 'Outstanding fees must be paid before check-in.',
          code: 'OUTSTANDING_BALANCE',
          requiresPayment: true,
          unpaidFeeCents: currentUnpaidFeeCents,
          memberName,
          tier: member.tier,
          upcomingBooking: formatBookingResponse(upcomingBooking),
        });
      }

      const checkinResult = await checkinBooking({
        bookingId,
        targetStatus: 'attended',
        confirmPayment: false,
        skipPaymentCheck: verifiedFeesCleared,
        skipRosterCheck: true,
        staffEmail: `kiosk:${sessionUser.email}`,
        staffName: 'Kiosk Self-Service',
      });

      if (checkinResult.alreadyProcessed) {
        return res.status(409).json({
          error: 'Already checked in',
          alreadyCheckedIn: true,
          memberName,
          tier: member.tier
        });
      }

      if (checkinResult.membershipBlocked) {
        return res.status(403).json({
          error: checkinResult.error || 'Membership is not active. Please speak to staff.',
          memberName,
          tier: member.tier
        });
      }

      if (checkinResult.requiresPayment) {
        return res.status(402).json({
          error: 'Outstanding fees must be paid before check-in.',
          code: 'OUTSTANDING_BALANCE',
          requiresPayment: true,
          unpaidFeeCents: Math.round((checkinResult.totalOutstanding || 0) * 100),
          memberName,
          tier: member.tier,
          upcomingBooking: formatBookingResponse(upcomingBooking),
        });
      }

      if (checkinResult.error && !checkinResult.success) {
        logger.warn('[Kiosk] Booking check-in failed, NOT falling back to walk-in (booking exists)', {
          extra: { bookingId, error: checkinResult.error, statusCode: checkinResult.statusCode, memberId: member.id }
        });
        return res.status(checkinResult.statusCode || 500).json({
          error: checkinResult.error || 'Check-in failed. Please see staff for help.',
          memberName,
          tier: member.tier
        });
      }

      const freshVisits = await db.execute(sql`
        SELECT lifetime_visits FROM users WHERE id = ${member.id} LIMIT 1
      `);
      const lifetimeVisits = (freshVisits.rows[0] as { lifetime_visits: number | null })?.lifetime_visits || (member.lifetime_visits || 0);

      if (verifiedFeesCleared) {
        await logPaymentAudit({
          bookingId,
          sessionId: upcomingBooking.session_id,
          action: 'kiosk_payment_completed_before_checkin',
          staffEmail: `kiosk:${sessionUser.email}`,
          staffName: 'Kiosk Self-Service',
          amountAffected: currentUnpaidFeeCents / 100,
          metadata: { memberId: String(member.id), memberEmail, reason: 'Payment verified server-side, check-in proceeded at kiosk' },
        });
      }

      logFromRequest(req, 'kiosk_checkin', 'member', String(member.id), memberName, {
        memberEmail,
        tier: member.tier,
        lifetimeVisits,
        type: 'booking',
        bookingId,
        source: 'kiosk_qr',
        staffEmail: sessionUser.email,
        feesVerifiedCleared: verifiedFeesCleared,
      });

      logger.info('[Kiosk] Booking check-in via kiosk QR scan', {
        extra: { memberEmail, memberName, bookingId, lifetimeVisits, staffEmail: sessionUser.email, feesVerifiedCleared: verifiedFeesCleared }
      });

      return res.json({
        success: true,
        memberName,
        memberId: String(member.id),
        memberEmail,
        tier: member.tier,
        lifetimeVisits,
        membershipStatus: member.membership_status,
        upcomingBooking: formatBookingResponse(upcomingBooking),
      });
    }

    const walkInResult = await processWalkInCheckin({
      memberId: String(member.id),
      checkedInBy: `kiosk:${sessionUser.email}`,
      checkedInByName: 'Kiosk Self-Service',
      source: 'kiosk'
    });

    if (walkInResult.alreadyCheckedIn) {
      return res.status(409).json({
        error: 'Already checked in',
        alreadyCheckedIn: true,
        memberName: walkInResult.memberName,
        tier: walkInResult.tier
      });
    }

    if (!walkInResult.success) {
      return res.status(500).json({ error: walkInResult.error });
    }

    logFromRequest(req, 'kiosk_checkin', 'member', String(member.id), walkInResult.memberName, {
      memberEmail: walkInResult.memberEmail,
      tier: walkInResult.tier,
      lifetimeVisits: walkInResult.lifetimeVisits,
      type: 'walk_in',
      source: 'kiosk_qr',
      staffEmail: sessionUser.email
    });

    logger.info('[Kiosk] Walk-in check-in via kiosk QR scan', {
      extra: {
        memberEmail: walkInResult.memberEmail,
        memberName: walkInResult.memberName,
        lifetimeVisits: walkInResult.lifetimeVisits,
        staffEmail: sessionUser.email
      }
    });

    res.json({
      success: true,
      memberName: walkInResult.memberName,
      tier: walkInResult.tier,
      lifetimeVisits: walkInResult.lifetimeVisits,
      membershipStatus: walkInResult.membershipStatus,
      upcomingBooking: null
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
    logAndRespond(req, res, 500, 'Failed to verify staff authentication', error);
  }
});

const passcodeAttempts = new Map<string, { count: number; lastAttempt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

const passcodeCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, record] of passcodeAttempts) {
    if (now - record.lastAttempt > LOCKOUT_MS * 5) {
      passcodeAttempts.delete(key);
    }
  }
}, LOCKOUT_MS * 5);
passcodeCleanupInterval.unref();

router.post('/api/kiosk/verify-passcode', isStaffOrAdmin, validateBody(kioskPasscodeSchema), async (req: Request, res: Response) => {
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
