import { db } from '../../db';
import { bookingRequests, resources, notifications, users, bookingParticipants, stripePaymentIntents } from '../../../shared/schema';
import { eq, and, or, gt, lt, lte, gte, ne, sql, isNull, isNotNull } from 'drizzle-orm';
import { sendPushNotification } from '../pushService';
import { formatNotificationDateTime, formatDateDisplayWithDay, formatTime12Hour, formatDateFromDb } from '../../utils/dateUtils';
import { logger } from '../logger';
import { notifyAllStaff, notifyMember, isSyntheticEmail } from '../notificationService';
import { checkClosureConflict, checkAvailabilityBlockConflict } from '../bookingValidation';
import { bookingEvents } from '../bookingEvents';
import { sendNotificationToUser, broadcastAvailabilityUpdate, broadcastMemberStatsUpdated, broadcastBillingUpdate } from '../websocket';
import { refundGuestPass } from '../billing/guestPassService';
import { updateHubSpotContactVisitCount } from '../memberSync';
import { createSessionWithUsageTracking, ensureSessionForBooking, createOrFindGuest } from './sessionManager';
import { recalculateSessionFees } from '../billing/unifiedFeeService';
import { PaymentStatusService } from '../billing/PaymentStatusService';
import { cancelPaymentIntent, getStripeClient } from '../stripe';
import { cancelPendingPaymentIntentsForBooking } from '../billing/paymentIntentCleanup';
import Stripe from 'stripe';
import { getCalendarNameForBayAsync } from '../calendar/calendarHelpers';
import { getCalendarIdByName, createCalendarEventOnCalendar, deleteCalendarEvent } from '../calendar/index';
import { releaseGuestPassHold } from '../billing/guestPassHoldService';
import { createPrepaymentIntent } from '../billing/prepaymentService';
import { voidBookingInvoice, finalizeAndPayInvoice, syncBookingInvoice, getBookingInvoiceId } from '../billing/bookingInvoiceService';
import { getErrorMessage } from '../../utils/errorUtils';
import { upsertVisitor } from '../visitors/matchingService';
import { AppError, assertBookingVersion } from '../errors';
import { logPaymentAudit } from '../auditLog';
import { voidBookingPass, refreshBookingPass } from '../../walletPass/bookingPassService';
import { BookingUpdateResult } from './approvalTypes';

export async function revertToApproved(params: { bookingId: number; staffEmail: string; expectedVersion?: number }) {
  const { bookingId, staffEmail, expectedVersion } = params;

  const existingResult = await db.select({
    status: bookingRequests.status,
    userEmail: bookingRequests.userEmail,
    userName: bookingRequests.userName,
    sessionId: bookingRequests.sessionId,
    version: bookingRequests.version,
  })
    .from(bookingRequests)
    .where(eq(bookingRequests.id, bookingId));

  if (existingResult.length === 0) {
    return { error: 'Booking not found', statusCode: 404 };
  }

  const existing = existingResult[0];

  assertBookingVersion(expectedVersion, existing.version);

  const allowedStatuses = ['attended', 'no_show', 'checked_in'];
  if (!existing.status || !allowedStatuses.includes(existing.status)) {
    return { error: `Cannot revert from status "${existing.status}"`, statusCode: 400 };
  }

  const previousStatus = existing.status;

  let reverted = false;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL app.bypass_status_check = 'true'`);
    const revertResult = await tx.execute(
      sql`UPDATE booking_requests SET status = 'approved', reviewed_by = ${staffEmail}, reviewed_at = NOW(), updated_at = NOW(), version = COALESCE(version, 1) + 1 WHERE id = ${bookingId} AND status IN ('attended', 'no_show', 'checked_in')`
    );

    if ((revertResult as unknown as { rowCount: number }).rowCount === 0) {
      return;
    }

    reverted = true;

    if (existing.sessionId) {
      await tx.execute(
        sql`UPDATE booking_participants bp SET payment_status = 'pending'
         FROM booking_sessions bs
         WHERE bp.session_id = ${existing.sessionId} AND bp.payment_status = 'waived'
           AND bs.id = bp.session_id
           AND (bs.source IS NULL OR bs.source::text NOT IN ('trackman_import', 'trackman_webhook'))`
      );
    }
  });

  if (!reverted) {
    logger.warn('[RevertToApproved] Status already changed by concurrent action — skipping revert', {
      extra: { bookingId, expectedStatuses: ['attended', 'no_show', 'checked_in'], staffEmail }
    });
    return { error: 'Booking status was changed by another action. Please refresh and try again.', statusCode: 409 };
  }

  logger.info('[RevertToApproved] Booking reverted to approved', {
    extra: { bookingId, previousStatus, staffEmail, memberEmail: existing.userEmail }
  });

  return { success: true, previousStatus, bookingId };
}

const ALLOWED_STATUS_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'declined', 'cancelled', 'cancellation_pending'],
  approved: ['attended', 'no_show', 'cancelled', 'cancellation_pending', 'confirmed'],
  confirmed: ['attended', 'no_show', 'cancelled', 'cancellation_pending'],
  cancellation_pending: ['approved'],
  declined: ['pending'],
  attended: [],
  cancelled: [],
  no_show: [],
};

export async function updateGenericStatus(bookingId: number, status: string, staff_notes?: string, expectedVersion?: number) {
  const [current] = await db.select({ status: bookingRequests.status, version: bookingRequests.version })
    .from(bookingRequests)
    .where(eq(bookingRequests.id, bookingId));

  if (!current) {
    throw new Error(`Booking ${bookingId} not found`);
  }

  assertBookingVersion(expectedVersion, current.version);

  const currentStatus = current.status || 'pending';
  const allowed = ALLOWED_STATUS_TRANSITIONS[currentStatus];
  if (allowed && !allowed.includes(status)) {
    throw new Error(`Invalid status transition from '${currentStatus}' to '${status}'`);
  }

  const allowedSourceStatuses = Object.entries(ALLOWED_STATUS_TRANSITIONS)
    .filter(([, targets]) => targets.includes(status))
    .map(([source]) => source);

  const result = await db.update(bookingRequests)
    .set({
      status: status,
      staffNotes: staff_notes || undefined,
      updatedAt: new Date(),
      version: sql`COALESCE(${bookingRequests.version}, 1) + 1`
    })
    .where(and(
      eq(bookingRequests.id, bookingId),
      sql`status IN (${sql.join(allowedSourceStatuses.map(s => sql`${s}`), sql`, `)})`
    ))
    .returning();

  if (result.length === 0) {
    throw new Error(`Booking ${bookingId} status changed concurrently — cannot transition to '${status}'`);
  }

  return result;
}

interface CheckinExistingRow {
  status: string | null;
  user_email: string;
  session_id: number | null;
  resource_id: number | null;
  request_date: string;
  start_time: string;
  end_time: string;
  declared_player_count: number | null;
  user_name: string | null;
}

interface RosterRow {
  trackman_player_count: number | null;
  declared_player_count: number | null;
  session_id: number | null;
  total_slots: string;
  empty_slots: string;
  participant_count: string;
}

export interface DevConfirmBookingRow {
  id: number;
  status: string | null;
  user_email: string;
  user_name: string | null;
  user_id: string | null;
  stripe_customer_id: string | null;
  tier: string | null;
  resource_id: number | null;
  request_date: string | Date;
  start_time: string;
  end_time: string;
  session_id: number | null;
  owner_email: string | null;
  request_participants: unknown;
}

interface CheckinBookingParams {
  bookingId: number;
  targetStatus?: string;
  confirmPayment?: boolean;
  skipPaymentCheck?: boolean;
  skipRosterCheck?: boolean;
  staffEmail: string;
  staffName: string | null;
  expectedVersion?: number;
}

export async function checkinBooking(params: CheckinBookingParams) {
  const { bookingId, targetStatus, confirmPayment, skipPaymentCheck, skipRosterCheck, staffEmail, staffName, expectedVersion } = params;

  const validStatuses = ['attended', 'no_show'];
  const newStatus = validStatuses.includes(targetStatus || '') ? targetStatus! : 'attended';

  const existingResult = await db.select({
    status: bookingRequests.status,
    user_email: bookingRequests.userEmail,
    session_id: bookingRequests.sessionId,
    resource_id: bookingRequests.resourceId,
    request_date: bookingRequests.requestDate,
    start_time: bookingRequests.startTime,
    end_time: bookingRequests.endTime,
    declared_player_count: bookingRequests.declaredPlayerCount,
    version: bookingRequests.version,
    user_name: sql`COALESCE(
      NULLIF(TRIM(CONCAT_WS(' ', ${users.firstName}, ${users.lastName})), ''),
      NULLIF(${bookingRequests.userName}, ''),
      ${bookingRequests.userEmail}
    )`.as('user_name')
  })
    .from(bookingRequests)
    .leftJoin(users, eq(bookingRequests.userId, users.id))
    .where(eq(bookingRequests.id, bookingId));

  if (existingResult.length === 0) {
    return { error: 'Booking not found', statusCode: 404 };
  }

  const existing: CheckinExistingRow = existingResult[0] as unknown as CheckinExistingRow;

  assertBookingVersion(expectedVersion, (existingResult[0] as unknown as { version: number | null }).version);
  const currentStatus = existing.status;

  if (newStatus === 'attended') {
    const ownerStatusResult = await db.execute(sql`
      SELECT membership_status, tier FROM users 
      WHERE LOWER(email) = LOWER(${existing.user_email ?? null})
      LIMIT 1
    `);
    const ownerStatus = (ownerStatusResult.rows[0] as unknown as { membership_status: string | null })?.membership_status;
    const blockedStatuses = ['cancelled', 'suspended', 'terminated', 'inactive', 'archived'];
    if (ownerStatus && blockedStatuses.includes(ownerStatus) && !skipPaymentCheck) {
      logger.warn('[Checkin] Attempting check-in for member with blocked status', { extra: { bookingId, ownerEmail: existing.user_email, membershipStatus: ownerStatus } });
      return {
        error: `Member status is "${ownerStatus}". Check-in blocked — membership is no longer active.`,
        statusCode: 403,
        membershipBlocked: true,
        membershipStatus: ownerStatus
      };
    }
  }

  if (currentStatus === newStatus) {
    return { success: true, message: `Already marked as ${newStatus}`, alreadyProcessed: true };
  }

  if (newStatus === 'attended' && !existing.session_id && existing.resource_id) {
    try {
      const userResult = await db.select({ id: users.id })
        .from(users)
        .where(eq(sql`LOWER(${users.email})`, (existing.user_email || '').toLowerCase()))
        .limit(1);
      const userId = userResult[0]?.id || null;

      const sessionResult = await ensureSessionForBooking({
        bookingId,
        resourceId: existing.resource_id,
        sessionDate: existing.request_date,
        startTime: existing.start_time,
        endTime: existing.end_time,
        ownerEmail: existing.user_email || '',
        ownerName: existing.user_name || undefined,
        ownerUserId: userId?.toString() || undefined,
        source: 'staff_manual',
        createdBy: staffEmail
      });
      if (sessionResult.sessionId) {
        existing.session_id = sessionResult.sessionId;
        await recalculateSessionFees(sessionResult.sessionId, 'checkin');
        syncBookingInvoice(bookingId, sessionResult.sessionId).catch((err: unknown) => {
          logger.warn('[Checkin] Invoice sync failed after session creation', { extra: { bookingId, sessionId: sessionResult.sessionId, error: getErrorMessage(err) } });
        });
      }
    } catch (err: unknown) {
      logger.error('[Checkin] Failed to auto-create session', { extra: { error: getErrorMessage(err) } });
    }
  }

  const hasSession = existing.session_id !== null;
  const allowedStatuses = ['approved', 'confirmed', 'attended', 'no_show', 'checked_in'];
  if (hasSession && (currentStatus === 'cancelled' || currentStatus === 'cancellation_pending')) {
    allowedStatuses.push('cancelled', 'cancellation_pending');
  }

  if (!allowedStatuses.includes(currentStatus || '')) {
    return { error: `Cannot update booking with status: ${currentStatus}`, statusCode: 400 };
  }

  if (newStatus === 'attended' && !skipRosterCheck) {
    const rosterResult = await db.execute(sql`
      SELECT 
        br.trackman_player_count,
        br.declared_player_count,
        br.session_id,
        (SELECT COUNT(*) FROM booking_participants bp WHERE bp.session_id = br.session_id AND NOT (bp.participant_type = 'guest' AND bp.user_id IS NULL AND bp.guest_id IS NULL AND bp.display_name = 'Empty Slot')) as total_slots,
        0 as empty_slots,
        (SELECT COUNT(*) FROM booking_participants bp WHERE bp.session_id = br.session_id AND NOT (bp.participant_type = 'guest' AND bp.user_id IS NULL AND bp.guest_id IS NULL AND bp.display_name = 'Empty Slot')) as participant_count
      FROM booking_requests br
      WHERE br.id = ${bookingId}
    `);

    if (rosterResult.rows.length > 0) {
      const roster = rosterResult.rows[0] as unknown as RosterRow;
      const declaredCount = roster.declared_player_count || roster.trackman_player_count || 1;
      const participantCount = parseInt(roster.participant_count, 10) || 0;

      if (!(roster.session_id && participantCount >= declaredCount)) {
        const emptySlots = parseInt(roster.empty_slots, 10) || 0;
        const totalSlots = parseInt(roster.total_slots, 10) || 0;

        if (emptySlots > 0 && declaredCount > 1) {
          return {
            error: 'Roster incomplete',
            statusCode: 402,
            requiresRoster: true,
            emptySlots,
            totalSlots,
            declaredPlayerCount: declaredCount,
            message: `${emptySlots} player slot${emptySlots > 1 ? 's' : ''} not assigned. Staff must link members or add guests before check-in to ensure proper billing.`
          };
        }
      }
    }
  }

  if (newStatus === 'attended' && !existing.session_id && !skipPaymentCheck) {
    return {
      error: 'Billing session not generated yet',
      statusCode: 400,
      requiresSync: true,
      message: 'Billing session not generated yet - Check Trackman Sync. The session may need to be synced from Trackman before check-in to ensure proper billing.'
    };
  }

  let totalOutstanding = 0;
  const unpaidParticipants: Array<{ id: number; name: string; amount: number }> = [];

  if (newStatus === 'attended' && existing.session_id) {
    const nullFeesCheck = await db.execute(sql`
      SELECT COUNT(*) as null_count
      FROM booking_participants bp
      WHERE bp.session_id = ${existing.session_id} AND bp.payment_status = 'pending' AND (bp.cached_fee_cents IS NULL OR bp.cached_fee_cents = 0)
    `);

    if (parseInt((nullFeesCheck.rows[0] as unknown as { null_count: string })?.null_count, 10) > 0) {
      try {
        await recalculateSessionFees(existing.session_id as number, 'checkin');
        logger.info('[Check-in Guard] Recalculated fees for session - some participants had NULL or zero cached_fee_cents', { extra: { existingSession_id: existing.session_id } });
        syncBookingInvoice(bookingId, existing.session_id as number).catch((err: unknown) => {
          logger.warn('[Check-in Guard] Invoice sync failed after fee recalculation', { extra: { bookingId, session_id: existing.session_id, error: getErrorMessage(err) } });
        });
      } catch (recalcError: unknown) {
        logger.error('[Check-in Guard] Failed to recalculate fees for session', { extra: { session_id: existing.session_id, error: getErrorMessage(recalcError) } });
      }
    }

    const balanceResult = await db.execute(sql`
      SELECT 
        bp.id as participant_id,
        bp.display_name,
        bp.participant_type,
        bp.payment_status,
        COALESCE(bp.cached_fee_cents, 0)::numeric / 100.0 as fee_amount
      FROM booking_participants bp
      WHERE bp.session_id = ${existing.session_id} AND bp.payment_status = 'pending'
    `);

    for (const p of balanceResult.rows as unknown as Array<{ participant_id: number; display_name: string; participant_type: string; payment_status: string; fee_amount: string }>) {
      const amount = parseFloat(p.fee_amount);
      if (amount > 0) {
        totalOutstanding += amount;
        unpaidParticipants.push({
          id: p.participant_id,
          name: p.display_name,
          amount
        });
      }
    }

    if (totalOutstanding > 0) {
      const prepaidResult = await db.execute(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::numeric / 100.0 as prepaid_total
        FROM conference_prepayments
        WHERE booking_id = ${bookingId} AND status IN ('succeeded', 'completed')
      `);
      const prepaidTotal = parseFloat((prepaidResult.rows[0] as unknown as { prepaid_total: string })?.prepaid_total || '0');
      if (prepaidTotal > 0) {
        totalOutstanding = Math.max(0, totalOutstanding - prepaidTotal);
        logger.info('[Check-in Guard] Deducted conference prepayment from outstanding balance', {
          extra: { bookingId, prepaidTotal, remainingOutstanding: totalOutstanding }
        });
      }
    }

    if (totalOutstanding > 0 && !confirmPayment) {
      if (skipPaymentCheck) {
        await logPaymentAudit({
          bookingId,
          sessionId: existing.session_id as number,
          action: 'payment_check_bypassed',
          staffEmail,
          staffName,
          amountAffected: totalOutstanding,
          metadata: { unpaidParticipants, bypassed: true, reason: 'skipPaymentCheck flag used' },
        });
        logger.warn(`[Check-in Guard] AUDIT: Payment check bypassed by ${staffEmail} for booking ${bookingId}, outstanding: $${totalOutstanding.toFixed(2)}`);
      } else {
        await logPaymentAudit({
          bookingId,
          sessionId: existing.session_id as number,
          action: 'checkin_guard_triggered',
          staffEmail,
          staffName,
          amountAffected: totalOutstanding,
          metadata: { unpaidParticipants },
        });

        return {
          error: 'Cannot complete check-in: All fees must be collected first',
          statusCode: 402,
          code: 'OUTSTANDING_BALANCE',
          requiresPayment: true,
          totalOutstanding,
          unpaidParticipants,
          pendingCount: unpaidParticipants.length,
          message: `Outstanding balance of $${totalOutstanding.toFixed(2)}. Has the member paid?`
        };
      }
    }

  }

  const txResult = await db.transaction(async (tx) => {
    const lockedRow = await tx.execute(sql`
      SELECT br.status, br.session_id, br.user_email
      FROM booking_requests br
      WHERE br.id = ${bookingId}
      FOR UPDATE
    `);

    if (lockedRow.rows.length === 0) {
      return { driftError: 'Booking not found during commit', driftCode: 404 };
    }

    const locked = lockedRow.rows[0] as unknown as { status: string | null; session_id: number | null; user_email: string | null };

    if (locked.status !== currentStatus) {
      return { driftError: `Booking status changed from "${currentStatus}" to "${locked.status}" since you loaded this page. Please refresh and try again.`, driftCode: 409 };
    }

    if (newStatus === 'attended' && !skipPaymentCheck) {
      const txOwnerStatus = await tx.execute(sql`
        SELECT membership_status FROM users
        WHERE LOWER(email) = LOWER(${locked.user_email ?? null})
        LIMIT 1
      `);
      const txMemberStatus = (txOwnerStatus.rows[0] as unknown as { membership_status: string | null })?.membership_status;
      const blockedStatuses = ['cancelled', 'suspended', 'terminated', 'inactive', 'archived'];
      if (txMemberStatus && blockedStatuses.includes(txMemberStatus)) {
        return { driftError: `Member status changed to "${txMemberStatus}" since you loaded this page. Check-in blocked.`, driftCode: 409, membershipBlocked: true };
      }
    }

    const txSessionId = locked.session_id ?? existing.session_id;

    if (newStatus === 'attended' && !skipRosterCheck && txSessionId) {
      const txRoster = await tx.execute(sql`
        SELECT
          br.declared_player_count,
          br.trackman_player_count,
          br.session_id,
          (SELECT COUNT(*) FROM booking_participants bp WHERE bp.session_id = br.session_id AND NOT (bp.participant_type = 'guest' AND bp.user_id IS NULL AND bp.guest_id IS NULL AND bp.display_name = 'Empty Slot')) as participant_count
        FROM booking_requests br
        WHERE br.id = ${bookingId}
      `);
      if (txRoster.rows.length > 0) {
        const r = txRoster.rows[0] as unknown as { declared_player_count: number | null; trackman_player_count: number | null; session_id: number | null; participant_count: string };
        const declaredCount = r.declared_player_count || r.trackman_player_count || 1;
        const participantCount = parseInt(r.participant_count, 10) || 0;
        if (!(r.session_id && participantCount >= declaredCount) && declaredCount > 1) {
          return { driftError: `Roster changed since you loaded this page. ${declaredCount - participantCount} player slot(s) now unassigned. Please refresh.`, driftCode: 409, requiresRoster: true };
        }
      }
    }

    if (newStatus === 'attended' && !skipPaymentCheck && txSessionId) {
      await tx.execute(sql`
        SELECT bp.id FROM booking_participants bp
        WHERE bp.session_id = ${txSessionId}
        FOR SHARE
      `);

      const txBalance = await tx.execute(sql`
        SELECT
          COALESCE(SUM(CASE WHEN bp.payment_status = 'pending' AND COALESCE(bp.cached_fee_cents, 0) > 0
            THEN COALESCE(bp.cached_fee_cents, 0)::numeric / 100.0 ELSE 0 END), 0) as tx_outstanding
        FROM booking_participants bp
        WHERE bp.session_id = ${txSessionId}
      `);
      const txOutstanding = parseFloat((txBalance.rows[0] as unknown as { tx_outstanding: string })?.tx_outstanding || '0');

      let txNetOutstanding = txOutstanding;
      if (txOutstanding > 0) {
        const txPrepaid = await tx.execute(sql`
          SELECT COALESCE(SUM(amount_cents), 0)::numeric / 100.0 as prepaid_total
          FROM conference_prepayments
          WHERE booking_id = ${bookingId} AND status IN ('succeeded', 'completed')
        `);
        const txPrepaidTotal = parseFloat((txPrepaid.rows[0] as unknown as { prepaid_total: string })?.prepaid_total || '0');
        txNetOutstanding = Math.max(0, txOutstanding - txPrepaidTotal);
      }

      if (!confirmPayment && txNetOutstanding > 0 && totalOutstanding <= 0) {
        return { driftError: `Fees were updated since you loaded this page. Outstanding balance is now $${txNetOutstanding.toFixed(2)}. Please refresh.`, driftCode: 409, requiresPayment: true, totalOutstanding: txNetOutstanding };
      }

      if (txNetOutstanding > 0 && totalOutstanding > 0) {
        const drift = Math.abs(txNetOutstanding - totalOutstanding);
        if (drift > 0.01) {
          return { driftError: `Outstanding balance changed from $${totalOutstanding.toFixed(2)} to $${txNetOutstanding.toFixed(2)} since you loaded this page. Please refresh.`, driftCode: 409, requiresPayment: true, totalOutstanding: txNetOutstanding };
        }
      }
    }

    if (skipPaymentCheck) {
      await tx.execute(sql`SET LOCAL app.bypass_status_check = 'true'`);
    }

    const updated = await tx.update(bookingRequests)
      .set({
        status: newStatus,
        isUnmatched: false,
        updatedAt: new Date(),
        version: sql`COALESCE(${bookingRequests.version}, 1) + 1`
      })
      .where(and(
        eq(bookingRequests.id, bookingId),
        eq(bookingRequests.status, currentStatus || '')
      ))
      .returning();

    if (updated.length === 0) {
      return null;
    }

    let paidParticipants: Array<{ id: number; display_name: string; fee_cents: number }> = [];
    if (confirmPayment && totalOutstanding > 0 && existing.session_id) {
      const freshUnpaid = await tx.execute(sql`
        SELECT bp.id, bp.display_name, COALESCE(bp.cached_fee_cents, 0) as fee_cents
        FROM booking_participants bp
        WHERE bp.session_id = ${existing.session_id} AND bp.payment_status = 'pending'
          AND COALESCE(bp.cached_fee_cents, 0) > 0
        FOR UPDATE
      `);
      paidParticipants = freshUnpaid.rows as unknown as Array<{ id: number; display_name: string; fee_cents: number }>;
      for (const row of paidParticipants) {
        await tx.update(bookingParticipants)
          .set({ paymentStatus: 'paid' })
          .where(eq(bookingParticipants.id, row.id));
      }
    }

    return { updated, paidParticipants };
  });

  if (txResult && 'driftError' in txResult) {
    logger.warn('[Checkin] Precondition drift detected during atomic check-in', {
      extra: { bookingId, drift: txResult.driftError, code: txResult.driftCode }
    });
    const { driftError, driftCode, ...rest } = txResult;
    return { error: driftError, statusCode: driftCode, ...rest };
  }

  if (!txResult || !('updated' in txResult) || txResult.updated.length === 0) {
    logger.warn('[Checkin] Booking status changed during check-in, possible race condition', { extra: { bookingId, expectedStatus: currentStatus, newStatus } });
    return { error: 'Booking status changed during check-in. Please refresh and try again.', statusCode: 409 };
  }

  const result = txResult.updated;
  const { paidParticipants } = txResult;

  if (confirmPayment && paidParticipants.length > 0) {
    let confirmedTotal = 0;

    for (const p of paidParticipants) {
      const amount = (p.fee_cents || 0) / 100;
      confirmedTotal += amount;
      await logPaymentAudit({
        bookingId,
        sessionId: existing.session_id as number,
        participantId: p.id,
        action: 'payment_confirmed',
        staffEmail,
        staffName,
        amountAffected: amount,
        previousStatus: 'pending',
        newStatus: 'paid',
      });
    }

    broadcastBillingUpdate({
      action: 'booking_payment_updated',
      bookingId,
      sessionId: existing.session_id as number,
      memberEmail: existing.user_email as string,
      amount: Math.round(confirmedTotal * 100)
    });
  }

  const booking = result[0];
  const checkinSideEffectErrors: Array<{ action: string; error: string; context?: Record<string, unknown> }> = [];

  if (newStatus === 'attended' && booking.userEmail) {
    const updateResult = await db.execute(sql`
      UPDATE users 
       SET lifetime_visits = COALESCE(lifetime_visits, 0) + 1 
       WHERE email = ${booking.userEmail}
       RETURNING lifetime_visits, hubspot_id
    `);

    const updatedUser = updateResult.rows[0] as { lifetime_visits: number; hubspot_id: string | null } | undefined;
    if (updatedUser?.hubspot_id && updatedUser.lifetime_visits) {
      try {
        await updateHubSpotContactVisitCount(updatedUser.hubspot_id, updatedUser.lifetime_visits);
      } catch (err: unknown) {
        const errMsg = getErrorMessage(err);
        logger.error('[Bays] Failed to sync visit count to HubSpot:', { extra: { error: errMsg } });
        checkinSideEffectErrors.push({ action: 'hubspot_visit_sync', error: errMsg, context: { hubspotId: updatedUser.hubspot_id, lifetimeVisits: updatedUser.lifetime_visits } });
      }
    }

    if (updatedUser?.lifetime_visits) {
      try { broadcastMemberStatsUpdated(booking.userEmail, { lifetimeVisits: updatedUser.lifetime_visits }); } catch (err: unknown) { logger.error('[Broadcast] Stats update error', { extra: { error: getErrorMessage(err) } }); }
    }

    const dateStr = formatDateFromDb(booking.requestDate as Date | string);
    const formattedDate = formatDateDisplayWithDay(dateStr);
    const formattedTime = formatTime12Hour(booking.startTime);

    try {
      await notifyMember({
        userEmail: booking.userEmail,
        title: 'Checked In',
        message: `Thanks for visiting! Your session on ${formattedDate} at ${formattedTime} has been checked in.`,
        type: 'booking',
        relatedId: bookingId,
        relatedType: 'booking',
        url: '/sims'
      });
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      logger.error('[Checkin] Member notification failed', { extra: { bookingId, error: errMsg } });
      checkinSideEffectErrors.push({
        action: 'checkin_notification',
        error: errMsg,
        context: {
          title: 'Checked In',
          message: `Thanks for visiting! Your session on ${formattedDate} at ${formattedTime} has been checked in.`,
          notificationType: 'booking',
          relatedId: bookingId,
          relatedType: 'booking',
        },
      });
    }
  }

  if (newStatus === 'attended') {
    try {
      await refreshBookingPass(bookingId);
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      logger.error('[Checkin] Wallet pass refresh failed after attended', { extra: { bookingId, error: errMsg } });
      checkinSideEffectErrors.push({ action: 'wallet_pass_refresh', error: errMsg });
    }
  }

  if (newStatus === 'no_show') {
    try {
      await voidBookingPass(bookingId);
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      logger.error('[Checkin] Wallet pass void failed after no-show', { extra: { bookingId, error: errMsg } });
      checkinSideEffectErrors.push({ action: 'wallet_pass_void', error: errMsg });
    }
  }

  if (newStatus === 'no_show' && booking.userEmail && !isSyntheticEmail(booking.userEmail)) {
    const noShowDateStr = formatDateFromDb(booking.requestDate as Date | string);
    const formattedDate = formatDateDisplayWithDay(noShowDateStr);
    const formattedTime = formatTime12Hour(booking.startTime);

    try {
      await notifyMember({
        userEmail: booking.userEmail,
        title: 'Missed Booking',
        message: `You were marked as a no-show for your booking on ${formattedDate} at ${formattedTime}. If this was in error, please contact staff.`,
        type: 'booking',
        relatedType: 'booking',
        url: '/dashboard'
      }, { sendPush: true });
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      logger.error('[approval] No-show notification failed', { extra: { error: errMsg } });
      checkinSideEffectErrors.push({
        action: 'no_show_notification',
        error: errMsg,
        context: {
          title: 'Missed Booking',
          message: `You were marked as a no-show for your booking on ${formattedDate} at ${formattedTime}. If this was in error, please contact staff.`,
          notificationType: 'booking',
          relatedId: bookingId,
          relatedType: 'booking',
        },
      });
    }

    sendNotificationToUser(booking.userEmail, {
      type: 'notification',
      title: 'Missed Booking',
      message: `You were marked as a no-show for your booking on ${formattedDate} at ${formattedTime}. If this was in error, please contact staff.`,
      data: { bookingId, eventType: 'booking_no_show' }
    }, { action: 'booking_no_show', bookingId, triggerSource: 'approval.ts' });
  }

  if (checkinSideEffectErrors.length > 0) {
    try {
      const { persistSideEffectFailures } = await import('../deferredSideEffects');
      await persistSideEffectFailures(bookingId, 'checkin', checkinSideEffectErrors.map(se => ({
        actionType: se.action,
        errorMessage: se.error,
        context: { status: newStatus, memberEmail: booking.userEmail, ...se.context },
      })));
    } catch (persistErr: unknown) {
      logger.error('[Checkin] CRITICAL: Failed to persist side effect failures', {
        extra: { bookingId, errors: checkinSideEffectErrors, persistError: getErrorMessage(persistErr) }
      });
    }
  }

  return { success: true, booking: result[0] };
}

interface DevConfirmParams {
  bookingId: number;
  staffEmail: string;
}
