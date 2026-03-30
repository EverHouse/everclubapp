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
          type: (notifType || 'system_alert') as 'system_alert',
          relatedId: notifContext?.relatedId as string | undefined,
          relatedType: notifContext?.relatedType as string | undefined,
        }, { sendPush: true, sendWebSocket: true });
        return true;
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
        'system_alert',
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
