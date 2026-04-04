import { db } from '../../db';
import { bookingRequests, resources, bookingParticipants, stripePaymentIntents, notifications } from '../../../shared/schema';
import { eq, and, or, ne, sql, isNull, isNotNull } from 'drizzle-orm';
import { formatNotificationDateTime, createPacificDate } from '../../utils/dateUtils';
import { logger } from '../logger';
import { notifyAllStaff, notifyMember, isNotifiableEmail } from '../notificationService';
import { bookingEvents } from '../bookingEvents';
import { sendNotificationToUser, broadcastAvailabilityUpdate } from '../websocket';
import { refundGuestPass } from '../billing/guestPassService';
import { getCalendarNameForBayAsync } from '../calendar/calendarHelpers';
import { getCalendarIdByName, deleteCalendarEvent } from '../calendar/index';
import { voidBookingInvoice } from '../billing/bookingInvoiceService';
import { getErrorMessage } from '../../utils/errorUtils';
import { assertBookingVersion } from '../errors';
import { toIntArrayLiteral } from '../../utils/sqlArrayLiteral';
import { queueJob } from '../jobQueue';
import { voidBookingPass } from '../../walletPass/bookingPassService';
import { getStripeClient } from '../stripe/client';
import { cancelPaymentIntent } from '../stripe/payments';
import { markPaymentRefunded } from '../billing/PaymentStatusService';
import { failedSideEffects } from '../../../shared/schema';
import { ensureDateString, ensureTimeString } from '../../utils/dateTimeUtils';
import type { CancelResult, SideEffectsManifest, BookingRecord, FeeSnapshotRow, BalancePaymentRow } from './bookingStateTypes';
import { executeSideEffects, persistFailedSideEffects } from './bookingSideEffects';
import { cancelCleanupAlert } from './cleanupAlertScheduler';

export class BookingStateService {
  static async cancelBooking(params: {
    bookingId: number;
    source: 'staff' | 'member' | 'trackman_webhook' | 'system';
    cancelledBy?: string;
    staffNotes?: string;
    staffEmail?: string;
    enforceLateCancel?: boolean;
    expectedVersion?: number;
  }): Promise<CancelResult> {
    const { bookingId, source, cancelledBy, staffNotes, staffEmail, enforceLateCancel, expectedVersion } = params;

    let booking: BookingRecord;
    try {
      const [existing] = await db.select({
        id: bookingRequests.id,
        userEmail: bookingRequests.userEmail,
        userName: bookingRequests.userName,
        resourceId: bookingRequests.resourceId,
        requestDate: bookingRequests.requestDate,
        startTime: bookingRequests.startTime,
        durationMinutes: bookingRequests.durationMinutes,
        status: bookingRequests.status,
        calendarEventId: bookingRequests.calendarEventId,
        sessionId: bookingRequests.sessionId,
        trackmanBookingId: bookingRequests.trackmanBookingId,
        staffNotes: bookingRequests.staffNotes,
        version: bookingRequests.version,
      })
        .from(bookingRequests)
        .where(eq(bookingRequests.id, bookingId));

      if (!existing) {
        return {
          success: false,
          status: 'cancelled',
          bookingId,
          bookingData: { userEmail: '', userName: null, resourceId: null, requestDate: '', startTime: '', durationMinutes: null, calendarEventId: null, sessionId: null, trackmanBookingId: null },
          error: 'Booking request not found',
          statusCode: 404,
        };
      }

      assertBookingVersion(expectedVersion, existing.version);

      booking = existing;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'StaleBookingVersionError') {
        throw err;
      }
      return {
        success: false,
        status: 'cancelled',
        bookingId,
        bookingData: { userEmail: '', userName: null, resourceId: null, requestDate: '', startTime: '', durationMinutes: null, calendarEventId: null, sessionId: null, trackmanBookingId: null },
        error: getErrorMessage(err),
        statusCode: 500,
      };
    }

    if (booking.status === 'cancelled') {
      return {
        success: true,
        status: 'cancelled',
        bookingId,
        bookingData: this.extractBookingData(booking),
      };
    }

    if (booking.status === 'cancellation_pending' && source !== 'trackman_webhook') {
      if (source === 'staff') {
        logger.warn('[BookingStateService] Blocked staff manual cancellation completion for cancellation_pending booking', {
          extra: { bookingId, source, cancelledBy }
        });
        return {
          success: false,
          status: 'cancellation_pending',
          bookingId,
          bookingData: this.extractBookingData(booking),
          error: 'Booking is awaiting Trackman cancellation confirmation. Please cancel in Trackman first.',
          statusCode: 403,
        };
      }
      return {
        success: true,
        status: 'cancellation_pending',
        bookingId,
        bookingData: this.extractBookingData(booking),
      };
    }

    const isTrackmanLinked = !!booking.trackmanBookingId && /^\d+$/.test(booking.trackmanBookingId);
    const wasApprovedOrConfirmed = booking.status === 'approved' || booking.status === 'confirmed';
    const needsPendingCancel = isTrackmanLinked && wasApprovedOrConfirmed && source !== 'trackman_webhook';

    if (needsPendingCancel) {
      return this.handlePendingCancellationFlow(bookingId, booking, source, cancelledBy);
    }

    let isLateCancel = false;
    if (enforceLateCancel && booking.requestDate && booking.startTime) {
      const dateStr = ensureDateString(booking.requestDate);
      const timeStr = ensureTimeString(booking.startTime);
      const bookingStart = createPacificDate(dateStr, timeStr);
      const hoursUntilStart = (bookingStart.getTime() - Date.now()) / (1000 * 60 * 60);
      isLateCancel = hoursUntilStart < 1;
      if (isLateCancel) {
        logger.info('[BookingStateService] Late cancellation detected — skipping refunds, preserving invoice', { extra: { bookingId, hoursUntilStart } });
      }
    }

    let resourceType = 'simulator';
    if (booking.resourceId) {
      const [resource] = await db.select({ type: resources.type }).from(resources).where(eq(resources.id, booking.resourceId));
      if (resource?.type === 'conference_room') resourceType = 'conference_room';
    }

    const memberCancelled = cancelledBy === booking.userEmail;
    const friendlyDateTime = formatNotificationDateTime(booking.requestDate, booking.startTime || '00:00');
    const statusLabel = wasApprovedOrConfirmed ? 'booking' : 'booking request';

    const manifest = await db.transaction(async (tx) => {
      const sideEffects: SideEffectsManifest = {
        stripeRefunds: [],
        stripeSnapshotRefunds: [],
        balanceRefunds: [],
        guestPassRefunds: [],
        invoiceVoid: isLateCancel ? null : { bookingId },
        calendarDeletion: booking.calendarEventId ? { eventId: booking.calendarEventId, resourceId: booking.resourceId } : null,
        notifications: {},
        trackmanSlotCleanup: booking.resourceId && booking.requestDate && booking.startTime ? { resourceId: booking.resourceId, slotDate: booking.requestDate, startTime: booking.startTime, durationMinutes: booking.durationMinutes } : null,
        availabilityBroadcast: { resourceId: booking.resourceId || undefined, resourceType, date: booking.requestDate },
        bookingEvent: { bookingId, memberEmail: booking.userEmail, status: 'cancelled', actionBy: memberCancelled ? 'member' : 'staff', bookingDate: booking.requestDate, startTime: booking.startTime || '' },
      };

      if (isLateCancel) {
        await tx.execute(sql`UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW() WHERE booking_id = ${bookingId} AND status IN ('pending', 'requires_action')`);
        logger.info('[BookingStateService] Late cancel — marked pending fee snapshots as cancelled (Stripe PIs preserved for fee collection)', { extra: { bookingId } });
      } else {
        const allSnapshots = await tx.execute(sql`
          SELECT id, stripe_payment_intent_id, status as snapshot_status, total_cents
          FROM booking_fee_snapshots
          WHERE booking_id = ${bookingId} AND stripe_payment_intent_id IS NOT NULL
        `);

        for (const snapshot of allSnapshots.rows as unknown as FeeSnapshotRow[]) {
          sideEffects.stripeSnapshotRefunds.push({
            paymentIntentId: snapshot.stripe_payment_intent_id,
            amountCents: snapshot.total_cents,
            idempotencyKey: `refund_cancel_snapshot_${bookingId}_${snapshot.stripe_payment_intent_id}_${Math.floor(Date.now() / 300000)}`,
          });
        }

        const otherIntents = await tx.select({ stripePaymentIntentId: stripePaymentIntents.stripePaymentIntentId, amountCents: stripePaymentIntents.amountCents, status: stripePaymentIntents.status })
          .from(stripePaymentIntents)
          .where(and(
            eq(stripePaymentIntents.bookingId, bookingId),
          ));

        const pendingStatuses = new Set(['pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture']);
        const snapshotPiIds = new Set((allSnapshots.rows as unknown as FeeSnapshotRow[]).map((s) => s.stripe_payment_intent_id));
        const piBookingAmounts = new Map<string, number>();
        for (const row of otherIntents) {
          piBookingAmounts.set(row.stripePaymentIntentId, row.amountCents || 0);
          if (!snapshotPiIds.has(row.stripePaymentIntentId)) {
            const isPending = pendingStatuses.has(row.status || '');
            sideEffects.stripeRefunds.push({
              paymentIntentId: row.stripePaymentIntentId,
              type: isPending ? 'cancel' : 'refund',
              idempotencyKey: isPending
                ? `cancel_pending_orphan_${bookingId}_${row.stripePaymentIntentId}`
                : `refund_cancel_orphan_${bookingId}_${row.stripePaymentIntentId}`,
            });
          }
        }

        if (booking.sessionId) {
          const paidParticipants = await tx.select({
            id: bookingParticipants.id,
            stripePaymentIntentId: bookingParticipants.stripePaymentIntentId,
            cachedFeeCents: bookingParticipants.cachedFeeCents,
            displayName: bookingParticipants.displayName,
          })
            .from(bookingParticipants)
            .where(and(
              eq(bookingParticipants.sessionId, booking.sessionId),
              eq(bookingParticipants.paymentStatus, 'paid'),
              isNotNull(bookingParticipants.stripePaymentIntentId),
              ne(bookingParticipants.stripePaymentIntentId, ''),
              sql`${bookingParticipants.stripePaymentIntentId} NOT LIKE 'balance-%'`,
              isNull(bookingParticipants.refundedAt),
            ));

          for (const participant of paidParticipants) {
            if (participant.stripePaymentIntentId && !snapshotPiIds.has(participant.stripePaymentIntentId)) {
              const participantAmount = participant.cachedFeeCents && participant.cachedFeeCents > 0
                ? participant.cachedFeeCents
                : piBookingAmounts.get(participant.stripePaymentIntentId) || undefined;
              sideEffects.stripeRefunds.push({
                paymentIntentId: participant.stripePaymentIntentId,
                type: 'refund',
                amountCents: participantAmount,
                idempotencyKey: `refund_cancel_participant_${bookingId}_${participant.stripePaymentIntentId}`,
              });
            }
          }

          const balancePaymentRecords = await tx.execute(sql`
            SELECT stripe_payment_intent_id, stripe_customer_id, amount_cents
            FROM stripe_payment_intents
            WHERE booking_id = ${bookingId}
              AND stripe_payment_intent_id LIKE 'balance-%'
              AND status = 'succeeded'
          `);

          for (const rec of balancePaymentRecords.rows as unknown as BalancePaymentRow[]) {
            if (rec.stripe_customer_id && rec.amount_cents > 0) {
              sideEffects.balanceRefunds.push({
                stripeCustomerId: rec.stripe_customer_id,
                amountCents: rec.amount_cents,
                bookingId,
                balanceRecordId: rec.stripe_payment_intent_id,
                description: `Refund for cancelled booking #${bookingId}`,
              });
            }
          }

          const pendingParticipantsWithPI = await tx.select({
            id: bookingParticipants.id,
            stripePaymentIntentId: bookingParticipants.stripePaymentIntentId,
          })
            .from(bookingParticipants)
            .where(and(
              eq(bookingParticipants.sessionId, booking.sessionId),
              or(
                eq(bookingParticipants.paymentStatus, 'pending'),
                isNull(bookingParticipants.paymentStatus),
              ),
              isNotNull(bookingParticipants.stripePaymentIntentId),
              ne(bookingParticipants.stripePaymentIntentId, ''),
            ));

          for (const pending of pendingParticipantsWithPI) {
            if (pending.stripePaymentIntentId) {
              sideEffects.stripeRefunds.push({
                paymentIntentId: pending.stripePaymentIntentId,
                type: 'cancel',
                idempotencyKey: `cancel_pending_participant_${bookingId}_${pending.stripePaymentIntentId}`,
              });
            }
          }

          await tx.update(bookingParticipants)
            .set({ cachedFeeCents: 0, paymentStatus: 'waived' })
            .where(and(
              eq(bookingParticipants.sessionId, booking.sessionId),
              or(
                eq(bookingParticipants.paymentStatus, 'pending'),
                isNull(bookingParticipants.paymentStatus),
              ),
            ));

          if (paidParticipants.length > 0) {
            const paidParticipantIds = paidParticipants.map(p => p.id);
            await tx.execute(sql`UPDATE booking_participants SET payment_status = 'refund_pending' WHERE id = ANY(${toIntArrayLiteral(paidParticipantIds)}::int[])`);
          }

        }
      }

      if (booking.sessionId && !isLateCancel) {
        const guestParticipants = await tx.execute(sql`SELECT display_name FROM booking_participants
           WHERE session_id = ${booking.sessionId} AND participant_type = 'guest' AND used_guest_pass = true`);
        for (const guest of guestParticipants.rows as Array<Record<string, unknown>>) {
          sideEffects.guestPassRefunds.push({ ownerEmail: booking.userEmail, guestDisplayName: (guest.display_name as string) || undefined });
        }
      }

      await tx.execute(sql`
        DELETE FROM guest_pass_holds WHERE booking_id = ${bookingId}
      `);

      if (booking.sessionId) {
        await tx.execute(sql`
          DELETE FROM usage_ledger
          WHERE session_id = ${booking.sessionId}
          AND LOWER(member_id) = LOWER(${booking.userEmail})
          AND NOT EXISTS (
            SELECT 1 FROM booking_requests br
            WHERE br.session_id = ${booking.sessionId}
            AND br.id != ${bookingId}
            AND LOWER(br.user_email) = LOWER(${booking.userEmail})
            AND br.status NOT IN ('cancelled', 'declined', 'deleted')
          )
        `);
      }

      await tx.execute(sql`
        UPDATE booking_fee_snapshots
        SET status = 'cancelled', updated_at = NOW()
        WHERE booking_id = ${bookingId}
          AND status IN ('pending', 'requires_action')
      `);

      let updatedStaffNotes = staffNotes || '';
      if (source === 'trackman_webhook') {
        updatedStaffNotes = (booking.staffNotes || '') + ' [Cancelled via Trackman webhook]';
      } else if (booking.trackmanBookingId) {
        const trackmanNote = '[Cancelled in app - needs Trackman cancellation]';
        updatedStaffNotes = updatedStaffNotes ? `${updatedStaffNotes}\n${trackmanNote}` : trackmanNote;
      }

      await tx.update(bookingRequests)
        .set({
          status: 'cancelled',
          isUnmatched: false,
          staffNotes: updatedStaffNotes || undefined,
          updatedAt: new Date(),
          version: sql`COALESCE(${bookingRequests.version}, 1) + 1`,
        })
        .where(eq(bookingRequests.id, bookingId));

      cancelCleanupAlert(bookingId).catch(err => logger.error('[BookingStateService] Failed to cancel cleanup alert (non-blocking)', { extra: { bookingId, error: getErrorMessage(err) } }));

      if (memberCancelled) {
        const staffMessage = `${booking.userName || booking.userEmail} has cancelled their ${statusLabel} for ${friendlyDateTime}.`;
        const memberMessage = `Your ${statusLabel} for ${friendlyDateTime} has been cancelled.`;

        if (isNotifiableEmail(booking.userEmail)) {
          sideEffects.notifications.memberNotification = { userEmail: booking.userEmail, title: 'Booking Cancelled', message: memberMessage, type: 'booking_cancelled' as const, relatedId: bookingId, relatedType: 'booking_request' };
          sideEffects.notifications.memberPush = { email: booking.userEmail, title: 'Booking Cancelled', body: memberMessage };
          sideEffects.notifications.memberWebSocket = { email: booking.userEmail, title: 'Booking Cancelled', message: memberMessage, bookingId };
        }
        sideEffects.notifications.staffNotification = { title: 'Booking Cancelled by Member', message: staffMessage };
      } else {
        const memberMessage = source === 'trackman_webhook'
          ? `Your booking for ${friendlyDateTime} has been cancelled. Any applicable charges have been refunded.`
          : `Your ${statusLabel} for ${friendlyDateTime} has been cancelled by staff.`;

        if (isNotifiableEmail(booking.userEmail)) {
          sideEffects.notifications.memberNotification = { userEmail: booking.userEmail, title: 'Booking Cancelled', message: memberMessage, type: 'booking_cancelled' as const, relatedId: bookingId, relatedType: 'booking_request' };
          sideEffects.notifications.memberPush = { email: booking.userEmail, title: 'Booking Cancelled', body: memberMessage };
          sideEffects.notifications.memberWebSocket = { email: booking.userEmail, title: 'Booking Cancelled', message: memberMessage, bookingId };
        }

        if (source === 'trackman_webhook') {
          sideEffects.notifications.staffNotification = {
            title: 'Booking Cancelled via TrackMan',
            message: `Booking cancelled via TrackMan: ${booking.userName || booking.userEmail}'s booking for ${friendlyDateTime}`,
          };
        }
      }

      await tx.update(notifications)
        .set({ isRead: true })
        .where(and(
          eq(notifications.relatedId, bookingId),
          eq(notifications.relatedType, 'booking_request'),
          eq(notifications.type, 'booking'),
        ));

      return sideEffects;
    });

    const { errors } = await executeSideEffects(manifest);

    await persistFailedSideEffects(bookingId, manifest, errors);

    return {
      success: true,
      status: 'cancelled',
      bookingId,
      bookingData: this.extractBookingData(booking),
      sideEffectErrors: errors.length > 0 ? errors : undefined,
      isLateCancel,
    };
  }

  static async completePendingCancellation(params: {
    bookingId: number;
    staffEmail: string;
    source: 'trackman_webhook';
  }): Promise<CancelResult> {
    const { bookingId, staffEmail, source } = params;

    const [precheck] = await db.select({
      id: bookingRequests.id,
      userEmail: bookingRequests.userEmail,
      userName: bookingRequests.userName,
      resourceId: bookingRequests.resourceId,
      requestDate: bookingRequests.requestDate,
      startTime: bookingRequests.startTime,
      durationMinutes: bookingRequests.durationMinutes,
      status: bookingRequests.status,
      calendarEventId: bookingRequests.calendarEventId,
      sessionId: bookingRequests.sessionId,
      trackmanBookingId: bookingRequests.trackmanBookingId,
      staffNotes: bookingRequests.staffNotes,
    })
      .from(bookingRequests)
      .where(eq(bookingRequests.id, bookingId));

    if (!precheck) {
      return {
        success: false,
        status: 'cancelled',
        bookingId,
        bookingData: { userEmail: '', userName: null, resourceId: null, requestDate: '', startTime: '', durationMinutes: null, calendarEventId: null, sessionId: null, trackmanBookingId: null },
        error: 'Booking not found',
        statusCode: 404,
      };
    }

    if (precheck.status !== 'cancellation_pending') {
      if (precheck.status === 'cancelled') {
        return {
          success: false,
          status: 'cancelled',
          bookingId,
          bookingData: this.extractBookingData(precheck),
          alreadyCancelled: true,
          error: 'Booking is already cancelled',
          statusCode: 400,
        };
      }
      return {
        success: false,
        status: 'cancelled',
        bookingId,
        bookingData: this.extractBookingData(precheck),
        error: `Cannot complete cancellation — booking status is '${precheck.status}', expected 'cancellation_pending'`,
        statusCode: 400,
      };
    }

    let resourceType = 'simulator';
    if (precheck.resourceId) {
      const [resource] = await db.select({ type: resources.type }).from(resources).where(eq(resources.id, precheck.resourceId));
      if (resource?.type === 'conference_room') resourceType = 'conference_room';
    }

    const friendlyDateTime = formatNotificationDateTime(precheck.requestDate, precheck.startTime || '00:00');
    const completedByLabel = source === 'trackman_webhook' ? 'Trackman webhook' : `staff (${staffEmail})`;

    const manifest = await db.transaction(async (tx) => {
      const lockedResult = await tx.execute(sql`
        SELECT id, user_email, user_name, resource_id, request_date, start_time, duration_minutes, status,
               calendar_event_id, session_id, trackman_booking_id, staff_notes
        FROM booking_requests
        WHERE id = ${bookingId}
        ORDER BY id ASC
        FOR UPDATE
      `);
      const lockedRow = lockedResult.rows[0] as Record<string, unknown> | undefined;
      if (!lockedRow || lockedRow.status !== 'cancellation_pending') {
        return null;
      }

      const existing = {
        id: lockedRow.id as number,
        userEmail: lockedRow.user_email as string | null,
        userName: lockedRow.user_name as string | null,
        resourceId: lockedRow.resource_id as number | null,
        requestDate: lockedRow.request_date as string,
        startTime: lockedRow.start_time as string,
        durationMinutes: lockedRow.duration_minutes as number | null,
        status: lockedRow.status as string,
        calendarEventId: lockedRow.calendar_event_id as string | null,
        sessionId: lockedRow.session_id as number | null,
        trackmanBookingId: lockedRow.trackman_booking_id as string | null,
        staffNotes: lockedRow.staff_notes as string | null,
      };

      const sideEffects: SideEffectsManifest = {
        stripeRefunds: [],
        stripeSnapshotRefunds: [],
        balanceRefunds: [],
        guestPassRefunds: [],
        invoiceVoid: { bookingId },
        calendarDeletion: existing.calendarEventId ? { eventId: existing.calendarEventId, resourceId: existing.resourceId } : null,
        notifications: {},
        trackmanSlotCleanup: existing.resourceId && existing.requestDate && existing.startTime ? { resourceId: existing.resourceId, slotDate: existing.requestDate, startTime: existing.startTime, durationMinutes: existing.durationMinutes } : null,
        availabilityBroadcast: { resourceId: existing.resourceId || undefined, resourceType, date: existing.requestDate },
        bookingEvent: { bookingId, memberEmail: existing.userEmail || '', status: 'cancelled', actionBy: 'staff', bookingDate: existing.requestDate, startTime: existing.startTime || '' },
      };

      const pendingIntents = await tx.select({ stripePaymentIntentId: stripePaymentIntents.stripePaymentIntentId })
        .from(stripePaymentIntents)
        .where(and(
          eq(stripePaymentIntents.bookingId, bookingId),
          sql`${stripePaymentIntents.status} IN ('pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture')`,
        ));

      for (const row of pendingIntents) {
        sideEffects.stripeRefunds.push({
          paymentIntentId: row.stripePaymentIntentId,
          type: 'cancel',
          idempotencyKey: `cancel_complete_${bookingId}_${row.stripePaymentIntentId}`,
        });
      }

      const allSnapshots = await tx.execute(sql`
        SELECT id, stripe_payment_intent_id, status as snapshot_status, total_cents
        FROM booking_fee_snapshots
        WHERE booking_id = ${bookingId} AND stripe_payment_intent_id IS NOT NULL
      `);

      for (const snapshot of allSnapshots.rows as unknown as FeeSnapshotRow[]) {
        sideEffects.stripeSnapshotRefunds.push({
          paymentIntentId: snapshot.stripe_payment_intent_id,
          amountCents: snapshot.total_cents,
          idempotencyKey: `refund_complete_cancel_snapshot_${bookingId}_${snapshot.stripe_payment_intent_id}_${Math.floor(Date.now() / 300000)}`,
        });
      }

      if (existing.sessionId) {
        const pendingParticipantsWithPI = await tx.select({
          id: bookingParticipants.id,
          stripePaymentIntentId: bookingParticipants.stripePaymentIntentId,
        })
          .from(bookingParticipants)
          .where(and(
            eq(bookingParticipants.sessionId, existing.sessionId),
            or(
              eq(bookingParticipants.paymentStatus, 'pending'),
              isNull(bookingParticipants.paymentStatus),
            ),
            isNotNull(bookingParticipants.stripePaymentIntentId),
            ne(bookingParticipants.stripePaymentIntentId, ''),
          ));

        for (const pending of pendingParticipantsWithPI) {
          if (pending.stripePaymentIntentId) {
            sideEffects.stripeRefunds.push({
              paymentIntentId: pending.stripePaymentIntentId,
              type: 'cancel',
              idempotencyKey: `cancel_pending_complete_${bookingId}_${pending.stripePaymentIntentId}`,
            });
          }
        }

        await tx.update(bookingParticipants)
          .set({ cachedFeeCents: 0, paymentStatus: 'waived' })
          .where(and(
            eq(bookingParticipants.sessionId, existing.sessionId),
            or(
              eq(bookingParticipants.paymentStatus, 'pending'),
              isNull(bookingParticipants.paymentStatus),
            ),
          ));

        const paidParticipants = await tx.select({
          id: bookingParticipants.id,
          stripePaymentIntentId: bookingParticipants.stripePaymentIntentId,
          cachedFeeCents: bookingParticipants.cachedFeeCents,
          displayName: bookingParticipants.displayName,
        })
          .from(bookingParticipants)
          .where(and(
            eq(bookingParticipants.sessionId, existing.sessionId),
            eq(bookingParticipants.paymentStatus, 'paid'),
            isNotNull(bookingParticipants.stripePaymentIntentId),
            ne(bookingParticipants.stripePaymentIntentId, ''),
            sql`${bookingParticipants.stripePaymentIntentId} NOT LIKE 'balance-%'`,
            isNull(bookingParticipants.refundedAt),
          ));

        const snapshotPiIds = new Set((allSnapshots.rows as unknown as FeeSnapshotRow[]).map((s) => s.stripe_payment_intent_id));
        const piAmounts = new Map<string, number>();
        for (const row of allSnapshots.rows as unknown as FeeSnapshotRow[]) {
          piAmounts.set(row.stripe_payment_intent_id, row.total_cents);
        }
        const piIntentRecords = await tx.select({ stripePaymentIntentId: stripePaymentIntents.stripePaymentIntentId, amountCents: stripePaymentIntents.amountCents })
          .from(stripePaymentIntents)
          .where(eq(stripePaymentIntents.bookingId, bookingId));
        for (const row of piIntentRecords) {
          if (!piAmounts.has(row.stripePaymentIntentId)) {
            piAmounts.set(row.stripePaymentIntentId, row.amountCents || 0);
          }
        }

        for (const participant of paidParticipants) {
          if (participant.stripePaymentIntentId && !snapshotPiIds.has(participant.stripePaymentIntentId)) {
            sideEffects.stripeRefunds.push({
              paymentIntentId: participant.stripePaymentIntentId,
              type: 'refund',
              amountCents: piAmounts.get(participant.stripePaymentIntentId) || undefined,
              idempotencyKey: `refund_complete_participant_${bookingId}_${participant.stripePaymentIntentId}`,
            });
          }
        }

        if (paidParticipants.length > 0) {
          const paidParticipantIds = paidParticipants.map(p => p.id);
          await tx.execute(sql`UPDATE booking_participants SET payment_status = 'refund_pending' WHERE id = ANY(${toIntArrayLiteral(paidParticipantIds)}::int[])`);
        }

        const balancePaymentRecords = await tx.execute(sql`
          SELECT stripe_payment_intent_id, stripe_customer_id, amount_cents
          FROM stripe_payment_intents
          WHERE booking_id = ${bookingId}
            AND stripe_payment_intent_id LIKE 'balance-%'
            AND status = 'succeeded'
        `);

        for (const rec of balancePaymentRecords.rows as unknown as BalancePaymentRow[]) {
          if (rec.stripe_customer_id && rec.amount_cents > 0) {
            sideEffects.balanceRefunds.push({
              stripeCustomerId: rec.stripe_customer_id,
              amountCents: rec.amount_cents,
              bookingId,
              balanceRecordId: rec.stripe_payment_intent_id,
              description: `Refund for cancelled booking #${bookingId}`,
            });
          }
        }

        const guestParticipants = await tx.select({
          id: bookingParticipants.id,
          displayName: bookingParticipants.displayName,
          usedGuestPass: bookingParticipants.usedGuestPass,
        })
          .from(bookingParticipants)
          .where(and(
            eq(bookingParticipants.sessionId, existing.sessionId),
            eq(bookingParticipants.participantType, 'guest'),
          ));

        for (const guest of guestParticipants) {
          if (guest.usedGuestPass) {
            try {
              const guestRefundResult = await refundGuestPass(existing.userEmail || '', guest.displayName || undefined, false, tx);
              if (!guestRefundResult.success) {
                logger.error('[BookingStateService] Guest pass refund failed', { extra: { memberEmail: existing.userEmail, guestName: guest.displayName, error: guestRefundResult.error } });
              }
            } catch (guestErr: unknown) {
              logger.error('[BookingStateService] Guest pass refund threw', { extra: { memberEmail: existing.userEmail, guestName: guest.displayName, error: getErrorMessage(guestErr) } });
            }
          }
        }
      }

      await tx.execute(sql`
        DELETE FROM guest_pass_holds WHERE booking_id = ${bookingId}
      `);

      if (existing.sessionId) {
        await tx.execute(sql`
          DELETE FROM usage_ledger
          WHERE session_id = ${existing.sessionId}
          AND LOWER(member_id) = LOWER(${existing.userEmail})
          AND NOT EXISTS (
            SELECT 1 FROM booking_requests br
            WHERE br.session_id = ${existing.sessionId}
            AND br.id != ${bookingId}
            AND LOWER(br.user_email) = LOWER(${existing.userEmail})
            AND br.status NOT IN ('cancelled', 'declined', 'deleted')
          )
        `);
      }

      await tx.execute(sql`
        UPDATE booking_fee_snapshots
        SET status = 'cancelled', updated_at = NOW()
        WHERE booking_id = ${bookingId}
          AND status IN ('pending', 'requires_action')
      `);

      const noteAppend = '\n[Cancellation completed via Trackman webhook]';

      const updateResult = await tx.execute(sql`
        UPDATE booking_requests
        SET status = 'cancelled',
            is_unmatched = false,
            staff_notes = COALESCE(staff_notes, '') || ${noteAppend},
            updated_at = NOW(),
            version = COALESCE(version, 1) + 1
        WHERE id = ${bookingId}
          AND status = 'cancellation_pending'
      `);

      if (updateResult.rowCount === 0) {
        return null;
      }

      const memberMessage = `Your booking for ${friendlyDateTime} has been cancelled and any charges have been refunded.`;

      const staffTitle = source === 'trackman_webhook' ? 'Cancellation Completed via TrackMan' : 'Cancellation Completed';
      const staffMsg = `Cancellation completed via ${completedByLabel}: ${existing.userName || existing.userEmail}'s booking for ${friendlyDateTime}`;

      if (isNotifiableEmail(existing.userEmail)) {
        sideEffects.notifications.memberNotification = { userEmail: existing.userEmail, title: 'Booking Cancelled', message: memberMessage, type: 'booking_cancelled' as const, relatedId: bookingId, relatedType: 'booking_request' };
      }
      sideEffects.notifications.staffNotification = { title: staffTitle, message: staffMsg };

      return sideEffects;
    });

    if (!manifest) {
      logger.warn('[BookingStateService] Concurrent cancellation conflict', { extra: { bookingId, staffEmail, source } });
      return {
        success: false,
        status: 'cancelled',
        bookingId,
        bookingData: this.extractBookingData(precheck),
        error: 'Booking status changed concurrently — cancellation already completed or no longer pending',
        statusCode: 409,
      };
    }

    const { errors } = await executeSideEffects(manifest);

    await persistFailedSideEffects(bookingId, manifest, errors);

    logger.info('[BookingStateService] Completed pending cancellation', { extra: { bookingId, staffEmail, source, errorCount: errors.length } });

    return {
      success: true,
      status: 'cancelled',
      bookingId,
      bookingData: this.extractBookingData(precheck),
      sideEffectErrors: errors.length > 0 ? errors : undefined,
    };
  }

  private static async handlePendingCancellationFlow(
    bookingId: number,
    booking: BookingRecord,
    _source: string,
    _cancelledBy?: string,
  ): Promise<CancelResult> {
    let bayName = 'Bay';
    if (booking.resourceId) {
      const [resource] = await db.select({ name: resources.name }).from(resources).where(eq(resources.id, booking.resourceId));
      if (resource?.name) bayName = resource.name;
    }

    const memberName = booking.userName || booking.userEmail || 'Member';
    const bookingDate = booking.requestDate;
    const bookingTime = booking.startTime?.substring(0, 5) || '';

    const transitionResult = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE booking_requests
        SET status = 'cancellation_pending',
            cancellation_pending_at = NOW(),
            staff_notes = COALESCE(staff_notes, '') || ${'\n[Staff initiated cancellation - awaiting Trackman cancellation]'},
            updated_at = NOW(),
            version = COALESCE(version, 1) + 1
        WHERE id = ${bookingId}
          AND status IN ('approved', 'confirmed')
      `);

      return (result.rowCount ?? 0) > 0;
    });

    if (!transitionResult) {
      logger.warn('[BookingStateService] Pending cancellation transition blocked by concurrent status change', { extra: { bookingId, currentStatus: booking.status } });
      return {
        success: false,
        status: 'cancelled',
        bookingId,
        bookingData: { userEmail: booking.userEmail || '', userName: booking.userName, resourceId: booking.resourceId, requestDate: booking.requestDate, startTime: booking.startTime || '', durationMinutes: booking.durationMinutes, calendarEventId: booking.calendarEventId, sessionId: booking.sessionId, trackmanBookingId: booking.trackmanBookingId },
        error: 'Booking status has already changed — cancellation blocked',
        statusCode: 409,
      };
    }

    if (isNotifiableEmail(booking.userEmail)) {
      notifyMember({
        userEmail: booking.userEmail,
        title: 'Booking Cancellation in Progress',
        message: `Your booking for ${bookingDate} at ${bookingTime} is being cancelled. You'll be notified once it's fully processed.`,
        type: 'cancellation_pending',
        relatedId: bookingId,
        relatedType: 'booking_request',
        url: '/sims'
      }, { sendPush: true }).catch(err => logger.error(`[BookingStateService] Member notification failed for bookingId=${bookingId}`, { extra: { bookingId, error: getErrorMessage(err) } }));
    }

    const staffMessage = `Booking cancellation pending for ${memberName} on ${bookingDate} at ${bookingTime} (${bayName}). Please cancel in Trackman to complete.`;
    notifyAllStaff(
      'Cancel in Trackman Required',
      staffMessage,
      'booking_cancelled',
      { relatedId: bookingId, relatedType: 'booking_request', url: '/admin/bookings' },
    ).catch(err => logger.error(`[BookingStateService] Staff cancellation notification failed for bookingId=${bookingId}`, { extra: { bookingId, error: getErrorMessage(err) } }));

    return {
      success: true,
      status: 'cancellation_pending',
      bookingId,
      bookingData: this.extractBookingData(booking),
    };
  }


  static async cleanupDeclinedBooking(bookingId: number, bookingDetails?: { resourceId?: number | null; requestDate?: string; startTime?: string; durationMinutes?: number | null }): Promise<{ errors: string[] }> {
    const errors: string[] = [];

    try {
      await db.execute(sql`DELETE FROM guest_pass_holds WHERE booking_id = ${bookingId}`);
    } catch (err: unknown) {
      const msg = `Failed to release guest pass hold: ${getErrorMessage(err)}`;
      errors.push(msg);
      logger.warn('[BookingStateService] cleanupDeclinedBooking: guest pass hold release failed', { extra: { bookingId, error: getErrorMessage(err) } });
    }

    try {
      await voidBookingInvoice(bookingId);
    } catch (err: unknown) {
      const msg = `Failed to void invoice: ${getErrorMessage(err)}`;
      errors.push(msg);
      logger.warn('[BookingStateService] cleanupDeclinedBooking: invoice void failed', { extra: { bookingId, error: getErrorMessage(err) } });
    }

    try {
      const piIdsToCancel = new Set<string>();

      const pendingIntents = await db.select({ stripePaymentIntentId: stripePaymentIntents.stripePaymentIntentId })
        .from(stripePaymentIntents)
        .where(and(
          eq(stripePaymentIntents.bookingId, bookingId),
          sql`${stripePaymentIntents.status} IN ('pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture')`,
        ));

      for (const row of pendingIntents) {
        piIdsToCancel.add(row.stripePaymentIntentId);
      }

      const snapshotPIs = await db.execute(sql`
        SELECT stripe_payment_intent_id
        FROM booking_fee_snapshots
        WHERE booking_id = ${bookingId} AND stripe_payment_intent_id IS NOT NULL AND status IN ('pending', 'requires_action')
      `);

      for (const row of snapshotPIs.rows) {
        piIdsToCancel.add(row.stripe_payment_intent_id as string);
      }

      const cancelledPiIds: string[] = [];
      for (const piId of piIdsToCancel) {
        try {
          const cancelResult = await cancelPaymentIntent(piId);
          if (cancelResult.success) {
            cancelledPiIds.push(piId);
            logger.info('[BookingStateService] Cancelled pending PI for declined booking', { extra: { paymentIntentId: piId, bookingId } });
          } else {
            const msg = `Failed to cancel PI ${piId.substring(0, 12)}: ${cancelResult.error}`;
            errors.push(msg);
            logger.warn('[BookingStateService] Failed to cancel pending PI for declined booking', { extra: { paymentIntentId: piId, error: cancelResult.error } });
          }
        } catch (piErr: unknown) {
          const msg = `Failed to cancel PI ${piId.substring(0, 12)}: ${getErrorMessage(piErr)}`;
          errors.push(msg);
          logger.warn('[BookingStateService] cleanupDeclinedBooking: PI cancellation failed', { extra: { paymentIntentId: piId, error: getErrorMessage(piErr) } });
        }
      }

      for (const piId of cancelledPiIds) {
        try {
          await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW() WHERE stripe_payment_intent_id = ${piId} AND status IN ('pending', 'requires_action')`);
        } catch (snapshotErr: unknown) {
          logger.warn('[BookingStateService] cleanupDeclinedBooking: snapshot status update failed', { extra: { paymentIntentId: piId, error: getErrorMessage(snapshotErr) } });
        }
      }
    } catch (err: unknown) {
      const msg = `Failed to cancel pending payment intents: ${getErrorMessage(err)}`;
      errors.push(msg);
      logger.warn('[BookingStateService] cleanupDeclinedBooking: PI query failed', { extra: { bookingId, error: getErrorMessage(err) } });
    }

    try {
      await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW() WHERE booking_id = ${bookingId} AND status IN ('pending', 'requires_action')`);
    } catch (err: unknown) {
      const msg = `Failed to clean up remaining fee snapshots: ${getErrorMessage(err)}`;
      errors.push(msg);
      logger.warn('[BookingStateService] cleanupDeclinedBooking: fee snapshot cleanup failed', { extra: { bookingId, error: getErrorMessage(err) } });
    }

    if (bookingDetails?.resourceId && bookingDetails.requestDate && bookingDetails.startTime) {
      try {
        const { resourceId, requestDate, startTime, durationMinutes } = bookingDetails;
        if (durationMinutes) {
          const [startHour, startMin] = startTime.split(':').map(Number);
          const startTotalMin = startHour * 60 + startMin;
          const endTotalMin = startTotalMin + durationMinutes;
          const endHour = Math.floor(endTotalMin / 60);
          const endMinute = endTotalMin % 60;
          const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
          await db.execute(sql`DELETE FROM trackman_bay_slots
            WHERE resource_id = ${resourceId} AND slot_date = ${requestDate} AND start_time >= ${startTime} AND start_time < ${endTime}`);
        } else {
          await db.execute(sql`DELETE FROM trackman_bay_slots
            WHERE resource_id = ${resourceId} AND slot_date = ${requestDate} AND start_time = ${startTime}`);
        }
      } catch (err: unknown) {
        const msg = `Failed Trackman slot cleanup: ${getErrorMessage(err)}`;
        errors.push(msg);
        logger.warn('[BookingStateService] cleanupDeclinedBooking: Trackman slot cleanup failed', { extra: { bookingId, error: getErrorMessage(err) } });
      }
    }

    cancelCleanupAlert(bookingId).catch(err => logger.warn('[BookingStateService] cleanupDeclinedBooking: cleanup alert cancel failed (non-blocking)', { extra: { bookingId, error: getErrorMessage(err) } }));

    if (errors.length > 0) {
      await persistFailedSideEffects(bookingId, {
        stripeRefunds: [],
        stripeSnapshotRefunds: [],
        balanceRefunds: [],
        guestPassRefunds: [],
        invoiceVoid: null,
        calendarDeletion: null,
        notifications: {},
        trackmanSlotCleanup: null,
        availabilityBroadcast: null,
        bookingEvent: null,
      }, errors);
    }

    return { errors };
  }

  private static extractBookingData(booking: BookingRecord): CancelResult['bookingData'] {
    return {
      userEmail: booking.userEmail,
      userName: booking.userName,
      resourceId: booking.resourceId,
      requestDate: booking.requestDate,
      startTime: booking.startTime,
      durationMinutes: booking.durationMinutes,
      calendarEventId: booking.calendarEventId,
      sessionId: booking.sessionId,
      trackmanBookingId: booking.trackmanBookingId,
    };
  }
}

  