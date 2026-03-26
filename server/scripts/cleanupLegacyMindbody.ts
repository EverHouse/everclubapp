import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

export async function cleanupLegacyMindbodyData(): Promise<{
  reclassifiedVisitors: number;
  deletedLegacyPurchases: number;
  clearedLegacySources: number;
}> {
  const results = {
    reclassifiedVisitors: 0,
    deletedLegacyPurchases: 0,
    clearedLegacySources: 0,
  };

  try {
    logger.info('[LegacyCleanup] Starting legacy MindBody data cleanup...');

    const reclassifyResult = await db.execute(sql`
      WITH legacy_visitors AS (
        SELECT u.id, u.email, u.visitor_type
        FROM users u
        WHERE u.visitor_type IN ('classpass', 'sim_walkin', 'private_lesson', 'lead')
          AND (u.role = 'visitor' OR u.membership_status IN ('visitor', 'non-member'))
          AND u.role NOT IN ('admin', 'staff', 'member')
      ),
      day_pass_buyers AS (
        SELECT DISTINCT LOWER(purchaser_email) as email
        FROM day_pass_purchases
      ),
      guest_participants AS (
        SELECT DISTINCT LOWER(g.email) as email
        FROM booking_participants bp
        JOIN guests g ON bp.guest_id = g.id
        WHERE bp.participant_type = 'guest'
      ),
      new_types AS (
        SELECT 
          lv.id,
          CASE
            WHEN dpb.email IS NOT NULL THEN 'day_pass'
            WHEN gp.email IS NOT NULL THEN 'guest'
            ELSE 'NEW'
          END as new_type
        FROM legacy_visitors lv
        LEFT JOIN day_pass_buyers dpb ON LOWER(lv.email) = dpb.email
        LEFT JOIN guest_participants gp ON LOWER(lv.email) = gp.email
      )
      UPDATE users u
      SET visitor_type = nt.new_type, updated_at = NOW()
      FROM new_types nt
      WHERE u.id = nt.id
    `);
    results.reclassifiedVisitors = reclassifyResult.rowCount ?? 0;
    logger.info(`[LegacyCleanup] Reclassified ${results.reclassifiedVisitors} visitors with legacy types`);

    const deleteResult = await db.execute(sql`
      DELETE FROM legacy_purchases
      WHERE item_category IS DISTINCT FROM 'guest_pass'
        AND (payment_method IS DISTINCT FROM 'guest_pass' OR payment_method IS NULL)
    `);
    results.deletedLegacyPurchases = deleteResult.rowCount ?? 0;
    logger.info(`[LegacyCleanup] Deleted ${results.deletedLegacyPurchases} MindBody-imported legacy purchase records`);

    const clearSourceResult = await db.execute(sql`
      UPDATE users
      SET legacy_source = NULL, updated_at = NOW()
      WHERE legacy_source = 'mindbody_import'
    `);
    results.clearedLegacySources = clearSourceResult.rowCount ?? 0;
    logger.info(`[LegacyCleanup] Cleared legacy_source from ${results.clearedLegacySources} users`);

    logger.info('[LegacyCleanup] Legacy MindBody data cleanup complete', results);
    return results;
  } catch (error: unknown) {
    logger.error('[LegacyCleanup] Error during legacy MindBody cleanup:', { error: getErrorMessage(error) });
    throw error;
  }
}
