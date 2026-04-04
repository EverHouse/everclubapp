import Stripe from 'stripe';
import { db } from '../../../db';
import { sql, lt } from 'drizzle-orm';
import { webhookProcessedEvents } from '../../../../shared/models/system';
import { logger } from '../../logger';
import { getErrorMessage } from '../../../utils/errorUtils';
import type { PoolClient } from 'pg';
import { pool, safeRelease } from '../../db';
import type { DeferredAction, StripeEventObject, CacheTransactionParams } from './types';
import { alertOnDeferredActionFailure, recordDeferredActionOutcome } from '../../dataAlerts';

const EVENT_DEDUP_WINDOW_DAYS = 30;

export function extractResourceId(event: Stripe.Event): string | null {
  const obj = event.data?.object as unknown as StripeEventObject | undefined;
  if (!obj || !obj.id) return null;

  const metadata = obj.metadata as Record<string, string> | undefined;

  if (event.type.startsWith('payment_intent.')) {
    return metadata?.bookingId ? `booking:${metadata.bookingId}` : obj.id;
  }
  if (event.type.startsWith('invoice.')) {
    return obj.subscription ? `sub:${obj.subscription}` : obj.id;
  }
  if (event.type.startsWith('customer.subscription.')) {
    return `sub:${obj.id}`;
  }
  if (event.type.startsWith('checkout.session.')) {
    if (metadata?.bookingId) return `booking:${metadata.bookingId}`;
    if (obj.subscription) return `sub:${typeof obj.subscription === 'string' ? obj.subscription : obj.id}`;
    return obj.id;
  }
  if (event.type.startsWith('charge.')) return obj.payment_intent || obj.id;
  if (event.type.startsWith('setup_intent.')) return obj.id;
  if (event.type.startsWith('subscription_schedule.')) return obj.subscription || obj.id;
  
  return null;
}

export async function tryClaimEvent(
  client: PoolClient,
  eventId: string,
  eventType: string,
  eventTimestamp: number,
  resourceId: string | null
): Promise<{ claimed: boolean; reason?: 'duplicate' | 'out_of_order' }> {
  const claimed = await client.query(
    `INSERT INTO webhook_processed_events (event_id, event_type, resource_id, processed_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, eventType, resourceId]
  );

  if (claimed.rowCount === 0) {
    return { claimed: false, reason: 'duplicate' };
  }

  return { claimed: true };
}

function getEventFamily(type: string): string {
  const parts = type.split('.');
  if (parts[0] === 'customer' && parts[1] === 'subscription') return 'customer.subscription';
  if (parts[0] === 'checkout' && parts[1] === 'session') return 'checkout.session';
  if (parts[0] === 'charge' && parts[1] === 'dispute') return 'charge.dispute';
  if (parts[0] === 'subscription_schedule') return 'subscription_schedule';
  return parts[0];
}

export async function checkResourceEventOrder(
  client: PoolClient,
  resourceId: string,
  eventType: string,
  _eventTimestamp: number,
  stripeEventId?: string
): Promise<boolean> {
  const EVENT_PRIORITY: Record<string, number> = {
    'payment_intent.created': 1,
    'payment_intent.processing': 2,
    'payment_intent.requires_action': 3,
    'payment_intent.succeeded': 10,
    'payment_intent.payment_failed': 10,
    'payment_intent.canceled': 10,
    'charge.succeeded': 11,
    'charge.refunded': 20,
    'charge.dispute.created': 25,
    'charge.dispute.updated': 25,
    'charge.dispute.closed': 26,
    'invoice.created': 1,
    'invoice.finalized': 2,
    'invoice.payment_action_required': 5,
    'invoice.payment_succeeded': 10,
    'invoice.payment_failed': 10,
    'invoice.paid': 10,
    'invoice.overdue': 15,
    'invoice.voided': 20,
    'invoice.marked_uncollectible': 20,
    'checkout.session.completed': 10,
    'checkout.session.expired': 20,
    'checkout.session.async_payment_succeeded': 15,
    'checkout.session.async_payment_failed': 15,
    'setup_intent.succeeded': 10,
    'setup_intent.setup_failed': 10,
    'customer.subscription.created': 1,
    'customer.subscription.updated': 5,
    'customer.subscription.paused': 8,
    'customer.subscription.resumed': 9,
    'customer.subscription.deleted': 20,
    'subscription_schedule.created': 5,
    'subscription_schedule.updated': 5,
    'subscription_schedule.canceled': 10,
  };

  const currentPriority = EVENT_PRIORITY[eventType] || 5;

  const result = await client.query(
    `SELECT event_type, processed_at FROM webhook_processed_events 
     WHERE resource_id = $1 AND event_type != $2
     ORDER BY processed_at DESC LIMIT 1`,
    [resourceId, eventType]
  );

  if (result.rows.length === 0) {
    return true;
  }

  const lastEventType = result.rows[0].event_type;
  const lastPriority = EVENT_PRIORITY[lastEventType] || 5;

  const isSameFamily = getEventFamily(lastEventType) === getEventFamily(eventType);

  if (isSameFamily && lastPriority > currentPriority) {
    if (eventType === 'customer.subscription.created') {
      if (lastEventType === 'customer.subscription.deleted') {
        logger.info(`[Stripe Webhook] Blocking stale subscription.created after subscription.deleted for resource ${resourceId} — preventing ghost reactivation`);
        return false;
      }
      logger.info(`[Stripe Webhook] Out-of-order event: ${eventType} (priority ${currentPriority}) after ${lastEventType} (priority ${lastPriority}) for resource ${resourceId} — allowing through because subscription creation should never be skipped`);
      return true;
    }
    logger.warn(`[Stripe Webhook] Out-of-order event: ${eventType} (priority ${currentPriority}) after ${lastEventType} (priority ${lastPriority}) for resource ${resourceId} — buffering to dead letter queue`);
    let dlqClient: PoolClient | null = null;
    try {
      dlqClient = await pool.connect();
      await dlqClient.query(
        `INSERT INTO webhook_dead_letter_queue (event_id, event_type, resource_id, reason, event_payload)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO NOTHING`,
        [
          stripeEventId || `${resourceId}:${eventType}:${Date.now()}`,
          eventType,
          resourceId,
          `Out-of-order: priority ${currentPriority} after ${lastEventType} (priority ${lastPriority})`,
          JSON.stringify({ stripeEventId, eventType, resourceId, currentPriority, lastEventType, lastPriority })
        ]
      );
    } catch (dlqErr: unknown) {
      logger.error('[Stripe Webhook] Failed to write to dead letter queue:', { extra: { error: getErrorMessage(dlqErr) } });
    } finally {
      if (dlqClient) {
        safeRelease(dlqClient);
      }
    }
    return false;
  }

  return true;
}

export async function executeDeferredActions(actions: DeferredAction[], eventContext?: { eventId: string; eventType: string }): Promise<number> {
  let failedCount = 0;
  const failedIndices: number[] = [];
  const eventId = eventContext?.eventId || 'unknown';
  const eventType = eventContext?.eventType || 'unknown';
  const results = await Promise.allSettled(actions.map(action => Promise.resolve().then(() => action())));
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === 'rejected') {
      failedCount++;
      failedIndices.push(i);
      const errorMsg = getErrorMessage((results[i] as PromiseRejectedResult).reason);
      logger.error(`[DeferredAction] Action ${i + 1}/${actions.length} failed for event ${eventId} (${eventType}):`, { 
        extra: { error: errorMsg, eventId, eventType, actionIndex: i }
      });
    }
  }

  const successCount = actions.length - failedCount;
  recordDeferredActionOutcome('stripe_webhook', successCount, failedCount);

  if (failedCount > 0) {
    logger.warn(`[DeferredAction] ${failedCount}/${actions.length} deferred actions failed for event ${eventId} (${eventType})`);

    const isCriticalEvent = eventType.startsWith('payment_intent.') ||
      eventType.startsWith('invoice.') ||
      eventType.startsWith('checkout.session.') ||
      eventType.startsWith('charge.');
    alertOnDeferredActionFailure(
      'stripe_webhook',
      eventId,
      `${failedCount}/${actions.length} deferred actions failed`,
      `Event ${eventId} (${eventType}): side-effects may not have executed`,
      isCriticalEvent,
      eventType
    ).catch(err => logger.error('[DeferredAction] Failed to send deferred action alert:', { extra: { error: getErrorMessage(err) } }));
  }
  return failedCount;
}

export async function upsertTransactionCache(params: CacheTransactionParams): Promise<void> {
  try {
    if (params.customerId) {
      const known = await db.execute(
        sql`SELECT 1 FROM users WHERE stripe_customer_id = ${params.customerId} LIMIT 1`
      );
      if (known.rows.length === 0) {
        logger.debug('[Stripe Cache] Unmapped customer, recording as guest transaction', { extra: { customerId: params.customerId, stripeId: params.stripeId } });
        params.customerId = undefined;
      }
    }

    await db.execute(
      sql`INSERT INTO stripe_transaction_cache 
       (stripe_id, object_type, amount_cents, currency, status, created_at, updated_at, 
        customer_id, customer_email, customer_name, description, metadata, source, 
        payment_intent_id, charge_id, invoice_id)
       VALUES (${params.stripeId}, ${params.objectType}, ${params.amountCents}, ${params.currency ?? 'usd'}, ${params.status}, ${params.createdAt}, NOW(), ${params.customerId ?? null}, ${params.customerEmail ?? null}, ${params.customerName ?? null}, ${params.description ?? null}, ${params.metadata ? JSON.stringify(params.metadata) : null}, ${params.source ?? 'webhook'}, ${params.paymentIntentId ?? null}, ${params.chargeId ?? null}, ${params.invoiceId ?? null})
       ON CONFLICT (stripe_id) DO UPDATE SET
         status = CASE 
           WHEN stripe_transaction_cache.status IN ('succeeded', 'failed', 'canceled') 
                AND EXCLUDED.status NOT IN ('succeeded', 'failed', 'canceled', 'refunded')
           THEN stripe_transaction_cache.status 
           ELSE EXCLUDED.status 
         END,
         amount_cents = EXCLUDED.amount_cents,
         customer_email = COALESCE(EXCLUDED.customer_email, stripe_transaction_cache.customer_email),
         customer_name = COALESCE(EXCLUDED.customer_name, stripe_transaction_cache.customer_name),
         description = COALESCE(EXCLUDED.description, stripe_transaction_cache.description),
         metadata = COALESCE(EXCLUDED.metadata, stripe_transaction_cache.metadata),
         updated_at = NOW()`
    );
  } catch (err: unknown) {
    logger.error('[Stripe Cache] Error upserting transaction cache:', { extra: { error: getErrorMessage(err) } });
  }
}

export async function cleanupOldProcessedEvents(): Promise<void> {
  try {
    const result = await db.delete(webhookProcessedEvents)
      .where(lt(webhookProcessedEvents.processedAt, sql`NOW() - INTERVAL '30 days'`))
      .returning({ id: webhookProcessedEvents.id });
    if (result.length > 0) {
      logger.info(`[Stripe Webhook] Cleaned up ${result.length} old processed events (>${EVENT_DEDUP_WINDOW_DAYS} days)`);
    }
  } catch (err: unknown) {
    logger.error('[Stripe Webhook] Error cleaning up old events:', { extra: { error: getErrorMessage(err) } });
  }
}
