import { getStripeSync } from '../core/stripe';
import { getStripeEnvironmentInfo, getStripeClient } from '../core/stripe/client';
import { runMigrations } from 'stripe-replit-sync';
import type Stripe from 'stripe';
import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { stripSslMode } from '../core/db';
import { retryWithBackoff } from './startupUtils';
import type { StartupHealth } from './startupTypes';

export async function initStripe(startupHealth: StartupHealth): Promise<void> {
  let origStdoutWrite: typeof process.stdout.write | undefined;
  let origStderrWrite: typeof process.stderr.write | undefined;
  try {
    const databaseUrl = stripSslMode(process.env.DATABASE_POOLER_URL) || process.env.DATABASE_URL;
    if (databaseUrl) {
      logger.info('[Stripe] Initializing Stripe schema...');
      const migrationUrl = new URL(databaseUrl);
      migrationUrl.searchParams.set('options', '-c statement_timeout=60000');
      await retryWithBackoff(() => runMigrations({ databaseUrl: migrationUrl.toString(), schema: 'stripe' } as unknown as Parameters<typeof runMigrations>[0]), 'Stripe schema migration', 5);
      logger.info('[Stripe] Schema ready');

      origStdoutWrite = process.stdout.write.bind(process.stdout);
      origStderrWrite = process.stderr.write.bind(process.stderr);
      const stripeSyncNoisePatterns = ['StripeSync initialized', 'autoExpandLists', 'Webhook not found', 'orphaned managed webhook', 'StripeInvalidRequestError'];
      const isStripeSyncNoise = (chunk: string | Buffer) => {
        const s = typeof chunk === 'string' ? chunk : chunk.toString();
        return stripeSyncNoisePatterns.some(p => s.includes(p));
      };
      process.stdout.write = ((chunk: string | Buffer, encodingOrCb?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
        if (isStripeSyncNoise(chunk)) return true;
        return origStdoutWrite!.call(process.stdout, chunk, encodingOrCb as BufferEncoding, cb);
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: string | Buffer, encodingOrCb?: BufferEncoding | ((err?: Error | null) => void), cb?: (err?: Error | null) => void) => {
        if (isStripeSyncNoise(chunk)) return true;
        return origStderrWrite!.call(process.stderr, chunk, encodingOrCb as BufferEncoding, cb);
      }) as typeof process.stderr.write;

      const stripeSync: unknown = await retryWithBackoff(() => getStripeSync(), 'Stripe sync init');

      const replitDomains = process.env.REPLIT_DOMAINS?.split(',')[0];
      if (replitDomains) {
        await setupStripeWebhook(replitDomains, stripeSync);
      }

      if (origStdoutWrite) process.stdout.write = origStdoutWrite;
      if (origStderrWrite) process.stderr.write = origStderrWrite;
      startupHealth.stripe = 'ok';

      try {
        const { validateStripeEnvironmentIds } = await import('../core/stripe/environmentValidation');
        await validateStripeEnvironmentIds();
      } catch (err: unknown) {
        logger.error('[Stripe Env] Validation failed', { extra: { error: getErrorMessage(err) } });
      }

      (stripeSync as unknown as { syncBackfill: () => Promise<void> }).syncBackfill()
        .then(() => logger.info('[Stripe] Data sync complete'))
        .catch((err: unknown) => {
          logger.error('[Stripe] Data sync error', { extra: { error: getErrorMessage(err) } });
          startupHealth.warnings.push(`Stripe backfill: ${getErrorMessage(err)}`);
        });

      import('../core/stripe/groupBilling.js')
        .then(({ getOrCreateFamilyCoupon }) => getOrCreateFamilyCoupon())
        .then(() => logger.info('[Stripe] FAMILY20 coupon ready'))
        .catch((err: unknown) => logger.error('[Stripe] FAMILY20 coupon setup failed', { extra: { error: getErrorMessage(err) } }));

      await initStripeProducts(startupHealth);
    }
  } catch (err: unknown) {
    try { if (origStdoutWrite) process.stdout.write = origStdoutWrite; if (origStderrWrite) process.stderr.write = origStderrWrite; } catch { /* restore best-effort */ }
    logger.error('[Stripe] Initialization failed', { extra: { error: getErrorMessage(err) } });
    startupHealth.stripe = 'failed';
    startupHealth.criticalFailures.push(`Stripe initialization: ${getErrorMessage(err)}`);
  }
}

async function setupStripeWebhook(replitDomains: string, stripeSync: unknown): Promise<void> {
  const webhookUrl = `https://${replitDomains}/api/stripe/webhook`;
  logger.info('[Stripe] Setting up managed webhook...');
  const result = await retryWithBackoff(() => (stripeSync as unknown as { findOrCreateManagedWebhook: (url: string) => Promise<unknown> }).findOrCreateManagedWebhook(webhookUrl), 'Stripe webhook setup');
  logger.info('[Stripe] Webhook configured');

  const requiredEvents = [
    'customer.created', 'customer.updated',
    'customer.subscription.created', 'customer.subscription.updated',
    'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed',
    'payment_intent.created', 'payment_intent.succeeded', 'payment_intent.payment_failed',
    'payment_intent.canceled', 'payment_intent.processing', 'payment_intent.requires_action',
    'invoice.payment_succeeded', 'invoice.payment_failed', 'invoice.created',
    'invoice.finalized', 'invoice.updated', 'invoice.voided',
    'invoice.marked_uncollectible', 'checkout.session.completed',
    'charge.refunded', 'charge.dispute.created', 'charge.dispute.closed',
    'product.created', 'product.updated', 'product.deleted',
    'price.created', 'price.updated',
    'coupon.created', 'coupon.updated', 'coupon.deleted',
    'credit_note.created', 'customer.subscription.trial_will_end', 'customer.deleted',
    'payment_method.attached', 'payment_method.detached', 'payment_method.updated',
    'payment_method.automatically_updated', 'charge.dispute.updated',
    'checkout.session.expired', 'checkout.session.async_payment_failed',
    'checkout.session.async_payment_succeeded', 'invoice.payment_action_required',
    'invoice.overdue', 'setup_intent.succeeded', 'setup_intent.setup_failed',
  ];

  try {
    const webhookObj = ((result as { webhook?: { id?: string; enabled_events?: string[] } })?.webhook || result) as { id?: string; enabled_events?: string[] };
    if (webhookObj?.id) {
      const currentEvents = (webhookObj.enabled_events || []) as string[];
      const missingEvents = requiredEvents.filter(
        (e: string) => !currentEvents.includes(e) && !currentEvents.includes('*')
      );
      if (missingEvents.length > 0) {
        logger.info(`[Stripe] Webhook missing ${missingEvents.length} event types, updating...`, { extra: { missingEvents } });
        const { getStripeClient } = await import('../core/stripe/client');
        const stripe = await getStripeClient();
        await stripe.webhookEndpoints.update(String(webhookObj.id), {
          enabled_events: requiredEvents as unknown as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
        });
        logger.info('[Stripe] Webhook events updated successfully');
      } else {
        logger.info('[Stripe] Webhook already has all required events');
      }
    }
  } catch (webhookUpdateErr: unknown) {
    logger.error('[Stripe] Failed to update webhook events (non-fatal)', { extra: { error: getErrorMessage(webhookUpdateErr) } });
  }
}

async function initStripeProducts(startupHealth: StartupHealth): Promise<void> {
  const products = await import('../core/stripe/products.js');

  const productInits: Array<{ name: string; fn: () => Promise<{ action: string }> }> = [
    { name: 'Simulator Overage', fn: () => products.ensureSimulatorOverageProduct() },
    { name: 'Guest Pass', fn: () => products.ensureGuestPassProduct() },
    { name: 'Day Pass Coworking', fn: () => products.ensureDayPassCoworkingProduct() },
    { name: 'Day Pass Golf Sim', fn: () => products.ensureDayPassGolfSimProduct() },
    { name: 'Corporate Volume Pricing', fn: () => products.ensureCorporateVolumePricingProduct() },
  ];

  for (const { name, fn } of productInits) {
    try {
      const result = await retryWithBackoff(async () => {
        const r = await fn();
        if (r.action === 'error') throw new Error(`${name} product initialization failed (${r.action})`);
        return { name, action: r.action };
      }, `${name} product`);
      logger.info(`[Stripe] ${name} product ${result.action}`, { extra: { action: result.action } });
    } catch (err: unknown) {
      logger.error(`[Stripe] ${name} setup failed`, { extra: { error: getErrorMessage(err) } });
      startupHealth.warnings.push(`Stripe product init: ${name} - ${getErrorMessage(err)}`);
    }
  }

  try {
    const pulled = await retryWithBackoff(() => products.pullCorporateVolumePricingFromStripe(), 'Corporate pricing pull');
    logger.info(`[Stripe] Corporate pricing ${pulled ? 'pulled from Stripe' : 'using defaults'}`, { extra: { pulled } });
  } catch (err: unknown) {
    logger.error('[Stripe] Corporate pricing pull failed', { extra: { error: getErrorMessage(err) } });
  }

  try {
    const dedup = await products.deduplicateStripeProducts();
    if (dedup.archived > 0) {
      logger.info(`[Stripe] Deduplicated products: ${dedup.archived} archived, ${dedup.kept} kept`, { extra: { results: dedup.results } });
    }
  } catch (err: unknown) {
    logger.error('[Stripe] Product deduplication failed', { extra: { error: getErrorMessage(err) } });
  }

  try {
    const stalePriceResult = await products.archiveAllStalePrices();
    if (stalePriceResult.totalArchived > 0) {
      logger.info(`[Stripe] Stale price sweep: ${stalePriceResult.totalArchived} archived across ${stalePriceResult.productsProcessed} products`, { extra: { errors: stalePriceResult.totalErrors, skipped: stalePriceResult.productsSkipped } });
    }
  } catch (err: unknown) {
    logger.error('[Stripe] Stale price sweep failed', { extra: { error: getErrorMessage(err) } });
  }

  try {
    const { syncStripeCustomersForMindBodyMembers } = await import('../core/stripe/customerSync.js');
    const result = await syncStripeCustomersForMindBodyMembers();
    if (result.updated > 0 || result.relinked > 0 || result.staleFound > 0) {
      logger.info('[Stripe] Customer sync complete', { extra: { updated: result.updated, relinked: result.relinked, staleDetected: result.staleFound } });
    }
  } catch (err: unknown) {
    logger.error('[Stripe] Customer sync failed', { extra: { error: getErrorMessage(err) } });
  }
}

export async function verifyStripeEnvironment(startupHealth: StartupHealth): Promise<void> {
  try {
    const { isLive, mode, isProduction } = await getStripeEnvironmentInfo();
    if (isProduction && !isLive) {
      logger.warn('[STARTUP WARNING] ⚠️ PRODUCTION DEPLOYMENT IS USING STRIPE TEST KEYS! Payments will NOT be processed with real money. Configure live Stripe keys in deployment settings.');
    } else if (!isProduction && isLive) {
      logger.warn('[STARTUP WARNING] ⚠️ Development environment is using Stripe LIVE keys. Be careful — real charges will be processed!');
    } else {
      logger.info(`[Startup] Stripe environment: ${mode} mode${isProduction ? ' (production)' : ' (development)'}`, { extra: { mode, isProduction } });
    }

    try {
      const stripe = await getStripeClient();
      const products = await stripe.products.list({ limit: 1, active: true });
      if (products.data.length === 0 && isProduction) {
        logger.warn('[STARTUP WARNING] ⚠️ Stripe live account has ZERO products. Run "Sync to Stripe" from the admin panel to push your tier and product data.');
      }
    } catch (productErr: unknown) {
      logger.warn('[Startup] Could not check Stripe products', { extra: { error: getErrorMessage(productErr) } });
    }
  } catch (err: unknown) {
    logger.warn('[Startup] Could not check Stripe environment', { extra: { error: getErrorMessage(err) } });
  }
}

export async function verifyResendConnector(startupHealth: StartupHealth): Promise<void> {
  try {
    const { getResendClient } = await import('../utils/resend');
    await getResendClient();
    logger.info('[Startup] Resend connector verified');
  } catch (err: unknown) {
    logger.warn('[Startup] Resend connector health check failed — email delivery may be unavailable', { extra: { error: getErrorMessage(err) } });
    startupHealth.warnings.push(`Resend connector: ${getErrorMessage(err)}`);
  }
}

export async function initSupabaseRealtime(startupHealth: StartupHealth): Promise<void> {
  try {
    const { enableRealtimeWithRetry } = await import('../core/supabase/client');
    logger.info('[Supabase] Enabling realtime for tables...');
    const { successCount, total } = await enableRealtimeWithRetry();
    if (successCount === total) {
      startupHealth.realtime = 'ok';
    } else if (successCount > 0) {
      startupHealth.realtime = 'ok';
      startupHealth.warnings.push(`Supabase realtime: only ${successCount}/${total} tables enabled`);
    } else {
      startupHealth.realtime = 'failed';
      startupHealth.warnings.push('Supabase realtime: no tables enabled - recovery scheduled');
    }
  } catch (err: unknown) {
    logger.error('[Supabase] Realtime setup failed', { extra: { error: getErrorMessage(err) } });
    startupHealth.realtime = 'failed';
    startupHealth.warnings.push(`Supabase realtime: ${getErrorMessage(err)}`);
  }
}
