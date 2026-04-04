import { db } from '../db';
import { sql } from 'drizzle-orm';
import {
  ensureDatabaseConstraints,
  seedDefaultNoticeTypes,
  createStripeTransactionCache,
  createSyncExclusionsTable,
  setupEmailNormalization,
  normalizeExistingEmails,
  seedTierFeatures,
  fixFunctionSearchPaths,
  validateTierHierarchy,
  setupInstantDataTriggers,
  clearStaleVisitorTypes,
  deleteOrphanHubSpotVisitors,
  ensureConsentEventsTable,
  ensureWaiverAuditTables,
  backfillWaiverSignatures,
} from '../db-init';
import { seedTrainingSections } from '../routes/training';
import { initMemberSyncSettings } from '../core/memberSync';
import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { retryWithBackoff } from './startupUtils';
import type { StartupHealth } from './startupTypes';

export async function initDatabaseConstraints(startupHealth: StartupHealth): Promise<void> {
  try {
    await ensureDatabaseConstraints();
    logger.info('[Startup] Database constraints initialized successfully');
    startupHealth.database = 'ok';
  } catch (err: unknown) {
    logger.error('[Startup] Database constraints failed', { extra: { error: getErrorMessage(err) } });
    startupHealth.database = 'failed';
    startupHealth.criticalFailures.push(`Database constraints: ${getErrorMessage(err)}`);
  }
}

export function buildParallelDbTasks(startupHealth: StartupHealth): Array<() => Promise<void>> {
  return [
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
        await ensureWaiverAuditTables();
        await backfillWaiverSignatures();
      } catch (err: unknown) {
        logger.warn(`[Startup] Waiver audit tables setup failed (non-critical): ${getErrorMessage(err)}`);
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
        await ensureConsentEventsTable();
        const { backfillConsentBaseline } = await import('../core/consentService');
        await backfillConsentBaseline();
      } catch (err: unknown) {
        logger.warn(`[Startup] Consent events table/backfill failed (non-critical): ${getErrorMessage(err)}`);
      }
    },
    async () => {
      try {
        const { refreshClubAddress } = await import('../emails/emailLayout');
        await refreshClubAddress();
        logger.info('[Startup] Club address loaded from system settings for email footers');
      } catch (err: unknown) {
        logger.warn(`[Startup] Club address refresh failed (using defaults): ${getErrorMessage(err)}`);
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
          CREATE TABLE IF NOT EXISTS "merch_items" (
            "id" serial PRIMARY KEY NOT NULL,
            "name" varchar NOT NULL,
            "price" numeric DEFAULT '0' NOT NULL,
            "description" text,
            "type" varchar DEFAULT 'Apparel' NOT NULL,
            "icon" varchar,
            "image_url" text,
            "is_active" boolean DEFAULT true,
            "sort_order" integer DEFAULT 0,
            "stock_quantity" integer,
            "stripe_product_id" varchar,
            "stripe_price_id" varchar,
            "created_at" timestamp DEFAULT now()
          )
        `);
        logger.info('[DB Init] merch_items table verified/created');
      } catch (err: unknown) {
        logger.error('[Startup] Failed to ensure merch_items table', { extra: { error: getErrorMessage(err) } });
        startupHealth.warnings.push(`merch_items table: ${getErrorMessage(err)}`);
      }
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
}

export async function verifyFeeProducts(startupHealth: StartupHealth): Promise<void> {
  try {
    const FEE_SLUGS_REQUIRED = ['guest-pass', 'simulator-overage-30min', 'day-pass-coworking', 'day-pass-golf-sim', 'corporate-volume-pricing'];
    const slugParams = FEE_SLUGS_REQUIRED.map(s => sql`${s}`);
    const feeCheck = await db.execute(sql`SELECT slug FROM fee_products WHERE slug IN (${sql.join(slugParams, sql`, `)})`);
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
}

export async function verifyIntegrityConstraintsStartup(startupHealth: StartupHealth): Promise<void> {
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
}
