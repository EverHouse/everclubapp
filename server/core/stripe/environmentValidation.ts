import Stripe from 'stripe';
import { getStripeClient, getStripeEnvironmentInfo } from './client';
import { upsertTransactionCache } from './webhooks';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage, getErrorCode, isStripeResourceMissing } from '../../utils/errorUtils';

import { logger } from '../logger';

async function backfillTransactionCacheInBackground(stripe: Stripe): Promise<void> {
  const daysBack = 180;
  const startDate = Math.floor((Date.now() - (daysBack * 24 * 60 * 60 * 1000)) / 1000);
  let processed = 0;

  logger.info(`[Stripe Env] Auto-backfilling transaction cache (${daysBack} days)...`);

  let hasMore = true;
  let startingAfter: string | undefined;

  while (hasMore) {
    const params: Stripe.PaymentIntentListParams = {
      limit: 100,
      created: { gte: startDate },
      expand: ['data.customer'],
    };
    if (startingAfter) params.starting_after = startingAfter;

    const page = await stripe.paymentIntents.list(params);

    for (const pi of page.data) {
      if (pi.status !== 'succeeded' && pi.status !== 'requires_capture') continue;
      const customer = pi.customer as Stripe.Customer | null;
      await upsertTransactionCache({
        stripeId: pi.id,
        objectType: 'payment_intent',
        amountCents: pi.amount,
        currency: pi.currency || 'usd',
        status: pi.status,
        createdAt: new Date(pi.created * 1000),
        customerId: typeof pi.customer === 'string' ? pi.customer : customer?.id,
        customerEmail: customer?.email || pi.receipt_email || pi.metadata?.email,
        customerName: customer?.name || pi.metadata?.memberName,
        description: pi.description || pi.metadata?.productName || 'Stripe payment',
        metadata: pi.metadata,
        source: 'backfill',
        paymentIntentId: pi.id,
      });
      processed++;
    }

    hasMore = page.has_more;
    if (page.data.length > 0) {
      startingAfter = page.data[page.data.length - 1].id;
    }
    if (hasMore) await new Promise(resolve => setTimeout(resolve, 100));
  }

  logger.info(`[Stripe Env] Auto-backfill complete: ${processed} payment intents cached`);
}

const MASS_WIPE_THRESHOLD = 0.25;

export async function validateStripeEnvironmentIds(): Promise<void> {
  try {
    const stripe = await getStripeClient();
    const { mode, isProduction } = await getStripeEnvironmentInfo();

    logger.info(`[Stripe Env] Validating stored Stripe IDs against ${mode} environment...`);

    let tiersChecked = 0;
    const staleTiers: Array<{ id: unknown; name: unknown; stripe_product_id: unknown; product_type: unknown }> = [];
    let cafeChecked = 0;
    const staleCafeItems: Array<{ id: unknown; name: unknown }> = [];
    let subsChecked = 0;
    const staleSubs: Array<{ id: unknown; email: unknown; stripe_subscription_id: unknown }> = [];
    let tiersCleared = 0;
    let cafeCleared = 0;
    let clearedSubscriptionTierCount = 0;
    let transactionCacheCleared = false;

    // a) Validate membership_tiers Stripe IDs
    const tiersResult = await db.execute(
      sql`SELECT id, name, stripe_product_id, stripe_price_id, product_type FROM membership_tiers WHERE stripe_product_id IS NOT NULL`
    );
    const tiers = tiersResult.rows;
    tiersChecked = tiers.length;

    for (let i = 0; i < tiers.length; i += 5) {
      const batch = tiers.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async (tier: Record<string, unknown>) => {
          try {
            await stripe.products.retrieve(tier.stripe_product_id as string);
          } catch (error: unknown) {
            if (isStripeResourceMissing(error)) {
              staleTiers.push({ id: tier.id, name: tier.name, stripe_product_id: tier.stripe_product_id, product_type: tier.product_type });
            } else {
              throw error;
            }
          }
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn(`[Stripe Env] Error checking tier product:`, { extra: { detail: result.reason?.message || result.reason } });
        }
      }
    }

    if (staleTiers.length > 0 && tiersChecked > 0) {
      const ratio = staleTiers.length / tiersChecked;
      if (ratio > MASS_WIPE_THRESHOLD) {
        const tierLogLevel = isProduction ? 'warn' : 'info';
        logger[tierLogLevel](`[Stripe Env] SAFETY GUARD: ${staleTiers.length}/${tiersChecked} (${Math.round(ratio * 100)}%) tiers have missing Stripe products. Skipping auto-clear to prevent mass data loss. Stale tiers: ${staleTiers.map(t => `"${t.name}" (${t.stripe_product_id})`).join(', ')}`);
      } else {
        for (const tier of staleTiers) {
          await db.execute(
            sql`UPDATE membership_tiers SET stripe_product_id = NULL, stripe_price_id = NULL WHERE id = ${tier.id}`
          );
          logger.info(`[Stripe Env] Cleared stale Stripe IDs for tier "${tier.name}" (product ${tier.stripe_product_id} not found in ${mode} Stripe)`);
          tiersCleared++;
          if (tier.product_type === 'subscription') {
            clearedSubscriptionTierCount++;
          }
        }
      }
    }

    // a2) Validate fee_products Stripe IDs
    const feeResult = await db.execute(
      sql`SELECT id, name, stripe_product_id, stripe_price_id FROM fee_products WHERE stripe_product_id IS NOT NULL`
    );
    const fees = feeResult.rows;
    const staleFees: Array<{ id: unknown; name: unknown; stripe_product_id: unknown }> = [];

    for (let i = 0; i < fees.length; i += 5) {
      const batch = fees.slice(i, i + 5);
      const results = await Promise.allSettled(
        batch.map(async (fee: Record<string, unknown>) => {
          try {
            await stripe.products.retrieve(fee.stripe_product_id as string);
          } catch (error: unknown) {
            if (isStripeResourceMissing(error)) {
              staleFees.push({ id: fee.id, name: fee.name, stripe_product_id: fee.stripe_product_id });
            } else {
              throw error;
            }
          }
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn(`[Stripe Env] Error checking fee product:`, { extra: { detail: result.reason?.message || result.reason } });
        }
      }
    }

    if (staleFees.length > 0) {
      for (const fee of staleFees) {
        await db.execute(
          sql`UPDATE fee_products SET stripe_product_id = NULL, stripe_price_id = NULL WHERE id = ${fee.id}`
        );
        logger.info(`[Stripe Env] Cleared stale Stripe IDs for fee product "${fee.name}" (product ${fee.stripe_product_id} not found in ${mode} Stripe)`);
      }
    }

    // b) Validate cafe_items Stripe IDs
    const cafeResult = await db.execute(
      sql`SELECT id, name, stripe_product_id, stripe_price_id FROM cafe_items WHERE stripe_product_id IS NOT NULL`
    );
    const cafeItems = cafeResult.rows;
    cafeChecked = cafeItems.length;

    for (let i = 0; i < cafeItems.length; i += 10) {
      const batch = cafeItems.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (item: Record<string, unknown>) => {
          try {
            await stripe.products.retrieve(item.stripe_product_id as string);
          } catch (error: unknown) {
            if (isStripeResourceMissing(error)) {
              staleCafeItems.push({ id: item.id, name: item.name });
            } else {
              throw error;
            }
          }
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn(`[Stripe Env] Error checking cafe item product:`, { extra: { detail: result.reason?.message || result.reason } });
        }
      }
    }

    let cafeAutoResynced = false;
    if (staleCafeItems.length > 0 && cafeChecked > 0) {
      const ratio = staleCafeItems.length / cafeChecked;
      if (ratio > MASS_WIPE_THRESHOLD) {
        const isFreshEnvironment = ratio === 1;
        let stripeHasZeroCafeProducts = false;
        if (isFreshEnvironment) {
          try {
            const existingProducts = await stripe.products.list({ limit: 1, active: true });
            const cafeProducts = existingProducts.data.filter(
              p => p.metadata?.app_category === 'cafe'
            );
            stripeHasZeroCafeProducts = cafeProducts.length === 0;
          } catch { /* intentional: Stripe product list check failure — assume products exist */
            stripeHasZeroCafeProducts = false;
          }
        }
        if (isFreshEnvironment && stripeHasZeroCafeProducts) {
          logger.info(`[Stripe Env] Fresh environment detected: all ${cafeChecked} cafe items have no matching Stripe products. Clearing stale IDs and auto-creating products...`);
        } else {
          const logLevel = isProduction ? 'warn' : 'info';
          logger[logLevel](`[Stripe Env] ${staleCafeItems.length}/${cafeChecked} (${Math.round(ratio * 100)}%) cafe items have stale Stripe IDs (likely environment switch). Clearing stale IDs and triggering auto-resync...`);
        }
        for (const item of staleCafeItems) {
          await db.execute(
            sql`UPDATE cafe_items SET stripe_product_id = NULL, stripe_price_id = NULL WHERE id = ${item.id}`
          );
          cafeCleared++;
        }
        try {
          const { syncCafeItemsToStripe } = await import('./productCatalogSync');
          const syncResult = await syncCafeItemsToStripe();
          logger.info(`[Stripe Env] Cafe items auto-resync complete: ${syncResult.synced} synced, ${syncResult.failed} failed, ${syncResult.skipped} skipped`);
          const postResyncResult = await db.execute(
            sql`SELECT COUNT(*) as count FROM cafe_items WHERE is_active = true AND (stripe_product_id IS NULL OR stripe_price_id IS NULL)`
          );
          const postResyncUnlinked = Number((postResyncResult.rows[0] as Record<string, unknown>).count) || 0;
          cafeAutoResynced = syncResult.failed === 0 && postResyncUnlinked === 0;
        } catch (syncErr: unknown) {
          logger.error(`[Stripe Env] Cafe items auto-resync failed — items cleared but not re-created. Use Admin > Products & Pricing > Sync to retry.`, { extra: { error: getErrorMessage(syncErr) } });
        }
      } else {
        for (const item of staleCafeItems) {
          await db.execute(
            sql`UPDATE cafe_items SET stripe_product_id = NULL, stripe_price_id = NULL WHERE id = ${item.id}`
          );
          logger.info(`[Stripe Env] Cleared stale Stripe IDs for cafe item "${item.name}"`);
          cafeCleared++;
        }
      }
    }

    let unlinkedCafeResult = await db.execute(
      sql`SELECT COUNT(*) as count FROM cafe_items WHERE is_active = true AND (stripe_product_id IS NULL OR stripe_price_id IS NULL)`
    );
    let unlinkedCafeCount = Number((unlinkedCafeResult.rows[0] as Record<string, unknown>).count) || 0;

    if (unlinkedCafeCount > 0 && !cafeAutoResynced) {
      const logLevel = isProduction ? 'warn' : 'info';
      logger[logLevel](`[Stripe Env] ${unlinkedCafeCount} active cafe items have missing Stripe product/price IDs. Triggering auto-sync...`);
      try {
        const { syncCafeItemsToStripe } = await import('./productCatalogSync');
        const syncResult = await syncCafeItemsToStripe();
        logger.info(`[Stripe Env] Cafe items auto-sync complete: ${syncResult.synced} synced, ${syncResult.failed} failed, ${syncResult.skipped} skipped`);
        unlinkedCafeResult = await db.execute(
          sql`SELECT COUNT(*) as count FROM cafe_items WHERE is_active = true AND (stripe_product_id IS NULL OR stripe_price_id IS NULL)`
        );
        unlinkedCafeCount = Number((unlinkedCafeResult.rows[0] as Record<string, unknown>).count) || 0;
        cafeAutoResynced = syncResult.failed === 0 && unlinkedCafeCount === 0;
      } catch (syncErr: unknown) {
        logger.error(`[Stripe Env] Cafe items auto-sync failed. Use Admin > Products & Pricing > Sync to retry.`, { extra: { error: getErrorMessage(syncErr) } });
      }
    }

    // c) Validate users stripe_subscription_id — LOG ONLY, NEVER AUTO-DELETE
    const usersResult = await db.execute(
      sql`SELECT id, email, stripe_subscription_id FROM users WHERE stripe_subscription_id IS NOT NULL`
    );
    const usersWithSubs = usersResult.rows;
    subsChecked = usersWithSubs.length;

    for (let i = 0; i < usersWithSubs.length; i += 10) {
      const batch = usersWithSubs.slice(i, i + 10);
      const results = await Promise.allSettled(
        batch.map(async (user: Record<string, unknown>) => {
          try {
            await stripe.subscriptions.retrieve(user.stripe_subscription_id as string);
          } catch (error: unknown) {
            if (isStripeResourceMissing(error)) {
              staleSubs.push({ id: user.id, email: user.email, stripe_subscription_id: user.stripe_subscription_id });
            } else {
              throw error;
            }
          }
        })
      );

      for (const result of results) {
        if (result.status === 'rejected') {
          logger.warn(`[Stripe Env] Error checking user subscription:`, { extra: { detail: result.reason?.message || result.reason } });
        }
      }
    }

    if (staleSubs.length > 0) {
      logger.warn(`[Stripe Env] Found ${staleSubs.length} user(s) with subscription IDs not found in ${mode} Stripe. These will NOT be auto-cleared — use Data Integrity tools to review and fix manually:`);
      for (const sub of staleSubs) {
        logger.warn(`[Stripe Env]   - "${sub.email}" (sub: ${sub.stripe_subscription_id})`);
      }
    }

    // d) Clear stripe_transaction_cache only if tier/cafe IDs were cleared (NOT for user sub issues)
    const totalCleared = tiersCleared + cafeCleared;
    if (totalCleared > 0) {
      try {
        await db.execute(sql`TRUNCATE TABLE stripe_transaction_cache`);
        transactionCacheCleared = true;
        logger.info(`[Stripe Env] Cleared transaction cache (environment change detected)`);
        backfillTransactionCacheInBackground(stripe).catch((err: unknown) => {
          logger.error('[Stripe Env] Background cache backfill failed', { extra: { detail: getErrorMessage(err) } });
        });
      } catch (truncateErr: unknown) {
        logger.warn(`[Stripe Env] Could not clear transaction cache:`, { extra: { detail: getErrorMessage(truncateErr) } });
      }
    }

    // e) Log summary
    logger.info(`[Stripe Env] Environment validation complete (${mode} mode):
  - Tiers: ${tiersChecked} checked, ${staleTiers.length} stale found, ${tiersCleared} cleared${staleTiers.length > tiersCleared ? ` (${staleTiers.length - tiersCleared} blocked by safety guard)` : ''}
  - Cafe items: ${cafeChecked} checked, ${staleCafeItems.length} stale found, ${cafeCleared} cleared${unlinkedCafeCount > 0 ? `, ${unlinkedCafeCount} unlinked` : ''}${cafeAutoResynced ? ' (auto-synced)' : staleCafeItems.length > cafeCleared ? ` (${staleCafeItems.length - cafeCleared} blocked by safety guard)` : ''}
  - User subscriptions: ${subsChecked} checked, ${staleSubs.length} stale found (LOG ONLY — no auto-clear)${transactionCacheCleared ? '\n  - Transaction cache: cleared (backfill started)' : ''}`);

    if (clearedSubscriptionTierCount > 0) {
      const startupLogLevel = isProduction ? 'warn' : 'info';
      logger[startupLogLevel](`[STARTUP${isProduction ? ' WARNING' : ''}] ${isProduction ? '⚠️ ' : ''}${clearedSubscriptionTierCount} subscription tiers lost their Stripe product links due to environment change. Run "Sync to Stripe" from Products & Pricing before member signups will work.`);
    }

    if (cafeCleared > 0 && !cafeAutoResynced) {
      const startupLogLevel = isProduction ? 'warn' : 'info';
      logger[startupLogLevel](`[STARTUP${isProduction ? ' WARNING' : ''}] ${isProduction ? '⚠️ ' : ''}${cafeCleared} cafe items lost their Stripe product links. Run "Sync to Stripe" to restore.`);
    }

    if (unlinkedCafeCount > 0 && !cafeAutoResynced) {
      const startupLogLevel = isProduction ? 'warn' : 'info';
      logger[startupLogLevel](`[STARTUP${isProduction ? ' WARNING' : ''}] ${isProduction ? '⚠️ ' : ''}${unlinkedCafeCount} active cafe items still missing Stripe product/price IDs after auto-sync attempt. Run "Sync to Stripe" from Admin to fix.`);
    }
  } catch (error: unknown) {
    logger.error('[Stripe Env] Environment validation failed (non-blocking):', { extra: { detail: getErrorMessage(error) } });
  }
}
