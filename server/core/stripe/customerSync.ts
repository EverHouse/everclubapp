import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getStripeClient } from './client';
import { getErrorMessage, getErrorCode, isStripeResourceMissing } from '../../utils/errorUtils';
import { systemSettings } from '../../../shared/models/system';
import { eq } from 'drizzle-orm';
import { logger } from '../logger';
export interface CustomerSyncResult {
  success: boolean;
  updated: number;
  skipped: number;
  staleFound: number;
  relinked: number;
  errors: string[];
  details: Array<{
    email: string;
    action: 'updated' | 'skipped' | 'error' | 'stale' | 'relinked';
    customerId?: string;
    reason?: string;
  }>;
}

export async function syncStripeCustomersForMindBodyMembers(): Promise<CustomerSyncResult> {
  const result: CustomerSyncResult = {
    success: true,
    updated: 0,
    skipped: 0,
    staleFound: 0,
    relinked: 0,
    errors: [],
    details: [],
  };

  try {
    logger.info('[Stripe Customer Sync] Starting metadata sync for existing Stripe customers...');
    
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
    logger.info(`[Stripe Customer Sync] Found ${members.length} MindBody members with existing Stripe customers to update`);
    
    if (members.length === 0) {
      logger.info('[Stripe Customer Sync] No existing Stripe customers to update');
      return result;
    }

    const stripe = await getStripeClient();
    
    for (const member of members) {
      try {
        const fullName = [member.first_name as string, member.last_name as string].filter(Boolean).join(' ') || undefined;
        await stripe.customers.update(member.stripe_customer_id as string, {
          metadata: {
            user_id: member.id as string,
            tier: (member.tier as string) || '',
            billing_provider: 'mindbody',
            ...(fullName ? { name: fullName } : {}),
          },
        });
        result.updated++;
        result.details.push({
          email: member.email as string,
          action: 'updated',
          customerId: member.stripe_customer_id as string,
        });
        
      } catch (error: unknown) {
        if (isStripeResourceMissing(error)) {
          const memberEmail = (member.email as string).toLowerCase();
          const staleId = member.stripe_customer_id as string;
          let relinked = false;

          try {
            const searchResult = await stripe.customers.list({
              email: memberEmail,
              limit: 10,
            });

            if (searchResult.data.length > 0) {
              const activeCustomers = searchResult.data.filter(c => !('deleted' in c && (c as { deleted?: boolean }).deleted));
              if (activeCustomers.length > 0) {
                const sortedCustomers = activeCustomers.sort((a, b) => b.created - a.created);
                const matchedCustomer = sortedCustomers[0];
                const fullName = [member.first_name as string, member.last_name as string].filter(Boolean).join(' ') || undefined;

                await stripe.customers.update(matchedCustomer.id, {
                  metadata: {
                    user_id: member.id as string,
                    tier: (member.tier as string) || '',
                    billing_provider: 'mindbody',
                    ...(fullName ? { name: fullName } : {}),
                  },
                });

                await db.execute(sql`UPDATE users SET stripe_customer_id = ${matchedCustomer.id}, updated_at = NOW() WHERE id = ${member.id as string}`);

                logger.info(`[Stripe Customer Sync] Re-linked "${memberEmail}": stale ${staleId} → ${matchedCustomer.id}`);
                result.relinked++;
                result.details.push({
                  email: memberEmail,
                  action: 'relinked',
                  customerId: matchedCustomer.id,
                  reason: `Stale ${staleId} replaced with ${matchedCustomer.id} found by email lookup`,
                });
                relinked = true;
              }
            }
          } catch (searchError: unknown) {
            logger.warn(`[Stripe Customer Sync] Email search failed for "${memberEmail}" during re-link attempt:`, { extra: { detail: getErrorMessage(searchError) } });
          }

          if (!relinked) {
            logger.debug(`[Stripe Customer Sync] Customer ${staleId} for "${memberEmail}" not found in Stripe and no match by email — NOT auto-clearing`);
            result.staleFound++;
            result.details.push({
              email: memberEmail,
              action: 'stale',
              customerId: staleId,
              reason: 'Customer not found in Stripe and no match found by email',
            });
          }
        } else {
          logger.error(`[Stripe Customer Sync] Error updating ${member.email}:`, { extra: { detail: getErrorMessage(error) } });
          result.errors.push(`${member.email}: ${getErrorMessage(error)}`);
          result.details.push({
            email: member.email as string,
            action: 'error',
            reason: getErrorMessage(error),
          });
        }
      }
    }
    
    if (result.staleFound > 0) {
      const staleDetails = result.details.filter(d => d.action === 'stale');
      const sampleEmails = staleDetails.slice(0, 5).map(d => d.email).join(', ');
      const moreCount = staleDetails.length > 5 ? ` and ${staleDetails.length - 5} more` : '';
      logger.debug(`[Stripe Customer Sync] ${result.staleFound} orphaned Stripe customer IDs detected (not auto-cleared). Sample: ${sampleEmails}${moreCount}. Use Data Integrity tools to review.`);

      try {
        const orphanedData = JSON.stringify({
          count: result.staleFound,
          detectedAt: new Date().toISOString(),
          customers: staleDetails.map(d => ({ email: d.email, stripeCustomerId: d.customerId })),
        });
        await db.insert(systemSettings)
          .values({ key: 'orphaned_stripe_customers', value: orphanedData, category: 'stripe_sync', updatedAt: new Date() })
          .onConflictDoUpdate({
            target: systemSettings.key,
            set: { value: orphanedData, updatedAt: new Date() },
          });
      } catch (cacheErr: unknown) {
        logger.debug(`[Stripe Customer Sync] Failed to cache orphaned customer data: ${getErrorMessage(cacheErr)}`);
      }
    } else {
      try {
        await db.delete(systemSettings).where(eq(systemSettings.key, 'orphaned_stripe_customers'));
      } catch {
      }
    }

    const parts = [`updated=${result.updated}`];
    if (result.relinked > 0) parts.push(`relinked=${result.relinked}`);
    if (result.staleFound > 0) parts.push(`stale_detected=${result.staleFound}`);
    if (result.skipped > 0) parts.push(`skipped=${result.skipped}`);
    if (result.errors.length > 0) parts.push(`errors=${result.errors.length}`);
    logger.info(`[Stripe Customer Sync] Completed: ${parts.join(', ')}`);
    
  } catch (error: unknown) {
    logger.error('[Stripe Customer Sync] Fatal error:', { error: getErrorMessage(error) });
    result.success = false;
    result.errors.push(`Fatal: ${getErrorMessage(error)}`);
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
    needsSync: parseInt(result.rows[0].needs_sync as string, 10) || 0,
    alreadySynced: parseInt(result.rows[0].already_synced as string, 10) || 0,
    total: parseInt(result.rows[0].total as string, 10) || 0,
  };
}

export async function getCachedOrphanedStripeCustomers(): Promise<{
  count: number;
  detectedAt: string;
  customers: Array<{ email: string; stripeCustomerId: string }>;
} | null> {
  try {
    const result = await db.select()
      .from(systemSettings)
      .where(eq(systemSettings.key, 'orphaned_stripe_customers'))
      .limit(1);
    if (result.length === 0 || !result[0].value) return null;
    return JSON.parse(result[0].value);
  } catch {
    return null;
  }
}
