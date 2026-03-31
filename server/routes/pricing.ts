import { Router } from 'express';
import { z } from 'zod';
import { PRICING, getCorporateVolumeTiers, getCorporateBasePrice, updateGuestFee, updateOverageRate } from '../core/billing/pricingConfig';
import { db } from '../db';
import { membershipTiers, feeProducts } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from '../core/logger';
import { isStaffOrAdmin } from '../core/middleware';
import { getErrorMessage } from '../utils/errorUtils';
import { autoPushFeeToStripe } from '../core/stripe/autoPush';
import { logFromRequest } from '../core/auditLog';
import { getCached, setCache, invalidateCache } from '../core/queryCache';
import { validateBody } from '../middleware/validate';

const router = Router();

const PRICING_CACHE_KEY = 'api:pricing';
const CACHE_TTL_MS = 5 * 60 * 1000;

// PUBLIC ROUTE - pricing information displayed on public website
router.get('/api/pricing', async (req, res) => {
  try {
  const cached = getCached<Record<string, unknown>>(PRICING_CACHE_KEY);
  if (cached) return res.json(cached);

  const response: Record<string, unknown> = {
    guestFeeDollars: PRICING.GUEST_FEE_DOLLARS,
    overageRatePerBlockDollars: PRICING.OVERAGE_RATE_DOLLARS,
    overageBlockMinutes: PRICING.OVERAGE_BLOCK_MINUTES,
  };

  const volumeTiers = getCorporateVolumeTiers();
  const basePrice = getCorporateBasePrice();
  response.corporatePricing = {
    basePriceDollars: basePrice / 100,
    tiers: volumeTiers.map(t => ({
      minMembers: t.minMembers,
      priceDollars: t.priceCents / 100,
    })),
  };

  try {
    const subscriptionTiers = await db.select({
      name: membershipTiers.name,
      dailySimMinutes: membershipTiers.dailySimMinutes,
    })
      .from(membershipTiers)
      .where(eq(membershipTiers.productType, 'subscription'));

    const tierMinutes: Record<string, number> = {};
    for (const t of subscriptionTiers) {
      if (t.name) {
        tierMinutes[t.name.toLowerCase()] = t.dailySimMinutes ?? 0;
      }
    }
    response.tierMinutes = tierMinutes;
  } catch (_e: unknown) {
    response.tierMinutes = {};
  }

  try {
    const dayPassProducts = await db.select()
      .from(feeProducts)
      .where(eq(feeProducts.productType, 'one_time'));

    const dayPasses: Record<string, number> = {};
    for (const p of dayPassProducts) {
      if (p.isActive && p.priceCents && p.priceCents > 0 && p.slug) {
        dayPasses[p.slug] = p.priceCents / 100;
      }
    }
    response.dayPassPrices = dayPasses;
  } catch (_e: unknown) {
    response.dayPassPrices = {};
  }

  setCache(PRICING_CACHE_KEY, response, CACHE_TTL_MS);
  res.json(response);
  } catch (error: unknown) {
    logger.error('Failed to fetch pricing', { extra: { error: getErrorMessage(error) } });
    return res.status(500).json({ error: 'Failed to fetch pricing' });
  }
});

const strictNumeric = z.union([
  z.number(),
  z.string().regex(/^\d+(\.\d+)?$/, 'Must be a numeric value'),
]).transform(Number).pipe(z.number().min(0, 'Must be zero or positive'));

const pricingUpdateSchema = z.object({
  guestFeeDollars: strictNumeric.optional(),
  overageRatePerBlockDollars: strictNumeric.optional(),
});

router.put('/api/pricing', isStaffOrAdmin, validateBody(pricingUpdateSchema), async (req, res) => {
  try {
    const { guestFeeDollars, overageRatePerBlockDollars } = req.body;

    const guestFeeCents = guestFeeDollars !== undefined ? Math.round(guestFeeDollars * 100) : undefined;
    const overageRateCents = overageRatePerBlockDollars !== undefined ? Math.round(overageRatePerBlockDollars * 100) : undefined;

    const syncErrors: string[] = [];

    if (guestFeeCents !== undefined) {
      const result = await autoPushFeeToStripe('guest-pass', guestFeeCents);
      if (!result.success) {
        syncErrors.push(`Guest fee: ${result.error}`);
      } else {
        updateGuestFee(guestFeeCents);
        logFromRequest(req, 'update_guest_fee', 'pricing', 'guest-pass', `$${guestFeeCents / 100}`, {});
      }
    }

    if (overageRateCents !== undefined) {
      const result = await autoPushFeeToStripe('simulator-overage-30min', overageRateCents);
      if (!result.success) {
        syncErrors.push(`Overage rate: ${result.error}`);
      } else {
        updateOverageRate(overageRateCents);
        logFromRequest(req, 'update_overage_rate', 'pricing', 'simulator-overage-30min', `$${overageRateCents / 100}`, {});
      }
    }

    const synced = syncErrors.length === 0;

    logger.info('[Pricing] Fees updated by admin', {
      extra: {
        detail: {
          guestFeeDollars: PRICING.GUEST_FEE_DOLLARS,
          overageRatePerBlockDollars: PRICING.OVERAGE_RATE_DOLLARS,
          synced,
          syncErrors: syncErrors.length > 0 ? syncErrors : undefined,
        }
      }
    });

    invalidateCache('api:pricing');
    res.json({
      guestFeeDollars: PRICING.GUEST_FEE_DOLLARS,
      overageRatePerBlockDollars: PRICING.OVERAGE_RATE_DOLLARS,
      overageBlockMinutes: PRICING.OVERAGE_BLOCK_MINUTES,
      synced,
      syncError: syncErrors.length > 0 ? syncErrors.join('; ') : undefined,
    });
  } catch (error: unknown) {
    logger.error('Failed to update pricing', { extra: { error: getErrorMessage(error) } });
    return res.status(500).json({ error: 'Failed to update pricing' });
  }
});

export default router;
