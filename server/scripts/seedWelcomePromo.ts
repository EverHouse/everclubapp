import { getStripeClient } from '../core/stripe/client';
import { logger } from '../core/logger';
import { getErrorMessage, isStripeResourceMissing } from '../utils/errorUtils';
import Stripe from 'stripe';

const COUPON_ID = 'WELCOME_50PCT_FIRST_MONTH';
const PROMO_CODE = 'WELCOME50';

export async function seedWelcomePromoCode(): Promise<{ success: boolean; couponId?: string; promoCodeId?: string; error?: string }> {
  try {
    const stripe = await getStripeClient();

    let couponExists = false;
    try {
      await stripe.coupons.retrieve(COUPON_ID);
      couponExists = true;
      logger.info(`[Seed] Coupon ${COUPON_ID} already exists`);
    } catch (err: unknown) {
      if (!isStripeResourceMissing(err)) throw err;
    }

    if (!couponExists) {
      await stripe.coupons.create({
        id: COUPON_ID,
        percent_off: 50,
        duration: 'once',
        name: '50% Off First Month',
        metadata: {
          source: 'self_serve_seed',
          description: 'Welcome offer - 50% off first month for new members',
        },
      });
      logger.info(`[Seed] Created coupon ${COUPON_ID}`);
    }

    const existingPromos = await stripe.promotionCodes.list({
      coupon: COUPON_ID,
      code: PROMO_CODE,
      limit: 1,
    });

    if (existingPromos.data.length > 0) {
      logger.info(`[Seed] Promotion code ${PROMO_CODE} already exists: ${existingPromos.data[0].id}`);
      return { success: true, couponId: COUPON_ID, promoCodeId: existingPromos.data[0].id };
    }

    const promoCode = await stripe.promotionCodes.create({
      coupon: COUPON_ID,
      code: PROMO_CODE,
      active: true,
      metadata: {
        source: 'self_serve_seed',
        description: 'Self-serve join page welcome discount',
      },
    } as unknown as Stripe.PromotionCodeCreateParams);

    logger.info(`[Seed] Created promotion code ${PROMO_CODE}: ${promoCode.id}`);
    return { success: true, couponId: COUPON_ID, promoCodeId: promoCode.id };
  } catch (error: unknown) {
    logger.error('[Seed] Failed to seed welcome promo code', { extra: { error: getErrorMessage(error) } });
    return { success: false, error: getErrorMessage(error) };
  }
}
