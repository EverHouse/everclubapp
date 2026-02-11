import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getStripeClient } from './client';

export interface CustomerSyncResult {
  success: boolean;
  updated: number;
  skipped: number;
  cleared: number;
  errors: string[];
  details: Array<{
    email: string;
    action: 'updated' | 'skipped' | 'error' | 'cleared';
    customerId?: string;
    reason?: string;
  }>;
}

export async function syncStripeCustomersForMindBodyMembers(): Promise<CustomerSyncResult> {
  const result: CustomerSyncResult = {
    success: true,
    updated: 0,
    skipped: 0,
    cleared: 0,
    errors: [],
    details: [],
  };

  try {
    console.log('[Stripe Customer Sync] Starting metadata sync for existing Stripe customers...');
    
    const membersResult = await db.execute(sql`
      SELECT id, email, first_name, last_name, tier, stripe_customer_id
      FROM users
      WHERE billing_provider = 'mindbody'
        AND tier IS NOT NULL 
        AND tier != ''
        AND stripe_customer_id IS NOT NULL
        AND email IS NOT NULL
        AND email != ''
      ORDER BY email
    `);
    
    const members = membersResult.rows;
    console.log(`[Stripe Customer Sync] Found ${members.length} MindBody members with existing Stripe customers to update`);
    
    if (members.length === 0) {
      console.log('[Stripe Customer Sync] No existing Stripe customers to update');
      return result;
    }

    const stripe = await getStripeClient();
    
    for (const member of members) {
      try {
        const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ') || undefined;
        await stripe.customers.update(member.stripe_customer_id, {
          metadata: {
            tier: member.tier || '',
            billing_provider: 'mindbody',
            ...(fullName ? { name: fullName } : {}),
          },
        });
        result.updated++;
        result.details.push({
          email: member.email,
          action: 'updated',
          customerId: member.stripe_customer_id,
        });
        
      } catch (error: any) {
        if (error.code === 'resource_missing' || error.message?.includes('No such customer')) {
          await db.execute(sql`UPDATE users SET stripe_customer_id = NULL WHERE id = ${member.id}`);
          result.cleared++;
          result.details.push({
            email: member.email,
            action: 'cleared',
            customerId: member.stripe_customer_id,
            reason: 'Customer no longer exists in Stripe',
          });
        } else {
          console.error(`[Stripe Customer Sync] Error updating ${member.email}:`, error.message);
          result.errors.push(`${member.email}: ${error.message}`);
          result.details.push({
            email: member.email,
            action: 'error',
            reason: error.message,
          });
        }
      }
    }
    
    const parts = [`updated=${result.updated}`];
    if (result.cleared > 0) parts.push(`cleared_stale=${result.cleared}`);
    if (result.skipped > 0) parts.push(`skipped=${result.skipped}`);
    if (result.errors.length > 0) parts.push(`errors=${result.errors.length}`);
    console.log(`[Stripe Customer Sync] Completed: ${parts.join(', ')}`);
    
  } catch (error: any) {
    console.error('[Stripe Customer Sync] Fatal error:', error);
    result.success = false;
    result.errors.push(`Fatal: ${error.message}`);
  }
  
  return result;
}

export async function getCustomerSyncStatus(): Promise<{
  needsSync: number;
  alreadySynced: number;
  total: number;
}> {
  const result = await db.execute(sql`
    SELECT 
      COUNT(*) FILTER (WHERE stripe_customer_id IS NULL) as needs_sync,
      COUNT(*) FILTER (WHERE stripe_customer_id IS NOT NULL) as already_synced,
      COUNT(*) as total
    FROM users
    WHERE billing_provider = 'mindbody'
      AND tier IS NOT NULL 
      AND tier != ''
  `);
  
  return {
    needsSync: parseInt(result.rows[0].needs_sync) || 0,
    alreadySynced: parseInt(result.rows[0].already_synced) || 0,
    total: parseInt(result.rows[0].total) || 0,
  };
}
