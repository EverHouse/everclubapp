import { logger } from '../core/logger';
import { Router, Request } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { validateQuery } from '../middleware/validate';
import { z } from 'zod';
import { requiredStringParam } from '../middleware/paramSchemas';
import { logFromRequest } from '../core/auditLog';
import { getSessionUser } from '../types/session';
import {
  syncGroupAddOnProductsToStripe,
  getGroupAddOnProducts,
  getBillingGroupByMemberEmail,
  createBillingGroup,
  addGroupMember,
  removeGroupMember,
  removeCorporateMember,
  linkStripeSubscriptionToBillingGroup,
  updateGroupAddOnPricing,
  getAllBillingGroups,
  reconcileGroupBillingWithStripe,
  getCorporateVolumePrice,
  addCorporateMember,
  updateBillingGroupName,
  deleteBillingGroup,
} from '../core/stripe/groupBilling';
import { db } from '../db';
import { billingGroups, groupMembers } from '../../shared/models/hubspot-billing';
import { eq } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';

const router = Router();

router.get('/api/group-billing/products', isStaffOrAdmin, async (req, res) => {
  try {
    const products = await getGroupAddOnProducts();
    res.json(products);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting products', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.get('/api/family-billing/products', isStaffOrAdmin, async (req, res) => {
  try {
    const products = await getGroupAddOnProducts();
    res.json(products);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting products', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/group-billing/products/sync', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await syncGroupAddOnProductsToStripe();
    res.json(result);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error syncing products', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/family-billing/products/sync', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await syncGroupAddOnProductsToStripe();
    res.json(result);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error syncing products', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.put('/api/group-billing/products/:tierName', isStaffOrAdmin, async (req, res) => {
  try {
    const tierParse = requiredStringParam.safeParse(req.params.tierName);
    if (!tierParse.success) return res.status(400).json({ error: 'Invalid tier name' });
    const tierName = tierParse.data;
    const { priceCents } = req.body;
    
    if (typeof priceCents !== 'number' || priceCents < 0) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    
    const result = await updateGroupAddOnPricing({ tierName, priceCents });
    
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error updating pricing', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.put('/api/family-billing/products/:tierName', isStaffOrAdmin, async (req, res) => {
  try {
    const tierParse = requiredStringParam.safeParse(req.params.tierName);
    if (!tierParse.success) return res.status(400).json({ error: 'Invalid tier name' });
    const tierName = tierParse.data;
    const { priceCents } = req.body;
    
    if (typeof priceCents !== 'number' || priceCents < 0) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    
    const result = await updateGroupAddOnPricing({ tierName, priceCents });
    
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error updating pricing', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.get('/api/group-billing/groups', isStaffOrAdmin, async (req, res) => {
  try {
    const groups = await getAllBillingGroups();
    res.json(groups);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting all groups', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.get('/api/family-billing/groups', isStaffOrAdmin, async (req, res) => {
  try {
    const groups = await getAllBillingGroups();
    res.json(groups);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting all groups', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.get('/api/group-billing/group/:email', isStaffOrAdmin, async (req, res) => {
  try {
    const emailParse = requiredStringParam.safeParse(req.params.email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const email = emailParse.data.trim().toLowerCase();
    const group = await getBillingGroupByMemberEmail(email);
    
    if (!group) {
      return res.status(404).json({ error: 'Billing group not found' });
    }
    
    res.json(group);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting group', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.get('/api/family-billing/group/:email', isStaffOrAdmin, async (req, res) => {
  try {
    const emailParse = requiredStringParam.safeParse(req.params.email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const email = emailParse.data.trim().toLowerCase();
    const group = await getBillingGroupByMemberEmail(email);
    
    if (!group) {
      return res.status(404).json({ error: 'Family group not found' });
    }
    
    res.json(group);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting group', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.put('/api/group-billing/group/:groupId/name', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    let { groupName } = req.body;
    
    // Normalize empty strings to null
    if (typeof groupName === 'string') {
      groupName = groupName.trim() || null;
    }
    
    // Validate groupName if provided
    if (groupName !== null && groupName !== undefined) {
      if (typeof groupName !== 'string') {
        return res.status(400).json({ error: 'Group name must be a string' });
      }
      if (groupName.length > 100) {
        return res.status(400).json({ error: 'Group name must be 100 characters or less' });
      }
    }
    
    const parsedGroupId = parseInt(groupId, 10);
    if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid group ID' });
    const result = await updateBillingGroupName(parsedGroupId, groupName);
    
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error updating group name', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.delete('/api/group-billing/group/:groupId', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    const parsedGroupId = parseInt(groupId, 10);
    if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid group ID' });
    
    const result = await deleteBillingGroup(parsedGroupId);
    
    if (result.success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error deleting group', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/group-billing/groups', isStaffOrAdmin, async (req, res) => {
  try {
    const { primaryEmail: rawPrimaryEmail, groupName } = req.body;
    const primaryEmail = rawPrimaryEmail?.trim()?.toLowerCase();
    const user = getSessionUser(req);
    
    if (!primaryEmail) {
      return res.status(400).json({ error: 'Primary email is required' });
    }
    
    const result = await createBillingGroup({
      primaryEmail,
      groupName,
      createdBy: user?.email || 'staff',
      createdByName: user?.name || 'Staff Member',
    });
    
    if (result.success) {
      res.json({ success: true, groupId: result.groupId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error creating group', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/family-billing/groups', isStaffOrAdmin, async (req, res) => {
  try {
    const { primaryEmail: rawPrimaryEmail, groupName } = req.body;
    const primaryEmail = rawPrimaryEmail?.trim()?.toLowerCase();
    const user = getSessionUser(req);
    
    if (!primaryEmail) {
      return res.status(400).json({ error: 'Primary email is required' });
    }
    
    const result = await createBillingGroup({
      primaryEmail,
      groupName,
      createdBy: user?.email || 'staff',
      createdByName: user?.name || 'Staff Member',
    });
    
    if (result.success) {
      res.json({ success: true, groupId: result.groupId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error creating group', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/group-billing/groups/:groupId/members', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    const parsedGroupId = parseInt(groupId, 10);
    if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid group ID' });
    const { memberEmail: rawMemberEmail, memberTier, relationship, firstName, lastName, phone, dob, streetAddress, city, state, zipCode, discountCode } = req.body;
    const memberEmail = rawMemberEmail?.trim()?.toLowerCase();
    const user = getSessionUser(req);
    
    if (!memberEmail || !memberTier) {
      return res.status(400).json({ error: 'Member email and tier are required' });
    }
    
    const result = await addGroupMember({
      billingGroupId: parsedGroupId,
      memberEmail,
      memberTier,
      relationship,
      firstName,
      lastName,
      phone,
      dob,
      streetAddress,
      city,
      state,
      zipCode,
      discountCode,
      addedBy: user?.email || 'staff',
      addedByName: user?.name || 'Staff Member',
    });
    
    if (result.success) {
      res.json({ success: true, memberId: result.memberId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error adding member', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/group-billing/groups/:groupId/corporate-members', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    const { email: rawEmail, firstName, lastName, phone, dob } = req.body;
    const email = rawEmail?.trim()?.toLowerCase();
    const user = getSessionUser(req);
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const groupIdInt = parseInt(groupId, 10);
    if (isNaN(groupIdInt)) return res.status(400).json({ error: 'Invalid group ID' });
    
    const group = await db.select()
      .from(billingGroups)
      .where(eq(billingGroups.id, groupIdInt))
      .limit(1);
    
    if (group.length === 0) {
      return res.status(404).json({ error: 'Group not found' });
    }
    
    if (group[0].type !== 'corporate') {
      return res.status(400).json({ error: 'This endpoint is only for corporate groups' });
    }
    
    const currentMembers = await db.select()
      .from(groupMembers)
      .where(eq(groupMembers.billingGroupId, groupIdInt));
    
    const activeMemberCount = currentMembers.filter(m => m.isActive).length;
    const maxSeats = group[0].maxSeats;
    
    if (maxSeats && (activeMemberCount + 1) > maxSeats) {
      return res.status(400).json({ 
        error: `All ${maxSeats} seats are filled. Contact support to add more seats.` 
      });
    }
    
    const result = await addCorporateMember({
      billingGroupId: groupIdInt,
      memberEmail: email,
      memberTier: 'Corporate',
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      phone: phone || undefined,
      dob: dob || undefined,
      addedBy: user?.email || 'staff',
      addedByName: user?.name || 'Staff Member',
    });
    
    if (result.success) {
      logFromRequest(req, 'add_corporate_member', 'group', groupId, group[0].groupName || undefined, {
        memberEmail: email,
        seatsUsed: activeMemberCount + 1,
        maxSeats,
      });
      res.json({ success: true, memberId: result.memberId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error adding corporate member', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/family-billing/groups/:groupId/members', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    const parsedGroupId = parseInt(groupId, 10);
    if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid group ID' });
    const { memberEmail: rawMemberEmail, memberTier, relationship, firstName, lastName, phone, dob, streetAddress, city, state, zipCode, discountCode } = req.body;
    const memberEmail = rawMemberEmail?.trim()?.toLowerCase();
    const user = getSessionUser(req);
    
    if (!memberEmail || !memberTier) {
      return res.status(400).json({ error: 'Member email and tier are required' });
    }
    
    const result = await addGroupMember({
      billingGroupId: parsedGroupId,
      memberEmail,
      memberTier,
      relationship,
      firstName,
      lastName,
      phone,
      dob,
      streetAddress,
      city,
      state,
      zipCode,
      discountCode,
      addedBy: user?.email || 'staff',
      addedByName: user?.name || 'Staff Member',
    });
    
    if (result.success) {
      res.json({ success: true, memberId: result.memberId });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error adding member', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});


const corporatePricingQuerySchema = z.object({ memberCount: z.string().regex(/^\d+$/).optional() }).passthrough();

router.get('/api/group-billing/corporate-pricing', isStaffOrAdmin, validateQuery(corporatePricingQuerySchema), async (req, res) => {
  try {
    const vq = (req as Request & { validatedQuery: z.infer<typeof corporatePricingQuerySchema> }).validatedQuery;
    const memberCount = parseInt(vq.memberCount || '', 10) || 1;
    const pricePerSeat = getCorporateVolumePrice(memberCount);
    res.json({
      memberCount,
      pricePerSeatCents: pricePerSeat,
      pricePerSeatDollars: pricePerSeat / 100,
      totalCents: pricePerSeat * memberCount,
      totalDollars: (pricePerSeat * memberCount) / 100,
    });
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error getting corporate pricing', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.delete('/api/group-billing/members/:memberId', isStaffOrAdmin, async (req, res) => {
  try {
    const memberIdParse = requiredStringParam.safeParse(req.params.memberId);
    if (!memberIdParse.success) return res.status(400).json({ error: 'Invalid member ID' });
    const memberId = memberIdParse.data;
    const user = getSessionUser(req);
    const memberIdInt = parseInt(memberId, 10);
    if (isNaN(memberIdInt)) return res.status(400).json({ error: 'Invalid member ID' });
    
    const memberRecord = await db.select({
      billingGroupId: groupMembers.billingGroupId,
      memberEmail: groupMembers.memberEmail,
    })
      .from(groupMembers)
      .where(eq(groupMembers.id, memberIdInt))
      .limit(1);
    
    if (memberRecord.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    const groupRecord = await db.select({ type: billingGroups.type })
      .from(billingGroups)
      .where(eq(billingGroups.id, memberRecord[0].billingGroupId))
      .limit(1);
    
    const isCorporate = groupRecord[0]?.type === 'corporate';
    
    let result;
    if (isCorporate) {
      result = await removeCorporateMember({
        billingGroupId: memberRecord[0].billingGroupId,
        memberEmail: memberRecord[0].memberEmail,
        removedBy: user?.email || 'staff',
      });
    } else {
      result = await removeGroupMember({
        memberId: memberIdInt,
        removedBy: user?.email || 'staff',
      });
    }
    
    if (result.success) {
      logFromRequest(req, 'remove_group_member', 'group', memberId, undefined, {
        memberId,
        groupType: isCorporate ? 'corporate' : 'group',
      });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error removing member', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to remove member. Please try again.' });
  }
});

router.delete('/api/family-billing/members/:memberId', isStaffOrAdmin, async (req, res) => {
  try {
    const memberIdParse = requiredStringParam.safeParse(req.params.memberId);
    if (!memberIdParse.success) return res.status(400).json({ error: 'Invalid member ID' });
    const memberId = memberIdParse.data;
    const user = getSessionUser(req);
    
    const parsedMemberId = parseInt(memberId, 10);
    if (isNaN(parsedMemberId)) return res.status(400).json({ error: 'Invalid member ID' });
    const result = await removeGroupMember({
      memberId: parsedMemberId,
      removedBy: user?.email || 'staff',
    });
    
    if (result.success) {
      logFromRequest(req, 'remove_group_member', 'group', memberId, undefined, {
        memberId,
        groupType: 'family',
      });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error removing member', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to remove family member. Please try again.' });
  }
});

router.post('/api/group-billing/groups/:groupId/link-subscription', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    const parsedGroupId = parseInt(groupId, 10);
    if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid group ID' });
    const { stripeSubscriptionId } = req.body;
    
    if (!stripeSubscriptionId) {
      return res.status(400).json({ error: 'Stripe subscription ID is required' });
    }
    
    const result = await linkStripeSubscriptionToBillingGroup({
      billingGroupId: parsedGroupId,
      stripeSubscriptionId,
    });
    
    if (result.success) {
      logFromRequest(req, 'link_group_subscription', 'group', groupId, undefined, {
        stripeSubscriptionId,
        groupType: 'group',
      });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error linking subscription', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/family-billing/groups/:groupId/link-subscription', isStaffOrAdmin, async (req, res) => {
  try {
    const groupIdParse = requiredStringParam.safeParse(req.params.groupId);
    if (!groupIdParse.success) return res.status(400).json({ error: 'Invalid group ID' });
    const groupId = groupIdParse.data;
    const parsedGroupId = parseInt(groupId, 10);
    if (isNaN(parsedGroupId)) return res.status(400).json({ error: 'Invalid group ID' });
    const { stripeSubscriptionId } = req.body;
    
    if (!stripeSubscriptionId) {
      return res.status(400).json({ error: 'Stripe subscription ID is required' });
    }
    
    const result = await linkStripeSubscriptionToBillingGroup({
      billingGroupId: parsedGroupId,
      stripeSubscriptionId,
    });
    
    if (result.success) {
      logFromRequest(req, 'link_group_subscription', 'group', groupId, undefined, {
        stripeSubscriptionId,
        groupType: 'family',
      });
      res.json({ success: true });
    } else {
      res.status(400).json({ error: result.error });
    }
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error linking subscription', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/group-billing/reconcile', isStaffOrAdmin, async (req, res) => {
  try {
    const _staffEmail = getSessionUser(req)?.email || 'unknown';
    logger.info('[GroupBilling] Starting reconciliation with Stripe...');
    const result = await reconcileGroupBillingWithStripe();
    logger.info('[GroupBilling] Reconciliation complete: groups checked, deactivated, reactivated, created, relinked', { extra: { resultGroupsChecked: result.groupsChecked, resultMembersDeactivated: result.membersDeactivated, resultMembersReactivated: result.membersReactivated, resultMembersCreated: result.membersCreated, resultItemsRelinked: result.itemsRelinked } });
    logFromRequest(req, 'reconcile_group_billing', 'billing_groups', null, undefined, {
      action: 'reconcile',
      groupsChecked: result.groupsChecked,
      membersDeactivated: result.membersDeactivated,
      membersReactivated: result.membersReactivated,
      membersCreated: result.membersCreated,
      itemsRelinked: result.itemsRelinked,
      errorCount: result.errors.length,
    });
    res.json(result);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error during reconciliation', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

router.post('/api/family-billing/reconcile', isStaffOrAdmin, async (req, res) => {
  try {
    const _staffEmail = getSessionUser(req)?.email || 'unknown';
    logger.info('[GroupBilling] Starting reconciliation with Stripe...');
    const result = await reconcileGroupBillingWithStripe();
    logger.info('[GroupBilling] Reconciliation complete: groups checked, deactivated, reactivated, created, relinked', { extra: { resultGroupsChecked: result.groupsChecked, resultMembersDeactivated: result.membersDeactivated, resultMembersReactivated: result.membersReactivated, resultMembersCreated: result.membersCreated, resultItemsRelinked: result.itemsRelinked } });
    logFromRequest(req, 'reconcile_group_billing', 'billing_groups', null, undefined, {
      action: 'reconcile',
      groupsChecked: result.groupsChecked,
      membersDeactivated: result.membersDeactivated,
      membersReactivated: result.membersReactivated,
      membersCreated: result.membersCreated,
      itemsRelinked: result.itemsRelinked,
      errorCount: result.errors.length,
    });
    res.json(result);
  } catch (error: unknown) {
    logger.error('[GroupBilling] Error during reconciliation', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

export default router;
