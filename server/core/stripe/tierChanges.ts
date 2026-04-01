import Stripe from 'stripe';
import { getStripeClient } from './client';
import { db } from '../../db';
import { membershipTiers, memberNotes } from '../../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { changeSubscriptionTier } from './subscriptions';
import { syncCustomerMetadataToStripe } from './customers';
import { getErrorMessage } from '../../utils/errorUtils';
import { queueJob } from '../jobQueue';

import { logger } from '../logger';
export interface TierChangePreview {
  currentTier: string;
  currentPriceId: string;
  currentAmountCents: number;
  newTier: string;
  newPriceId: string;
  newAmountCents: number;
  prorationAmountCents: number;
  nextInvoiceAmountCents: number;
  effectiveDate: Date;
  isImmediate: boolean;
}

export async function previewTierChange(
  subscriptionId: string,
  newPriceId: string,
  immediate: boolean = true
): Promise<{ success: boolean; preview?: TierChangePreview; error?: string }> {
  try {
    const stripe = await getStripeClient();
    
    // Get current subscription
    const sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['items.data.price.product']
    });
    
    const currentItem = sub.items.data[0];
    const currentPrice = currentItem.price;
    const currentProduct = currentPrice.product as Stripe.Product;
    
    // Get new price details
    const newPrice = await stripe.prices.retrieve(newPriceId, { expand: ['product'] });
    const newProduct = newPrice.product as Stripe.Product;
    
    if (immediate) {
      // Use createPreview to preview proration (replaces deprecated retrieveUpcoming)
      const previewInvoice = await stripe.invoices.createPreview({
        customer: sub.customer as string,
        subscription: subscriptionId,
        subscription_details: {
          items: [{ id: currentItem.id, price: newPriceId }],
          proration_behavior: 'always_invoice',
        },
      });
      
      // Calculate proration from invoice line items
      let prorationAmount = 0;
      for (const line of previewInvoice.lines.data) {
        if ((line as Stripe.InvoiceLineItem & { proration?: boolean }).proration) {
          prorationAmount += line.amount;
        }
      }
      
      return {
        success: true,
        preview: {
          currentTier: currentProduct.name,
          currentPriceId: currentPrice.id,
          currentAmountCents: currentPrice.unit_amount || 0,
          newTier: newProduct.name,
          newPriceId: newPriceId,
          newAmountCents: newPrice.unit_amount || 0,
          prorationAmountCents: prorationAmount,
          nextInvoiceAmountCents: previewInvoice.amount_due,
          effectiveDate: new Date(),
          isImmediate: true,
        }
      };
    } else {
      // End of cycle change - no proration
      return {
        success: true,
        preview: {
          currentTier: currentProduct.name,
          currentPriceId: currentPrice.id,
          currentAmountCents: currentPrice.unit_amount || 0,
          newTier: newProduct.name,
          newPriceId: newPriceId,
          newAmountCents: newPrice.unit_amount || 0,
          prorationAmountCents: 0,
          nextInvoiceAmountCents: newPrice.unit_amount || 0,
          effectiveDate: new Date((sub.items.data[0]?.current_period_end || 0) * 1000),
          isImmediate: false,
        }
      };
    }
  } catch (error: unknown) {
    logger.error('[Tier Change] Preview error:', { extra: { error: getErrorMessage(error) } });
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function commitTierChange(
  memberEmail: string,
  subscriptionId: string,
  newPriceId: string,
  immediate: boolean,
  staffEmail: string
): Promise<{ success: boolean; error?: string; warning?: string }> {
  try {
    const stripe = await getStripeClient();
    
    // Get current subscription to find current price ID
    const currentSub = await stripe.subscriptions.retrieve(subscriptionId);
    const currentPriceId = currentSub.items.data[0]?.price?.id;
    
    // Look up current tier from DB using price ID (consistent naming)
    let currentTierName = 'Unknown';
    if (currentPriceId) {
      const currentTierResult = await db.execute(
        sql`SELECT name FROM membership_tiers WHERE stripe_price_id = ${currentPriceId} OR founding_price_id = ${currentPriceId}`
      );
      if (currentTierResult.rows.length > 0) {
        currentTierName = String((currentTierResult.rows[0] as { name: string }).name);
      }
    }
    
    // Find new tier in DB
    const tier = await db.query.membershipTiers.findFirst({
      where: eq(membershipTiers.stripePriceId, newPriceId)
    });
    
    if (!tier) {
      return { success: false, error: 'New tier not found in database' };
    }
    
    // Change subscription in Stripe
    const result = await changeSubscriptionTier(subscriptionId, newPriceId, immediate);
    if (!result.success) {
      return result;
    }
    
    const changeType = immediate ? 'immediately' : 'at end of billing cycle';
    const noteContent = `Membership tier changed from ${currentTierName} to ${tier.name} (${changeType}). Changed by staff: ${staffEmail}`;

    try {
      await db.transaction(async (tx) => {
        if (immediate) {
          await tx.execute(
            sql`UPDATE users SET tier = ${tier.name}, updated_at = NOW() WHERE LOWER(email) = LOWER(${memberEmail})`
          );
        }

        await tx.insert(memberNotes).values({
          memberEmail: memberEmail.toLowerCase(),
          content: noteContent,
          createdBy: staffEmail,
          createdByName: staffEmail.split('@')[0] || 'Staff',
          isPinned: false,
        });
      });
    } catch (txError) {
      logger.error('[Tier Change] CRITICAL: DB transaction failed after Stripe subscription was already updated', {
        extra: {
          memberEmail,
          subscriptionId,
          newTier: tier.name,
          error: getErrorMessage(txError),
        },
      });

      let reconciliationQueued = false;
      try {
        await queueJob('tier_change_reconciliation', {
          memberEmail,
          expectedTier: tier.name,
          subscriptionId,
          staffEmail,
          currentTierName,
          immediate,
          failedAt: new Date().toISOString(),
          reason: getErrorMessage(txError),
        }, { priority: 10, maxRetries: 5 });
        reconciliationQueued = true;
        logger.info(`[Tier Change] Reconciliation job queued for ${memberEmail}`);
      } catch (queueError) {
        logger.error('[Tier Change] CRITICAL: Failed to queue reconciliation job', {
          extra: { memberEmail, error: getErrorMessage(queueError) },
        });
      }

      return {
        success: false,
        error: reconciliationQueued
          ? `Stripe updated but DB write failed. A reconciliation job has been queued. Details: ${getErrorMessage(txError)}`
          : `Stripe updated but DB write failed. Reconciliation queue also failed — manual intervention required. Details: ${getErrorMessage(txError)}`,
      };
    }

    if (immediate) {
      await syncCustomerMetadataToStripe(memberEmail);

      try {
        const { syncMemberToHubSpot } = await import('../hubspot/stages');
        await syncMemberToHubSpot({ email: memberEmail, tier: tier.name, billingProvider: 'stripe' });
        logger.info(`[TierChange] Synced ${memberEmail} tier=${tier.name} to HubSpot`);
      } catch (hubspotError) {
        logger.error('[TierChange] HubSpot sync failed:', { extra: { error: getErrorMessage(hubspotError) } });
      }
    }
    
    logger.info(`[Tier Change] Staff ${staffEmail} changed ${memberEmail} from ${currentTierName} to ${tier.name} (${changeType})`);
    
    return { success: true };
  } catch (error: unknown) {
    logger.error('[Tier Change] Commit error:', { extra: { error: getErrorMessage(error) } });
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getAvailableTiersForChange(): Promise<Array<{
  id: number;
  name: string;
  slug: string;
  priceCents: number;
  stripePriceId: string;
  billingInterval: string;
}>> {
  const tiers = await db.select({
    id: membershipTiers.id,
    name: membershipTiers.name,
    slug: membershipTiers.slug,
    priceCents: membershipTiers.priceCents,
    stripePriceId: membershipTiers.stripePriceId,
    billingInterval: membershipTiers.billingInterval,
    productType: membershipTiers.productType,
  })
  .from(membershipTiers)
  .where(eq(membershipTiers.isActive, true));
  
  // Only return subscription tiers with Stripe price IDs
  return tiers
    .filter(t => t.stripePriceId && t.productType !== 'one_time')
    .map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      priceCents: t.priceCents || 0,
      stripePriceId: t.stripePriceId!,
      billingInterval: t.billingInterval || 'month',
    }));
}
