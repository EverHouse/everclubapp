import { pool } from '../db';
import { db } from '../../db';
import { billingGroups, groupMembers, familyAddOnProducts } from '../../../shared/models/hubspot-billing';
import { eq, and } from 'drizzle-orm';
import { getStripeClient } from './client';
import Stripe from 'stripe';

export interface BillingGroupWithMembers {
  id: number;
  primaryEmail: string;
  primaryName: string;
  groupName: string | null;
  stripeSubscriptionId: string | null;
  members: GroupMemberInfo[];
  totalMonthlyAmount: number;
  isActive: boolean;
}

export interface GroupMemberInfo {
  id: number;
  memberEmail: string;
  memberName: string;
  memberTier: string;
  relationship: string | null;
  addOnPriceCents: number;
  isActive: boolean;
  addedAt: Date | null;
}

export type FamilyGroupWithMembers = BillingGroupWithMembers;
export type FamilyMemberInfo = GroupMemberInfo;

export function getCorporateVolumePrice(memberCount: number): number {
  if (memberCount >= 50) return 24900;
  if (memberCount >= 20) return 27500;
  if (memberCount >= 10) return 29900;
  if (memberCount >= 5) return 32500;
  return 35000;
}

export async function syncGroupAddOnProductsToStripe(): Promise<{
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
            name: product.displayName || `Group Add-on - ${product.tierName}`,
            description: product.description || `Group add-on membership for ${product.tierName} tier`,
            metadata: {
              group_addon: 'true',
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
              group_addon: 'true',
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

export const syncFamilyAddOnProductsToStripe = syncGroupAddOnProductsToStripe;

export async function getGroupAddOnProducts(): Promise<typeof familyAddOnProducts.$inferSelect[]> {
  return db.select().from(familyAddOnProducts).where(eq(familyAddOnProducts.isActive, true));
}

export const getFamilyAddOnProducts = getGroupAddOnProducts;

export async function getBillingGroupByPrimaryEmail(primaryEmail: string): Promise<BillingGroupWithMembers | null> {
  const group = await db.select()
    .from(billingGroups)
    .where(eq(billingGroups.primaryEmail, primaryEmail.toLowerCase()))
    .limit(1);
  
  if (group.length === 0) return null;
  
  const billingGroup = group[0];
  
  const members = await db.select()
    .from(groupMembers)
    .where(and(
      eq(groupMembers.billingGroupId, billingGroup.id),
      eq(groupMembers.isActive, true)
    ));
  
  const primaryUserResult = await pool.query(
    'SELECT first_name, last_name FROM users WHERE LOWER(email) = $1',
    [primaryEmail.toLowerCase()]
  );
  const primaryName = primaryUserResult.rows[0] 
    ? `${primaryUserResult.rows[0].first_name || ''} ${primaryUserResult.rows[0].last_name || ''}`.trim()
    : primaryEmail;
  
  const memberInfos: GroupMemberInfo[] = [];
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
    id: billingGroup.id,
    primaryEmail: billingGroup.primaryEmail,
    primaryName,
    groupName: billingGroup.groupName,
    stripeSubscriptionId: billingGroup.primaryStripeSubscriptionId,
    members: memberInfos,
    totalMonthlyAmount,
    isActive: billingGroup.isActive ?? true,
  };
}

export const getFamilyGroupByPrimaryEmail = getBillingGroupByPrimaryEmail;

export async function getBillingGroupByMemberEmail(memberEmail: string): Promise<BillingGroupWithMembers | null> {
  const member = await db.select()
    .from(groupMembers)
    .where(and(
      eq(groupMembers.memberEmail, memberEmail.toLowerCase()),
      eq(groupMembers.isActive, true)
    ))
    .limit(1);
  
  if (member.length === 0) {
    const asGroup = await getBillingGroupByPrimaryEmail(memberEmail);
    return asGroup;
  }
  
  const group = await db.select()
    .from(billingGroups)
    .where(eq(billingGroups.id, member[0].billingGroupId))
    .limit(1);
  
  if (group.length === 0) return null;
  
  return getBillingGroupByPrimaryEmail(group[0].primaryEmail);
}

export const getFamilyGroupByMemberEmail = getBillingGroupByMemberEmail;

export async function createBillingGroup(params: {
  primaryEmail: string;
  groupName?: string;
  createdBy: string;
  createdByName: string;
}): Promise<{ success: boolean; groupId?: number; error?: string }> {
  try {
    const existingGroup = await db.select()
      .from(billingGroups)
      .where(eq(billingGroups.primaryEmail, params.primaryEmail.toLowerCase()))
      .limit(1);
    
    if (existingGroup.length > 0) {
      return { success: false, error: 'A billing group already exists for this member' };
    }
    
    const primaryUserResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE LOWER(email) = $1',
      [params.primaryEmail.toLowerCase()]
    );
    
    const stripeCustomerId = primaryUserResult.rows[0]?.stripe_customer_id || null;
    
    const result = await db.insert(billingGroups).values({
      primaryEmail: params.primaryEmail.toLowerCase(),
      primaryStripeCustomerId: stripeCustomerId,
      groupName: params.groupName || null,
      createdBy: params.createdBy,
      createdByName: params.createdByName,
    }).returning({ id: billingGroups.id });
    
    await pool.query(
      'UPDATE users SET billing_group_id = $1 WHERE LOWER(email) = $2',
      [result[0].id, params.primaryEmail.toLowerCase()]
    );
    
    return { success: true, groupId: result[0].id };
  } catch (err: any) {
    console.error('[GroupBilling] Error creating billing group:', err);
    return { success: false, error: err.message };
  }
}

export const createFamilyGroup = createBillingGroup;

export async function addGroupMember(params: {
  billingGroupId: number;
  memberEmail: string;
  memberTier: string;
  relationship?: string;
  addedBy: string;
  addedByName: string;
}): Promise<{ success: boolean; memberId?: number; error?: string }> {
  try {
    const existingMember = await db.select()
      .from(groupMembers)
      .where(and(
        eq(groupMembers.memberEmail, params.memberEmail.toLowerCase()),
        eq(groupMembers.isActive, true)
      ))
      .limit(1);
    
    if (existingMember.length > 0) {
      return { success: false, error: 'This member is already part of a billing group' };
    }
    
    const addOnProduct = await db.select()
      .from(familyAddOnProducts)
      .where(eq(familyAddOnProducts.tierName, params.memberTier))
      .limit(1);
    
    if (addOnProduct.length === 0) {
      return { success: false, error: `No add-on product found for tier: ${params.memberTier}` };
    }
    
    const product = addOnProduct[0];
    
    const group = await db.select()
      .from(billingGroups)
      .where(eq(billingGroups.id, params.billingGroupId))
      .limit(1);
    
    if (group.length === 0) {
      return { success: false, error: 'Billing group not found' };
    }
    
    let stripeSubscriptionItemId: string | null = null;
    
    // VERIFIED: This correctly adds a subscription_item to the primary payer's existing subscription
    // (NOT creating a separate subscription). Uses stripe.subscriptionItems.create() with the
    // primary's subscription ID, which is the correct approach for group/family billing.
    if (group[0].primaryStripeSubscriptionId && product.stripePriceId) {
      try {
        const stripe = await getStripeClient();
        const subscriptionItem = await stripe.subscriptionItems.create({
          subscription: group[0].primaryStripeSubscriptionId,
          price: product.stripePriceId,
          quantity: 1,
          metadata: {
            group_member_email: params.memberEmail.toLowerCase(),
            billing_group_id: params.billingGroupId.toString(),
            tier: params.memberTier,
          },
        });
        stripeSubscriptionItemId = subscriptionItem.id;
      } catch (stripeErr: any) {
        console.error('[GroupBilling] Error adding Stripe subscription item:', stripeErr);
        return { success: false, error: `Failed to add billing: ${stripeErr.message}` };
      }
    } else if (group[0].primaryStripeSubscriptionId && !product.stripePriceId) {
      return { success: false, error: 'Add-on product not synced to Stripe. Please sync products first.' };
    }
    
    const result = await db.insert(groupMembers).values({
      billingGroupId: params.billingGroupId,
      memberEmail: params.memberEmail.toLowerCase(),
      memberTier: params.memberTier,
      relationship: params.relationship || null,
      stripeSubscriptionItemId,
      stripePriceId: product.stripePriceId,
      addOnPriceCents: product.priceCents,
      addedBy: params.addedBy,
      addedByName: params.addedByName,
    }).returning({ id: groupMembers.id });
    
    await pool.query(
      'UPDATE users SET billing_group_id = $1 WHERE LOWER(email) = $2',
      [params.billingGroupId, params.memberEmail.toLowerCase()]
    );
    
    return { success: true, memberId: result[0].id };
  } catch (err: any) {
    console.error('[GroupBilling] Error adding group member:', err);
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
  return addGroupMember({
    billingGroupId: params.familyGroupId,
    memberEmail: params.memberEmail,
    memberTier: params.memberTier,
    relationship: params.relationship,
    addedBy: params.addedBy,
    addedByName: params.addedByName,
  });
}

export async function addCorporateMember(params: {
  billingGroupId: number;
  memberEmail: string;
  memberTier: string;
  addedBy: string;
  addedByName: string;
}): Promise<{ success: boolean; memberId?: number; error?: string }> {
  try {
    const existingMember = await db.select()
      .from(groupMembers)
      .where(and(
        eq(groupMembers.memberEmail, params.memberEmail.toLowerCase()),
        eq(groupMembers.isActive, true)
      ))
      .limit(1);
    
    if (existingMember.length > 0) {
      return { success: false, error: 'This member is already part of a billing group' };
    }
    
    const group = await db.select()
      .from(billingGroups)
      .where(eq(billingGroups.id, params.billingGroupId))
      .limit(1);
    
    if (group.length === 0) {
      return { success: false, error: 'Billing group not found' };
    }
    
    const currentMembers = await db.select()
      .from(groupMembers)
      .where(and(
        eq(groupMembers.billingGroupId, params.billingGroupId),
        eq(groupMembers.isActive, true)
      ));
    
    const newMemberCount = currentMembers.length + 1;
    const pricePerSeat = getCorporateVolumePrice(newMemberCount);
    
    if (group[0].primaryStripeSubscriptionId) {
      try {
        const stripe = await getStripeClient();
        const subscription = await stripe.subscriptions.retrieve(group[0].primaryStripeSubscriptionId, {
          expand: ['items.data'],
        });
        
        const corporateItem = subscription.items.data.find(
          item => item.metadata?.corporate_membership === 'true'
        );
        
        if (corporateItem) {
          await stripe.subscriptionItems.update(corporateItem.id, {
            quantity: newMemberCount,
          });
        }
      } catch (stripeErr: any) {
        console.error('[GroupBilling] Error updating corporate subscription quantity:', stripeErr);
        return { success: false, error: `Failed to update billing: ${stripeErr.message}` };
      }
    }
    
    const result = await db.insert(groupMembers).values({
      billingGroupId: params.billingGroupId,
      memberEmail: params.memberEmail.toLowerCase(),
      memberTier: params.memberTier,
      relationship: 'employee',
      addOnPriceCents: pricePerSeat,
      addedBy: params.addedBy,
      addedByName: params.addedByName,
    }).returning({ id: groupMembers.id });
    
    await pool.query(
      'UPDATE users SET billing_group_id = $1 WHERE LOWER(email) = $2',
      [params.billingGroupId, params.memberEmail.toLowerCase()]
    );
    
    return { success: true, memberId: result[0].id };
  } catch (err: any) {
    console.error('[GroupBilling] Error adding corporate member:', err);
    return { success: false, error: err.message };
  }
}

export async function removeGroupMember(params: {
  memberId: number;
  removedBy: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const member = await db.select()
      .from(groupMembers)
      .where(eq(groupMembers.id, params.memberId))
      .limit(1);
    
    if (member.length === 0) {
      return { success: false, error: 'Group member not found' };
    }
    
    const memberRecord = member[0];
    
    if (memberRecord.stripeSubscriptionItemId) {
      try {
        const stripe = await getStripeClient();
        await stripe.subscriptionItems.del(memberRecord.stripeSubscriptionItemId);
      } catch (stripeErr: any) {
        console.error('[GroupBilling] Error removing Stripe subscription item:', stripeErr);
      }
    }
    
    await db.update(groupMembers)
      .set({
        isActive: false,
        removedAt: new Date(),
      })
      .where(eq(groupMembers.id, params.memberId));
    
    await pool.query(
      'UPDATE users SET billing_group_id = NULL WHERE LOWER(email) = $1',
      [memberRecord.memberEmail.toLowerCase()]
    );
    
    return { success: true };
  } catch (err: any) {
    console.error('[GroupBilling] Error removing group member:', err);
    return { success: false, error: err.message };
  }
}

export const removeFamilyMember = removeGroupMember;

export async function linkStripeSubscriptionToBillingGroup(params: {
  billingGroupId: number;
  stripeSubscriptionId: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await db.update(billingGroups)
      .set({
        primaryStripeSubscriptionId: params.stripeSubscriptionId,
        updatedAt: new Date(),
      })
      .where(eq(billingGroups.id, params.billingGroupId));
    
    return { success: true };
  } catch (err: any) {
    console.error('[GroupBilling] Error linking subscription:', err);
    return { success: false, error: err.message };
  }
}

export async function linkStripeSubscriptionToFamilyGroup(params: {
  familyGroupId: number;
  stripeSubscriptionId: string;
}): Promise<{ success: boolean; error?: string }> {
  return linkStripeSubscriptionToBillingGroup({
    billingGroupId: params.familyGroupId,
    stripeSubscriptionId: params.stripeSubscriptionId,
  });
}

export async function updateGroupAddOnPricing(params: {
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
        displayName: `Group Add-on - ${params.tierName}`,
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
              group_addon: 'true',
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
          console.error('[GroupBilling] Error creating new Stripe price:', stripeErr);
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
    console.error('[GroupBilling] Error updating pricing:', err);
    return { success: false, error: err.message };
  }
}

export const updateFamilyAddOnPricing = updateGroupAddOnPricing;

export async function getAllBillingGroups(): Promise<BillingGroupWithMembers[]> {
  const groups = await db.select()
    .from(billingGroups)
    .where(eq(billingGroups.isActive, true));
  
  const result: BillingGroupWithMembers[] = [];
  
  for (const group of groups) {
    const fullGroup = await getBillingGroupByPrimaryEmail(group.primaryEmail);
    if (fullGroup) {
      result.push(fullGroup);
    }
  }
  
  return result;
}

export const getAllFamilyGroups = getAllBillingGroups;

export interface ReconciliationResult {
  success: boolean;
  groupsChecked: number;
  membersDeactivated: number;
  membersReactivated: number;
  membersCreated: number;
  itemsRelinked: number;
  errors: string[];
  details: ReconciliationDetail[];
}

export interface ReconciliationDetail {
  billingGroupId: number;
  primaryEmail: string;
  action: 'deactivated' | 'reactivated' | 'relinked' | 'error' | 'ok';
  memberEmail?: string;
  reason: string;
}

export async function reconcileGroupBillingWithStripe(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = {
    success: true,
    groupsChecked: 0,
    membersDeactivated: 0,
    membersReactivated: 0,
    membersCreated: 0,
    itemsRelinked: 0,
    errors: [],
    details: [],
  };

  try {
    const stripe = await getStripeClient();
    
    const activeGroups = await db.select()
      .from(billingGroups)
      .where(eq(billingGroups.isActive, true));
    
    for (const group of activeGroups) {
      result.groupsChecked++;
      
      if (!group.primaryStripeSubscriptionId) {
        result.details.push({
          billingGroupId: group.id,
          primaryEmail: group.primaryEmail,
          action: 'ok',
          reason: 'No Stripe subscription linked - skipped',
        });
        continue;
      }
      
      try {
        const subscription = await stripe.subscriptions.retrieve(group.primaryStripeSubscriptionId, {
          expand: ['items.data'],
        });
        
        const stripeItemsMap = new Map<string, Stripe.SubscriptionItem>();
        const stripeEmailToItemMap = new Map<string, Stripe.SubscriptionItem>();
        
        for (const item of subscription.items.data) {
          stripeItemsMap.set(item.id, item);
          const memberEmail = item.metadata?.group_member_email?.toLowerCase() || 
                              item.metadata?.family_member_email?.toLowerCase();
          if (memberEmail) {
            stripeEmailToItemMap.set(memberEmail, item);
          }
        }
        
        const localMembers = await db.select()
          .from(groupMembers)
          .where(and(
            eq(groupMembers.billingGroupId, group.id),
            eq(groupMembers.isActive, true)
          ));
        
        for (const member of localMembers) {
          if (member.stripeSubscriptionItemId) {
            if (!stripeItemsMap.has(member.stripeSubscriptionItemId)) {
              const stripeItem = stripeEmailToItemMap.get(member.memberEmail.toLowerCase());
              if (stripeItem) {
                await db.update(groupMembers)
                  .set({
                    stripeSubscriptionItemId: stripeItem.id,
                    updatedAt: new Date(),
                  })
                  .where(eq(groupMembers.id, member.id));
                
                result.itemsRelinked++;
                result.details.push({
                  billingGroupId: group.id,
                  primaryEmail: group.primaryEmail,
                  action: 'relinked',
                  memberEmail: member.memberEmail,
                  reason: `Subscription item ID updated from ${member.stripeSubscriptionItemId} to ${stripeItem.id}`,
                });
              } else {
                await db.update(groupMembers)
                  .set({
                    isActive: false,
                    removedAt: new Date(),
                  })
                  .where(eq(groupMembers.id, member.id));
                
                await pool.query(
                  'UPDATE users SET billing_group_id = NULL WHERE LOWER(email) = $1',
                  [member.memberEmail.toLowerCase()]
                );
                
                result.membersDeactivated++;
                result.details.push({
                  billingGroupId: group.id,
                  primaryEmail: group.primaryEmail,
                  action: 'deactivated',
                  memberEmail: member.memberEmail,
                  reason: 'Stripe subscription item no longer exists',
                });
              }
            }
          } else {
            const stripeItem = stripeEmailToItemMap.get(member.memberEmail.toLowerCase());
            if (stripeItem) {
              await db.update(groupMembers)
                .set({
                  stripeSubscriptionItemId: stripeItem.id,
                  updatedAt: new Date(),
                })
                .where(eq(groupMembers.id, member.id));
              
              result.itemsRelinked++;
              result.details.push({
                billingGroupId: group.id,
                primaryEmail: group.primaryEmail,
                action: 'relinked',
                memberEmail: member.memberEmail,
                reason: `Linked to existing Stripe item ${stripeItem.id}`,
              });
            }
          }
        }
        
        for (const [email, item] of stripeEmailToItemMap) {
          const hasLocalMember = localMembers.some(
            m => m.memberEmail.toLowerCase() === email
          );
          
          if (!hasLocalMember) {
            const inactiveMember = await db.select()
              .from(groupMembers)
              .where(and(
                eq(groupMembers.billingGroupId, group.id),
                eq(groupMembers.memberEmail, email),
                eq(groupMembers.isActive, false)
              ))
              .limit(1);
            
            if (inactiveMember.length > 0) {
              await db.update(groupMembers)
                .set({
                  isActive: true,
                  stripeSubscriptionItemId: item.id,
                  removedAt: null,
                  updatedAt: new Date(),
                })
                .where(eq(groupMembers.id, inactiveMember[0].id));
              
              await pool.query(
                'UPDATE users SET billing_group_id = $1 WHERE LOWER(email) = $2',
                [group.id, email]
              );
              
              result.membersReactivated++;
              result.details.push({
                billingGroupId: group.id,
                primaryEmail: group.primaryEmail,
                action: 'reactivated',
                memberEmail: email,
                reason: 'Found active Stripe item, reactivated member',
              });
            } else {
              const tierFromMetadata = item.metadata?.tier || 'Social';
              const priceInfo = item.price;
              const priceCents = priceInfo?.unit_amount || 0;
              
              await db.insert(groupMembers).values({
                billingGroupId: group.id,
                memberEmail: email,
                memberTier: tierFromMetadata,
                stripeSubscriptionItemId: item.id,
                stripePriceId: priceInfo?.id || null,
                addOnPriceCents: priceCents,
                addedBy: 'system-reconcile',
                addedByName: 'Stripe Reconciliation',
              });
              
              await pool.query(
                'UPDATE users SET billing_group_id = $1 WHERE LOWER(email) = $2',
                [group.id, email]
              );
              
              result.membersCreated++;
              result.details.push({
                billingGroupId: group.id,
                primaryEmail: group.primaryEmail,
                action: 'reactivated',
                memberEmail: email,
                reason: `Created new group member from Stripe item (tier: ${tierFromMetadata})`,
              });
            }
          }
        }
        
      } catch (stripeErr: any) {
        result.errors.push(`Group ${group.id} (${group.primaryEmail}): ${stripeErr.message}`);
        result.details.push({
          billingGroupId: group.id,
          primaryEmail: group.primaryEmail,
          action: 'error',
          reason: stripeErr.message,
        });
        result.success = false;
      }
    }
    
    return result;
  } catch (err: any) {
    return {
      ...result,
      success: false,
      errors: [...result.errors, err.message],
    };
  }
}

export const reconcileFamilyBillingWithStripe = reconcileGroupBillingWithStripe;

export async function handleSubscriptionItemsChanged(
  subscriptionId: string,
  currentItems: Array<{ id: string; metadata?: Record<string, string> }>,
  previousItems: Array<{ id: string; metadata?: Record<string, string> }>
): Promise<void> {
  try {
    const group = await db.select()
      .from(billingGroups)
      .where(eq(billingGroups.primaryStripeSubscriptionId, subscriptionId))
      .limit(1);
    
    if (group.length === 0) {
      return;
    }
    
    const billingGroupId = group[0].id;
    
    const currentItemIds = new Set(currentItems.map(i => i.id));
    const previousItemIds = new Set(previousItems.map(i => i.id));
    
    const removedItems = previousItems.filter(item => !currentItemIds.has(item.id));
    
    for (const item of removedItems) {
      const memberEmail = item.metadata?.group_member_email?.toLowerCase() ||
                          item.metadata?.family_member_email?.toLowerCase();
      if (memberEmail) {
        const member = await db.select()
          .from(groupMembers)
          .where(and(
            eq(groupMembers.billingGroupId, billingGroupId),
            eq(groupMembers.memberEmail, memberEmail),
            eq(groupMembers.isActive, true)
          ))
          .limit(1);
        
        if (member.length > 0) {
          await db.update(groupMembers)
            .set({
              isActive: false,
              removedAt: new Date(),
            })
            .where(eq(groupMembers.id, member[0].id));
          
          await pool.query(
            'UPDATE users SET billing_group_id = NULL WHERE LOWER(email) = $1',
            [memberEmail]
          );
          
          console.log(`[GroupBilling] Auto-deactivated member ${memberEmail} - subscription item removed`);
        }
      }
    }
  } catch (err: any) {
    console.error('[GroupBilling] Error handling subscription items change:', err);
  }
}
