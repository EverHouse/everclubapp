import { db } from '../db';
import { failedSideEffects } from '../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import { schedulerTracker } from '../core/schedulerTracker';
import { notifyAllStaff } from '../core/notificationService';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

const MAX_RETRIES = 5;
const SCHEDULER_INTERVAL_MS = 30 * 60 * 1000;
const PERMANENT_FAILURE_ALERT_THRESHOLD = 3;

interface FailedSideEffectRow {
  id: number;
  booking_id: number;
  action_type: string;
  stripe_payment_intent_id: string | null;
  error_message: string;
  context: Record<string, unknown> | null;
  retry_count: number;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

async function retryFailedSideEffect(record: FailedSideEffectRow): Promise<boolean> {
  const id = record.id;
  const bookingId = record.booking_id;
  const actionType = record.action_type;
  const stripePaymentIntentId = record.stripe_payment_intent_id;
  const context = record.context;

  try {
    switch (actionType) {
      case 'stripe_refund':
      case 'stripe_snapshot_refund': {
        if (!stripePaymentIntentId) {
          logger.warn('[FailedSideEffects] No payment intent ID for refund retry, marking permanent failure', { extra: { id, bookingId } });
          return false;
        }
        const piStatus = await db.execute(sql`SELECT status FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${stripePaymentIntentId}`);
        const currentStatus = (piStatus.rows[0] as { status: string } | undefined)?.status;
        if (currentStatus === 'refunded' || currentStatus === 'canceled' || currentStatus === 'cancelled') {
          logger.info('[FailedSideEffects] Payment already refunded/cancelled, marking resolved', { extra: { id, stripePaymentIntentId } });
          return true;
        }
        const pendingStatuses = ['pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture'];
        if (currentStatus && pendingStatuses.includes(currentStatus)) {
          const { cancelPaymentIntent } = await import('../core/stripe/payments');
          const cancelResult = await cancelPaymentIntent(stripePaymentIntentId);
          if (!cancelResult.success) throw new Error(cancelResult.error || 'Cancel failed');
          await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW() WHERE stripe_payment_intent_id = ${stripePaymentIntentId} AND status IN ('pending', 'requires_action')`);
          return true;
        }
        if (currentStatus === 'refund_succeeded_sync_failed') {
          if (!stripePaymentIntentId.startsWith('pi_')) {
            logger.info('[FailedSideEffects] Synthetic PI with refund_succeeded_sync_failed — marking canceled', { extra: { id, stripePaymentIntentId } });
            await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${stripePaymentIntentId}`);
            return true;
          }
          const { getStripeClient } = await import('../core/stripe/client');
          const stripe = await getStripeClient();
          const piObj = await stripe.paymentIntents.retrieve(stripePaymentIntentId, { expand: ['latest_charge.refunds'] });
          const latestCharge = piObj.latest_charge as Stripe.Charge | null;
          const latestRefund = latestCharge?.refunds?.data?.[0];
          if (!latestRefund) {
            logger.warn('[FailedSideEffects] refund_succeeded_sync_failed but no refund found on Stripe PI', { extra: { id, stripePaymentIntentId } });
            return false;
          }
          const { markPaymentRefunded } = await import('../core/billing/PaymentStatusService');
          await markPaymentRefunded({ paymentIntentId: stripePaymentIntentId, refundId: latestRefund.id });
          return true;
        }
        if (currentStatus === 'succeeded') {
          if (!stripePaymentIntentId.startsWith('pi_')) {
            logger.info('[FailedSideEffects] Synthetic PI with succeeded status — marking canceled', { extra: { id, stripePaymentIntentId } });
            await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${stripePaymentIntentId}`);
            return true;
          }
          const { getStripeClient } = await import('../core/stripe/client');
          const stripe = await getStripeClient();
          const refund = await stripe.refunds.create({
            payment_intent: stripePaymentIntentId,
            reason: 'requested_by_customer',
            metadata: { reason: 'failed_side_effect_retry', bookingId: bookingId.toString() },
          }, { idempotencyKey: `refund_retry_${id}_${stripePaymentIntentId}_${record.retry_count}` });
          const { markPaymentRefunded } = await import('../core/billing/PaymentStatusService');
          await markPaymentRefunded({ paymentIntentId: stripePaymentIntentId, refundId: refund.id });
          return true;
        }
        logger.info('[FailedSideEffects] PI in non-retryable status, skipping', { extra: { id, stripePaymentIntentId, currentStatus } });
        return false;
      }

      case 'balance_refund': {
        if (!stripePaymentIntentId) return false;
        const balanceStatus = await db.execute(sql`SELECT status, stripe_customer_id, amount_cents FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${stripePaymentIntentId}`);
        const balanceRow = balanceStatus.rows[0] as { status: string; stripe_customer_id: string | null; amount_cents: number } | undefined;
        if (!balanceRow || balanceRow.status === 'refunded') return true;
        if (!balanceRow.stripe_customer_id || balanceRow.amount_cents <= 0) return false;
        const { getStripeClient } = await import('../core/stripe/client');
        const stripe = await getStripeClient();
        const txn = await stripe.customers.createBalanceTransaction(
          balanceRow.stripe_customer_id,
          { amount: -balanceRow.amount_cents, currency: 'usd', description: `Retry refund for booking #${bookingId}` },
          { idempotencyKey: `balance_refund_retry_${id}_${stripePaymentIntentId}_${record.retry_count}` }
        );
        const { markPaymentRefunded } = await import('../core/billing/PaymentStatusService');
        await markPaymentRefunded({ paymentIntentId: stripePaymentIntentId, refundId: txn.id, amountCents: balanceRow.amount_cents });
        return true;
      }

      case 'invoice_void': {
        const { voidBookingInvoice } = await import('../core/billing/bookingInvoiceService');
        const voidResult = await voidBookingInvoice(bookingId);
        return voidResult.success;
      }

      case 'calendar_cleanup': {
        const calendarEventId = (context as Record<string, unknown> | null)?.calendarEventId as string | undefined;
        const resourceId = (context as Record<string, unknown> | null)?.resourceId as number | undefined;
        if (!calendarEventId) {
          const bookingResult = await db.execute(sql`SELECT calendar_event_id, resource_id FROM booking_requests WHERE id = ${bookingId}`);
          const booking = bookingResult.rows[0] as { calendar_event_id: string | null; resource_id: number | null } | undefined;
          if (!booking?.calendar_event_id) return true;
          const { getCalendarNameForBayAsync } = await import('../routes/bays/helpers');
          const { getCalendarIdByName, deleteCalendarEvent } = await import('../core/calendar/index');
          const calendarName = await getCalendarNameForBayAsync(booking.resource_id);
          if (calendarName) {
            const calendarId = await getCalendarIdByName(calendarName);
            if (calendarId) {
              await deleteCalendarEvent(booking.calendar_event_id, calendarId);
            }
          }
          return true;
        }
        const { getCalendarNameForBayAsync } = await import('../routes/bays/helpers');
        const { getCalendarIdByName, deleteCalendarEvent } = await import('../core/calendar/index');
        const calendarName = await getCalendarNameForBayAsync(resourceId || null);
        if (calendarName) {
          const calendarId = await getCalendarIdByName(calendarName);
          if (calendarId) {
            await deleteCalendarEvent(calendarEventId, calendarId);
          }
        }
        return true;
      }

      case 'notification': {
        const notifContext = context as Record<string, unknown> | null;
        const userEmail = notifContext?.userEmail as string | undefined;
        const title = notifContext?.title as string | undefined;
        const message = notifContext?.message as string | undefined;
        const notifType = notifContext?.notificationType as string | undefined;
        if (!userEmail || !title || !message) {
          logger.warn('[FailedSideEffects] Notification retry missing required context (userEmail/title/message)', { extra: { id, bookingId, context } });
          return true;
        }
        const { notifyMember } = await import('../core/notificationService');
        await notifyMember({
          userEmail,
          title,
          message,
          type: (notifType || 'system') as 'system',
          relatedId: notifContext?.relatedId as string | undefined,
          relatedType: notifContext?.relatedType as string | undefined,
          idempotencyKey: `failed_side_effect_${id}_booking_${bookingId}`,
        }, { sendPush: true, sendWebSocket: true });
        return true;
      }

      case 'invoice_status_check': {
        const bookingResult = await db.execute(sql`SELECT stripe_invoice_id FROM booking_requests WHERE id = ${bookingId} AND stripe_invoice_id IS NOT NULL LIMIT 1`);
        const invoiceId = (bookingResult.rows[0] as Record<string, unknown> | undefined)?.stripe_invoice_id as string | undefined;
        if (!invoiceId) return true;
        const { getStripeClient } = await import('../core/stripe/client');
        const stripe = await getStripeClient();
        const inv = await stripe.invoices.retrieve(invoiceId);
        logger.info('[FailedSideEffects] Invoice status check retry complete', { extra: { id, bookingId, invoiceId, invoiceStatus: inv.status } });
        return true;
      }

      case 'wallet_pass_refresh': {
        const { refreshBookingPass } = await import('../walletPass/bookingPassService');
        await refreshBookingPass(bookingId);
        return true;
      }

      case 'wallet_pass_void': {
        const { voidBookingPass } = await import('../walletPass/bookingPassService');
        await voidBookingPass(bookingId);
        return true;
      }

      case 'hubspot_visit_sync': {
        const hubspotId = (context as Record<string, unknown> | null)?.hubspotId as string | undefined;
        const lifetimeVisits = (context as Record<string, unknown> | null)?.lifetimeVisits as number | undefined;
        if (!hubspotId || lifetimeVisits == null) {
          logger.warn('[FailedSideEffects] hubspot_visit_sync retry missing required context', { extra: { id, bookingId, context } });
          return false;
        }
        const { updateHubSpotContactVisitCount } = await import('../core/memberSync');
        await updateHubSpotContactVisitCount(hubspotId, lifetimeVisits);
        return true;
      }

      case 'guest_pass_refund': {
        const refundContext = context as Record<string, unknown> | null;
        const ownerEmail = refundContext?.ownerEmail as string | undefined;
        const guestDisplayName = refundContext?.guestDisplayName as string | undefined;
        if (!ownerEmail) {
          logger.warn('[FailedSideEffects] guest_pass_refund retry missing ownerEmail', { extra: { id, bookingId, context } });
          return false;
        }
        const { refundGuestPass } = await import('../core/billing/guestPassService');
        const refundResult = await refundGuestPass(ownerEmail, guestDisplayName || 'Guest', false);
        return refundResult.success;
      }

      case 'checkin_notification':
      case 'no_show_notification': {
        const notifCtx = context as Record<string, unknown> | null;
        const memberEmail = notifCtx?.memberEmail as string | undefined;
        if (!memberEmail) {
          logger.warn('[FailedSideEffects] Checkin notification retry missing memberEmail', { extra: { id, bookingId, context } });
          return true;
        }
        const originalTitle = (notifCtx?.title as string) || (actionType === 'no_show_notification' ? 'Missed Booking' : 'Checked In');
        const originalMessage = (notifCtx?.message as string) || `Booking #${bookingId} status update notification (retry).`;
        const originalType = (notifCtx?.notificationType as string) || 'booking';
        const { notifyMember } = await import('../core/notificationService');
        await notifyMember({
          userEmail: memberEmail,
          title: originalTitle,
          message: originalMessage,
          type: originalType as 'booking',
          relatedId: notifCtx?.relatedId as number | undefined ?? bookingId,
          relatedType: (notifCtx?.relatedType as string) || 'booking',
          idempotencyKey: `failed_side_effect_${id}_booking_${bookingId}`,
        }, { sendPush: true });
        return true;
      }

      case 'calendar_sync': {
        const calCtx = context as Record<string, unknown> | null;
        logger.info('[FailedSideEffects] Calendar sync requires manual resolution via admin dashboard', { extra: { id, bookingId, context: calCtx } });
        return false;
      }

      case 'prepayment_creation':
      case 'invoice_finalization': {
        logger.info(`[FailedSideEffects] ${actionType} requires manual resolution via admin dashboard`, { extra: { id, bookingId } });
        return false;
      }

      case 'push_notification': {
        const pushCtx = context as Record<string, unknown> | null;
        const pushUserEmail = pushCtx?.userEmail as string | undefined;
        if (!pushUserEmail) {
          logger.warn('[FailedSideEffects] Push notification retry missing userEmail', { extra: { id, bookingId } });
          return true;
        }
        const { sendPushNotification } = await import('../core/pushService');
        await sendPushNotification(pushUserEmail, {
          title: (pushCtx?.title as string) || 'Booking Update',
          body: (pushCtx?.message as string) || `Booking #${bookingId} update.`,
          url: (pushCtx?.url as string) || '/sims',
          tag: `booking-${bookingId}`
        });
        return true;
      }

      case 'group_notification': {
        logger.info('[FailedSideEffects] Group notification retry not supported — requires booking state reconstruction', { extra: { id, bookingId } });
        return false;
      }

      default: {
        logger.warn('[FailedSideEffects] Unknown action type, cannot retry', { extra: { id, actionType, bookingId } });
        return false;
      }
    }
  } catch (err: unknown) {
    logger.error('[FailedSideEffects] Retry failed', { extra: { id, bookingId, actionType, retryCount: record.retry_count, error: getErrorMessage(err) } });
    return false;
  }
}

async function processFailedSideEffects(): Promise<void> {
  try {
    const now = new Date();

    const claimedRows = await db.execute(sql`
      SELECT * FROM failed_side_effects
      WHERE resolved = false
        AND retry_count < ${MAX_RETRIES}
        AND (
          COALESCE(updated_at, created_at) + (INTERVAL '30 minutes' * POWER(2, retry_count)) <= NOW()
        )
      ORDER BY retry_count ASC, created_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);

    const unresolvedRows = claimedRows.rows as unknown as FailedSideEffectRow[];

    if (unresolvedRows.length === 0) {
      schedulerTracker.recordRun('Failed Side Effects', true);
      return;
    }

    let retried = 0;
    let resolved = 0;

    for (const row of unresolvedRows) {

      retried++;
      const success = await retryFailedSideEffect(row);

      if (success) {
        resolved++;
        await db.update(failedSideEffects)
          .set({ resolved: true, resolvedAt: now, resolvedBy: 'system:auto_retry', updatedAt: now })
          .where(eq(failedSideEffects.id, row.id));
        logger.info('[FailedSideEffects] Successfully retried and resolved', {
          extra: { id: row.id, bookingId: row.booking_id, actionType: row.action_type }
        });
      } else {
        await db.update(failedSideEffects)
          .set({ retryCount: row.retry_count + 1, updatedAt: now })
          .where(eq(failedSideEffects.id, row.id));
      }
    }

    const exhaustedResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM failed_side_effects
      WHERE resolved = false AND retry_count >= ${MAX_RETRIES}
    `);
    const exhaustedCount = Number((exhaustedResult.rows[0] as { cnt: string })?.cnt || 0);

    if (exhaustedCount >= PERMANENT_FAILURE_ALERT_THRESHOLD) {
      await notifyAllStaff(
        'Failed Side Effects Need Manual Review',
        `${exhaustedCount} failed side effect(s) have exceeded the maximum retry limit and need manual resolution. Check the Data Integrity dashboard for details.`,
        'system',
        { sendPush: true }
      );
    }

    logger.info(`[FailedSideEffects] Cycle complete — retried: ${retried}, resolved: ${resolved}, exhausted (unresolved): ${exhaustedCount}`);
    schedulerTracker.recordRun('Failed Side Effects', true);
  } catch (error: unknown) {
    logger.error('[FailedSideEffects] Scheduler error:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun('Failed Side Effects', false, getErrorMessage(error));
  }
}

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

async function guardedProcess(): Promise<void> {
  if (isRunning) {
    logger.info('[FailedSideEffects] Skipping run — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    await processFailedSideEffects();
  } finally {
    isRunning = false;
  }
}

export function startFailedSideEffectsScheduler(): void {
  if (intervalId) {
    logger.info('[FailedSideEffects] Scheduler already running');
    return;
  }

  logger.info('[Startup] Failed side effects retry scheduler enabled (runs every 30 minutes)');

  intervalId = setInterval(() => {
    guardedProcess().catch((err: unknown) => {
      logger.error('[FailedSideEffects] Uncaught error:', { extra: { error: getErrorMessage(err) } });
      schedulerTracker.recordRun('Failed Side Effects', false, getErrorMessage(err));
    });
  }, SCHEDULER_INTERVAL_MS);

  setTimeout(() => {
    guardedProcess().catch((err: unknown) => {
      logger.error('[FailedSideEffects] Initial run error:', { extra: { error: getErrorMessage(err) } });
      schedulerTracker.recordRun('Failed Side Effects', false, getErrorMessage(err));
    });
  }, 2 * 60 * 1000);
}

export function stopFailedSideEffectsScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  logger.info('[FailedSideEffects] Scheduler stopped');
}
