import { db } from '../../db';
import { pool } from '../db';
import { hubspotDeals, hubspotLineItems, billingAuditLog } from '../../../shared/schema';
import { eq } from 'drizzle-orm';
import { getHubSpotClient } from '../integrations';

export interface SyncPaymentParams {
  email: string;
  amountCents: number;
  purpose: string;
  description: string;
  paymentIntentId: string;
}

export async function syncPaymentToHubSpot(params: SyncPaymentParams): Promise<void> {
  const { email, amountCents, purpose, description, paymentIntentId } = params;

  const deal = await db.select()
    .from(hubspotDeals)
    .where(eq(hubspotDeals.memberEmail, email.toLowerCase()))
    .limit(1);

  if (deal.length === 0) {
    console.log(`[Stripe->HubSpot] No deal found for ${email}, skipping HubSpot sync`);
    return;
  }

  const memberDeal = deal[0];
  const hubspotDealId = memberDeal.hubspotDealId;

  const productResult = await pool.query(
    `SELECT hubspot_product_id, product_name FROM hubspot_product_mappings 
     WHERE product_type = $1 AND is_active = true 
     LIMIT 1`,
    [purpose === 'guest_fee' ? 'pass' : 'fee']
  );

  let productId: string | null = null;
  let productName = description;

  if (productResult.rows.length > 0) {
    productId = productResult.rows[0].hubspot_product_id;
    productName = productResult.rows[0].product_name;
  }

  try {
    const hubspot = await getHubSpotClient();
    
    const unitPrice = amountCents / 100;
    
    const lineItemProperties: any = {
      quantity: '1',
      price: String(unitPrice),
      name: productName,
    };

    if (productId) {
      lineItemProperties.hs_product_id = productId;
    }

    const lineItemResponse = await hubspot.crm.lineItems.basicApi.create({
      properties: lineItemProperties
    });

    const lineItemId = lineItemResponse.id;

    await hubspot.crm.associations.v4.basicApi.create(
      'line_items',
      lineItemId,
      'deals',
      hubspotDealId,
      [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 20 }]
    );

    await db.insert(hubspotLineItems).values({
      hubspotDealId,
      hubspotLineItemId: lineItemId,
      hubspotProductId: productId || 'stripe_payment',
      productName,
      quantity: 1,
      unitPrice: String(unitPrice),
      discountPercent: 0,
      totalAmount: String(unitPrice),
      status: 'synced',
      createdBy: 'stripe_webhook',
      createdByName: 'Stripe Payment'
    });

    await db.insert(billingAuditLog).values({
      memberEmail: email,
      hubspotDealId,
      actionType: 'stripe_payment_synced_to_hubspot',
      actionDetails: {
        paymentIntentId,
        amountCents,
        purpose,
        lineItemId,
        productId
      },
      newValue: `Synced Stripe payment of $${unitPrice.toFixed(2)} to HubSpot`,
      performedBy: 'stripe_webhook',
      performedByName: 'Stripe Webhook'
    });

    console.log(`[Stripe->HubSpot] Synced payment ${paymentIntentId} to deal ${hubspotDealId} as line item ${lineItemId}`);
  } catch (error) {
    console.error('[Stripe->HubSpot] Error syncing payment:', error);
    throw error;
  }
}
