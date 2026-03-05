import { enqueueHubSpotSync } from './queue';
import { db } from '../../db';
import { sql } from 'drizzle-orm';

export interface TierSyncParams {
  email: string;
  newTier: string;
  oldTier?: string;
  changedBy?: string;
  changedByName?: string;
}

export interface IntegrityFixSyncParams {
  email: string;
  status?: string;
  tier?: string;
  billingProvider?: string;
  fixAction: string;
  performedBy?: string;
}

export async function queueIntegrityFixSync(params: IntegrityFixSyncParams): Promise<void> {
  const emailKey = params.email.toLowerCase();

  await enqueueHubSpotSync('sync_tier', {
    email: emailKey,
    newTier: params.tier || '',
    oldTier: '',
    changedBy: params.performedBy || 'data_integrity',
    changedByName: 'Data Integrity Fix',
  }, {
    priority: 2,
    idempotencyKey: `integrity_fix_${emailKey}_${params.fixAction}_${Math.floor(Date.now() / 86400000)}`,
    maxRetries: 3
  });
}

export async function queueTierSync(params: TierSyncParams): Promise<void> {
  const newTierKey = (params.newTier || 'none').replace(/\s+/g, '_');
  const emailKey = params.email.toLowerCase();

  await db.execute(sql`UPDATE hubspot_sync_queue 
    SET status = 'superseded', completed_at = NOW() 
    WHERE operation = 'sync_tier' 
      AND status IN ('pending', 'failed') 
      AND LOWER(payload->>'email') = ${emailKey}`);

  await enqueueHubSpotSync('sync_tier', params, {
    priority: 2,
    idempotencyKey: `tier_sync_${emailKey}_to_${newTierKey}_${Math.floor(Date.now() / 86400000)}`,
    maxRetries: 5
  });
}
