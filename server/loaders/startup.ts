import { ensureDatabaseConstraints, seedDefaultNoticeTypes, createStripeTransactionCache, createSyncExclusionsTable, setupEmailNormalization, normalizeExistingEmails, seedTierFeatures, fixFunctionSearchPaths, validateTierHierarchy, setupInstantDataTriggers, clearStaleVisitorTypes, deleteOrphanHubSpotVisitors } from '../db-init';
import { seedTrainingSections } from '../routes/training';
import { getStripeSync } from '../core/stripe';
import { getStripeEnvironmentInfo, getStripeClient } from '../core/stripe/client';
import { runMigrations } from 'stripe-replit-sync';
import type Stripe from 'stripe';
import { enableRealtimeWithRetry } from '../core/supabase/client';
import { initMemberSyncSettings } from '../core/memberSync';
import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { stripSslMode } from '../core/db';

async function retryWithBackoff<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      logger.info(`[Startup] ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay/1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('unreachable');
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<PromiseSettledResult<void>[]> {
  if (tasks.length === 0) return [];
  const effectiveLimit = Math.max(1, limit);
  const results: PromiseSettledResult<void>[] = [];
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        await tasks[currentIndex]();
        results[currentIndex] = { status: 'fulfilled', value: undefined };
      } catch (err) {
        results[currentIndex] = { status: 'rejected', reason: err };
      }
    }
  }

  const workers = Array.from({ length: Math.min(effectiveLimit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

interface StartupHealth {
  database: 'ok' | 'failed' | 'pending';
  stripe: 'ok' | 'failed' | 'pending';
  realtime: 'ok' | 'failed' | 'pending';
  criticalFailures: string[];
  warnings: string[];
  startedAt: string;
  completedAt?: string;
}

const startupHealth: StartupHealth = {
  database: 'pending',
  stripe: 'pending',
  realtime: 'pending',
  criticalFailures: [],
  warnings: [],
  startedAt: new Date().toISOString()
};

export function getStartupHealth(): StartupHealth {
  return { ...startupHealth };
}

async function waitForDatabaseReady(maxAttempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.execute(sql`SELECT 1`);
      if (attempt > 1) {
        logger.info(`[Startup] Database connection ready (after ${attempt} attempts)`);
      }
      return;
    } catch (err: unknown) {
      if (attempt === maxAttempts) {
        logger.error(`[Startup] Database not ready after ${maxAttempts} attempts — startup tasks may fail`, { extra: { error: getErrorMessage(err) } });
        throw err;
      }
      const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), 10000);
      logger.warn(`[Startup] Database not ready (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(delay / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export async function runStartupTasks(): Promise<void> {
  logger.info('[Startup] Running deferred database initialization...');

  startupHealth.database = 'pending';
  startupHealth.stripe = 'pending';
  startupHealth.realtime = 'pending';
  startupHealth.criticalFailures = [];
  startupHealth.warnings = [];
  startupHealth.startedAt = new Date().toISOString();
  delete startupHealth.completedAt;

  try {
    await waitForDatabaseReady();
  } catch {
    startupHealth.database = 'failed';
    startupHealth.criticalFailures.push('Database connection could not be established');
    startupHealth.completedAt = new Date().toISOString();
    return;
  }
  
  try {
    await ensureDatabaseConstraints();
    logger.info('[Startup] Database constraints initialized successfully');
    startupHealth.database = 'ok';
  } catch (err: unknown) {
    logger.error('[Startup] Database constraints failed', { extra: { error: getErrorMessage(err) } });
    startupHealth.database = 'failed';
    startupHealth.criticalFailures.push(`Database constraints: ${getErrorMessage(err)}`);
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    logger.error('[Startup] GOOGLE_CLIENT_ID is not set — Google sign-in and account linking will be unavailable');
    startupHealth.warnings.push('GOOGLE_CLIENT_ID is not configured — Google auth disabled');
  } else {
    logger.info('[Startup] Google auth configured (GOOGLE_CLIENT_ID present)');
  }

  const parallelDbTasks: Array<() => Promise<void>> = [
    async () => {
      try {
        await setupEmailNormalization();
        const { updated } = await normalizeExistingEmails();
        if (updated > 0) {
          logger.info(`[Startup] Normalized ${updated} existing email records`, { extra: { updated } });
        }
      } catch (err: unknown) {
        logger.error('[Startup] Email normalization failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Email normalization: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await setupInstantDataTriggers();
      } catch (err: unknown) {
        logger.error('[Startup] Instant data triggers failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Instant data triggers: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await clearStaleVisitorTypes();
        await deleteOrphanHubSpotVisitors();
      } catch (err: unknown) {
        logger.warn(`[Startup] Visitor cleanup failed (non-critical): ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await fixFunctionSearchPaths();
      } catch (err: unknown) {
        logger.warn(`[Startup] Function search_path fix failed (non-critical): ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await createSyncExclusionsTable();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          logger.warn('[Startup] Sync exclusions table already exists (non-critical)');
        } else {
          logger.error('[Startup] Creating sync exclusions table failed', { extra: { error: getErrorMessage(err) } });
          startupHealth.warnings.push(`Sync exclusions table: ${msg}`);
        }
      }

      try {
        await seedDefaultNoticeTypes();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          logger.warn('[Startup] Notice types already seeded (non-critical)');
        } else {
          logger.error('[Startup] Seeding notice types failed', { extra: { error: getErrorMessage(err) } });
          startupHealth.warnings.push(`Notice types: ${msg}`);
        }
      }

      try {
        await seedTierFeatures();
      } catch (err: unknown) {
        const msg = getErrorMessage(err);
        if (msg.includes('already exists') || msg.includes('duplicate')) {
          logger.warn('[Startup] Tier features already seeded (non-critical)');
        } else {
          logger.error('[Startup] Seeding tier features failed', { extra: { error: getErrorMessage(err) } });
          startupHealth.warnings.push(`Tier features: ${msg}`);
        }
      }

      try {
        await validateTierHierarchy();
      } catch (err: unknown) {
        logger.error('[Startup] Tier hierarchy validation failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Tier validation: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await initMemberSyncSettings();
      } catch (err: unknown) {
        logger.error('[Startup] Member sync settings init failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Member sync settings: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await retryWithBackoff(() => seedTrainingSections(), 'Training sections');
        logger.info('[Startup] Training sections synced');
      } catch (err: unknown) {
        logger.error('[Startup] Seeding training sections failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Training sections: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        await db.execute(sql`
          INSERT INTO system_settings (key, value, category, updated_at, updated_by)
          VALUES ('current_waiver_version', '2.0', 'waivers', NOW(), 'system')
          ON CONFLICT (key) DO UPDATE SET value = '2.0', updated_at = NOW()
          WHERE CAST(system_settings.value AS numeric) < 2.0
        `);
        logger.info('[Startup] Membership agreement version ensured at 2.0');
      } catch (err: unknown) {
        logger.warn('[Startup] Membership agreement version upsert failed (non-critical)', { extra: { error: getErrorMessage(err) } });
      }
    },
    async () => {
      try {
        await db.execute(sql`
          INSERT INTO system_settings (key, value, category, updated_at, updated_by)
          VALUES ('scheduling.onboarding_nudge_hour', '10', 'scheduling', NOW(), 'system')
          ON CONFLICT (key) DO NOTHING
        `);
        await db.execute(sql`
          INSERT INTO system_settings (key, value, category, updated_at, updated_by)
          VALUES ('scheduling.max_onboarding_nudges', '3', 'scheduling', NOW(), 'system')
          ON CONFLICT (key) DO NOTHING
        `);
        logger.info('[Startup] Onboarding nudge settings seeded');
      } catch (err: unknown) {
        logger.warn('[Startup] Onboarding nudge settings seed failed (non-critical)', { extra: { error: getErrorMessage(err) } });
      }
    },
    async () => {
      try {
        await createStripeTransactionCache();
      } catch (err: unknown) {
        logger.error('[Startup] Creating stripe transaction cache failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Stripe transaction cache: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        const result = await retryWithBackoff(async () => {
          return db.execute(sql`
            UPDATE users SET tier = NULL, tier_id = NULL, updated_at = NOW()
            WHERE role = 'visitor' AND membership_status = 'visitor' AND (tier IS NOT NULL OR tier_id IS NOT NULL)
            RETURNING id
          `);
        }, 'Visitor tier cleanup');
        const count = Array.isArray(result) ? result.length : (result?.rows?.length ?? 0);
        if (count > 0) {
          logger.info(`[Startup] Cleaned up tier data for ${count} visitor records`);
        }
      } catch (err: unknown) {
        logger.error('[Startup] Visitor tier cleanup failed', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`Visitor tier cleanup: ${getErrorMessage(err)}`);
      }
    },
    async () => {
      await retryWithBackoff(async () => {
        const result = await db.execute(sql`
          UPDATE users SET archived_at = NULL, archived_by = NULL, updated_at = NOW()
          WHERE archived_by = 'system-cleanup'
            AND archived_at IS NOT NULL
            AND (
              role IN ('admin', 'staff', 'golf_instructor')
              OR EXISTS (SELECT 1 FROM staff_users su WHERE LOWER(su.email) = LOWER(users.email) AND su.is_active = true)
            )
          RETURNING email, role
        `);
        if (result.rows.length > 0) {
          logger.info('[Startup] Restored incorrectly archived staff accounts', { extra: { restored: result.rows.map((r: Record<string, unknown>) => r.email) } });
        }
      }, 'Archived staff check').catch((err: unknown) => {
        logger.warn('[Startup] Archived staff check failed after retries (non-critical):', { extra: { error: getErrorMessage(err) } });
      });
    },
    async () => {
      await retryWithBackoff(async () => {
        const cleanupResult = await db.execute(sql`
          UPDATE users SET stripe_customer_id = NULL, stripe_subscription_id = NULL, updated_at = NOW()
          WHERE email LIKE '%.merged.%' AND (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL)
          RETURNING email, stripe_customer_id
        `);
        if (cleanupResult.rows.length > 0) {
          logger.info('[Startup] Cleared Stripe IDs from merged/archived users', { extra: { count: cleanupResult.rows.length, users: cleanupResult.rows.map((r: Record<string, unknown>) => r.email) } });
        }
      }, 'Merged user Stripe ID cleanup').catch((err: unknown) => {
        logger.warn('[Startup] Merged user Stripe ID cleanup failed after retries (non-critical):', { extra: { error: getErrorMessage(err) } });
      });
    },
    async () => {
      try {
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS fee_products (
            id SERIAL PRIMARY KEY,
            name VARCHAR NOT NULL UNIQUE,
            slug VARCHAR NOT NULL UNIQUE,
            description TEXT,
            price_cents INTEGER,
            price_string VARCHAR NOT NULL,
            button_text VARCHAR DEFAULT 'Purchase',
            stripe_product_id VARCHAR,
            stripe_price_id VARCHAR,
            product_type VARCHAR DEFAULT 'one_time',
            fee_type VARCHAR,
            is_active BOOLEAN DEFAULT true,
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);

        const migrated = await db.execute(sql`
          INSERT INTO fee_products (name, slug, description, price_cents, price_string, button_text,
            stripe_product_id, stripe_price_id, product_type,
            fee_type, is_active, sort_order, created_at, updated_at)
          SELECT name, slug, description, price_cents, price_string,
            COALESCE(button_text, 'Purchase'),
            stripe_product_id, stripe_price_id, product_type,
            CASE
              WHEN slug = 'guest-pass' THEN 'guest_pass'
              WHEN slug = 'simulator-overage-30min' THEN 'simulator_overage'
              WHEN slug = 'day-pass-coworking' THEN 'day_pass_coworking'
              WHEN slug = 'day-pass-golf-sim' THEN 'day_pass_golf_sim'
              WHEN slug = 'corporate-volume-pricing' THEN 'corporate_config'
              ELSE 'general'
            END,
            is_active, sort_order, created_at, updated_at
          FROM membership_tiers
          WHERE product_type IN ('one_time', 'fee', 'config')
          ON CONFLICT (slug) DO UPDATE SET
            stripe_product_id = COALESCE(EXCLUDED.stripe_product_id, fee_products.stripe_product_id),
            stripe_price_id = COALESCE(EXCLUDED.stripe_price_id, fee_products.stripe_price_id),
            price_cents = COALESCE(EXCLUDED.price_cents, fee_products.price_cents),
            price_string = COALESCE(EXCLUDED.price_string, fee_products.price_string),
            updated_at = NOW()
          RETURNING slug
        `);
        const migratedSlugs = Array.isArray(migrated) ? migrated : (migrated?.rows ?? []);
        if (migratedSlugs.length > 0) {
          logger.info(`[Startup] Migrated fee products to fee_products table: ${migratedSlugs.map((r: Record<string, unknown>) => r.slug).join(', ')}`);

          await db.execute(sql`
            UPDATE membership_tiers
            SET is_active = false,
                stripe_product_id = NULL,
                stripe_price_id = NULL,
                updated_at = NOW()
            WHERE product_type IN ('one_time', 'fee', 'config')
              AND is_active = true
          `);
          logger.info('[Startup] Deactivated migrated fee rows and cleared Stripe IDs in membership_tiers');
        }
      } catch (err: unknown) {
        logger.error(`[Startup] Fee products migration failed: ${getErrorMessage(err)}`);
        startupHealth.criticalFailures.push('Fee products table migration failed');
      }
    },
  ];

  await runWithConcurrency(parallelDbTasks, 5);
  logger.info('[Startup] Parallel DB initialization tasks complete');

  try {
    const FEE_SLUGS_REQUIRED = ['guest-pass', 'simulator-overage-30min', 'day-pass-coworking', 'day-pass-golf-sim', 'corporate-volume-pricing'];
    const feeCheck = await db.execute(sql`SELECT slug FROM fee_products WHERE slug = ANY(${sql.raw(`ARRAY[${FEE_SLUGS_REQUIRED.map(s => `'${s}'`).join(',')}]`)}::varchar[])`);
    const foundSlugs = new Set((Array.isArray(feeCheck) ? feeCheck : (feeCheck?.rows ?? [])).map((r: Record<string, unknown>) => r.slug));
    const missingSlugs = FEE_SLUGS_REQUIRED.filter(s => !foundSlugs.has(s));
    if (missingSlugs.length > 0) {
      logger.error(`[Startup] Missing required fee products: ${missingSlugs.join(', ')}`);
      startupHealth.warnings.push(`Missing fee products: ${missingSlugs.join(', ')}`);
    } else {
      logger.info('[Startup] All required fee products verified');
    }
  } catch (err: unknown) {
    logger.warn(`[Startup] Fee products verification skipped: ${getErrorMessage(err)}`);
  }

  try {
    const { verifyIntegrityConstraints } = await import('../db-init');
    const verification = await verifyIntegrityConstraints();
    if (!verification.verified) {
      logger.error('[Startup] Integrity constraint verification failed — some eliminated checks lack DB backing', { extra: { missing: verification.missing } });
      startupHealth.criticalFailures.push(`Missing integrity constraints: ${verification.missing.join(', ')}`);
    }
  } catch (err: unknown) {
    logger.warn(`[Startup] Integrity constraint verification skipped: ${getErrorMessage(err)}`);
  }

  let origStdoutWrite: typeof process.stdout.write | undefined;
  let origStderrWrite: typeof process.stderr.write | undefined;
  try {
    const databaseUrl = stripSslMode(process.env.DATABASE_POOLER_URL) || process.env.DATABASE_URL;
    if (databaseUrl) {
      logger.info('[Stripe] Initializing Stripe schema...');
      const migrationUrl = new URL(databaseUrl);
      migrationUrl.searchParams.set('options', '-c statement_timeout=30000');
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
        const webhookUrl = `https://${replitDomains}/api/stripe/webhook`;
        logger.info('[Stripe] Setting up managed webhook...');
        const result = await retryWithBackoff(() => (stripeSync as unknown as { findOrCreateManagedWebhook: (url: string) => Promise<unknown> }).findOrCreateManagedWebhook(webhookUrl), 'Stripe webhook setup');
        logger.info('[Stripe] Webhook configured');

        const requiredEvents = [
          'customer.created',
          'customer.updated',
          'customer.subscription.created',
          'customer.subscription.updated',
          'customer.subscription.deleted',
          'customer.subscription.paused',
          'customer.subscription.resumed',
          'payment_intent.created',
          'payment_intent.succeeded',
          'payment_intent.payment_failed',
          'payment_intent.canceled',
          'payment_intent.processing',
          'payment_intent.requires_action',
          'invoice.payment_succeeded',
          'invoice.payment_failed',
          'invoice.created',
          'invoice.finalized',
          'invoice.updated',
          'invoice.voided',
          'invoice.marked_uncollectible',
          'checkout.session.completed',
          'charge.refunded',
          'charge.dispute.created',
          'charge.dispute.closed',
          'product.created',
          'product.updated',
          'product.deleted',
          'price.created',
          'price.updated',
          'coupon.created',
          'coupon.updated',
          'coupon.deleted',
          'credit_note.created',
          'customer.subscription.trial_will_end',
          'customer.deleted',
          'payment_method.attached',
          'payment_method.detached',
          'payment_method.updated',
          'payment_method.automatically_updated',
          'charge.dispute.updated',
          'checkout.session.expired',
          'checkout.session.async_payment_failed',
          'checkout.session.async_payment_succeeded',
          'invoice.payment_action_required',
          'invoice.overdue',
          'setup_intent.succeeded',
          'setup_intent.setup_failed',
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
      
      const products = await import('../core/stripe/products.js');

      const productInits: Array<{ name: string; fn: () => Promise<{ action: string }> }> = [
        { name: 'Simulator Overage', fn: () => products.ensureSimulatorOverageProduct() },
        { name: 'Guest Pass', fn: () => products.ensureGuestPassProduct() },
        { name: 'Day Pass Coworking', fn: () => products.ensureDayPassCoworkingProduct() },
        { name: 'Day Pass Golf Sim', fn: () => products.ensureDayPassGolfSimProduct() },
        { name: 'Corporate Volume Pricing', fn: () => products.ensureCorporateVolumePricingProduct() },
      ];

      const productResults = await Promise.allSettled(
        productInits.map(({ name, fn }) =>
          retryWithBackoff(async () => {
            const result = await fn();
            if (result.action === 'error') throw new Error(`${name} product initialization failed (${result.action})`);
            return { name, action: result.action };
          }, `${name} product`)
        )
      );
      for (let i = 0; i < productResults.length; i++) {
        const result = productResults[i];
        const { name } = productInits[i];
        if (result.status === 'fulfilled') {
          logger.info(`[Stripe] ${name} product ${result.value.action}`, { extra: { action: result.value.action } });
        } else {
          logger.error(`[Stripe] ${name} setup failed`, { extra: { error: getErrorMessage(result.reason) } });
          startupHealth.warnings.push(`Stripe product init: ${name} - ${getErrorMessage(result.reason)}`);
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
  } catch (err: unknown) {
    try { if (origStdoutWrite) process.stdout.write = origStdoutWrite; if (origStderrWrite) process.stderr.write = origStderrWrite; } catch { /* restore best-effort */ }
    logger.error('[Stripe] Initialization failed', { extra: { error: getErrorMessage(err) } });
    startupHealth.stripe = 'failed';
    startupHealth.criticalFailures.push(`Stripe initialization: ${getErrorMessage(err)}`);
  }

  try {
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

  await Promise.allSettled([
    (async () => {
      const backfillResult = await db.execute(sql`
        UPDATE users u
        SET first_login_at = sub.first_booking,
            updated_at = NOW()
        FROM (
          SELECT br.user_id, MIN(br.created_at) as first_booking
          FROM booking_requests br
          WHERE br.user_id IS NOT NULL
            AND br.origin IS NULL
          GROUP BY br.user_id
        ) sub
        WHERE u.id = sub.user_id
          AND u.first_login_at IS NULL
      `);
      const count = (backfillResult as { rowCount?: number })?.rowCount || 0;
      if (count > 0) {
        logger.info(`[Startup] Backfilled first_login_at for ${count} members from self-requested booking history`);
      }
    })().catch((err: unknown) => logger.warn('[Startup] first_login_at backfill failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const tierBackfill = await db.execute(sql`
        UPDATE users
        SET last_tier = tier, updated_at = NOW()
        WHERE membership_status IN ('cancelled', 'expired', 'paused', 'inactive', 'terminated', 'suspended', 'frozen', 'declined', 'churned', 'former_member')
          AND tier IS NOT NULL AND tier != ''
          AND (last_tier IS NULL OR last_tier = '')
      `);
      const count = (tierBackfill as { rowCount?: number })?.rowCount || 0;
      if (count > 0) {
        logger.info(`[Startup] Backfilled last_tier for ${count} former members`);
      }
    })().catch((err: unknown) => logger.warn('[Startup] last_tier backfill failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const passReconcile = await db.execute(sql`
        UPDATE guest_passes gp
        SET passes_used = COALESCE(actual.used_count, 0),
            passes_total = GREATEST(gp.passes_total, COALESCE(actual.used_count, 0))
        FROM (
          SELECT LOWER(gp2.member_email) as email, COUNT(bp.id) as used_count
          FROM guest_passes gp2
          LEFT JOIN booking_requests br ON LOWER(br.user_email) = LOWER(gp2.member_email)
            AND br.status NOT IN ('cancelled', 'rejected', 'deleted')
          LEFT JOIN booking_sessions bs ON br.session_id = bs.id
          LEFT JOIN booking_participants bp ON bp.session_id = bs.id
            AND bp.participant_type = 'guest'
            AND bp.used_guest_pass = true
          GROUP BY LOWER(gp2.member_email)
        ) actual
        WHERE LOWER(gp.member_email) = actual.email
          AND gp.passes_used != COALESCE(actual.used_count, 0)
      `);
      const reconciled = (passReconcile as { rowCount?: number })?.rowCount || 0;
      if (reconciled > 0) {
        logger.info(`[Startup] Reconciled guest pass counters for ${reconciled} members`);
      }
    })().catch((err: unknown) => logger.warn('[Startup] Guest pass reconciliation failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const orphanedDeductions = await db.execute(sql`
        SELECT stripe_payment_intent_id, stripe_customer_id, amount_cents, user_id, status
        FROM stripe_payment_intents
        WHERE status IN ('balance_pending', 'balance_deducted')
          AND created_at < NOW() - INTERVAL '5 minutes'
      `);
      const orphanRows = orphanedDeductions.rows as unknown as { stripe_payment_intent_id: string; stripe_customer_id: string; amount_cents: number; user_id: string; status: string }[];
      if (orphanRows.length > 0) {
        const { getStripeClient } = await import('../core/stripe/client.js');
        const stripe = await getStripeClient();
        for (const row of orphanRows) {
          if (row.status === 'balance_deducted') {
            try {
              await stripe.customers.createBalanceTransaction(row.stripe_customer_id, {
                amount: -row.amount_cents,
                currency: 'usd',
                description: 'Startup recovery: rollback orphaned balance deduction',
              });
              logger.info(`[Startup] Rolled back orphaned balance deduction: $${(row.amount_cents / 100).toFixed(2)} for customer ${row.stripe_customer_id}`);
            } catch (rollbackErr: unknown) {
              logger.error(`[Startup] Failed to roll back orphaned balance deduction for ${row.stripe_customer_id}`, { extra: { error: getErrorMessage(rollbackErr) } });
            }
          }
          await db.execute(sql`DELETE FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${row.stripe_payment_intent_id}`);
        }
        logger.info(`[Startup] Cleaned up ${orphanRows.length} orphaned balance deduction record(s)`);
      }
    })().catch((err: unknown) => logger.warn('[Startup] Orphaned balance deduction cleanup failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const mismatchedSessions = await db.execute(sql`
        SELECT active_br.session_id,
               active_br.user_id AS correct_user_id,
               active_br.user_name AS correct_user_name,
               active_br.user_email AS correct_user_email,
               active_br.request_participants,
               active_br.start_time,
               active_br.end_time
        FROM booking_requests active_br
        JOIN booking_participants bp
          ON bp.session_id = active_br.session_id
          AND bp.participant_type = 'owner'
        WHERE active_br.status NOT IN ('cancelled', 'deleted', 'declined')
          AND bp.user_id IS DISTINCT FROM active_br.user_id
          AND active_br.user_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM booking_requests cancelled_br
            WHERE cancelled_br.session_id = active_br.session_id
              AND cancelled_br.status IN ('cancelled', 'deleted', 'declined')
              AND cancelled_br.id != active_br.id
          )
          AND NOT EXISTS (
            SELECT 1 FROM booking_requests other_active
            WHERE other_active.session_id = active_br.session_id
              AND other_active.status NOT IN ('cancelled', 'deleted', 'declined')
              AND other_active.id != active_br.id
          )
      `);

      const rows = mismatchedSessions.rows as Array<{
        session_id: number;
        correct_user_id: string;
        correct_user_name: string;
        correct_user_email: string;
        request_participants: Array<{ email?: string; type?: string; name?: string; userId?: string }> | null;
        start_time: string;
        end_time: string;
      }>;

      if (rows.length > 0) {
        let fixedCount = 0;
        for (const row of rows) {
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`DELETE FROM booking_participants WHERE session_id = ${row.session_id}`);

              let slotDuration = 60;
              try {
                const [sH, sM] = row.start_time.split(':').map(Number);
                const [eH, eM] = row.end_time.split(':').map(Number);
                slotDuration = (eH * 60 + eM) - (sH * 60 + sM);
                if (slotDuration <= 0) slotDuration = 60;
              } catch (_) { /* slot duration calculation: non-critical, fallback to 60 min */ }

              await tx.execute(sql`
                INSERT INTO booking_participants (session_id, user_id, participant_type, display_name, slot_duration, payment_status, invited_at)
                VALUES (${row.session_id}, ${row.correct_user_id}, 'owner', ${row.correct_user_name || row.correct_user_email}, ${slotDuration}, 'pending', NOW())
              `);

              const requestParticipants = row.request_participants;
              if (requestParticipants && Array.isArray(requestParticipants)) {
                const ownerEmail = row.correct_user_email?.toLowerCase();
                for (const rp of requestParticipants) {
                  if (!rp || typeof rp !== 'object') continue;
                  const rpEmail = rp.email?.toLowerCase()?.trim() || '';
                  if (rpEmail && rpEmail === ownerEmail) continue;
                  if (rp.userId && rp.userId === row.correct_user_id) continue;

                  let resolvedUserId: string | null = rp.userId || null;
                  let resolvedName = rp.name || rpEmail || 'Participant';
                  let participantType = rp.type === 'member' ? 'member' : 'guest';

                  if (!resolvedUserId && rpEmail) {
                    const userLookup = await tx.execute(sql`
                      SELECT id, first_name, last_name FROM users WHERE LOWER(email) = ${rpEmail} LIMIT 1
                    `);
                    const found = (userLookup.rows as Array<{ id: string; first_name?: string; last_name?: string }>)[0];
                    if (found) {
                      resolvedUserId = found.id;
                      participantType = 'member';
                      const fullName = [found.first_name, found.last_name].filter(Boolean).join(' ');
                      if (fullName) resolvedName = fullName;
                    }
                  }

                  if (participantType !== 'guest' && !resolvedUserId) {
                    logger.warn('[Startup] Cannot rebuild owner/member participant without user_id, downgrading to guest', {
                      extra: { sessionId: row.session_id, email: rpEmail, originalType: participantType }
                    });
                    participantType = 'guest';
                  }

                  await tx.execute(sql`
                    INSERT INTO booking_participants (session_id, user_id, participant_type, display_name, slot_duration, payment_status, invited_at)
                    VALUES (${row.session_id}, ${resolvedUserId}, ${participantType}, ${resolvedName}, ${slotDuration}, 'pending', NOW())
                  `);
                }
              }
            });
            fixedCount++;
            logger.info(`[Startup] Rebuilt participants for session ${row.session_id} (owner: ${row.correct_user_name})`);
          } catch (sessionErr: unknown) {
            logger.warn(`[Startup] Failed to rebuild participants for session ${row.session_id} (non-critical)`, { extra: { error: getErrorMessage(sessionErr) } });
          }
        }
        if (fixedCount > 0) {
          logger.info(`[Startup] Fixed ${fixedCount} session(s) with mismatched owners from cancelled booking reuse`);
        }
      }
    })().catch((err: unknown) => logger.warn('[Startup] Session owner mismatch fix failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const { cleanupLessonClosures } = await import('../core/databaseCleanup');
      const deactivated = await cleanupLessonClosures();
      if (deactivated > 0) {
        logger.info(`[Startup] Deactivated ${deactivated} past lesson closures`);
      }
    })().catch((err: unknown) => logger.warn('[Startup] Lesson closures cleanup failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const deadItems = await db.execute(sql`
        SELECT id, payload FROM hubspot_sync_queue
        WHERE status = 'dead' AND operation = 'sync_tier'
          AND last_error LIKE '%was not one of the allowed options%'
      `);
      const rows = (deadItems as unknown as { rows: Array<{ id: number; payload: string }> }).rows;
      if (rows.length > 0) {
        const { enqueueHubSpotSync } = await import('../core/hubspot/queue');
        for (const row of rows) {
          try {
            const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
            if (!payload?.email || typeof payload.email !== 'string') {
              logger.warn(`[Startup] Dead HubSpot job #${row.id} has no valid email in payload, skipping`);
              continue;
            }
            const emailKey = (payload.email as string).toLowerCase();
            const newJobId = await enqueueHubSpotSync('sync_tier', payload, {
              priority: 2,
              idempotencyKey: `requeue_dead_tier_sync_${emailKey}_${row.id}`,
              maxRetries: 5
            });
            if (newJobId !== null) {
              await db.execute(sql`UPDATE hubspot_sync_queue SET status = 'superseded', completed_at = NOW() WHERE id = ${row.id}`);
              logger.info(`[Startup] Re-queued dead HubSpot sync_tier job #${row.id} as #${newJobId} for ${emailKey}`);
            } else {
              logger.info(`[Startup] Dead HubSpot sync_tier job #${row.id} already re-queued, marking superseded`);
              await db.execute(sql`UPDATE hubspot_sync_queue SET status = 'superseded', completed_at = NOW() WHERE id = ${row.id}`);
            }
          } catch (rowErr: unknown) {
            logger.warn(`[Startup] Failed to re-queue dead HubSpot job #${row.id}, leaving as dead for manual review`, { extra: { error: getErrorMessage(rowErr) } });
          }
        }
      }
    })().catch((err: unknown) => logger.warn('[Startup] HubSpot dead queue re-queue failed (non-critical)', { extra: { error: getErrorMessage(err) } })),

    (async () => {
      const linkedResult = await db.execute(sql`
        UPDATE booking_requests br
        SET 
          user_email = u.email,
          user_id = u.id,
          updated_at = NOW()
        FROM user_linked_emails ule
        JOIN users u ON LOWER(u.email) = LOWER(ule.primary_email) AND u.archived_at IS NULL
        WHERE LOWER(br.user_email) = LOWER(ule.linked_email)
          AND LOWER(br.user_email) != LOWER(u.email)
        RETURNING br.id, br.user_email AS new_email, ule.linked_email AS old_email
      `);
      const manualResult = await db.execute(sql`
        UPDATE booking_requests br
        SET
          user_email = u.email,
          user_id = u.id,
          updated_at = NOW()
        FROM users u
        WHERE u.archived_at IS NULL
          AND u.manually_linked_emails IS NOT NULL
          AND u.manually_linked_emails @> to_jsonb(LOWER(br.user_email))
          AND LOWER(br.user_email) != LOWER(u.email)
        RETURNING br.id, br.user_email AS new_email
      `);
      const totalFixed = (linkedResult.rows?.length || 0) + (manualResult.rows?.length || 0);
      if (totalFixed > 0) {
        logger.info(`[Startup] Repaired ${totalFixed} bookings stored under linked emails`, { extra: { linkedFixed: linkedResult.rows?.length || 0, manualFixed: manualResult.rows?.length || 0 } });
      }
    })().catch((err: unknown) => logger.warn('[Startup] Linked email booking repair failed (non-critical)', { extra: { error: getErrorMessage(err) } })),
  ]);

  startupHealth.completedAt = new Date().toISOString();
  
  if (startupHealth.criticalFailures.length > 0) {
    logger.error('[Startup] CRITICAL FAILURES', { extra: { failures: startupHealth.criticalFailures } });
  }
  if (startupHealth.warnings.length > 0) {
    logger.warn('[Startup] Warnings', { extra: { warnings: startupHealth.warnings } });
  }
}
