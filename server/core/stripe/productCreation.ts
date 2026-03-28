import { db } from '../../db';
import { feeProducts } from '../../../shared/schema';
import { eq } from 'drizzle-orm';
import { getStripeClient } from './client';
import { PRICING, getCorporateVolumeTiers, getCorporateBasePrice, updateCorporateVolumePricing, updateOverageRate, updateGuestFee, VolumeTier } from '../billing/pricingConfig';
import { getErrorMessage } from '../../utils/errorUtils';
import { logger } from '../logger';
import { markAppOriginated } from './appOriginTracker';
import { findExistingStripeProduct } from './productHelpers';
import type Stripe from 'stripe';

async function archiveStalePrices(stripe: Stripe, productId: string, activePriceId: string, label: string): Promise<void> {
  try {
    const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    const stale = prices.data.filter(p => p.id !== activePriceId);
    if (stale.length === 0) return;
    let archived = 0;
    for (const p of stale) {
      try {
        await stripe.prices.update(p.id, { active: false });
        archived++;
      } catch (archiveErr: unknown) {
        const msg = getErrorMessage(archiveErr);
        if (msg.includes('default price')) {
          logger.debug(`[${label}] Skipped default price ${p.id}`);
        } else {
          logger.warn(`[${label}] Failed to archive price ${p.id}`, { extra: { error: msg } });
        }
      }
    }
    if (archived > 0) logger.info(`[${label}] Archived ${archived} stale price(s)`);
  } catch (err: unknown) {
    logger.warn(`[${label}] Failed to list stale prices`, { extra: { error: getErrorMessage(err) } });
  }
}

export async function ensureSimulatorOverageProduct(): Promise<{
  success: boolean;
  stripeProductId?: string;
  stripePriceId?: string;
  action: 'created' | 'exists' | 'error';
}> {
  const OVERAGE_SLUG = 'simulator-overage-30min';
  const OVERAGE_NAME = 'Simulator Overage (30 min)';
  const OVERAGE_PRICE_CENTS = PRICING.OVERAGE_RATE_CENTS;
  const OVERAGE_DESCRIPTION = 'Per 30 minutes over tier privileges';

  try {
    const stripe = await getStripeClient();
    
    const existing = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.slug, OVERAGE_SLUG))
      .limit(1);
    
    let feeId: number;
    let stripeProductId = existing[0]?.stripeProductId;
    let stripePriceId = existing[0]?.stripePriceId;
    
    if (existing.length === 0) {
      const [newFee] = await db.insert(feeProducts).values({
        name: OVERAGE_NAME,
        slug: OVERAGE_SLUG,
        priceString: `$${PRICING.OVERAGE_RATE_DOLLARS}`,
        description: OVERAGE_DESCRIPTION,
        buttonText: 'Pay Now',
        sortOrder: 99,
        isActive: true,
        productType: 'one_time',
        feeType: 'simulator_overage',
        priceCents: OVERAGE_PRICE_CENTS,
      }).returning();
      feeId = newFee.id;
      logger.info(`[Overage Product] Created database record: ${OVERAGE_NAME}`);
    } else {
      feeId = existing[0].id;
      if (existing[0].productType !== 'one_time') {
        await db.update(feeProducts)
          .set({ productType: 'one_time' })
          .where(eq(feeProducts.id, feeId));
        logger.info(`[Overage Product] Fixed productType to one_time`);
      }
    }
    
    if (stripeProductId) {
      try {
        const existingProduct = await stripe.products.retrieve(stripeProductId);
        if (!existingProduct.active) {
          logger.warn(`[Overage Product] Stripe product ${stripeProductId} is archived, reactivating`);
          markAppOriginated(stripeProductId);
          await stripe.products.update(stripeProductId, { active: true });
        }
      } catch (prodErr: unknown) {
        const errMsg = getErrorMessage(prodErr);
        if (errMsg.includes('No such product') || errMsg.includes('resource_missing')) {
          logger.warn(`[Overage Product] Stored Stripe product ${stripeProductId} no longer exists, will recreate`);
          stripeProductId = null;
          stripePriceId = null;
        }
      }
    }

    if (!stripeProductId) {
      const found = await findExistingStripeProduct(stripe, OVERAGE_NAME, 'fee_slug', OVERAGE_SLUG, 'tier_slug');
      if (found) {
        stripeProductId = found.id;
        if (found.default_price && typeof found.default_price === 'string') {
          stripePriceId = found.default_price;
        } else if (found.default_price && typeof found.default_price === 'object') {
          stripePriceId = found.default_price.id;
        }
        logger.info(`[Overage Product] Re-linked existing Stripe product: ${stripeProductId}${stripePriceId ? `, price: ${stripePriceId}` : ''}`);
      } else {
        const product = await stripe.products.create({
          name: OVERAGE_NAME,
          description: OVERAGE_DESCRIPTION,
          metadata: {
            fee_product_id: feeId.toString(),
            fee_slug: OVERAGE_SLUG,
            product_type: 'one_time',
            fee_type: 'simulator_overage',
            app_category: 'fee',
            source: 'ever_house_app',
          },
        });
        stripeProductId = product.id;
        logger.info(`[Overage Product] Created Stripe product: ${stripeProductId}`);
      }
    }
    
    if (stripePriceId) {
      try {
        const existingPrice = await stripe.prices.retrieve(stripePriceId);
        if (!existingPrice.active) {
          logger.warn(`[Overage Product] Stored Stripe price ${stripePriceId} is inactive, will recreate`);
          stripePriceId = null;
        }
      } catch (priceErr: unknown) {
        const errMsg = getErrorMessage(priceErr);
        if (errMsg.includes('No such price') || errMsg.includes('resource_missing')) {
          logger.warn(`[Overage Product] Stored Stripe price ${stripePriceId} no longer exists, will recreate`);
          stripePriceId = null;
        } else {
          logger.warn(`[Overage Product] Transient error retrieving price ${stripePriceId}, keeping existing`, { extra: { error: getErrorMessage(priceErr) } });
        }
      }
    }

    if (!stripePriceId) {
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: OVERAGE_PRICE_CENTS,
        currency: 'usd',
        metadata: {
          fee_product_id: feeId.toString(),
          fee_slug: OVERAGE_SLUG,
          product_type: 'one_time',
          app_category: 'fee',
        },
      });
      stripePriceId = price.id;
      logger.info(`[Overage Product] Created Stripe price: ${stripePriceId}`);
    }
    
    await db.update(feeProducts)
      .set({
        stripeProductId,
        stripePriceId,
      })
      .where(eq(feeProducts.id, feeId));
    
    logger.info(`[Overage Product] ${OVERAGE_NAME} ready (${stripePriceId})`);

    await archiveStalePrices(stripe, stripeProductId, stripePriceId, 'Overage Product');

    try {
      const actualPrice = await stripe.prices.retrieve(stripePriceId);
      if (actualPrice.unit_amount && actualPrice.unit_amount > 0) {
        updateOverageRate(actualPrice.unit_amount);
      }
    } catch (priceReadErr: unknown) {
      logger.warn('[Overage Product] Failed to read Stripe price, using default:', { extra: { error: getErrorMessage(priceReadErr) } });
    }

    return { success: true, stripeProductId, stripePriceId, action: existing.length > 0 && existing[0].stripePriceId ? 'exists' : 'created' };
  } catch (error: unknown) {
    logger.error('[Overage Product] Error:', { extra: { detail: getErrorMessage(error) } });
    return { success: false, action: 'error' };
  }
}

export async function ensureGuestPassProduct(): Promise<{
  success: boolean;
  stripeProductId?: string;
  stripePriceId?: string;
  action: 'created' | 'exists' | 'error';
}> {
  const GUEST_PASS_SLUG = 'guest-pass';
  const GUEST_PASS_NAME = 'Guest Fee';
  const GUEST_PASS_PRICE_CENTS = PRICING.GUEST_FEE_CENTS;
  const GUEST_PASS_DESCRIPTION = 'Guest fee for simulator use';

  try {
    const stripe = await getStripeClient();
    
    const existing = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.slug, GUEST_PASS_SLUG))
      .limit(1);
    
    let feeId: number;
    let stripeProductId = existing[0]?.stripeProductId;
    let stripePriceId = existing[0]?.stripePriceId;
    
    if (existing.length === 0) {
      const [newFee] = await db.insert(feeProducts).values({
        name: GUEST_PASS_NAME,
        slug: GUEST_PASS_SLUG,
        priceString: `$${GUEST_PASS_PRICE_CENTS / 100}`,
        description: GUEST_PASS_DESCRIPTION,
        buttonText: 'Purchase',
        sortOrder: 97,
        isActive: true,
        productType: 'one_time',
        feeType: 'guest_pass',
        priceCents: GUEST_PASS_PRICE_CENTS,
      }).returning();
      feeId = newFee.id;
      logger.info(`[Guest Pass Product] Created database record: ${GUEST_PASS_NAME}`);
    } else {
      feeId = existing[0].id;
      const updates: Record<string, string> = {};
      if (existing[0].name !== GUEST_PASS_NAME) updates.name = GUEST_PASS_NAME;
      if (existing[0].productType !== 'one_time') updates.productType = 'one_time';
      if (Object.keys(updates).length > 0) {
        await db.update(feeProducts)
          .set(updates)
          .where(eq(feeProducts.id, feeId));
        logger.info(`[Guest Pass Product] Fixed DB record fields: ${Object.keys(updates).join(', ')}`);
      }
    }
    
    if (stripeProductId) {
      try {
        const existingProduct = await stripe.products.retrieve(stripeProductId);
        const updates: Record<string, unknown> = {};
        if (!existingProduct.active) {
          updates.active = true;
          logger.warn(`[Guest Pass Product] Stripe product ${stripeProductId} is archived, reactivating`);
        }
        if (existingProduct.name !== GUEST_PASS_NAME) {
          updates.name = GUEST_PASS_NAME;
          updates.description = GUEST_PASS_DESCRIPTION;
        }
        if (Object.keys(updates).length > 0) {
          markAppOriginated(stripeProductId);
          await stripe.products.update(stripeProductId, updates);
          if (updates.name) logger.info(`[Guest Pass Product] Renamed Stripe product: ${existingProduct.name} -> ${GUEST_PASS_NAME}`);
        }
      } catch (renameErr: unknown) {
        const errMsg = getErrorMessage(renameErr);
        if (errMsg.includes('No such product') || errMsg.includes('resource_missing')) {
          logger.warn(`[Guest Pass Product] Stored Stripe product ${stripeProductId} no longer exists, will recreate`);
          stripeProductId = null;
          stripePriceId = null;
        } else {
          logger.warn('[Guest Pass Product] Could not sync Stripe product name', { extra: { error: errMsg } });
        }
      }
    }

    if (!stripeProductId) {
      const found = await findExistingStripeProduct(stripe, GUEST_PASS_NAME, 'fee_slug', GUEST_PASS_SLUG, 'tier_slug');
      if (found) {
        stripeProductId = found.id;
        if (found.default_price && typeof found.default_price === 'string') {
          stripePriceId = found.default_price;
        } else if (found.default_price && typeof found.default_price === 'object') {
          stripePriceId = found.default_price.id;
        }
        logger.info(`[Guest Pass Product] Re-linked existing Stripe product: ${stripeProductId}${stripePriceId ? `, price: ${stripePriceId}` : ''}`);
      } else {
        const product = await stripe.products.create({
          name: GUEST_PASS_NAME,
          description: GUEST_PASS_DESCRIPTION,
          metadata: {
            fee_product_id: feeId.toString(),
            fee_slug: GUEST_PASS_SLUG,
            product_type: 'one_time',
            fee_type: 'guest_pass',
            app_category: 'fee',
            source: 'ever_house_app',
          },
        });
        stripeProductId = product.id;
        logger.info(`[Guest Pass Product] Created Stripe product: ${stripeProductId}`);
      }
    }
    
    if (stripePriceId) {
      try {
        const existingPrice = await stripe.prices.retrieve(stripePriceId);
        if (!existingPrice.active) {
          logger.warn(`[Guest Pass Product] Stored Stripe price ${stripePriceId} is inactive, will recreate`);
          stripePriceId = null;
        }
      } catch (priceErr: unknown) {
        const errMsg = getErrorMessage(priceErr);
        if (errMsg.includes('No such price') || errMsg.includes('resource_missing')) {
          logger.warn(`[Guest Pass Product] Stored Stripe price ${stripePriceId} no longer exists, will recreate`);
          stripePriceId = null;
        } else {
          logger.warn(`[Guest Pass Product] Transient error retrieving price ${stripePriceId}, keeping existing`, { extra: { error: getErrorMessage(priceErr) } });
        }
      }
    }

    if (!stripePriceId) {
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: GUEST_PASS_PRICE_CENTS,
        currency: 'usd',
        metadata: {
          fee_product_id: feeId.toString(),
          fee_slug: GUEST_PASS_SLUG,
          product_type: 'one_time',
          app_category: 'fee',
        },
      });
      stripePriceId = price.id;
      logger.info(`[Guest Pass Product] Created Stripe price: ${stripePriceId}`);
    }
    
    await db.update(feeProducts)
      .set({
        stripeProductId,
        stripePriceId,
      })
      .where(eq(feeProducts.id, feeId));
    
    logger.info(`[Guest Pass Product] ${GUEST_PASS_NAME} ready (${stripePriceId})`);

    await archiveStalePrices(stripe, stripeProductId, stripePriceId, 'Guest Pass Product');

    try {
      const actualPrice = await stripe.prices.retrieve(stripePriceId);
      if (actualPrice.unit_amount && actualPrice.unit_amount > 0) {
        updateGuestFee(actualPrice.unit_amount);
      }
    } catch (priceReadErr: unknown) {
      logger.warn('[Guest Pass Product] Failed to read Stripe price, using default:', { extra: { error: getErrorMessage(priceReadErr) } });
    }

    return { success: true, stripeProductId, stripePriceId, action: existing.length > 0 && existing[0].stripePriceId ? 'exists' : 'created' };
  } catch (error: unknown) {
    logger.error('[Guest Pass Product] Error:', { extra: { detail: getErrorMessage(error) } });
    return { success: false, action: 'error' };
  }
}

export async function ensureDayPassCoworkingProduct(): Promise<{
  success: boolean;
  stripeProductId?: string;
  stripePriceId?: string;
  action: 'created' | 'exists' | 'error';
}> {
  const COWORKING_SLUG = 'day-pass-coworking';
  const COWORKING_NAME = 'Day Pass - Coworking';
  const COWORKING_PRICE_CENTS = 3500;
  const COWORKING_DESCRIPTION = 'Full day workspace access';

  try {
    const stripe = await getStripeClient();
    
    const existing = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.slug, COWORKING_SLUG))
      .limit(1);
    
    let feeId: number;
    let stripeProductId = existing[0]?.stripeProductId;
    let stripePriceId = existing[0]?.stripePriceId;
    
    if (existing.length === 0) {
      const [newFee] = await db.insert(feeProducts).values({
        name: COWORKING_NAME,
        slug: COWORKING_SLUG,
        priceString: `$${COWORKING_PRICE_CENTS / 100}`,
        description: COWORKING_DESCRIPTION,
        buttonText: 'Purchase',
        sortOrder: 96,
        isActive: true,
        productType: 'one_time',
        feeType: 'day_pass_coworking',
        priceCents: COWORKING_PRICE_CENTS,
      }).returning();
      feeId = newFee.id;
      logger.info(`[Day Pass Coworking Product] Created database record: ${COWORKING_NAME}`);
    } else {
      feeId = existing[0].id;
      if (existing[0].productType !== 'one_time') {
        await db.update(feeProducts)
          .set({ productType: 'one_time' })
          .where(eq(feeProducts.id, feeId));
        logger.info(`[Day Pass Coworking Product] Fixed productType to one_time`);
      }
    }

    if (stripeProductId) {
      try {
        const existingProduct = await stripe.products.retrieve(stripeProductId);
        if (!existingProduct.active) {
          logger.warn(`[Day Pass Coworking Product] Stripe product ${stripeProductId} is archived, reactivating`);
          markAppOriginated(stripeProductId);
          await stripe.products.update(stripeProductId, { active: true });
        }
      } catch (prodErr: unknown) {
        const errMsg = getErrorMessage(prodErr);
        if (errMsg.includes('No such product') || errMsg.includes('resource_missing')) {
          logger.warn(`[Day Pass Coworking Product] Stored Stripe product ${stripeProductId} no longer exists, will recreate`);
          stripeProductId = null;
          stripePriceId = null;
        }
      }
    }

    if (stripePriceId) {
      try {
        const existingPrice = await stripe.prices.retrieve(stripePriceId);
        if (!existingPrice.active) {
          logger.warn(`[Day Pass Coworking Product] Stored Stripe price ${stripePriceId} is inactive, will recreate`);
          stripePriceId = null;
        }
      } catch (priceErr: unknown) {
        const errMsg = getErrorMessage(priceErr);
        if (errMsg.includes('No such price') || errMsg.includes('resource_missing')) {
          logger.warn(`[Day Pass Coworking Product] Stored Stripe price ${stripePriceId} no longer exists, will recreate`);
          stripePriceId = null;
        } else {
          logger.warn(`[Day Pass Coworking Product] Transient error retrieving price ${stripePriceId}, keeping existing`, { extra: { error: getErrorMessage(priceErr) } });
        }
      }
    }
    
    if (!stripeProductId) {
      const found = await findExistingStripeProduct(stripe, COWORKING_NAME, 'fee_slug', COWORKING_SLUG, 'tier_slug');
      if (found) {
        stripeProductId = found.id;
        if (found.default_price && typeof found.default_price === 'string') {
          stripePriceId = found.default_price;
        } else if (found.default_price && typeof found.default_price === 'object') {
          stripePriceId = found.default_price.id;
        }
        logger.info(`[Day Pass Coworking Product] Re-linked existing Stripe product: ${stripeProductId}${stripePriceId ? `, price: ${stripePriceId}` : ''}`);
      } else {
        const product = await stripe.products.create({
          name: COWORKING_NAME,
          description: COWORKING_DESCRIPTION,
          metadata: {
            fee_product_id: feeId.toString(),
            fee_slug: COWORKING_SLUG,
            product_type: 'one_time',
            fee_type: 'day_pass_coworking',
            app_category: 'fee',
            source: 'ever_house_app',
          },
        });
        stripeProductId = product.id;
        logger.info(`[Day Pass Coworking Product] Created Stripe product: ${stripeProductId}`);
      }
    }
    
    if (!stripePriceId) {
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: COWORKING_PRICE_CENTS,
        currency: 'usd',
        metadata: {
          fee_product_id: feeId.toString(),
          fee_slug: COWORKING_SLUG,
          product_type: 'one_time',
          app_category: 'fee',
        },
      });
      stripePriceId = price.id;
      logger.info(`[Day Pass Coworking Product] Created Stripe price: ${stripePriceId}`);
    }
    
    await db.update(feeProducts)
      .set({
        stripeProductId,
        stripePriceId,
      })
      .where(eq(feeProducts.id, feeId));
    
    logger.info(`[Day Pass Coworking Product] ${COWORKING_NAME} ready (${stripePriceId})`);

    await archiveStalePrices(stripe, stripeProductId, stripePriceId, 'Day Pass Coworking Product');

    return { success: true, stripeProductId, stripePriceId, action: existing.length > 0 && existing[0].stripePriceId ? 'exists' : 'created' };
  } catch (error: unknown) {
    logger.error('[Day Pass Coworking Product] Error:', { extra: { detail: getErrorMessage(error) } });
    return { success: false, action: 'error' };
  }
}

export async function ensureDayPassGolfSimProduct(): Promise<{
  success: boolean;
  stripeProductId?: string;
  stripePriceId?: string;
  action: 'created' | 'exists' | 'error';
}> {
  const GOLF_SIM_SLUG = 'day-pass-golf-sim';
  const GOLF_SIM_NAME = 'Day Pass - Golf Sim';
  const GOLF_SIM_PRICE_CENTS = 5000;
  const GOLF_SIM_DESCRIPTION = '60 minute golf simulator session';

  try {
    const stripe = await getStripeClient();
    
    const existing = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.slug, GOLF_SIM_SLUG))
      .limit(1);
    
    let feeId: number;
    let stripeProductId = existing[0]?.stripeProductId;
    let stripePriceId = existing[0]?.stripePriceId;
    
    if (existing.length === 0) {
      const [newFee] = await db.insert(feeProducts).values({
        name: GOLF_SIM_NAME,
        slug: GOLF_SIM_SLUG,
        priceString: `$${GOLF_SIM_PRICE_CENTS / 100}`,
        description: GOLF_SIM_DESCRIPTION,
        buttonText: 'Purchase',
        sortOrder: 95,
        isActive: true,
        productType: 'one_time',
        feeType: 'day_pass_golf_sim',
        priceCents: GOLF_SIM_PRICE_CENTS,
      }).returning();
      feeId = newFee.id;
      logger.info(`[Day Pass Golf Sim Product] Created database record: ${GOLF_SIM_NAME}`);
    } else {
      feeId = existing[0].id;
      if (existing[0].productType !== 'one_time') {
        await db.update(feeProducts)
          .set({ productType: 'one_time' })
          .where(eq(feeProducts.id, feeId));
        logger.info(`[Day Pass Golf Sim Product] Fixed productType to one_time`);
      }
    }

    if (stripeProductId) {
      try {
        const existingProduct = await stripe.products.retrieve(stripeProductId);
        if (!existingProduct.active) {
          logger.warn(`[Day Pass Golf Sim Product] Stripe product ${stripeProductId} is archived, reactivating`);
          markAppOriginated(stripeProductId);
          await stripe.products.update(stripeProductId, { active: true });
        }
      } catch (prodErr: unknown) {
        const errMsg = getErrorMessage(prodErr);
        if (errMsg.includes('No such product') || errMsg.includes('resource_missing')) {
          logger.warn(`[Day Pass Golf Sim Product] Stored Stripe product ${stripeProductId} no longer exists, will recreate`);
          stripeProductId = null;
          stripePriceId = null;
        }
      }
    }

    if (stripePriceId) {
      try {
        const existingPrice = await stripe.prices.retrieve(stripePriceId);
        if (!existingPrice.active) {
          logger.warn(`[Day Pass Golf Sim Product] Stored Stripe price ${stripePriceId} is inactive, will recreate`);
          stripePriceId = null;
        }
      } catch (priceErr: unknown) {
        const errMsg = getErrorMessage(priceErr);
        if (errMsg.includes('No such price') || errMsg.includes('resource_missing')) {
          logger.warn(`[Day Pass Golf Sim Product] Stored Stripe price ${stripePriceId} no longer exists, will recreate`);
          stripePriceId = null;
        } else {
          logger.warn(`[Day Pass Golf Sim Product] Transient error retrieving price ${stripePriceId}, keeping existing`, { extra: { error: getErrorMessage(priceErr) } });
        }
      }
    }
    
    if (!stripeProductId) {
      const found = await findExistingStripeProduct(stripe, GOLF_SIM_NAME, 'fee_slug', GOLF_SIM_SLUG, 'tier_slug');
      if (found) {
        stripeProductId = found.id;
        if (found.default_price && typeof found.default_price === 'string') {
          stripePriceId = found.default_price;
        } else if (found.default_price && typeof found.default_price === 'object') {
          stripePriceId = found.default_price.id;
        }
        logger.info(`[Day Pass Golf Sim Product] Re-linked existing Stripe product: ${stripeProductId}${stripePriceId ? `, price: ${stripePriceId}` : ''}`);
      } else {
        const product = await stripe.products.create({
          name: GOLF_SIM_NAME,
          description: GOLF_SIM_DESCRIPTION,
          metadata: {
            fee_product_id: feeId.toString(),
            fee_slug: GOLF_SIM_SLUG,
            product_type: 'one_time',
            fee_type: 'day_pass_golf_sim',
            app_category: 'fee',
            source: 'ever_house_app',
          },
        });
        stripeProductId = product.id;
        logger.info(`[Day Pass Golf Sim Product] Created Stripe product: ${stripeProductId}`);
      }
    }
    
    if (!stripePriceId) {
      const price = await stripe.prices.create({
        product: stripeProductId,
        unit_amount: GOLF_SIM_PRICE_CENTS,
        currency: 'usd',
        metadata: {
          fee_product_id: feeId.toString(),
          fee_slug: GOLF_SIM_SLUG,
          product_type: 'one_time',
          app_category: 'fee',
        },
      });
      stripePriceId = price.id;
      logger.info(`[Day Pass Golf Sim Product] Created Stripe price: ${stripePriceId}`);
    }
    
    await db.update(feeProducts)
      .set({
        stripeProductId,
        stripePriceId,
      })
      .where(eq(feeProducts.id, feeId));
    
    logger.info(`[Day Pass Golf Sim Product] ${GOLF_SIM_NAME} ready (${stripePriceId})`);

    await archiveStalePrices(stripe, stripeProductId, stripePriceId, 'Day Pass Golf Sim Product');

    return { success: true, stripeProductId, stripePriceId, action: existing.length > 0 && existing[0].stripePriceId ? 'exists' : 'created' };
  } catch (error: unknown) {
    logger.error('[Day Pass Golf Sim Product] Error:', { extra: { detail: getErrorMessage(error) } });
    return { success: false, action: 'error' };
  }
}

const CORPORATE_PRICING_SLUG = 'corporate-volume-pricing';
const CORPORATE_PRICING_NAME = 'Corporate Volume Pricing';

export async function ensureCorporateVolumePricingProduct(): Promise<{
  success: boolean;
  stripeProductId?: string;
  action: 'created' | 'exists' | 'error';
}> {
  try {
    const stripe = await getStripeClient();
    
    const existing = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.slug, CORPORATE_PRICING_SLUG))
      .limit(1);
    
    let feeId: number;
    let stripeProductId = existing[0]?.stripeProductId;
    
    if (existing.length === 0) {
      const [newFee] = await db.insert(feeProducts).values({
        name: CORPORATE_PRICING_NAME,
        slug: CORPORATE_PRICING_SLUG,
        priceString: 'Volume',
        description: 'Corporate volume pricing configuration',
        buttonText: '',
        sortOrder: 98,
        isActive: true,
        productType: 'config',
        feeType: 'corporate_config',
        priceCents: 0,
      }).returning();
      feeId = newFee.id;
      logger.info(`[Corporate Pricing] Created database record: ${CORPORATE_PRICING_NAME}`);
    } else {
      feeId = existing[0].id;
    }
    
    if (stripeProductId) {
      try {
        const existingProduct = await stripe.products.retrieve(stripeProductId);
        if (!existingProduct.active) {
          logger.warn(`[Corporate Pricing] Stripe product ${stripeProductId} is archived, reactivating`);
          markAppOriginated(stripeProductId);
          await stripe.products.update(stripeProductId, { active: true });
        }
      } catch (prodErr: unknown) {
        const errMsg = getErrorMessage(prodErr);
        if (errMsg.includes('No such product') || errMsg.includes('resource_missing')) {
          logger.warn(`[Corporate Pricing] Stored Stripe product ${stripeProductId} no longer exists, will recreate`);
          stripeProductId = null;
        }
      }
    }

    if (!stripeProductId) {
      const existingProducts = await stripe.products.search({
        query: `metadata['config_type']:'corporate_volume_pricing' AND metadata['fee_slug']:'${CORPORATE_PRICING_SLUG}'`,
        limit: 1,
      });
      
      if (existingProducts.data.length > 0) {
        stripeProductId = existingProducts.data[0].id;
        await db.update(feeProducts)
          .set({ stripeProductId })
          .where(eq(feeProducts.id, feeId));
        logger.info(`[Corporate Pricing] Re-linked existing Stripe product: ${stripeProductId}`);
      } else {
        const tiers = getCorporateVolumeTiers();
        const basePrice = getCorporateBasePrice();
        
        const metadata: Record<string, string> = {
          fee_product_id: feeId.toString(),
          fee_slug: CORPORATE_PRICING_SLUG,
          product_type: 'config',
          config_type: 'corporate_volume_pricing',
          volume_base_price: basePrice.toString(),
          app_category: 'config',
        };
        
        for (const tier of tiers) {
          metadata[`volume_tier_${tier.minMembers}`] = tier.priceCents.toString();
        }
        
        const product = await stripe.products.create({
          name: CORPORATE_PRICING_NAME,
          description: 'Configuration product for corporate volume pricing tiers. Edit metadata to change pricing.',
          metadata,
        });
        stripeProductId = product.id;
        
        await db.update(feeProducts)
          .set({ stripeProductId })
          .where(eq(feeProducts.id, feeId));
        
        logger.info(`[Corporate Pricing] Created Stripe product: ${stripeProductId}`);
      }
    }
    
    updateCorporateVolumePricing(getCorporateVolumeTiers(), getCorporateBasePrice(), stripeProductId);
    
    logger.info(`[Corporate Pricing] ${CORPORATE_PRICING_NAME} ready (${stripeProductId})`);
    return { success: true, stripeProductId, action: existing.length > 0 && existing[0].stripeProductId ? 'exists' : 'created' };
  } catch (error: unknown) {
    logger.error('[Corporate Pricing] Error:', { extra: { detail: getErrorMessage(error) } });
    return { success: false, action: 'error' };
  }
}

export async function pullCorporateVolumePricingFromStripe(): Promise<boolean> {
  try {
    const stripe = await getStripeClient();
    
    const existing = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.slug, CORPORATE_PRICING_SLUG))
      .limit(1);
    
    if (existing.length === 0 || !existing[0].stripeProductId) {
      logger.info('[Corporate Pricing] No Stripe product linked, using defaults');
      return false;
    }
    
    let product;
    try {
      product = await stripe.products.retrieve(existing[0].stripeProductId);
    } catch (prodErr: unknown) {
      const errMsg = getErrorMessage(prodErr);
      if (errMsg.includes('No such product') || errMsg.includes('resource_missing')) {
        logger.warn(`[Corporate Pricing] Stored Stripe product ${existing[0].stripeProductId} no longer exists, clearing reference`);
        await db.update(feeProducts)
          .set({ stripeProductId: null })
          .where(eq(feeProducts.id, existing[0].id));
        return false;
      }
      throw prodErr;
    }
    const metadata = product.metadata || {};
    
    const tiers: VolumeTier[] = [];
    const basePrice = metadata.volume_base_price ? parseInt(metadata.volume_base_price, 10) : getCorporateBasePrice();
    
    for (const [key, value] of Object.entries(metadata)) {
      const match = key.match(/^volume_tier_(\d+)$/);
      if (match) {
        const minMembers = parseInt(match[1], 10);
        const priceCents = parseInt(value, 10);
        if (!isNaN(minMembers) && !isNaN(priceCents)) {
          tiers.push({ minMembers, priceCents });
        }
      }
    }
    
    if (tiers.length > 0) {
      updateCorporateVolumePricing(tiers, basePrice, existing[0].stripeProductId);
      logger.info(`[Corporate Pricing] Pulled ${tiers.length} volume tiers from Stripe`);
      return true;
    }
    
    logger.info('[Corporate Pricing] No volume tiers found in Stripe metadata, using defaults');
    return false;
  } catch (error: unknown) {
    logger.error('[Corporate Pricing] Pull failed:', { extra: { detail: getErrorMessage(error) } });
    return false;
  }
}
