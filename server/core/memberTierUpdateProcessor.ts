import { db } from '../db';
import { users } from '../../shared/schema';
import { sql } from 'drizzle-orm';
import { queueTierSync } from './hubspot';
import { notifyMember, isNotifiableEmail } from './notificationService';
import { getErrorMessage } from '../utils/errorUtils';

import { logger } from './logger';
import { sendPassUpdateForMemberByEmail } from '../walletPass/apnPushService';
function getTierRank(tier: string): number {
  const ranks: Record<string, number> = {
    'social': 1, 'core': 2, 'premium': 3, 'vip': 4, 'corporate': 5
  };
  return ranks[tier.toLowerCase()] || 0;
}

interface MemberTierUpdatePayload {
  email: string;
  newTier: string;
  oldTier: string | null;
  performedBy: string;
  performedByName: string;
  syncToHubspot?: boolean;
  tierId?: number;
  csvTier?: string;
}

export async function processMemberTierUpdate(payload: MemberTierUpdatePayload): Promise<void> {
  const {
    email,
    newTier,
    oldTier,
    performedBy,
    performedByName,
    syncToHubspot = true,
    tierId,
    csvTier
  } = payload;

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Fetch current user data
    const userResult = await db
      .select({
        id: users.id,
        email: users.email,
        tier: users.tier,
        firstName: users.firstName,
        lastName: users.lastName,
        billingProvider: users.billingProvider,
        stripeSubscriptionId: users.stripeSubscriptionId
      })
      .from(users)
      .where(sql`LOWER(${users.email}) = ${normalizedEmail}`);

    if (userResult.length === 0) {
      logger.warn(`[MemberTierUpdateProcessor] Member not found: ${normalizedEmail}`);
      return;
    }

    const user = userResult[0];

    // Double-check that the tier actually needs to change
    if (user.tier === newTier) {
      logger.info(`[MemberTierUpdateProcessor] Member ${normalizedEmail} is already on tier ${newTier}, skipping`);
      return;
    }

    // Update database with new tier
    const tierIdValue = tierId || (newTier ? await getTierIdFromTierName(newTier) : null);

    if (user.billingProvider === 'stripe' && user.stripeSubscriptionId && newTier) {
      const { membershipTiers } = await import('../../shared/schema');
      const { eq } = await import('drizzle-orm');
      const tierResult = await db.select({ stripePriceId: membershipTiers.stripePriceId })
        .from(membershipTiers)
        .where(eq(membershipTiers.name, newTier))
        .limit(1);

      if (tierResult.length > 0 && tierResult[0].stripePriceId) {
        const { changeSubscriptionTier } = await import('./stripe/subscriptions');
        const stripeResult = await changeSubscriptionTier(user.stripeSubscriptionId, tierResult[0].stripePriceId);
        if (!stripeResult.success) {
          throw new Error(`Stripe tier sync failed for ${normalizedEmail}: ${stripeResult.error || 'unknown error'}`);
        }
        logger.info(`[MemberTierUpdateProcessor] Synced Stripe subscription tier for ${normalizedEmail}: ${oldTier || 'None'} → ${newTier}`);
      } else {
        logger.warn(`[MemberTierUpdateProcessor] No Stripe price found for tier ${newTier} — Stripe subscription not updated for ${normalizedEmail}`);
      }
    }

    await db
      .update(users)
      .set({
        tier: newTier,
        ...(tierIdValue !== null && { tierId: tierIdValue }),
        ...(csvTier && { membershipTier: csvTier }),
        updatedAt: new Date()
      })
      .where(sql`LOWER(${users.email}) = ${normalizedEmail}`);

    if (syncToHubspot && newTier) {
      await queueTierSync({
        email: normalizedEmail,
        newTier,
        oldTier: oldTier || 'None',
        changedBy: performedBy,
        changedByName: performedByName
      });
      logger.info(`[MemberTierUpdateProcessor] Queued HubSpot tier sync for ${normalizedEmail}: ${oldTier || 'None'} → ${newTier}`);
    }

    // Notify member of tier change
    const isUpgrade = newTier
      ? getTierRank(newTier) > getTierRank(oldTier || '')
      : false;
    const isFirstTier = !oldTier && newTier;
    const changeType = isFirstTier
      ? 'set'
      : newTier
      ? isUpgrade
        ? 'upgraded'
        : 'changed'
      : 'cleared';

    if (isNotifiableEmail(normalizedEmail)) {
      await notifyMember({
        userEmail: normalizedEmail,
        title: isFirstTier
          ? 'Membership Tier Assigned'
          : newTier
          ? isUpgrade
            ? 'Membership Upgraded'
            : 'Membership Updated'
          : 'Membership Cleared',
        message: isFirstTier
          ? `Your membership tier has been set to ${newTier}`
          : newTier
          ? `Your membership has been ${changeType} from ${oldTier} to ${newTier}`
          : `Your membership tier has been cleared (was ${oldTier})`,
        type: 'membership_tier_change',
        url: '/dashboard/membership'
      });
    }

    sendPassUpdateForMemberByEmail(normalizedEmail).catch(err =>
      logger.warn('[MemberTierUpdateProcessor] Wallet pass push failed (non-fatal)', { extra: { email: normalizedEmail, error: getErrorMessage(err) } })
    );

    logger.info(`[MemberTierUpdateProcessor] Successfully updated ${normalizedEmail}: ${oldTier || 'None'} → ${newTier}`);
  } catch (error: unknown) {
    logger.error(`[MemberTierUpdateProcessor] Error updating tier for ${normalizedEmail}:`, { extra: { error: getErrorMessage(error) } });
    throw error;
  }
}

async function getTierIdFromTierName(tierName: string): Promise<number | null> {
  try {
    const { membershipTiers } = await import('../../shared/schema');
    const { eq } = await import('drizzle-orm');
    const result = await db.select({ id: membershipTiers.id })
      .from(membershipTiers)
      .where(eq(membershipTiers.name, tierName))
      .limit(1);
    return result[0]?.id ?? null;
  } catch (err: unknown) {
    logger.debug(`[TierUpdateProcessor] Failed to look up tier ID for "${tierName}"`, { extra: { error: getErrorMessage(err) } });
    return null;
  }
}
