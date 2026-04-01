import { logger } from '../logger';
import { db } from '../../db';
import { dayPassPurchases } from '../../../shared/schema';
import { eq } from 'drizzle-orm';
import { upsertVisitor, linkPurchaseToUser } from '../visitors/matchingService';
import { findOrCreateHubSpotContact } from '../hubspot/members';
import { getErrorMessage } from '../../utils/errorUtils';

export async function recordDayPassPurchaseFromWebhook(data: {
  productSlug: string;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  amountCents: number;
  paymentIntentId: string;
  customerId: string | null;
}): Promise<{ success: boolean; purchaseId?: string; userId?: string; quantity?: number; remainingUses?: number; error?: string }> {
  try {
    const existingPurchase = await db.select()
      .from(dayPassPurchases)
      .where(eq(dayPassPurchases.stripePaymentIntentId, data.paymentIntentId))
      .limit(1);

    if (existingPurchase.length > 0) {
      logger.info('[DayPasses] Purchase already recorded for payment', { extra: { dataPaymentIntentId: data.paymentIntentId } });
      return { 
        success: true, 
        purchaseId: existingPurchase[0].id, 
        userId: existingPurchase[0].userId || undefined,
        quantity: existingPurchase[0].quantity ?? 1,
        remainingUses: existingPurchase[0].remainingUses ?? 1
      };
    }

    const user = await upsertVisitor({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone
    });

    let purchase;
    try {
      [purchase] = await db
        .insert(dayPassPurchases)
        .values({
          userId: user.id,
          productType: data.productSlug,
          amountCents: data.amountCents,
          quantity: 1,
          stripePaymentIntentId: data.paymentIntentId,
          stripeCustomerId: data.customerId,
          purchaserEmail: data.email,
          purchaserFirstName: data.firstName,
          purchaserLastName: data.lastName,
          purchaserPhone: data.phone,
          source: 'stripe',
          purchasedAt: new Date()
        })
        .returning();
    } catch (insertErr: unknown) {
      if (String(insertErr).includes('day_pass_purchases_stripe_pi_unique')) {
        const existing = await db.select()
          .from(dayPassPurchases)
          .where(eq(dayPassPurchases.stripePaymentIntentId, data.paymentIntentId))
          .limit(1);
        if (existing.length > 0) {
          logger.info('[DayPasses Webhook] Duplicate insert caught by unique constraint', { extra: { paymentIntentId: data.paymentIntentId } });
          return {
            success: true,
            purchaseId: existing[0].id,
            userId: existing[0].userId || undefined,
            quantity: existing[0].quantity ?? 1,
            remainingUses: existing[0].remainingUses ?? 1
          };
        }
      }
      throw insertErr;
    }

    if (user.id) {
      await linkPurchaseToUser(purchase.id, user.id);
    }

    findOrCreateHubSpotContact(data.email, data.firstName || '', data.lastName || '', data.phone || undefined, undefined, { role: 'day-pass' }).catch((err) => {
      logger.error('[DayPasses] Background HubSpot sync for day-pass buyer failed', { extra: { error: getErrorMessage(err) } });
    });

    logger.info('[DayPasses Webhook] Recorded purchase for : $ from', { extra: { purchaseId: purchase.id, dataProductSlug: data.productSlug, dataAmountCents_100_ToFixed_2: (data.amountCents / 100).toFixed(2), dataEmail: data.email } });

    return { 
      success: true, 
      purchaseId: purchase.id, 
      userId: user.id,
      quantity: purchase.quantity ?? 1,
      remainingUses: purchase.remainingUses ?? 1
    };
  } catch (error: unknown) {
    logger.error('[DayPasses Webhook] Error recording purchase', { extra: { error: getErrorMessage(error) } });
    return { success: false, error: getErrorMessage(error) };
  }
}
