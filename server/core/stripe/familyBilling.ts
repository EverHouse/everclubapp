import { pool } from '../db';
import { db } from '../../db';
import { familyGroups, familyMembers, familyAddOnProducts } from '../../../shared/models/hubspot-billing';
import { eq, and } from 'drizzle-orm';
import { getStripeClient } from './client';
import Stripe from 'stripe';

export interface FamilyGroupWithMembers {
  id: number;
  primaryEmail: string;
  primaryName: string;
  groupName: string | null;
  stripeSubscriptionId: string | null;
  members: FamilyMemberInfo[];
  totalMonthlyAmount: number;
  isActive: boolean;
}

export interface FamilyMemberInfo {
  id: number;
  memberEmail: string;
  memberName: string;
  memberTier: string;
  relationship: string | null;
  addOnPriceCents: number;
  isActive: boolean;
  addedAt: Date | null;
}

export async function syncFamilyAddOnProductsToStripe(): Promise<{
  success: boolean;
  synced: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let synced = 0;

  try {
    const stripe = await getStripeClient();
    
    const addOnProducts = await db.select().from(familyAddOnProducts).where(eq(familyAddOnProducts.isActive, true));
    
    for (const product of addOnProducts) {
      try {
        let stripeProductId = product.stripeProductId;
        let stripePriceId = product.stripePriceId;
        
        if (!stripeProductId) {
          const stripeProduct = await stripe.products.create({
            name: product.displayName || `Family Add-on - ${product.tierName}`,
            description: product.description || `Family add-on membership for ${product.tierName} tier`,
            metadata: {
              family_addon: 'true',
              tier_name: product.tierName,
            },
          });
          stripeProductId = stripeProduct.id;
        }
        
        if (!stripePriceId) {
          const stripePrice = await stripe.prices.create({
            product: stripeProductId,
            unit_amount: product.priceCents,
            currency: 'usd',
            recurring: {
              interval: (product.billingInterval || 'month') as 'month' | 'year',
            },
            metadata: {
              family_addon: 'true',
              tier_name: product.tierName,
            },
          });
          stripePriceId = stripePrice.id;
        }
        
        await db.update(familyAddOnProducts)
          .set({
            stripeProductId,
            stripePriceId,
            updatedAt: new Date(),
          })
          .where(eq(familyAddOnProducts.id, product.id));
        
        synced++;
      } catch (err: any) {
        errors.push(`Failed to sync ${product.tierName}: ${err.message}`);
      }
    }
    
    return { success: errors.length === 0, synced, errors };
  } catch (err: any) {
    return { success: false, synced, errors: [err.message] };
  }
}

export async function getFamilyAddOnProducts(): Promise<typeof familyAddOnProducts.$inferSelect[]> {
  return db.select().from(familyAddOnProducts).where(eq(familyAddOnProducts.isActive, true));
}

export async function getFamilyGroupByPrimaryEmail(primaryEmail: string): Promise<FamilyGroupWithMembers | null> {
  const group = await db.select()
    .from(familyGroups)
    .where(eq(familyGroups.primaryEmail, primaryEmail.toLowerCase()))
    .limit(1);
  
  if (group.length === 0) return null;
  
  const familyGroup = group[0];
  
  const members = await db.select()
    .from(familyMembers)
    .where(and(
      eq(familyMembers.familyGroupId, familyGroup.id),
      eq(familyMembers.isActive, true)
    ));
  
  const primaryUserResult = await pool.query(
    'SELECT first_name, last_name FROM users WHERE LOWER(email) = $1',
    [primaryEmail.toLowerCase()]
  );
  const primaryName = primaryUserResult.rows[0] 
    ? `${primaryUserResult.rows[0].first_name || ''} ${primaryUserResult.rows[0].last_name || ''}`.trim()
    : primaryEmail;
  
  const memberInfos: FamilyMemberInfo[] = [];
  for (const member of members) {
    const memberUserResult = await pool.query(
      'SELECT first_name, last_name FROM users WHERE LOWER(email) = $1',
      [member.memberEmail.toLowerCase()]
    );
    const memberName = memberUserResult.rows[0]
      ? `${memberUserResult.rows[0].first_name || ''} ${memberUserResult.rows[0].last_name || ''}`.trim()
      : member.memberEmail;
    
    memberInfos.push({
      id: member.id,
      memberEmail: member.memberEmail,
      memberName,
      memberTier: member.memberTier,
      relationship: member.relationship,
      addOnPriceCents: member.addOnPriceCents || 0,
      isActive: member.isActive ?? true,
      addedAt: member.addedAt,
    });
  }
  
  const totalMonthlyAmount = memberInfos.reduce((sum, m) => sum + m.addOnPriceCents, 0);
  
  return {
    id: familyGroup.id,
    primaryEmail: familyGroup.primaryEmail,
    primaryName,
    groupName: familyGroup.groupName,
    stripeSubscriptionId: familyGroup.primaryStripeSubscriptionId,
    members: memberInfos,
    totalMonthlyAmount,
    isActive: familyGroup.isActive ?? true,
  };
}

export async function getFamilyGroupByMemberEmail(memberEmail: string): Promise<FamilyGroupWithMembers | null> {
  const member = await db.select()
    .from(familyMembers)
    .where(and(
      eq(familyMembers.memberEmail, memberEmail.toLowerCase()),
      eq(familyMembers.isActive, true)
    ))
    .limit(1);
  
  if (member.length === 0) {
    const asGroup = await getFamilyGroupByPrimaryEmail(memberEmail);
    return asGroup;
  }
  
  const group = await db.select()
    .from(familyGroups)
    .where(eq(familyGroups.id, member[0].familyGroupId))
    .limit(1);
  
  if (group.length === 0) return null;
  
  return getFamilyGroupByPrimaryEmail(group[0].primaryEmail);
}

export async function createFamilyGroup(params: {
  primaryEmail: string;
  groupName?: string;
  createdBy: string;
  createdByName: string;
}): Promise<{ success: boolean; groupId?: number; error?: string }> {
  try {
    const existingGroup = await db.select()
      .from(familyGroups)
      .where(eq(familyGroups.primaryEmail, params.primaryEmail.toLowerCase()))
      .limit(1);
    
    if (existingGroup.length > 0) {
      return { success: false, error: 'A family group already exists for this member' };
    }
    
    const primaryUserResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE LOWER(email) = $1',
      [params.primaryEmail.toLowerCase()]
    );
    
    const stripeCustomerId = primaryUserResult.rows[0]?.stripe_customer_id || null;
    
    const result = await db.insert(familyGroups).values({
      primaryEmail: params.primaryEmail.toLowerCase(),
      primaryStripeCustomerId: stripeCustomerId,
      groupName: params.groupName || null,
      createdBy: params.createdBy,
      createdByName: params.createdByName,
    }).returning({ id: familyGroups.id });
    
    await pool.query(
      'UPDATE users SET family_group_id = $1, is_family_primary = true WHERE LOWER(email) = $2',
      [result[0].id, params.primaryEmail.toLowerCase()]
    );
    
    return { success: true, groupId: result[0].id };
  } catch (err: any) {
    console.error('[FamilyBilling] Error creating family group:', err);
    return { success: false, error: err.message };
  }
}

export async function addFamilyMember(params: {
  familyGroupId: number;
  memberEmail: string;
  memberTier: string;
  relationship?: string;
  addedBy: string;
  addedByName: string;
}): Promise<{ success: boolean; memberId?: number; error?: string }> {
  try {
    const existingMember = await db.select()
      .from(familyMembers)
      .where(and(
        eq(familyMembers.memberEmail, params.memberEmail.toLowerCase()),
        eq(familyMembers.isActive, true)
      ))
      .limit(1);
    
    if (existingMember.length > 0) {
      return { success: false, error: 'This member is already part of a family group' };
    }
    
    const addOnProduct = await db.select()
      .from(familyAddOnProducts)
      .where(eq(familyAddOnProducts.tierName, params.memberTier))
      .limit(1);
    
    if (addOnProduct.length === 0) {
      return { success: false, error: `No family add-on product found for tier: ${params.memberTier}` };
    }
    
    const product = addOnProduct[0];
    
    const group = await db.select()
      .from(familyGroups)
      .where(eq(familyGroups.id, params.familyGroupId))
      .limit(1);
    
    if (group.length === 0) {
      return { success: false, error: 'Family group not found' };
    }
    
    let stripeSubscriptionItemId: string | null = null;
    
    if (group[0].primaryStripeSubscriptionId && product.stripePriceId) {
      try {
        const stripe = await getStripeClient();
        const subscriptionItem = await stripe.subscriptionItems.create({
          subscription: group[0].primaryStripeSubscriptionId,
          price: product.stripePriceId,
          quantity: 1,
          metadata: {
            family_member_email: params.memberEmail.toLowerCase(),
            family_group_id: params.familyGroupId.toString(),
            tier: params.memberTier,
          },
        });
        stripeSubscriptionItemId = subscriptionItem.id;
      } catch (stripeErr: any) {
        console.error('[FamilyBilling] Error adding Stripe subscription item:', stripeErr);
        return { success: false, error: `Failed to add billing: ${stripeErr.message}` };
      }
    } else if (group[0].primaryStripeSubscriptionId && !product.stripePriceId) {
      return { success: false, error: 'Family add-on product not synced to Stripe. Please sync products first.' };
    }
    
    const result = await db.insert(familyMembers).values({
      familyGroupId: params.familyGroupId,
      memberEmail: params.memberEmail.toLowerCase(),
      memberTier: params.memberTier,
      relationship: params.relationship || null,
      stripeSubscriptionItemId,
      stripePriceId: product.stripePriceId,
      addOnPriceCents: product.priceCents,
      addedBy: params.addedBy,
      addedByName: params.addedByName,
    }).returning({ id: familyMembers.id });
    
    await pool.query(
      'UPDATE users SET family_group_id = $1, is_family_primary = false WHERE LOWER(email) = $2',
      [params.familyGroupId, params.memberEmail.toLowerCase()]
    );
    
    return { success: true, memberId: result[0].id };
  } catch (err: any) {
    console.error('[FamilyBilling] Error adding family member:', err);
    return { success: false, error: err.message };
  }
}

export async function removeFamilyMember(params: {
  memberId: number;
  removedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const member = await db.select()
      .from(familyMembers)
      .where(eq(familyMembers.id, params.memberId))
      .limit(1);
    
    if (member.length === 0) {
      return { success: false, error: 'Family member not found' };
    }
    
    const memberRecord = member[0];
    
    if (memberRecord.stripeSubscriptionItemId) {
      try {
        const stripe = await getStripeClient();
        await stripe.subscriptionItems.del(memberRecord.stripeSubscriptionItemId);
      } catch (stripeErr: any) {
        console.error('[FamilyBilling] Error removing Stripe subscription item:', stripeErr);
      }
    }
    
    await db.update(familyMembers)
      .set({
        isActive: false,
        removedAt: new Date(),
      })
      .where(eq(familyMembers.id, params.memberId));
    
    await pool.query(
      'UPDATE users SET family_group_id = NULL, is_family_primary = false WHERE LOWER(email) = $1',
      [memberRecord.memberEmail.toLowerCase()]
    );
    
    return { success: true };
  } catch (err: any) {
    console.error('[FamilyBilling] Error removing family member:', err);
    return { success: false, error: err.message };
  }
}

export async function linkStripeSubscriptionToFamilyGroup(params: {
  familyGroupId: number;
  stripeSubscriptionId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await db.update(familyGroups)
      .set({
        primaryStripeSubscriptionId: params.stripeSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(familyGroups.id, params.familyGroupId));
    
    return { success: true };
  } catch (err: any) {
    console.error('[FamilyBilling] Error linking subscription:', err);
    return { success: false, error: err.message };
  }
}

export async function updateFamilyAddOnPricing(params: {
  tierName: string;
  priceCents: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await db.select()
      .from(familyAddOnProducts)
      .where(eq(familyAddOnProducts.tierName, params.tierName))
      .limit(1);
    
    if (existing.length === 0) {
      await db.insert(familyAddOnProducts).values({
        tierName: params.tierName,
        priceCents: params.priceCents,
        displayName: `Family Add-on - ${params.tierName}`,
      });
    } else {
      const product = existing[0];
      
      if (product.stripeProductId) {
        try {
          const stripe = await getStripeClient();
          const newPrice = await stripe.prices.create({
            product: product.stripeProductId,
            unit_amount: params.priceCents,
            currency: 'usd',
            recurring: { interval: 'month' },
            metadata: {
              family_addon: 'true',
              tier_name: params.tierName,
            },
          });
          
          await db.update(familyAddOnProducts)
            .set({
              priceCents: params.priceCents,
              stripePriceId: newPrice.id,
              updatedAt: new Date(),
            })
            .where(eq(familyAddOnProducts.id, product.id));
        } catch (stripeErr: any) {
          console.error('[FamilyBilling] Error creating new Stripe price:', stripeErr);
          return { success: false, error: stripeErr.message };
        }
      } else {
        await db.update(familyAddOnProducts)
          .set({
            priceCents: params.priceCents,
            updatedAt: new Date(),
          })
          .where(eq(familyAddOnProducts.id, product.id));
      }
    }
    
    return { success: true };
  } catch (err: any) {
    console.error('[FamilyBilling] Error updating pricing:', err);
    return { success: false, error: err.message };
  }
}

export async function getAllFamilyGroups(): Promise<FamilyGroupWithMembers[]> {
  const groups = await db.select()
    .from(familyGroups)
    .where(eq(familyGroups.isActive, true));
  
  const result: FamilyGroupWithMembers[] = [];
  
  for (const group of groups) {
    const fullGroup = await getFamilyGroupByPrimaryEmail(group.primaryEmail);
    if (fullGroup) {
      result.push(fullGroup);
    }
  }
  
  return result;
}
