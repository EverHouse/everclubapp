import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

async function run() {
  logger.info('[Migration] Clearing stale visitor_type values for visitor-role users...');
  
  const result = await db.execute(sql`
    UPDATE users
    SET visitor_type = NULL, updated_at = NOW()
    WHERE visitor_type IS NOT NULL
      AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
      AND role NOT IN ('admin', 'staff', 'member')
  `);

  const count = result.rowCount ?? 0;
  logger.info(`[Migration] Cleared stale visitor_type for ${count} users`);
  process.exit(0);
}

run().catch((err) => {
  logger.error('[Migration] Failed to clear stale visitor types', { extra: { error: getErrorMessage(err) } });
  process.exit(1);
});
