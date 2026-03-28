import { db } from '../../db';
import { discountRules, type DiscountRule } from '../../../shared/models/hubspot-billing';
import { eq, sql } from 'drizzle-orm';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';

export async function getAllDiscountRules(): Promise<DiscountRule[]> {
  try {
    const rules = await db.select().from(discountRules).orderBy(discountRules.discountPercent);
    return rules;
  } catch (error: unknown) {
    logger.error('[HubSpotDeals] Error fetching discount rules:', { extra: { error: getErrorMessage(error) } });
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
  } catch (error: unknown) {
    logger.error('[HubSpotDeals] Error updating discount rule:', { extra: { error: getErrorMessage(error) } });
    return false;
  }
}

interface BillingAuditLogEntry {
  id: number;
  action: string;
  actor_email: string | null;
  actor_type: string | null;
  resource_type: string;
  resource_id: string;
  resource_name: string | null;
  details: Record<string, unknown> | null;
  created_at: Date | string;
}

export async function getBillingAuditLog(memberEmail: string, limit: number = 50): Promise<BillingAuditLogEntry[]> {
  try {
    const result = await db.execute(sql`SELECT id, action, actor_email, actor_type, resource_type, resource_id, resource_name, details, created_at FROM admin_audit_log 
       WHERE resource_type = 'billing'
       AND resource_id = ${memberEmail.toLowerCase()} 
       ORDER BY created_at DESC 
       LIMIT ${limit}`);
    return result.rows as unknown as BillingAuditLogEntry[];
  } catch (error: unknown) {
    logger.error('[HubSpotDeals] Error fetching billing audit log:', { extra: { error: getErrorMessage(error) } });
    return [];
  }
}
