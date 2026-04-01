import { db } from '../../db';
import { bookingParticipants, stripePaymentIntents, failedSideEffects } from '../../../shared/schema';
import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { notifyMember, notifyAllStaff } from '../notificationService';
import { bookingEvents } from '../bookingEvents';
import { sendNotificationToUser, broadcastAvailabilityUpdate } from '../websocket';
import { refundGuestPass } from '../billing/guestPassService';
import { getCalendarNameForBayAsync } from '../calendar/calendarHelpers';
import { getCalendarIdByName, deleteCalendarEvent } from '../calendar/index';
import { voidBookingInvoice } from '../billing/bookingInvoiceService';
import { getErrorMessage } from '../../utils/errorUtils';
import { cancelPaymentIntent } from '../stripe/payments';
import { getStripeClient } from '../stripe/client';
import { markPaymentRefunded } from '../billing/PaymentStatusService';
import { voidBookingPass } from '../../walletPass/bookingPassService';
import type { SideEffectsManifest } from './bookingStateTypes';

  export async function executeInlineRefund(params: {
    paymentIntentId: string;
    reason: 'duplicate' | 'fraudulent' | 'requested_by_customer';
    metadata: Record<string, string>;
    amountCents?: number;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; refundId?: string; error?: string }> {
    if (!params.paymentIntentId.startsWith('pi_')) {
      logger.info('[BookingStateService] Skipping refund for synthetic PI — marking canceled', { extra: { paymentIntentId: params.paymentIntentId } });
      await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${params.paymentIntentId}`);
      return { success: true };
    }
    const stripe = await getStripeClient();
    try {
      const refundCreateParams: { payment_intent: string; reason: 'duplicate' | 'fraudulent' | 'requested_by_customer'; metadata: Record<string, string>; amount?: number } = {
        payment_intent: params.paymentIntentId,
        reason: params.reason,
        metadata: params.metadata,
      };
      if (params.amountCents) {
        refundCreateParams.amount = params.amountCents;
      }
      const refund = await stripe.refunds.create(
        refundCreateParams,
        params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : undefined
      );
      logger.info(`[BookingStateService] Refund issued: ${refund.id} for PI ${params.paymentIntentId}, amount: ${params.amountCents || 'full'}`);

      try {
        await markPaymentRefunded({
          paymentIntentId: params.paymentIntentId,
          refundId: refund.id,
          amountCents: params.amountCents,
        });
      } catch (statusErr: unknown) {
        logger.warn(`[BookingStateService] Non-blocking: failed to mark payment refunded for PI ${params.paymentIntentId}, setting refund_succeeded_sync_failed`, { extra: { error: getErrorMessage(statusErr) } });
        try {
          await db.execute(sql`UPDATE stripe_payment_intents 
             SET status = 'refund_succeeded_sync_failed', updated_at = NOW() 
             WHERE stripe_payment_intent_id = ${params.paymentIntentId}`);
        } catch (syncErr: unknown) {
          logger.error(`[BookingStateService] CRITICAL: Failed to set refund_succeeded_sync_failed status for PI ${params.paymentIntentId}`, {
            extra: { paymentIntentId: params.paymentIntentId, error: getErrorMessage(syncErr) }
          });
        }
      }
      return { success: true, refundId: refund.id };
    } catch (err: unknown) {
      return { success: false, error: getErrorMessage(err) };
    }
  }
    export async function executeSideEffects(manifest: SideEffectsManifest): Promise<{ errors: string[] }> {
    const errors: string[] = [];

    for (const snapshotRefund of manifest.stripeSnapshotRefunds) {
      try {
        const piStatusResult = await db.execute(sql`SELECT status FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${snapshotRefund.paymentIntentId}`);
        const piRow = (piStatusResult.rows as unknown as Array<{ status: string }>)[0];
        const nonSucceededStatuses = ['pending', 'requires_action', 'requires_payment_method', 'requires_confirmation', 'requires_capture'];
        if (piRow && nonSucceededStatuses.includes(piRow.status)) {
          const cancelResult = await cancelPaymentIntent(snapshotRefund.paymentIntentId);
          if (!cancelResult.success) {
            throw new Error(cancelResult.error || 'Failed to cancel pending snapshot PI');
          }
          await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW() WHERE stripe_payment_intent_id = ${snapshotRefund.paymentIntentId} AND status IN ('pending', 'requires_action')`);
          logger.info('[BookingStateService] Cancelled pending snapshot PI instead of refunding', { extra: { paymentIntentId: snapshotRefund.paymentIntentId, originalStatus: piRow.status } });
          continue;
        }
        const claimResult = await db.execute(sql`UPDATE stripe_payment_intents 
          SET status = 'refunding', updated_at = NOW() 
          WHERE stripe_payment_intent_id = ${snapshotRefund.paymentIntentId} AND status = 'succeeded'
          RETURNING stripe_payment_intent_id`);
        if ((claimResult as unknown as { rowCount: number }).rowCount === 0) {
          logger.info('[BookingStateService] Snapshot PI already claimed/refunded, skipping', { extra: { paymentIntentId: snapshotRefund.paymentIntentId } });
          continue;
        }
        const refundResult = await executeInlineRefund({
          paymentIntentId: snapshotRefund.paymentIntentId,
          reason: 'requested_by_customer',
          metadata: { reason: 'booking_cancellation_snapshot' },
          amountCents: snapshotRefund.amountCents || undefined,
          idempotencyKey: snapshotRefund.idempotencyKey,
        });
        if (!refundResult.success) {
          await db.execute(sql`UPDATE stripe_payment_intents 
            SET status = 'succeeded', updated_at = NOW() 
            WHERE stripe_payment_intent_id = ${snapshotRefund.paymentIntentId} AND status = 'refunding'`);
          throw new Error(refundResult.error);
        }
        await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'refunded', updated_at = NOW() WHERE stripe_payment_intent_id = ${snapshotRefund.paymentIntentId} AND status IN ('pending', 'requires_action')`);

      } catch (err: unknown) {
        const msg = `Failed snapshot refund ${snapshotRefund.paymentIntentId.substring(0, 12)}: ${getErrorMessage(err)}`;
        errors.push(msg);
        logger.error('[BookingStateService] Snapshot refund failed', { extra: { paymentIntentId: snapshotRefund.paymentIntentId, error: getErrorMessage(err) } });
      }
    }

    for (const refundItem of manifest.stripeRefunds) {
      try {
        if (refundItem.type === 'cancel') {
          const cancelResult = await cancelPaymentIntent(refundItem.paymentIntentId);
          if (cancelResult.success) {
            logger.info('[BookingStateService] Cancelled payment intent', { extra: { paymentIntentId: refundItem.paymentIntentId } });
          } else if (cancelResult.error?.includes('already succeeded') || cancelResult.error?.includes('use refund instead')) {
            logger.warn('[BookingStateService] PI already succeeded, refunding instead', { extra: { paymentIntentId: refundItem.paymentIntentId } });
            const refundResult = await executeInlineRefund({
              paymentIntentId: refundItem.paymentIntentId,
              reason: 'requested_by_customer',
              metadata: { reason: 'booking_cancellation_pi_succeeded_race' },
            });
            if (!refundResult.success) throw new Error(refundResult.error);
          } else {
            throw new Error(cancelResult.error || 'Unknown cancel error');
          }
          await db.execute(sql`UPDATE booking_participants SET payment_status = 'refunded', refunded_at = NOW() WHERE stripe_payment_intent_id = ${refundItem.paymentIntentId} AND payment_status = 'refund_pending'`);
        } else {
          const claimResult = await db.execute(sql`UPDATE stripe_payment_intents 
            SET status = 'refunding', updated_at = NOW() 
            WHERE stripe_payment_intent_id = ${refundItem.paymentIntentId} AND status = 'succeeded'
            RETURNING stripe_payment_intent_id`);
          if ((claimResult as unknown as { rowCount: number }).rowCount === 0) {
            logger.info('[BookingStateService] PI already claimed/refunded, skipping', { extra: { paymentIntentId: refundItem.paymentIntentId } });
            continue;
          }
          const refundResult = await executeInlineRefund({
            paymentIntentId: refundItem.paymentIntentId,
            reason: 'requested_by_customer',
            metadata: { reason: 'booking_cancellation' },
            amountCents: refundItem.amountCents || undefined,
            idempotencyKey: refundItem.idempotencyKey,
          });
          if (!refundResult.success) {
            await db.execute(sql`UPDATE stripe_payment_intents 
              SET status = 'succeeded', updated_at = NOW() 
              WHERE stripe_payment_intent_id = ${refundItem.paymentIntentId} AND status = 'refunding'`);
            throw new Error(refundResult.error);
          }
        }
      } catch (err: unknown) {
        const msg = `Failed refund ${refundItem.paymentIntentId.substring(0, 12)}: ${getErrorMessage(err)}`;
        errors.push(msg);
        logger.error('[BookingStateService] Refund failed', { extra: { paymentIntentId: refundItem.paymentIntentId, error: getErrorMessage(err) } });
      }
    }

    for (const balanceRefund of manifest.balanceRefunds) {
      try {
        const stripe = await getStripeClient();
        const balanceTxn = await stripe.customers.createBalanceTransaction(
          balanceRefund.stripeCustomerId,
          {
            amount: -balanceRefund.amountCents,
            currency: 'usd',
            description: balanceRefund.description,
          },
          { idempotencyKey: `balance_refund_${balanceRefund.bookingId}_${balanceRefund.balanceRecordId}` }
        );
        logger.info('[BookingStateService] Balance refund issued', {
          extra: { bookingId: balanceRefund.bookingId, balanceRecordId: balanceRefund.balanceRecordId, amountCents: balanceRefund.amountCents, txnId: balanceTxn.id }
        });
        await markPaymentRefunded({
          paymentIntentId: balanceRefund.balanceRecordId,
          refundId: balanceTxn.id,
          amountCents: balanceRefund.amountCents,
        });
      } catch (err: unknown) {
        const msg = `Failed balance refund for ${balanceRefund.balanceRecordId}: ${getErrorMessage(err)}`;
        errors.push(msg);
        logger.error('[BookingStateService] Balance refund failed', { extra: { ...balanceRefund, error: getErrorMessage(err) } });
      }
    }

    if (manifest.invoiceVoid) {
      try {
        const voidResult = await voidBookingInvoice(manifest.invoiceVoid.bookingId);
        if (!voidResult.success) {
          const msg = `Invoice void/refund incomplete for booking ${manifest.invoiceVoid.bookingId}: ${voidResult.error}`;
          errors.push(msg);
          logger.error('[BookingStateService] Invoice void returned failure', { extra: { bookingId: manifest.invoiceVoid.bookingId, error: voidResult.error } });
        }
      } catch (err: unknown) {
        const msg = `Failed to void invoice for booking ${manifest.invoiceVoid.bookingId}: ${getErrorMessage(err)}`;
        errors.push(msg);
        logger.error('[BookingStateService] Invoice void failed', { extra: { bookingId: manifest.invoiceVoid.bookingId, error: getErrorMessage(err) } });
      }
    }

    for (const guestRefund of manifest.guestPassRefunds) {
      try {
        const result = await refundGuestPass(guestRefund.ownerEmail, guestRefund.guestDisplayName, false);
        if (result.success) {
          logger.info('[BookingStateService] Refunded guest pass', { extra: { ownerEmail: guestRefund.ownerEmail, guestName: guestRefund.guestDisplayName } });
        } else {
          errors.push(`Guest pass refund failed for ${guestRefund.guestDisplayName || 'unknown'}: ${result.error}`);
          logger.error('[BookingStateService] Guest pass refund failed', { extra: { ownerEmail: guestRefund.ownerEmail, guestName: guestRefund.guestDisplayName, error: result.error } });
        }
      } catch (err: unknown) {
        const msg = `Guest pass refund threw for ${guestRefund.guestDisplayName || 'unknown'}: ${getErrorMessage(err)}`;
        errors.push(msg);
        logger.error('[BookingStateService] Guest pass refund threw', { extra: { ownerEmail: guestRefund.ownerEmail, error: getErrorMessage(err) } });
      }
    }

    if (manifest.trackmanSlotCleanup) {
      try {
        const { resourceId, slotDate, startTime, durationMinutes } = manifest.trackmanSlotCleanup;
        if (durationMinutes) {
          const [startHour, startMin] = startTime.split(':').map(Number);
          const startTotalMin = startHour * 60 + startMin;
          const endTotalMin = startTotalMin + durationMinutes;
          const endHour = Math.floor(endTotalMin / 60);
          const endMinute = endTotalMin % 60;
          const endTime = `${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`;
          await db.execute(sql`DELETE FROM trackman_bay_slots 
             WHERE resource_id = ${resourceId} AND slot_date = ${slotDate} AND start_time >= ${startTime} AND start_time < ${endTime}`);
        } else {
          await db.execute(sql`DELETE FROM trackman_bay_slots 
             WHERE resource_id = ${resourceId} AND slot_date = ${slotDate} AND start_time = ${startTime}`);
        }
      } catch (err: unknown) {
        logger.error('[BookingStateService] Trackman slot cleanup failed', { extra: { ...manifest.trackmanSlotCleanup, error: getErrorMessage(err) } });
      }
    }

    if (manifest.calendarDeletion) {
      try {
        const calendarName = await getCalendarNameForBayAsync(manifest.calendarDeletion.resourceId);
        if (calendarName) {
          const calendarId = await getCalendarIdByName(calendarName);
          if (calendarId) {
            await deleteCalendarEvent(manifest.calendarDeletion.eventId, calendarId);
          }
        }
      } catch (err: unknown) {
        logger.error('[BookingStateService] Calendar deletion failed', { extra: { eventId: manifest.calendarDeletion.eventId, error: getErrorMessage(err) } });
      }
    }

    if (manifest.notifications.memberNotification && manifest.notifications.memberNotification.userEmail) {
      const mn = manifest.notifications.memberNotification;
      notifyMember({
        userEmail: mn.userEmail,
        title: mn.title,
        message: mn.message,
        type: mn.type,
        relatedId: mn.relatedId,
        relatedType: mn.relatedType,
        url: '/sims',
        idempotencyKey: `${mn.type}_${mn.relatedId}_${mn.userEmail}`
      }, { sendPush: true, sendWebSocket: true }).catch(err => logger.error(`[BookingStateService] Member notification failed for bookingId=${mn.relatedId}`, { extra: { bookingId: mn.relatedId, error: getErrorMessage(err) } }));
    }

    if (manifest.notifications.staffNotification) {
      notifyAllStaff(
        manifest.notifications.staffNotification.title,
        manifest.notifications.staffNotification.message,
        'booking_cancelled',
        { url: '/admin/bookings' },
      ).catch(err => logger.error(`[BookingStateService] Staff notification failed for booking cancellation`, { extra: { error: getErrorMessage(err) } }));
    }

    if (manifest.notifications.memberWebSocket && manifest.notifications.memberWebSocket.email) {
      const ws = manifest.notifications.memberWebSocket;
      sendNotificationToUser(ws.email, {
        type: 'notification',
        title: ws.title,
        message: ws.message,
        data: { bookingId: ws.bookingId, eventType: 'booking_cancelled' },
      }, { action: 'booking_cancelled', bookingId: ws.bookingId, triggerSource: 'bookingStateService' });
    }

    if (manifest.availabilityBroadcast) {
      broadcastAvailabilityUpdate({
        resourceId: manifest.availabilityBroadcast.resourceId,
        resourceType: manifest.availabilityBroadcast.resourceType,
        date: manifest.availabilityBroadcast.date,
        action: 'cancelled',
      });
    }

    if (manifest.bookingEvent) {
      const evt = manifest.bookingEvent;
      bookingEvents.publish('booking_cancelled', {
        bookingId: evt.bookingId,
        memberEmail: evt.memberEmail,
        bookingDate: evt.bookingDate,
        startTime: evt.startTime,
        status: evt.status,
        actionBy: evt.actionBy as 'member' | 'staff',
      }, { notifyMember: false, notifyStaff: true, cleanupNotifications: false }).catch(err => logger.error(`[BookingStateService] Booking event publish failed for bookingId=${evt.bookingId}`, { extra: { bookingId: evt.bookingId, error: getErrorMessage(err) } }));

      voidBookingPass(evt.bookingId).catch(err => logger.error(`[BookingStateService] Failed to void booking wallet pass for bookingId=${evt.bookingId}`, { extra: { bookingId: evt.bookingId, error: getErrorMessage(err) } }));
    }

    return { errors };
  }

  export async function persistFailedSideEffects(bookingId: number, manifest: SideEffectsManifest, errors: string[]): Promise<void> {
    if (errors.length === 0) return;

    try {
      const records = errors.map((errorMessage) => {
        let actionType = 'unknown';
        let stripePaymentIntentId: string | null = null;

        if (errorMessage.includes('snapshot refund')) {
          actionType = 'stripe_snapshot_refund';
          const match = manifest.stripeSnapshotRefunds.find(r => errorMessage.includes(r.paymentIntentId.substring(0, 12)));
          if (match) stripePaymentIntentId = match.paymentIntentId;
        } else if (errorMessage.includes('balance refund')) {
          actionType = 'balance_refund';
          const match = manifest.balanceRefunds.find(r => errorMessage.includes(r.balanceRecordId));
          if (match) stripePaymentIntentId = match.balanceRecordId;
        } else if (errorMessage.includes('void') || errorMessage.includes('invoice')) {
          actionType = 'invoice_void';
        } else if (errorMessage.includes('calendar')) {
          actionType = 'calendar_cleanup';
        } else if (errorMessage.includes('refund') || errorMessage.includes('cancel')) {
          actionType = 'stripe_refund';
          const match = manifest.stripeRefunds.find(r => errorMessage.includes(r.paymentIntentId.substring(0, 12)));
          if (match) stripePaymentIntentId = match.paymentIntentId;
        }

        return {
          bookingId,
          actionType,
          stripePaymentIntentId,
          errorMessage,
          context: {
            hasStripeRefunds: manifest.stripeRefunds.length > 0,
            hasSnapshotRefunds: manifest.stripeSnapshotRefunds.length > 0,
            hasBalanceRefunds: manifest.balanceRefunds.length > 0,
            hasInvoiceVoid: !!manifest.invoiceVoid,
            hasCalendarDeletion: !!manifest.calendarDeletion,
          },
        };
      });

      for (const record of records) {
        await db.insert(failedSideEffects).values(record);
      }

      logger.warn('[BookingStateService] Persisted failed side effects for retry', {
        extra: { bookingId, failureCount: errors.length }
      });
    } catch (persistErr: unknown) {
      logger.error('[BookingStateService] CRITICAL: Failed to persist side effect failures', {
        extra: { bookingId, errors, persistError: getErrorMessage(persistErr) }
      });
    }
  }
