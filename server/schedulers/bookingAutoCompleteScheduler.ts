import { schedulerTracker } from '../core/schedulerTracker';
import { queryWithRetry } from '../core/db';
import { getTodayPacific, formatTimePacific } from '../utils/dateUtils';
import { notifyAllStaff } from '../core/notificationService';
import { ensureSessionForBooking } from '../core/bookingService/sessionManager';
import { recalculateSessionFees } from '../core/bookingService/usageCalculator';
import { syncBookingInvoice } from '../core/billing/bookingInvoiceService';
import { logger } from '../core/logger';
import { refreshBookingPass } from '../walletPass/bookingPassService';
import { getErrorMessage } from '../utils/errorUtils';

const STUCK_ESCALATION_HOURS = parseInt(process.env.STUCK_BOOKING_ESCALATION_HOURS || '24', 10);
const STUCK_FORCE_COMPLETE_DAYS = parseInt(process.env.STUCK_BOOKING_FORCE_COMPLETE_DAYS || '7', 10);

interface AutoCompletedBookingResult {
  id: number;
  userEmail: string;
  userName: string | null;
  requestDate: string;
  startTime: string;
  endTime: string;
  resourceId: number | null;
  sessionId: number | null;
  trackmanBookingId: string | null;
}

async function autoCompletePastBookings(): Promise<void> {
  try {
    const now = new Date();
    const todayStr = getTodayPacific();
    const currentTimePacific = formatTimePacific(now);

    logger.info(`[Booking Auto-Complete] Running auto-complete check at ${todayStr} ${currentTimePacific}`);


    const stuckPendingPayments = await queryWithRetry<{ id: number; userEmail: string; userName: string | null; requestDate: string; startTime: string; endTime: string | null; stuckHours: number }>(
      `SELECT br.id, br.user_email AS "userEmail", br.user_name AS "userName", 
              br.request_date AS "requestDate", br.start_time AS "startTime",
              br.end_time AS "endTime",
              EXTRACT(EPOCH FROM (NOW() - (br.request_date + COALESCE(br.end_time, br.start_time)::time))) / 3600 AS "stuckHours"
       FROM booking_requests br
       WHERE br.status IN ('approved', 'confirmed')
         AND br.request_date < $1::date
         AND br.request_date >= $1::date - INTERVAL '14 days'
         AND br.session_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM booking_participants bp
           WHERE bp.session_id = br.session_id
             AND bp.cached_fee_cents > 0
             AND bp.payment_status = 'pending'
         )`,
      [todayStr]
    );

    if (stuckPendingPayments.rows.length > 0) {
      const forceCompleteThresholdHours = STUCK_FORCE_COMPLETE_DAYS * 24;
      const forceCompleteBookings = stuckPendingPayments.rows.filter(b => b.stuckHours >= forceCompleteThresholdHours);

      if (forceCompleteBookings.length > 0) {
        const forceIds = forceCompleteBookings.map(b => b.id);
        logger.warn(`[Booking Auto-Complete] Force-completing ${forceCompleteBookings.length} booking(s) stuck ${STUCK_FORCE_COMPLETE_DAYS}+ days with unpaid fees. IDs: [${forceIds.join(', ')}]`);

        const forceResult = await queryWithRetry<{ id: number }>(
          `UPDATE booking_requests
           SET status = 'attended',
               is_unmatched = false,
               staff_notes = COALESCE(staff_notes || E'\n', '') || $2,
               updated_at = NOW(),
               reviewed_at = NOW(),
               reviewed_by = 'system-force-complete'
           WHERE id = ANY($1::int[])
             AND status IN ('approved', 'confirmed')
           RETURNING id`,
          [forceIds, `[Force-completed after ${STUCK_FORCE_COMPLETE_DAYS}+ days stuck with unpaid fees]`]
        );

        const actuallyForced = forceResult.rows.map(r => r.id);
        if (actuallyForced.length > 0) {
          await notifyAllStaff(
            `Bookings Force-Completed — ${actuallyForced.length} Stuck ${STUCK_FORCE_COMPLETE_DAYS}+ Days`,
            `${actuallyForced.length} booking(s) were force-completed because they were stuck for over ${STUCK_FORCE_COMPLETE_DAYS} days with unpaid fees. Fees are still outstanding and should be collected:\n\n${forceCompleteBookings.filter(b => actuallyForced.includes(b.id)).slice(0, 10).map(b => `• #${b.id} ${b.userName || b.userEmail} (${b.userEmail})`).join('\n')}`,
            'warning',
            { sendPush: true }
          );

          for (const id of actuallyForced) {
            refreshBookingPass(id).catch(err =>
              logger.error('[Booking Auto-Complete] Wallet pass refresh failed for force-completed', { extra: { bookingId: id, error: getErrorMessage(err) } })
            );
          }
        }
      }

      const remainingStuck = stuckPendingPayments.rows.filter(b => b.stuckHours < forceCompleteThresholdHours);

      if (remainingStuck.length > 0) {
      const stuckIds = remainingStuck.map(b => b.id).sort((a, b) => a - b);
      const stuckSummary = remainingStuck
        .slice(0, 5)
        .map(b => {
          const hours = Math.round(b.stuckHours);
          const durationStr = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
          return `• #${b.id} ${b.userName || b.userEmail} (${b.userEmail}) - ${b.requestDate} ${b.startTime} — stuck ${durationStr}`;
        })
        .join('\n');
      const stuckMore = remainingStuck.length > 5 ? `\n...and ${remainingStuck.length - 5} more` : '';
      const logDetails = remainingStuck
        .slice(0, 10)
        .map(b => {
          const hours = Math.round(b.stuckHours);
          const durationStr = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
          return `#${b.id} ${b.userEmail} (${durationStr})`;
        })
        .join(', ');
      logger.warn(`[Booking Auto-Complete] ${remainingStuck.length} booking(s) stuck with unpaid fees, skipped auto-complete. IDs: [${stuckIds.join(', ')}]. Details: ${logDetails}`);

      const escalatedBookings = remainingStuck.filter(b => b.stuckHours >= STUCK_ESCALATION_HOURS);
      const isEscalation = escalatedBookings.length > 0;

      const recentDup = await queryWithRetry<{ id: number }>(
        `SELECT id FROM notifications
         WHERE title = $1
           AND created_at > NOW() - INTERVAL '6 hours'
         LIMIT 1`,
        [isEscalation ? `URGENT: Bookings Stuck ${STUCK_ESCALATION_HOURS}h+ — Manual Resolution Required` : 'Bookings Stuck — Unpaid Fees']
      );

      if (recentDup.rows.length === 0) {
        if (isEscalation) {
          const escalatedSummary = escalatedBookings
            .slice(0, 10)
            .map(b => {
              const hours = Math.round(b.stuckHours);
              const durationStr = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
              return `• Booking #${b.id} — ${b.userName || 'Unknown'} (${b.userEmail}) — ${b.requestDate} ${b.startTime} — stuck ${durationStr}`;
            })
            .join('\n');
          const escalatedMore = escalatedBookings.length > 10 ? `\n...and ${escalatedBookings.length - 10} more` : '';

          await notifyAllStaff(
            `URGENT: Bookings Stuck ${STUCK_ESCALATION_HOURS}h+ — Manual Resolution Required`,
            `${escalatedBookings.length} booking(s) have been stuck for over ${STUCK_ESCALATION_HOURS} hours with unpaid fees and cannot be auto checked-in. These require immediate manual attention — collect payment or waive fees:\n\n${escalatedSummary}${escalatedMore}`,
            'warning',
            { sendPush: true }
          );
          logger.warn(`[Booking Auto-Complete] ESCALATION: ${escalatedBookings.length} booking(s) stuck ${STUCK_ESCALATION_HOURS}h+, sent urgent staff notification. IDs: [${escalatedBookings.map(b => b.id).join(', ')}]`);
        } else {
          await notifyAllStaff(
            'Bookings Stuck — Unpaid Fees',
            `${remainingStuck.length} past booking(s) cannot be auto checked-in because they have unpaid fees. Please collect payment or waive fees:\n\n${stuckSummary}${stuckMore}`,
            'system',
            { sendPush: false }
          );
        }
      } else {
        logger.info(`[Booking Auto-Complete] Skipping duplicate stuck-fees notification — sent within last 6h (bookings: ${stuckIds.join(', ')})`);
      }
      }
    }

    const unlinkedBookings = await queryWithRetry<{ id: number; userEmail: string }>(
      `SELECT br.id, br.user_email AS "userEmail"
       FROM booking_requests br
       WHERE br.status IN ('approved', 'confirmed')
         AND br.request_date >= $1::date - INTERVAL '14 days'
         AND br.session_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM booking_participants bp
           WHERE bp.session_id = br.session_id
             AND bp.participant_type IN ('owner', 'member')
             AND bp.user_id IS NOT NULL
         )
         AND (
           br.request_date < $1::date - INTERVAL '1 day'
           OR (br.request_date <= $1::date AND br.end_time IS NOT NULL AND br.end_time <= $2::time)
         )`,
      [todayStr, currentTimePacific]
    );
    if (unlinkedBookings.rows.length > 0) {
      const ids = unlinkedBookings.rows.map(b => b.id);
      logger.warn(`[Booking Auto-Complete] Skipped ${ids.length} booking(s) with no linked member participants — require staff resolution. IDs: [${ids.join(', ')}]`);
    }

    const markedBookings = await queryWithRetry<AutoCompletedBookingResult>(
      `UPDATE booking_requests 
       SET status = 'attended',
           is_unmatched = false,
           staff_notes = COALESCE(staff_notes || E'\n', '') || '[Auto checked-in: booking time passed]',
           updated_at = NOW(),
           reviewed_at = NOW(),
           reviewed_by = 'system-auto-checkin'
       WHERE status IN ('approved', 'confirmed')
         AND status NOT IN ('attended', 'checked_in')
         AND request_date >= $1::date - INTERVAL '14 days'
         AND (
           request_date < $1::date - INTERVAL '1 day'
           OR (
             request_date = $1::date - INTERVAL '1 day'
             AND CASE
               WHEN end_time IS NOT NULL AND end_time < start_time
                 THEN $2::time >= '00:30:00'::time AND end_time <= ($2::time - interval '30 minutes')
               WHEN end_time IS NOT NULL
                 THEN true
               ELSE true
             END
           )
           OR (
             request_date = $1::date
             AND end_time IS NOT NULL
             AND end_time >= start_time
             AND $2::time >= '00:30:00'::time
             AND end_time <= ($2::time - interval '30 minutes')
           )
         )
         AND (
           session_id IS NULL
           OR NOT EXISTS (
             SELECT 1 FROM booking_participants bp
             WHERE bp.session_id = booking_requests.session_id
               AND bp.cached_fee_cents > 0
               AND bp.payment_status = 'pending'
           )
         )
         AND (
           session_id IS NULL
           OR EXISTS (
             SELECT 1 FROM booking_participants bp2
             WHERE bp2.session_id = booking_requests.session_id
               AND bp2.participant_type IN ('owner', 'member')
               AND bp2.user_id IS NOT NULL
           )
         )
       RETURNING id, user_email AS "userEmail", user_name AS "userName", request_date AS "requestDate", 
                 start_time AS "startTime", end_time AS "endTime", resource_id AS "resourceId",
                 session_id AS "sessionId", trackman_booking_id AS "trackmanBookingId"`,
      [todayStr, currentTimePacific]
    );

    const markedCount = markedBookings.rows.length;

    if (markedCount === 0) {
      logger.info('[Booking Auto-Complete] No past approved/confirmed bookings found');
      schedulerTracker.recordRun('Booking Auto-Complete', true);
      return;
    }

    let sessionsCreated = 0;
    let sessionErrors = 0;

    for (const booking of markedBookings.rows) {
      logger.info(
        `[Booking Auto-Complete] Auto checked-in request #${booking.id}: ` +
        `${booking.userName || booking.userEmail} for ${booking.requestDate} ${booking.startTime}`
      );

      if (!booking.sessionId && booking.resourceId) {
        try {
          const result = await ensureSessionForBooking({
            bookingId: booking.id,
            resourceId: booking.resourceId,
            sessionDate: typeof booking.requestDate === 'object' 
              ? (booking.requestDate as Date).toISOString().split('T')[0] 
              : String(booking.requestDate),
            startTime: booking.startTime,
            endTime: booking.endTime,
            ownerEmail: booking.userEmail,
            ownerName: booking.userName || undefined,
            trackmanBookingId: booking.trackmanBookingId || undefined,
            source: 'auto-complete',
            createdBy: 'system-auto-checkin'
          });
          if (result.error || result.sessionId === 0) {
            sessionErrors++;
            logger.error(`[Booking Auto-Complete] Session creation failed for booking #${booking.id}: ${result.error || 'sessionId=0'}`);
          } else {
            if (result.created) {
              sessionsCreated++;
              logger.info(`[Booking Auto-Complete] Created session ${result.sessionId} for booking #${booking.id}`);
            } else {
              logger.info(`[Booking Auto-Complete] Linked existing session ${result.sessionId} to booking #${booking.id}`);
            }
            try {
              await recalculateSessionFees(result.sessionId);
              syncBookingInvoice(booking.id, result.sessionId).catch((err: unknown) => {
                logger.warn('[Booking Auto-Complete] Invoice sync failed after fee recalculation', { extra: { bookingId: booking.id, sessionId: result.sessionId, error: getErrorMessage(err) } });
              });
            } catch (feeErr: unknown) {
              logger.error('[Booking Auto-Complete] Fee recalculation failed after session creation', { extra: { bookingId: booking.id, sessionId: result.sessionId, error: getErrorMessage(feeErr) } });
            }
          }
        } catch (err) {
          sessionErrors++;
          logger.error(`[Booking Auto-Complete] Failed to create session for booking #${booking.id}:`, { extra: { error: getErrorMessage(err) } });
        }
      } else if (booking.sessionId) {
        try {
          const ledgerCheck = await queryWithRetry<{ count: number }>(
            `SELECT COUNT(*)::int as count FROM usage_ledger WHERE session_id = $1`,
            [booking.sessionId]
          );
          if ((ledgerCheck.rows[0]?.count || 0) === 0) {
            await recalculateSessionFees(booking.sessionId);
            syncBookingInvoice(booking.id, booking.sessionId).catch((err: unknown) => {
              logger.warn('[Booking Auto-Complete] Invoice sync failed after ledger backfill', { extra: { bookingId: booking.id, sessionId: booking.sessionId, error: getErrorMessage(err) } });
            });
            logger.info(`[Booking Auto-Complete] Backfilled usage ledger for existing session ${booking.sessionId} on booking #${booking.id}`);
          }
        } catch (feeErr: unknown) {
          logger.error('[Booking Auto-Complete] Fee recalculation failed for existing session', { extra: { bookingId: booking.id, sessionId: booking.sessionId, error: getErrorMessage(feeErr) } });
        }
      }
    }

    if (sessionsCreated > 0 || sessionErrors > 0) {
      logger.info(`[Booking Auto-Complete] Session backfill: ${sessionsCreated} created, ${sessionErrors} errors`);
    }

    let totalPassesConsumed = 0;
    for (const booking of markedBookings.rows) {
      let resolvedSessionId = booking.sessionId;
      if (!resolvedSessionId) {
        try {
          const sessionLookup = await queryWithRetry<{ session_id: number }>(
            `SELECT session_id FROM booking_requests WHERE id = $1 AND session_id IS NOT NULL`,
            [booking.id]
          );
          resolvedSessionId = sessionLookup.rows[0]?.session_id ?? null;
        } catch {
          // ignore lookup failure
        }
      }
      if (!resolvedSessionId) continue;

      try {
        const guestParticipants = await queryWithRetry<{ id: number; display_name: string; used_guest_pass: boolean; session_date: string | null }>(
          `SELECT bp.id, bp.display_name, bp.used_guest_pass, bs.session_date
           FROM booking_participants bp
           LEFT JOIN booking_sessions bs ON bp.session_id = bs.id
           WHERE bp.session_id = $1
             AND bp.participant_type = 'guest'
             AND bp.used_guest_pass IS NOT TRUE
             AND bp.payment_status = 'pending'`,
          [resolvedSessionId]
        );

        if (guestParticipants.rows.length === 0) continue;

        const { canUseGuestPass, consumeGuestPassForParticipant } = await import('../core/billing/guestPassConsumer');
        const { isPlaceholderGuestName } = await import('../core/billing/pricingConfig');

        const passCheck = await canUseGuestPass(booking.userEmail);
        if (!passCheck.canUse || passCheck.remaining <= 0) continue;

        const eligibleGuests = guestParticipants.rows.filter(g => !isPlaceholderGuestName(g.display_name));
        const passesToConsume = Math.min(eligibleGuests.length, passCheck.remaining);
        let consumed = 0;

        for (let i = 0; i < passesToConsume; i++) {
          const guest = eligibleGuests[i];
          const sessionDate = guest.session_date ? new Date(guest.session_date) : new Date();
          const result = await consumeGuestPassForParticipant(
            guest.id,
            booking.userEmail,
            guest.display_name || 'Guest',
            resolvedSessionId,
            sessionDate
          );
          if (result.success) {
            consumed++;
          } else {
            logger.warn('[GuestPassAutoConsume] Auto-complete pass consumption failed', { extra: { participantId: guest.id, error: result.error, bookingId: booking.id } });
            break;
          }
        }

        if (consumed > 0) {
          totalPassesConsumed += consumed;
          logger.info(`[GuestPassAutoConsume] Consumed ${consumed} pass(es) for booking #${booking.id} via auto-complete`);
        }
      } catch (passErr: unknown) {
        logger.error('[GuestPassAutoConsume] Error during auto-complete pass consumption', { extra: { bookingId: booking.id, error: getErrorMessage(passErr) } });
      }
    }

    if (totalPassesConsumed > 0) {
      logger.info(`[GuestPassAutoConsume] Auto-complete total: ${totalPassesConsumed} guest pass(es) consumed across ${markedCount} booking(s)`);
    }

    for (const booking of markedBookings.rows) {
      refreshBookingPass(booking.id).catch(err =>
        logger.error('[Booking Auto-Complete] Wallet pass refresh failed', { extra: { bookingId: booking.id, error: getErrorMessage(err) } })
      );
    }

    logger.info(`[Booking Auto-Complete] Auto checked-in ${markedCount} past booking(s)`);
    schedulerTracker.recordRun('Booking Auto-Complete', true);

    if (markedCount >= 2) {
      const summary = markedBookings.rows
        .slice(0, 5)
        .map(b => `• ${b.userName || b.userEmail} - ${b.requestDate} ${b.startTime}`)
        .join('\n');

      const moreText = markedCount > 5 ? `\n...and ${markedCount - 5} more` : '';

      await notifyAllStaff(
        'Bookings Auto Checked-In',
        `${markedCount} approved/confirmed booking(s) were auto checked-in because their scheduled time passed:\n\n${summary}${moreText}`,
        'system',
        { sendPush: false }
      );
    }

  } catch (error: unknown) {
    logger.error('[Booking Auto-Complete] Error auto-completing bookings:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun('Booking Auto-Complete', false, getErrorMessage(error));
  }
}

let intervalId: NodeJS.Timeout | null = null;
let initialTimeoutId: NodeJS.Timeout | null = null;
let isRunning = false;

async function guardedAutoComplete(): Promise<void> {
  if (isRunning) {
    logger.info('[Booking Auto-Complete] Skipping run — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    await autoCompletePastBookings();
  } finally {
    isRunning = false;
  }
}

export function startBookingAutoCompleteScheduler(): void {
  if (intervalId) {
    logger.info('[Booking Auto-Complete] Scheduler already running');
    return;
  }

  logger.info('[Startup] Booking auto-complete scheduler enabled (runs every 60 minutes)');

  intervalId = setInterval(() => {
    guardedAutoComplete().catch((err: unknown) => {
      logger.error('[Booking Auto-Complete] Uncaught error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 60 * 60 * 1000);

  initialTimeoutId = setTimeout(() => {
    initialTimeoutId = null;
    guardedAutoComplete().catch((err: unknown) => {
      logger.error('[Booking Auto-Complete] Initial run error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 30000);
}

export function stopBookingAutoCompleteScheduler(): void {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[Booking Auto-Complete] Scheduler stopped');
  }
}

export async function runManualBookingAutoComplete(): Promise<{ markedCount: number; sessionsCreated: number }> {
  logger.info('[Booking Auto-Complete] Running manual auto-complete check...');

  const todayStr = getTodayPacific();
  const currentTimePacific = formatTimePacific(new Date());


  const result = await queryWithRetry<AutoCompletedBookingResult>(
    `UPDATE booking_requests 
     SET status = 'attended',
         is_unmatched = false,
         staff_notes = COALESCE(staff_notes || E'\n', '') || '[Auto checked-in: booking time passed]',
         updated_at = NOW(),
         reviewed_at = NOW(),
         reviewed_by = 'system-auto-checkin'
     WHERE status IN ('approved', 'confirmed')
       AND status NOT IN ('attended', 'checked_in')
       AND request_date >= $1::date - INTERVAL '14 days'
       AND (
         request_date < $1::date - INTERVAL '1 day'
         OR (
           request_date = $1::date - INTERVAL '1 day'
           AND CASE
             WHEN end_time IS NOT NULL AND end_time < start_time
               THEN $2::time >= '00:30:00'::time AND end_time <= ($2::time - interval '30 minutes')
             WHEN end_time IS NOT NULL
               THEN true
             ELSE true
           END
         )
         OR (
           request_date = $1::date
           AND end_time IS NOT NULL
           AND end_time >= start_time
           AND $2::time >= '00:30:00'::time
           AND end_time <= ($2::time - interval '30 minutes')
         )
       )
       AND (
         session_id IS NULL
         OR NOT EXISTS (
           SELECT 1 FROM booking_participants bp
           WHERE bp.session_id = booking_requests.session_id
             AND bp.cached_fee_cents > 0
             AND bp.payment_status = 'pending'
         )
       )
       AND (
         session_id IS NULL
         OR EXISTS (
           SELECT 1 FROM booking_participants bp2
           WHERE bp2.session_id = booking_requests.session_id
             AND bp2.participant_type IN ('owner', 'member')
             AND bp2.user_id IS NOT NULL
         )
       )
     RETURNING id, user_email AS "userEmail", user_name AS "userName", request_date AS "requestDate",
               start_time AS "startTime", end_time AS "endTime", resource_id AS "resourceId",
               session_id AS "sessionId", trackman_booking_id AS "trackmanBookingId"`,
    [todayStr, currentTimePacific]
  );

  const markedCount = result.rows.length;
  let sessionsCreated = 0;

  for (const booking of result.rows) {
    if (!booking.sessionId && booking.resourceId) {
      try {
        const sessionResult = await ensureSessionForBooking({
          bookingId: booking.id,
          resourceId: booking.resourceId,
          sessionDate: typeof booking.requestDate === 'object'
            ? (booking.requestDate as Date).toISOString().split('T')[0]
            : String(booking.requestDate),
          startTime: booking.startTime,
          endTime: booking.endTime,
          ownerEmail: booking.userEmail,
          ownerName: booking.userName || undefined,
          trackmanBookingId: booking.trackmanBookingId || undefined,
          source: 'manual-auto-complete',
          createdBy: 'system-auto-checkin'
        });
        if (sessionResult.error || sessionResult.sessionId === 0) {
          logger.error(`[Booking Auto-Complete] Manual: session creation failed for booking #${booking.id}: ${sessionResult.error || 'sessionId=0'}`);
        } else {
          if (sessionResult.created) {
            sessionsCreated++;
          }
          try {
            await recalculateSessionFees(sessionResult.sessionId);
            syncBookingInvoice(booking.id, sessionResult.sessionId).catch((err: unknown) => {
              logger.warn('[Booking Auto-Complete] Manual: invoice sync failed', { extra: { bookingId: booking.id, sessionId: sessionResult.sessionId, error: getErrorMessage(err) } });
            });
          } catch (feeErr: unknown) {
            logger.error('[Booking Auto-Complete] Manual: fee recalculation failed', { extra: { bookingId: booking.id, sessionId: sessionResult.sessionId, error: getErrorMessage(feeErr) } });
          }
        }
      } catch (err) {
        logger.error(`[Booking Auto-Complete] Manual: failed to create session for booking #${booking.id}:`, { extra: { error: getErrorMessage(err) } });
      }
    } else if (booking.sessionId) {
      try {
        const ledgerCheck = await queryWithRetry<{ count: number }>(
          `SELECT COUNT(*)::int as count FROM usage_ledger WHERE session_id = $1`,
          [booking.sessionId]
        );
        if ((ledgerCheck.rows[0]?.count || 0) === 0) {
          await recalculateSessionFees(booking.sessionId);
          syncBookingInvoice(booking.id, booking.sessionId).catch((err: unknown) => {
            logger.warn('[Booking Auto-Complete] Manual: invoice sync failed after ledger backfill', { extra: { bookingId: booking.id, sessionId: booking.sessionId, error: getErrorMessage(err) } });
          });
        }
      } catch (feeErr: unknown) {
        logger.error('[Booking Auto-Complete] Manual: fee recalculation failed for existing session', { extra: { bookingId: booking.id, sessionId: booking.sessionId, error: getErrorMessage(feeErr) } });
      }
    }
  }

  for (const booking of result.rows) {
    refreshBookingPass(booking.id).catch(err =>
      logger.error('[Booking Auto-Complete] Manual: wallet pass refresh failed', { extra: { bookingId: booking.id, error: getErrorMessage(err) } })
    );
  }

  logger.info(`[Booking Auto-Complete] Manual run auto checked-in ${markedCount} booking(s), created ${sessionsCreated} session(s)`);

  return { markedCount, sessionsCreated };
}
