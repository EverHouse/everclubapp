import Stripe from 'stripe';
import { logger } from '../../../../logger';
import { notifyAllStaff } from '../../../../notificationService';
import { getErrorMessage } from '../../../../../utils/errorUtils';
import type { PoolClient } from 'pg';
import type { DeferredAction } from '../../types';

interface PendingTierChangeData {
  scheduleId: string;
  currentTier: string | null;
  newTier: string | null;
  newStatus: string | null;
  effectiveDate: string;
  createdAt: string;
  source: 'stripe_schedule';
}

async function resolveScheduleDetails(
  client: PoolClient,
  schedule: Stripe.SubscriptionSchedule
): Promise<{ userId: string; email: string; memberName: string; currentTier: string | null; pendingData: PendingTierChangeData } | null> {
  const customerId = typeof schedule.customer === 'string' ? schedule.customer : schedule.customer?.id;
  if (!customerId) {
    logger.warn('[Stripe Webhook] subscription_schedule event has no customer ID');
    return null;
  }

  const userResult = await client.query(
    'SELECT id, email, first_name, last_name, tier FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    logger.warn(`[Stripe Webhook] No user found for Stripe customer ${customerId} (subscription_schedule)`);
    return null;
  }

  const { id: userId, email, first_name, last_name, tier: currentTier } = userResult.rows[0];
  const memberName = `${first_name || ''} ${last_name || ''}`.trim() || email;

  let newTier: string | null = null;
  let newStatus: string | null = null;
  let effectiveDate: string = '';

  const phases = schedule.phases || [];
  const scheduleEndBehavior = schedule.end_behavior;

  if (phases.length > 1) {
    const currentPhase = phases[0];
    const nextPhase = phases[phases.length - 1];
    effectiveDate = new Date(nextPhase.start_date * 1000).toISOString();

    const currentPriceId = currentPhase.items?.[0]
      ? (typeof currentPhase.items[0].price === 'string' ? currentPhase.items[0].price : currentPhase.items[0].price?.id)
      : null;

    if (nextPhase.items && nextPhase.items.length > 0) {
      const nextItem = nextPhase.items[0];
      const nextPriceId = typeof nextItem.price === 'string' ? nextItem.price : nextItem.price?.id;

      if (nextPriceId && nextPriceId !== currentPriceId) {
        const tierResult = await client.query(
          'SELECT name FROM membership_tiers WHERE stripe_price_id = $1 OR founding_price_id = $1',
          [nextPriceId]
        );
        if (tierResult.rows.length > 0) {
          newTier = tierResult.rows[0].name;
        }
      }
    }

    const nextMetadata = nextPhase.metadata || {};
    if (nextMetadata.pause === 'true' || nextMetadata.action === 'pause') {
      newStatus = 'pause';
    }
  } else if (phases.length === 1) {
    const phase = phases[0];
    effectiveDate = new Date(phase.end_date * 1000).toISOString();

    const phaseMetadata = phase.metadata || {};
    if (phaseMetadata.pause === 'true' || phaseMetadata.action === 'pause') {
      newStatus = 'pause';
    }
  }

  if (scheduleEndBehavior === 'cancel') {
    newStatus = 'cancellation';
    if (!effectiveDate && phases.length > 0) {
      const lastPhase = phases[phases.length - 1];
      effectiveDate = new Date(lastPhase.end_date * 1000).toISOString();
    }
  } else if (scheduleEndBehavior === 'release' && !newTier && !newStatus) {
    const scheduleMetadata = schedule.metadata || {};
    if (scheduleMetadata.pause === 'true' || scheduleMetadata.action === 'pause') {
      newStatus = 'pause';
    }
  }

  if (!newTier && !newStatus) {
    if (phases.length > 1) {
      newTier = 'unknown';
    }
    if (phases.length > 0) {
      const lastPhase = phases[phases.length - 1];
      effectiveDate = effectiveDate || new Date(lastPhase.start_date * 1000).toISOString();
    }
  }

  const pendingData: PendingTierChangeData = {
    scheduleId: schedule.id,
    currentTier,
    newTier,
    newStatus,
    effectiveDate: effectiveDate || new Date().toISOString(),
    createdAt: new Date().toISOString(),
    source: 'stripe_schedule',
  };

  return { userId, email, memberName, currentTier, pendingData };
}

export async function handleSubscriptionScheduleCreated(
  client: PoolClient,
  schedule: Stripe.SubscriptionSchedule
): Promise<DeferredAction[]> {
  const deferredActions: DeferredAction[] = [];

  try {
    const details = await resolveScheduleDetails(client, schedule);
    if (!details) return deferredActions;

    const { userId, email, memberName, pendingData } = details;

    await client.query(
      'UPDATE users SET pending_tier_change = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(pendingData), userId]
    );

    logger.info(`[Stripe Webhook] Stored pending tier change for ${email} — schedule ${schedule.id}`, {
      extra: { scheduleId: schedule.id, newTier: pendingData.newTier, newStatus: pendingData.newStatus, effectiveDate: pendingData.effectiveDate },
    });

    const deferredEmail = email;
    const deferredMemberName = memberName;
    const deferredPendingData = pendingData;

    deferredActions.push(async () => {
      try {
        const changeDesc = deferredPendingData.newStatus === 'cancellation'
          ? 'scheduled cancellation'
          : deferredPendingData.newStatus === 'pause'
          ? 'scheduled pause'
          : `tier change to ${deferredPendingData.newTier || 'unknown'}`;
        const effectiveDateStr = new Date(deferredPendingData.effectiveDate).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
        });

        await notifyAllStaff(
          'Scheduled Membership Change',
          `${deferredMemberName} (${deferredEmail}) has a ${changeDesc} scheduled for ${effectiveDateStr}. This was set up in Stripe.`,
          'membership_tier_change',
          { sendPush: true, url: '/admin/members' }
        );
      } catch (notifyErr: unknown) {
        logger.error('[Stripe Webhook] Staff notification for subscription schedule failed (non-fatal):', { error: getErrorMessage(notifyErr) });
      }
    });
  } catch (err: unknown) {
    logger.error('[Stripe Webhook] Error handling subscription_schedule.created:', { error: getErrorMessage(err) });
    throw err;
  }

  return deferredActions;
}

export async function handleSubscriptionScheduleUpdated(
  client: PoolClient,
  schedule: Stripe.SubscriptionSchedule
): Promise<DeferredAction[]> {
  const deferredActions: DeferredAction[] = [];

  try {
    if (schedule.status === 'canceled' || schedule.status === 'completed' || schedule.status === 'released') {
      const customerId = typeof schedule.customer === 'string' ? schedule.customer : schedule.customer?.id;
      if (customerId) {
        await client.query(
          `UPDATE users SET pending_tier_change = NULL, updated_at = NOW() 
           WHERE stripe_customer_id = $1 AND pending_tier_change->>'scheduleId' = $2`,
          [customerId, schedule.id]
        );
        logger.info(`[Stripe Webhook] Cleared pending tier change for schedule ${schedule.id} (status: ${schedule.status})`);
      }
      return deferredActions;
    }

    const details = await resolveScheduleDetails(client, schedule);
    if (!details) return deferredActions;

    const { userId, email, memberName, pendingData } = details;

    await client.query(
      'UPDATE users SET pending_tier_change = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(pendingData), userId]
    );

    logger.info(`[Stripe Webhook] Updated pending tier change for ${email} — schedule ${schedule.id}`, {
      extra: { scheduleId: schedule.id, newTier: pendingData.newTier, newStatus: pendingData.newStatus, effectiveDate: pendingData.effectiveDate },
    });

    const deferredEmail = email;
    const deferredMemberName = memberName;
    const deferredPendingData = pendingData;

    deferredActions.push(async () => {
      try {
        const changeDesc = deferredPendingData.newStatus === 'cancellation'
          ? 'scheduled cancellation'
          : deferredPendingData.newStatus === 'pause'
          ? 'scheduled pause'
          : `tier change to ${deferredPendingData.newTier || 'unknown'}`;
        const effectiveDateStr = new Date(deferredPendingData.effectiveDate).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles',
        });

        await notifyAllStaff(
          'Scheduled Change Updated',
          `${deferredMemberName} (${deferredEmail}) subscription schedule updated: ${changeDesc} on ${effectiveDateStr}.`,
          'membership_tier_change',
          { sendPush: true, url: '/admin/members' }
        );
      } catch (notifyErr: unknown) {
        logger.error('[Stripe Webhook] Staff notification for subscription schedule update failed (non-fatal):', { error: getErrorMessage(notifyErr) });
      }
    });
  } catch (err: unknown) {
    logger.error('[Stripe Webhook] Error handling subscription_schedule.updated:', { error: getErrorMessage(err) });
    throw err;
  }

  return deferredActions;
}

export async function handleSubscriptionScheduleCanceled(
  client: PoolClient,
  schedule: Stripe.SubscriptionSchedule
): Promise<DeferredAction[]> {
  const deferredActions: DeferredAction[] = [];

  try {
    const customerId = typeof schedule.customer === 'string' ? schedule.customer : schedule.customer?.id;
    if (!customerId) {
      logger.warn('[Stripe Webhook] subscription_schedule.canceled has no customer ID');
      return deferredActions;
    }

    const userResult = await client.query(
      `SELECT id, email, first_name, last_name FROM users 
       WHERE stripe_customer_id = $1 AND pending_tier_change->>'scheduleId' = $2`,
      [customerId, schedule.id]
    );

    if (userResult.rows.length === 0) {
      logger.info(`[Stripe Webhook] No pending tier change found for schedule ${schedule.id} — may already be cleared`);
      return deferredActions;
    }

    const { id: userId, email, first_name, last_name } = userResult.rows[0];
    const memberName = `${first_name || ''} ${last_name || ''}`.trim() || email;

    await client.query(
      'UPDATE users SET pending_tier_change = NULL, updated_at = NOW() WHERE id = $1',
      [userId]
    );

    logger.info(`[Stripe Webhook] Cleared pending tier change for ${email} — schedule ${schedule.id} canceled`);

    const deferredEmail = email;
    const deferredMemberName = memberName;

    deferredActions.push(async () => {
      try {
        await notifyAllStaff(
          'Scheduled Change Canceled',
          `${deferredMemberName} (${deferredEmail}) scheduled membership change has been canceled.`,
          'membership_tier_change',
          { sendPush: false, url: '/admin/members' }
        );
      } catch (notifyErr: unknown) {
        logger.error('[Stripe Webhook] Staff notification for schedule cancellation failed (non-fatal):', { error: getErrorMessage(notifyErr) });
      }
    });
  } catch (err: unknown) {
    logger.error('[Stripe Webhook] Error handling subscription_schedule.canceled:', { error: getErrorMessage(err) });
    throw err;
  }

  return deferredActions;
}
