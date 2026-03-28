import Stripe from 'stripe';
import { getStripeSync, getStripeClient } from '../client';
import { updateFamilyDiscountPercent } from '../../billing/pricingConfig';
import { pool, safeRelease } from '../../db';
import { logger } from '../../logger';
import { getErrorMessage } from '../../../utils/errorUtils';
import type { DeferredAction, StripeProductWithMarketingFeatures, InvoiceWithLegacyFields, SubscriptionPreviousAttributes } from './types';
import {
  extractResourceId,
  tryClaimEvent,
  checkResourceEventOrder,
  executeDeferredActions,
} from './framework';
export { upsertTransactionCache } from './framework';

import {
  handlePaymentIntentSucceeded,
  handlePaymentIntentFailed,
  handlePaymentIntentCanceled,
  handlePaymentIntentStatusUpdate,
  handleChargeRefunded,
  handleChargeDisputeCreated,
  handleChargeDisputeClosed,
  handleChargeDisputeUpdated,
  handleCreditNoteCreated,
} from './handlers/payments';

import {
  handleInvoicePaymentSucceeded,
  handleInvoicePaymentFailed,
  handleInvoiceLifecycle,
  handleInvoiceVoided,
  handleInvoicePaymentActionRequired,
  handleInvoiceOverdue,
} from './handlers/invoices';

import {
  handleSubscriptionCreated,
  handleSubscriptionUpdated,
  handleSubscriptionPaused,
  handleSubscriptionResumed,
  handleSubscriptionDeleted,
  handleTrialWillEnd,
  handleSubscriptionScheduleCreated,
  handleSubscriptionScheduleUpdated,
  handleSubscriptionScheduleCanceled,
} from './handlers/subscriptions';

import {
  handleCheckoutSessionCompleted,
  handleCheckoutSessionExpired,
  handleCheckoutSessionAsyncPaymentFailed,
  handleCheckoutSessionAsyncPaymentSucceeded,
} from './handlers/checkout';

import {
  handleProductUpdated,
  handleProductCreated,
  handleProductDeleted,
  handlePriceChange,
  handlePriceDeleted,
} from './handlers/catalog';

import {
  handleCustomerUpdated,
  handleCustomerCreated,
  handleCustomerDeleted,
  handlePaymentMethodAttached,
  handlePaymentMethodDetached,
  handlePaymentMethodUpdated,
  handlePaymentMethodAutoUpdated,
  handleSetupIntentSucceeded,
  handleSetupIntentFailed,
} from './handlers/customers';

type StripeWebhookDataObject =
  | Stripe.PaymentIntent
  | Stripe.Charge
  | Stripe.Invoice
  | Stripe.Subscription
  | Stripe.Checkout.Session
  | Stripe.Product
  | Stripe.Price
  | Stripe.Coupon
  | Stripe.CreditNote
  | Stripe.Customer
  | Stripe.PaymentMethod
  | Stripe.Dispute
  | Stripe.SetupIntent
  | Stripe.SubscriptionSchedule
  | StripeProductWithMarketingFeatures
  | InvoiceWithLegacyFields;

async function dispatchWebhookEvent(
  client: import('pg').PoolClient,
  eventType: string,
  dataObject: StripeWebhookDataObject,
  previousAttributes?: Partial<SubscriptionPreviousAttributes>
): Promise<DeferredAction[]> {
  if (eventType === 'payment_intent.created') {
    return [];
  } else if (eventType === 'payment_intent.processing' || eventType === 'payment_intent.requires_action') {
    return handlePaymentIntentStatusUpdate(client, dataObject as Stripe.PaymentIntent);
  } else if (eventType === 'payment_intent.succeeded') {
    return handlePaymentIntentSucceeded(client, dataObject as Stripe.PaymentIntent);
  } else if (eventType === 'payment_intent.payment_failed') {
    return handlePaymentIntentFailed(client, dataObject as Stripe.PaymentIntent);
  } else if (eventType === 'payment_intent.canceled') {
    return handlePaymentIntentCanceled(client, dataObject as Stripe.PaymentIntent);
  } else if (eventType === 'charge.refunded') {
    return handleChargeRefunded(client, dataObject as Stripe.Charge);
  } else if (eventType === 'invoice.payment_succeeded') {
    return handleInvoicePaymentSucceeded(client, dataObject as InvoiceWithLegacyFields);
  } else if (eventType === 'invoice.payment_failed') {
    return handleInvoicePaymentFailed(client, dataObject as InvoiceWithLegacyFields);
  } else if (eventType === 'invoice.created' || eventType === 'invoice.finalized' || eventType === 'invoice.updated') {
    return handleInvoiceLifecycle(client, dataObject as InvoiceWithLegacyFields, eventType);
  } else if (eventType === 'invoice.voided' || eventType === 'invoice.marked_uncollectible') {
    return handleInvoiceVoided(client, dataObject as InvoiceWithLegacyFields, eventType);
  } else if (eventType === 'checkout.session.completed') {
    return handleCheckoutSessionCompleted(client, dataObject as Stripe.Checkout.Session);
  } else if (eventType === 'customer.subscription.created') {
    return handleSubscriptionCreated(client, dataObject as Stripe.Subscription);
  } else if (eventType === 'customer.subscription.updated') {
    return handleSubscriptionUpdated(client, dataObject as Stripe.Subscription, previousAttributes);
  } else if (eventType === 'customer.subscription.paused') {
    return handleSubscriptionPaused(client, dataObject as Stripe.Subscription);
  } else if (eventType === 'customer.subscription.resumed') {
    return handleSubscriptionResumed(client, dataObject as Stripe.Subscription);
  } else if (eventType === 'customer.subscription.deleted') {
    return handleSubscriptionDeleted(client, dataObject as Stripe.Subscription);
  } else if (eventType === 'charge.dispute.created') {
    return handleChargeDisputeCreated(client, dataObject as Stripe.Dispute);
  } else if (eventType === 'charge.dispute.closed') {
    return handleChargeDisputeClosed(client, dataObject as Stripe.Dispute);
  } else if (eventType === 'product.updated') {
    return handleProductUpdated(client, dataObject as StripeProductWithMarketingFeatures);
  } else if (eventType === 'product.created') {
    return handleProductCreated(client, dataObject as StripeProductWithMarketingFeatures);
  } else if (eventType === 'product.deleted') {
    return handleProductDeleted(client, dataObject as Stripe.Product);
  } else if (eventType === 'price.updated' || eventType === 'price.created') {
    return handlePriceChange(client, dataObject as Stripe.Price);
  } else if (eventType === 'price.deleted') {
    return handlePriceDeleted(client, dataObject as Stripe.Price);
  } else if (eventType === 'coupon.updated' || eventType === 'coupon.created') {
    const coupon = dataObject as Stripe.Coupon;
    if ((coupon.metadata?.system_role === 'family_discount' || coupon.id === 'FAMILY20') && coupon.percent_off) {
      updateFamilyDiscountPercent(coupon.percent_off);
      logger.info(`[Stripe Webhook] Family discount coupon ${eventType}: ${coupon.percent_off}% off (coupon: ${coupon.id})`);
    }
  } else if (eventType === 'coupon.deleted') {
    const coupon = dataObject as Stripe.Coupon;
    if (coupon.metadata?.system_role === 'family_discount' || coupon.id === 'FAMILY20') {
      updateFamilyDiscountPercent(0);
      logger.info(`[Stripe Webhook] Family discount coupon deleted (${coupon.id}) - discount zeroed out, will be recreated on next use`);
    }
  } else if (eventType === 'credit_note.created') {
    return handleCreditNoteCreated(client, dataObject as Stripe.CreditNote);
  } else if (eventType === 'customer.updated') {
    return handleCustomerUpdated(client, dataObject as Stripe.Customer);
  } else if (eventType === 'customer.subscription.trial_will_end') {
    return handleTrialWillEnd(client, dataObject as Stripe.Subscription);
  } else if (eventType === 'payment_method.attached') {
    return handlePaymentMethodAttached(client, dataObject as Stripe.PaymentMethod);
  } else if (eventType === 'customer.created') {
    return handleCustomerCreated(client, dataObject as Stripe.Customer);
  } else if (eventType === 'customer.deleted') {
    return handleCustomerDeleted(client, dataObject as Stripe.Customer);
  } else if (eventType === 'payment_method.detached') {
    return handlePaymentMethodDetached(client, dataObject as Stripe.PaymentMethod);
  } else if (eventType === 'payment_method.updated') {
    return handlePaymentMethodUpdated(client, dataObject as Stripe.PaymentMethod);
  } else if (eventType === 'payment_method.automatically_updated') {
    return handlePaymentMethodAutoUpdated(client, dataObject as Stripe.PaymentMethod);
  } else if (eventType === 'charge.dispute.updated') {
    return handleChargeDisputeUpdated(client, dataObject as Stripe.Dispute);
  } else if (eventType === 'checkout.session.expired') {
    return handleCheckoutSessionExpired(client, dataObject as Stripe.Checkout.Session);
  } else if (eventType === 'checkout.session.async_payment_failed') {
    return handleCheckoutSessionAsyncPaymentFailed(client, dataObject as Stripe.Checkout.Session);
  } else if (eventType === 'checkout.session.async_payment_succeeded') {
    return handleCheckoutSessionAsyncPaymentSucceeded(client, dataObject as Stripe.Checkout.Session);
  } else if (eventType === 'invoice.payment_action_required') {
    return handleInvoicePaymentActionRequired(client, dataObject as InvoiceWithLegacyFields);
  } else if (eventType === 'invoice.overdue') {
    return handleInvoiceOverdue(client, dataObject as InvoiceWithLegacyFields);
  } else if (eventType === 'setup_intent.succeeded') {
    return handleSetupIntentSucceeded(client, dataObject as Stripe.SetupIntent);
  } else if (eventType === 'setup_intent.setup_failed') {
    return handleSetupIntentFailed(client, dataObject as Stripe.SetupIntent);
  } else if (eventType === 'subscription_schedule.created') {
    return handleSubscriptionScheduleCreated(client, dataObject as Stripe.SubscriptionSchedule);
  } else if (eventType === 'subscription_schedule.updated') {
    return handleSubscriptionScheduleUpdated(client, dataObject as Stripe.SubscriptionSchedule);
  } else if (eventType === 'subscription_schedule.canceled') {
    return handleSubscriptionScheduleCanceled(client, dataObject as Stripe.SubscriptionSchedule);
  }

  logger.warn(`[Stripe Webhook] Received unhandled event type: ${eventType} — consider adding a handler or removing this event from the Stripe webhook endpoint configuration`);
  return [];
}

export async function processStripeWebhook(
  payload: Buffer,
  signature: string
): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error(
      'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
      'Received type: ' + typeof payload + '. ' +
      'This usually means express.json() parsed the body before reaching this handler.'
    );
  }

  const stripe = await getStripeClient();
  const payloadString = payload.toString('utf8');

  const isProductionEnv = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  try {
    const rawParse = JSON.parse(payloadString) as { id?: string; livemode?: boolean };
    if (typeof rawParse.livemode === 'boolean' && rawParse.livemode !== isProductionEnv) {
      logger.warn(`[Stripe Webhook] Ignored event ${rawParse.id ?? 'unknown'}: livemode=${rawParse.livemode} does not match environment production=${isProductionEnv}`);
      return;
    }
  } catch {
    logger.warn('[Stripe Webhook] Could not pre-parse payload for livemode check, continuing');
  }

  const sync = await getStripeSync() as { processWebhook: (payload: Buffer, signature: string) => Promise<void> };
  try {
    await sync.processWebhook(payload, signature);
  } catch (sigErr) {
    logger.warn('[Stripe Webhook] Signature verification failed', { extra: { error: getErrorMessage(sigErr) } });
    throw new Error('Webhook signature verification failed');
  }

  let event: Stripe.Event;
  try {
    const minimalParse = JSON.parse(payloadString) as { id: string };
    event = await stripe.events.retrieve(minimalParse.id);
  } catch (retrieveErr) {
    logger.warn('[Stripe Webhook] Stripe API retrieve failed, using verified payload', {
      extra: { error: getErrorMessage(retrieveErr) },
    });
    try {
      event = JSON.parse(payloadString) as Stripe.Event;
    } catch (parseErr) {
      logger.error('[Stripe Webhook] Failed to parse verified payload', {
        extra: { error: getErrorMessage(parseErr) },
      });
      throw new Error('Failed to parse webhook event');
    }
  }

  const resourceId = extractResourceId(event);
  const client = await pool.connect();
  let isCommitted = false;

  try {
    await client.query('BEGIN');

    const claimResult = await tryClaimEvent(client, event.id, event.type, event.created, resourceId);
    
    if (!claimResult.claimed) {
      await client.query('ROLLBACK');
      logger.info(`[Stripe Webhook] Skipping ${claimResult.reason} event: ${event.id} (${event.type})`);
      return;
    }

    if (resourceId) {
      const orderOk = await checkResourceEventOrder(client, resourceId, event.type, event.created, event.id);
      if (!orderOk) {
        await client.query('ROLLBACK');
        logger.info(`[Stripe Webhook] Skipping out-of-order event: ${event.id} (${event.type}) for resource ${resourceId}`);
        return;
      }
    }

    logger.info(`[Stripe Webhook] Processing event: ${event.id} (${event.type})`);

    const deferredActions = await dispatchWebhookEvent(client, event.type, event.data.object, event.data.previous_attributes);

    await client.query('COMMIT');
    isCommitted = true;
    logger.info(`[Stripe Webhook] Event ${event.id} committed successfully`);

    const failedActions = await executeDeferredActions(deferredActions, { eventId: event.id, eventType: event.type });
    if (failedActions > 0) {
      const dlqClient = await pool.connect();
      try {
        await dlqClient.query(
          `INSERT INTO webhook_dead_letter_queue (event_id, event_type, resource_id, reason, event_payload)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (event_id) DO UPDATE SET
             reason = webhook_dead_letter_queue.reason || E'\n' || EXCLUDED.reason,
             event_payload = EXCLUDED.event_payload`,
          [
            event.id,
            event.type,
            resourceId || null,
            `deferred_action_failure: ${failedActions} action(s) failed post-commit`,
            JSON.stringify({ deferredActions, failedCount: failedActions }),
          ]
        );
        logger.warn(`[Stripe Webhook] Event ${event.id} committed but ${failedActions} deferred action(s) failed — written to DLQ for retry`);
      } catch (dlqErr) {
        logger.error(`[Stripe Webhook] Failed to write deferred action failure to DLQ for ${event.id}:`, { extra: { error: getErrorMessage(dlqErr) } });
      } finally {
        safeRelease(dlqClient);
      }
    }

  } catch (handlerError: unknown) {
    if (!isCommitted) {
      await client.query('ROLLBACK').catch(rbErr =>
        logger.error(`[Stripe Webhook] Rollback also failed for ${event.id}:`, { extra: { error: getErrorMessage(rbErr) } })
      );
    }
    logger.error(`[Stripe Webhook] Handler failed for ${event.type} (${event.id})${isCommitted ? ' (post-commit deferred actions)' : ', rolled back'}:`, { extra: { error: getErrorMessage(handlerError) } });
    if (!isCommitted) throw handlerError;
  } finally {
    safeRelease(client);
  }
}

export async function replayStripeEvent(
  eventId: string,
  forceReplay: boolean = false
): Promise<{ success: boolean; eventType: string; message: string }> {
  const stripe = await getStripeClient();
  const event = await stripe.events.retrieve(eventId);

  const resourceId = extractResourceId(event);
  const client = await pool.connect();
  let replayCommitted = false;

  try {
    await client.query('BEGIN');

    if (!forceReplay) {
      const claimResult = await tryClaimEvent(client, event.id, event.type, event.created, resourceId);

      if (!claimResult.claimed) {
        await client.query('ROLLBACK');
        logger.info(`[Stripe Webhook Replay] Skipping ${claimResult.reason} event: ${event.id} (${event.type})`);
        return { success: false, eventType: event.type, message: `Event already processed (${claimResult.reason}). Use forceReplay=true to override.` };
      }
    }

    if (resourceId) {
      const orderOk = await checkResourceEventOrder(client, resourceId, event.type, event.created, event.id);
      if (!orderOk) {
        await client.query('ROLLBACK');
        logger.info(`[Stripe Webhook Replay] Skipping out-of-order event: ${event.id} (${event.type}) for resource ${resourceId}`);
        return { success: false, eventType: event.type, message: `Event is out of order for resource ${resourceId}` };
      }
    }

    logger.info(`[Stripe Webhook Replay] Processing event: ${event.id} (${event.type})`);

    const deferredActions = await dispatchWebhookEvent(client, event.type, event.data.object, event.data.previous_attributes);

    await client.query('COMMIT');
    replayCommitted = true;
    logger.info(`[Stripe Webhook Replay] Event ${event.id} committed successfully`);

    await executeDeferredActions(deferredActions);

    return { success: true, eventType: event.type, message: `Successfully replayed event ${event.id} (${event.type})` };
  } catch (handlerError: unknown) {
    if (!replayCommitted) {
      await client.query('ROLLBACK').catch(rbErr =>
        logger.error(`[Stripe Webhook Replay] Rollback also failed for ${event.id}:`, { extra: { error: getErrorMessage(rbErr) } })
      );
    }
    logger.error(`[Stripe Webhook Replay] Handler failed for ${event.type} (${event.id})${replayCommitted ? ' (post-commit deferred actions)' : ', rolled back'}:`, { extra: { error: getErrorMessage(handlerError) } });
    if (!replayCommitted) throw handlerError;
    return { success: true, eventType: event.type, message: `Event committed but deferred actions failed: ${getErrorMessage(handlerError)}` };
  } finally {
    safeRelease(client);
  }
}
