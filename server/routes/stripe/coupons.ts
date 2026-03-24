import { logger } from '../../core/logger';
import { Router, Request, Response } from 'express';
import { isStaffOrAdmin, isAdmin } from '../../core/middleware';
import { getErrorCode, isStripeResourceMissing } from '../../utils/errorUtils';
import { logFromRequest } from '../../core/auditLog';
import { createHash } from 'crypto';

const router = Router();

router.get('/api/stripe/coupons', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { getStripeClient } = await import('../../core/stripe/client');
    const stripe = await getStripeClient();
    
    const coupons = await stripe.coupons.list({
      limit: 100,
    });
    
    logger.info('[Stripe Coupons] Found coupons', { extra: { count: coupons.data.length, coupons: coupons.data.map(c => ({ id: c.id, name: c.name })) } });
    
    const promoCodes = await stripe.promotionCodes.list({ limit: 100, active: true });
    const promoMap = new Map<string, string[]>();
    for (const pc of promoCodes.data) {
      const couponId = typeof pc.coupon === 'string' ? pc.coupon : pc.coupon.id;
      const existing = promoMap.get(couponId) || [];
      existing.push(pc.code);
      promoMap.set(couponId, existing);
    }

    const formattedCoupons = coupons.data.map(coupon => ({
      id: coupon.id,
      name: coupon.name || coupon.id,
      percentOff: coupon.percent_off,
      amountOff: coupon.amount_off ? coupon.amount_off / 100 : null,
      amountOffCents: coupon.amount_off,
      currency: coupon.currency,
      duration: coupon.duration,
      durationInMonths: coupon.duration_in_months,
      maxRedemptions: coupon.max_redemptions,
      timesRedeemed: coupon.times_redeemed,
      valid: coupon.valid,
      createdAt: new Date(coupon.created * 1000).toISOString(),
      metadata: coupon.metadata,
      promotionCodes: promoMap.get(coupon.id) || [],
    }));
    
    res.json({ coupons: formattedCoupons, count: formattedCoupons.length });
  } catch (error: unknown) {
    logger.error('[Stripe] Error listing coupons', { error: error instanceof Error ? error : new Error(String(error)) });
    res.status(500).json({ error: 'Failed to list coupons' });
  }
});

router.post('/api/stripe/coupons', isAdmin, async (req: Request, res: Response) => {
  try {
    const { 
      id, 
      name, 
      percentOff, 
      amountOffCents, 
      currency = 'usd',
      duration, 
      durationInMonths,
      promotionCode,
    } = req.body;
    
    if (!duration || !['once', 'repeating', 'forever'].includes(duration)) {
      return res.status(400).json({ error: 'Invalid duration. Must be once, repeating, or forever.' });
    }
    
    if (duration === 'repeating' && (!durationInMonths || durationInMonths < 1)) {
      return res.status(400).json({ error: 'durationInMonths is required for repeating duration.' });
    }
    
    if (!percentOff && !amountOffCents) {
      return res.status(400).json({ error: 'Either percentOff or amountOffCents is required.' });
    }
    
    if (percentOff && amountOffCents) {
      return res.status(400).json({ error: 'Cannot specify both percentOff and amountOffCents.' });
    }
    
    if (percentOff && (percentOff <= 0 || percentOff > 100)) {
      return res.status(400).json({ error: 'percentOff must be between 1 and 100.' });
    }
    
    if (amountOffCents && amountOffCents <= 0) {
      return res.status(400).json({ error: 'amountOffCents must be greater than 0.' });
    }
    
    const { getStripeClient } = await import('../../core/stripe/client');
    const stripe = await getStripeClient();
    
    const couponParams: Record<string, unknown> = {
      duration,
      name: name || undefined,
      metadata: {
        source: 'admin_dashboard',
        created_by: 'staff',
      },
    };
    
    if (id) {
      couponParams.id = id;
    }
    
    if (percentOff) {
      couponParams.percent_off = percentOff;
    } else {
      couponParams.amount_off = amountOffCents;
      couponParams.currency = currency;
    }
    
    if (duration === 'repeating') {
      couponParams.duration_in_months = durationInMonths;
    }
    
    const discountValue = percentOff ? `${percentOff}p` : `${amountOffCents}c`;
    const nameForKey = (name || 'unnamed').replace(/\s+/g, '_').toLowerCase();
    const keyString = `${nameForKey}_${discountValue}_${duration}`;
    const keyHash = createHash('md5').update(keyString).digest('hex').slice(0, 12);
    const idempotencyKey = `coupon_admin_${nameForKey}_${keyHash}`;
    
    const coupon = await stripe.coupons.create(couponParams, {
      idempotencyKey,
    });
    
    logger.info('[Stripe] Created coupon', { extra: { couponId: coupon.id } });
    logFromRequest(req, 'create_coupon', 'coupon', coupon.id, coupon.name || '', {});
    
    let createdPromoCode: string | null = null;
    if (promotionCode && typeof promotionCode === 'string' && promotionCode.trim()) {
      const code = promotionCode.trim().toUpperCase().replace(/\s+/g, '');
      const promo = await stripe.promotionCodes.create({
        coupon: coupon.id,
        code,
        metadata: {
          source: 'admin_dashboard',
          created_by: 'staff',
        },
      });
      createdPromoCode = promo.code;
      logger.info('[Stripe] Created promotion code', { extra: { promoCode: promo.code, couponId: coupon.id } });
      logFromRequest(req, 'create_promotion_code', 'promotion_code', promo.id, promo.code, { couponId: coupon.id });
    }

    res.json({
      success: true,
      coupon: {
        id: coupon.id,
        name: coupon.name || coupon.id,
        percentOff: coupon.percent_off,
        amountOff: coupon.amount_off ? coupon.amount_off / 100 : null,
        amountOffCents: coupon.amount_off,
        currency: coupon.currency,
        duration: coupon.duration,
        durationInMonths: coupon.duration_in_months,
        valid: coupon.valid,
        promotionCodes: createdPromoCode ? [createdPromoCode] : [],
      },
    });
  } catch (error: unknown) {
    logger.error('[Stripe] Error creating coupon', { error: error instanceof Error ? error : new Error(String(error)) });
    if (getErrorCode(error) === 'resource_already_exists') {
      return res.status(400).json({ error: 'A coupon with this ID already exists.' });
    }
    res.status(500).json({ error: 'Failed to create coupon' });
  }
});

router.put('/api/stripe/coupons/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    if (!id) {
      return res.status(400).json({ error: 'Coupon ID is required.' });
    }
    
    const { getStripeClient } = await import('../../core/stripe/client');
    const stripe = await getStripeClient();
    
    const coupon = await stripe.coupons.update(id as string, {
      name: name || undefined,
    });
    
    logger.info('[Stripe] Updated coupon - name: ""', { extra: { id, name } });
    logFromRequest(req, 'update_coupon', 'coupon', req.params.id as string, '', {});
    
    res.json({
      success: true,
      coupon: {
        id: coupon.id,
        name: coupon.name || coupon.id,
        percentOff: coupon.percent_off,
        amountOff: coupon.amount_off ? coupon.amount_off / 100 : null,
        amountOffCents: coupon.amount_off,
        currency: coupon.currency,
        duration: coupon.duration,
        durationInMonths: coupon.duration_in_months,
        valid: coupon.valid,
      },
    });
  } catch (error: unknown) {
    logger.error('[Stripe] Error updating coupon', { error: error instanceof Error ? error : new Error(String(error)) });
    if (isStripeResourceMissing(error)) {
      return res.status(404).json({ error: 'Coupon not found.' });
    }
    res.status(500).json({ error: 'Failed to update coupon' });
  }
});

router.delete('/api/stripe/coupons/:id', isAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    if (!id) {
      return res.status(400).json({ error: 'Coupon ID is required.' });
    }
    
    const { getStripeClient } = await import('../../core/stripe/client');
    const stripe = await getStripeClient();
    
    await stripe.coupons.del(id as string);
    
    logger.info('[Stripe] Deleted coupon', { extra: { id } });
    logFromRequest(req, 'delete_coupon', 'coupon', req.params.id as string, '', {});
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('[Stripe] Error deleting coupon', { error: error instanceof Error ? error : new Error(String(error)) });
    if (isStripeResourceMissing(error)) {
      return res.status(404).json({ error: 'Coupon not found.' });
    }
    res.status(500).json({ error: 'Failed to delete coupon' });
  }
});

router.post('/api/stripe/promo-codes/seed-welcome', isAdmin, async (req: Request, res: Response) => {
  try {
    const { seedWelcomePromoCode } = await import('../../scripts/seedWelcomePromo');
    const result = await seedWelcomePromoCode();
    if (result.success) {
      logFromRequest(req, 'seed_promo_code', 'promo_code', result.promoCodeId || '', 'WELCOME50', {});
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: unknown) {
    logger.error('[Stripe] Error seeding welcome promo code', { error: error instanceof Error ? error : new Error(String(error)) });
    res.status(500).json({ error: 'Failed to seed welcome promo code' });
  }
});

export default router;
