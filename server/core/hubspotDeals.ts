import { db } from '../db';
import { pool, isProduction } from './db';
import { getHubSpotClient } from './integrations';
import { 
  hubspotDeals, 
  hubspotLineItems, 
  hubspotProductMappings, 
  discountRules,
  billingAuditLog 
} from '../../shared/schema';
import { eq, and, inArray } from 'drizzle-orm';
import pRetry, { AbortError } from 'p-retry';

const MEMBERSHIP_PIPELINE_ID = process.env.HUBSPOT_MEMBERSHIP_PIPELINE_ID || 'default';

const MINDBODY_TO_STAGE_MAP: Record<string, string> = {
  'active': 'active_member',
  'pending': 'pending',
  'declined': 'payment_declined',
  'suspended': 'payment_declined',
  'expired': 'churned',
  'terminated': 'churned',
  'cancelled': 'churned',
  'froze': 'payment_declined',
  'non-member': 'churned',
};

function isRateLimitError(error: any): boolean {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const statusCode = error?.response?.statusCode || error?.status || error?.code;
  return (
    statusCode === 429 ||
    errorMsg.includes("429") ||
    errorMsg.includes("RATELIMIT_EXCEEDED") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

async function retryableHubSpotRequest<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error: any) {
        if (isRateLimitError(error)) {
          if (!isProduction) console.warn('HubSpot Rate Limit hit, retrying...');
          throw error;
        }
        throw new AbortError(error);
      }
    },
    {
      retries: 5,
      minTimeout: 1000,
      maxTimeout: 30000,
      factor: 2
    }
  );
}

export async function getContactDeals(hubspotContactId: string): Promise<any[]> {
  try {
    const hubspot = await getHubSpotClient();
    const response = await retryableHubSpotRequest(() =>
      hubspot.crm.contacts.associationsApi.getAll(hubspotContactId, 'deals')
    );
    
    if (!response.results || response.results.length === 0) {
      return [];
    }
    
    const dealIds = response.results.map((r: any) => r.id);
    const deals = await Promise.all(
      dealIds.map((id: string) =>
        retryableHubSpotRequest(() =>
          hubspot.crm.deals.basicApi.getById(id, [
            'dealname',
            'pipeline',
            'dealstage',
            'amount',
            'closedate',
            'createdate'
          ])
        )
      )
    );
    
    return deals;
  } catch (error) {
    console.error('[HubSpotDeals] Error fetching contact deals:', error);
    return [];
  }
}

export async function updateDealStage(
  hubspotDealId: string,
  newStage: string,
  performedBy: string,
  performedByName?: string
): Promise<boolean> {
  try {
    const hubspot = await getHubSpotClient();
    
    const existingDeal = await db.select()
      .from(hubspotDeals)
      .where(eq(hubspotDeals.hubspotDealId, hubspotDealId))
      .limit(1);
    
    const previousStage = existingDeal[0]?.pipelineStage || null;
    
    await retryableHubSpotRequest(() =>
      hubspot.crm.deals.basicApi.update(hubspotDealId, {
        properties: {
          dealstage: newStage
        }
      })
    );
    
    await db.update(hubspotDeals)
      .set({
        pipelineStage: newStage,
        lastStageSyncAt: new Date(),
        lastSyncError: null,
        updatedAt: new Date()
      })
      .where(eq(hubspotDeals.hubspotDealId, hubspotDealId));
    
    if (existingDeal[0]) {
      await db.insert(billingAuditLog).values({
        memberEmail: existingDeal[0].memberEmail,
        hubspotDealId,
        actionType: 'stage_changed',
        previousValue: previousStage,
        newValue: newStage,
        performedBy,
        performedByName
      });
    }
    
    if (!isProduction) console.log(`[HubSpotDeals] Updated deal ${hubspotDealId} to stage ${newStage}`);
    return true;
  } catch (error: any) {
    console.error('[HubSpotDeals] Error updating deal stage:', error);
    
    await db.update(hubspotDeals)
      .set({
        lastSyncError: error.message || 'Unknown error',
        updatedAt: new Date()
      })
      .where(eq(hubspotDeals.hubspotDealId, hubspotDealId));
    
    return false;
  }
}

export async function syncDealStageFromMindbodyStatus(
  memberEmail: string,
  mindbodyStatus: string,
  performedBy: string = 'system',
  performedByName?: string
): Promise<{ success: boolean; dealId?: string; newStage?: string }> {
  try {
    const normalizedStatus = mindbodyStatus.toLowerCase().replace(/[^a-z-]/g, '');
    const targetStage = MINDBODY_TO_STAGE_MAP[normalizedStatus];
    
    if (!targetStage) {
      if (!isProduction) console.log(`[HubSpotDeals] No stage mapping for status: ${mindbodyStatus}`);
      return { success: false };
    }
    
    const existingDeal = await db.select()
      .from(hubspotDeals)
      .where(eq(hubspotDeals.memberEmail, memberEmail.toLowerCase()))
      .limit(1);
    
    if (existingDeal.length === 0) {
      if (!isProduction) console.log(`[HubSpotDeals] No deal found for member: ${memberEmail}`);
      return { success: false };
    }
    
    const deal = existingDeal[0];
    
    if (deal.pipelineStage === targetStage && deal.lastKnownMindbodyStatus === normalizedStatus) {
      return { success: true, dealId: deal.hubspotDealId, newStage: targetStage };
    }
    
    await db.update(hubspotDeals)
      .set({
        lastKnownMindbodyStatus: normalizedStatus,
        updatedAt: new Date()
      })
      .where(eq(hubspotDeals.id, deal.id));
    
    const updated = await updateDealStage(deal.hubspotDealId, targetStage, performedBy, performedByName);
    
    return { success: updated, dealId: deal.hubspotDealId, newStage: targetStage };
  } catch (error) {
    console.error('[HubSpotDeals] Error syncing deal stage from Mindbody:', error);
    return { success: false };
  }
}

export async function getApplicableDiscounts(memberTags: string[]): Promise<{ tag: string; percent: number }[]> {
  if (!memberTags || memberTags.length === 0) {
    return [];
  }
  
  const rules = await db.select()
    .from(discountRules)
    .where(and(
      inArray(discountRules.discountTag, memberTags),
      eq(discountRules.isActive, true)
    ));
  
  return rules.map(r => ({ tag: r.discountTag, percent: r.discountPercent }));
}

export async function calculateTotalDiscount(memberTags: string[]): Promise<{ totalPercent: number; appliedRules: string[] }> {
  const discounts = await getApplicableDiscounts(memberTags);
  
  if (discounts.length === 0) {
    return { totalPercent: 0, appliedRules: [] };
  }
  
  const maxDiscount = discounts.reduce((max, d) => d.percent > max.percent ? d : max, discounts[0]);
  
  return {
    totalPercent: Math.min(maxDiscount.percent, 100),
    appliedRules: [maxDiscount.tag]
  };
}

export async function getProductMapping(tierName?: string, productType?: string): Promise<any | null> {
  try {
    let query = db.select().from(hubspotProductMappings).where(eq(hubspotProductMappings.isActive, true));
    
    if (tierName) {
      const result = await db.select()
        .from(hubspotProductMappings)
        .where(and(
          eq(hubspotProductMappings.tierName, tierName),
          eq(hubspotProductMappings.isActive, true)
        ))
        .limit(1);
      return result[0] || null;
    }
    
    if (productType) {
      const result = await db.select()
        .from(hubspotProductMappings)
        .where(and(
          eq(hubspotProductMappings.productType, productType),
          eq(hubspotProductMappings.isActive, true)
        ));
      return result;
    }
    
    return null;
  } catch (error) {
    console.error('[HubSpotDeals] Error getting product mapping:', error);
    return null;
  }
}

export async function addLineItemToDeal(
  hubspotDealId: string,
  productId: string,
  quantity: number = 1,
  discountPercent: number = 0,
  discountReason?: string,
  createdBy?: string,
  createdByName?: string
): Promise<{ success: boolean; lineItemId?: string }> {
  try {
    const product = await db.select()
      .from(hubspotProductMappings)
      .where(eq(hubspotProductMappings.hubspotProductId, productId))
      .limit(1);
    
    if (product.length === 0) {
      console.error('[HubSpotDeals] Product not found:', productId);
      return { success: false };
    }
    
    const productInfo = product[0];
    const unitPrice = parseFloat(productInfo.unitPrice?.toString() || '0');
    const discountedPrice = unitPrice * (1 - discountPercent / 100);
    const totalAmount = discountedPrice * quantity;
    
    const hubspot = await getHubSpotClient();
    
    const lineItemResponse = await retryableHubSpotRequest(() =>
      hubspot.crm.lineItems.basicApi.create({
        properties: {
          hs_product_id: productId,
          quantity: String(quantity),
          price: String(discountedPrice),
          name: productInfo.productName,
          ...(discountPercent > 0 && { discount: String(discountPercent) })
        }
      })
    );
    
    const lineItemId = lineItemResponse.id;
    
    await retryableHubSpotRequest(() =>
      hubspot.crm.lineItems.associationsApi.create(
        lineItemId,
        'deals',
        hubspotDealId,
        [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 20 }]
      )
    );
    
    await db.insert(hubspotLineItems).values({
      hubspotDealId,
      hubspotLineItemId: lineItemId,
      hubspotProductId: productId,
      productName: productInfo.productName,
      quantity,
      unitPrice: productInfo.unitPrice,
      discountPercent,
      discountReason,
      totalAmount: String(totalAmount),
      status: 'synced',
      createdBy,
      createdByName
    });
    
    const deal = await db.select()
      .from(hubspotDeals)
      .where(eq(hubspotDeals.hubspotDealId, hubspotDealId))
      .limit(1);
    
    if (deal[0] && createdBy) {
      await db.insert(billingAuditLog).values({
        memberEmail: deal[0].memberEmail,
        hubspotDealId,
        actionType: 'line_item_added',
        actionDetails: {
          productId,
          productName: productInfo.productName,
          quantity,
          unitPrice,
          discountPercent,
          discountReason,
          totalAmount
        },
        newValue: `${productInfo.productName} x${quantity} @ $${discountedPrice}`,
        performedBy: createdBy,
        performedByName
      });
    }
    
    if (!isProduction) console.log(`[HubSpotDeals] Added line item ${lineItemId} to deal ${hubspotDealId}`);
    return { success: true, lineItemId };
  } catch (error: any) {
    console.error('[HubSpotDeals] Error adding line item:', error);
    return { success: false };
  }
}

export async function removeLineItemFromDeal(
  lineItemId: string,
  performedBy: string,
  performedByName?: string
): Promise<boolean> {
  try {
    const lineItem = await db.select()
      .from(hubspotLineItems)
      .where(eq(hubspotLineItems.hubspotLineItemId, lineItemId))
      .limit(1);
    
    if (lineItem.length === 0) {
      console.error('[HubSpotDeals] Line item not found:', lineItemId);
      return false;
    }
    
    const hubspot = await getHubSpotClient();
    
    await retryableHubSpotRequest(() =>
      hubspot.crm.lineItems.basicApi.archive(lineItemId)
    );
    
    await db.delete(hubspotLineItems)
      .where(eq(hubspotLineItems.hubspotLineItemId, lineItemId));
    
    const deal = await db.select()
      .from(hubspotDeals)
      .where(eq(hubspotDeals.hubspotDealId, lineItem[0].hubspotDealId))
      .limit(1);
    
    if (deal[0]) {
      await db.insert(billingAuditLog).values({
        memberEmail: deal[0].memberEmail,
        hubspotDealId: lineItem[0].hubspotDealId,
        actionType: 'line_item_removed',
        actionDetails: {
          productName: lineItem[0].productName,
          quantity: lineItem[0].quantity,
          unitPrice: lineItem[0].unitPrice
        },
        previousValue: `${lineItem[0].productName} x${lineItem[0].quantity}`,
        performedBy,
        performedByName
      });
    }
    
    if (!isProduction) console.log(`[HubSpotDeals] Removed line item ${lineItemId}`);
    return true;
  } catch (error) {
    console.error('[HubSpotDeals] Error removing line item:', error);
    return false;
  }
}

export async function getMemberDealWithLineItems(memberEmail: string): Promise<any | null> {
  try {
    const deal = await db.select()
      .from(hubspotDeals)
      .where(eq(hubspotDeals.memberEmail, memberEmail.toLowerCase()))
      .limit(1);
    
    if (deal.length === 0) {
      return null;
    }
    
    const lineItems = await db.select()
      .from(hubspotLineItems)
      .where(eq(hubspotLineItems.hubspotDealId, deal[0].hubspotDealId));
    
    return {
      ...deal[0],
      lineItems
    };
  } catch (error) {
    console.error('[HubSpotDeals] Error fetching member deal:', error);
    return null;
  }
}

export async function getAllProductMappings(): Promise<any[]> {
  try {
    const products = await db.select().from(hubspotProductMappings).orderBy(hubspotProductMappings.productType);
    return products;
  } catch (error) {
    console.error('[HubSpotDeals] Error fetching product mappings:', error);
    return [];
  }
}

export async function getAllDiscountRules(): Promise<any[]> {
  try {
    const rules = await db.select().from(discountRules).orderBy(discountRules.discountPercent);
    return rules;
  } catch (error) {
    console.error('[HubSpotDeals] Error fetching discount rules:', error);
    return [];
  }
}

export async function updateDiscountRule(
  discountTag: string,
  discountPercent: number,
  description?: string
): Promise<boolean> {
  try {
    await db.update(discountRules)
      .set({
        discountPercent,
        description,
        updatedAt: new Date()
      })
      .where(eq(discountRules.discountTag, discountTag));
    
    return true;
  } catch (error) {
    console.error('[HubSpotDeals] Error updating discount rule:', error);
    return false;
  }
}

export async function getBillingAuditLog(memberEmail: string, limit: number = 50): Promise<any[]> {
  try {
    const result = await pool.query(
      `SELECT * FROM billing_audit_log 
       WHERE member_email = $1 
       ORDER BY created_at DESC 
       LIMIT $2`,
      [memberEmail.toLowerCase(), limit]
    );
    return result.rows;
  } catch (error) {
    console.error('[HubSpotDeals] Error fetching billing audit log:', error);
    return [];
  }
}
