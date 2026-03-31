import { db } from '../db';
import { sql } from 'drizzle-orm';
import { schedulerTracker } from '../core/schedulerTracker';
import { upsertVisitor, linkPurchaseToUser } from '../core/visitors/matchingService';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

let intervalId: NodeJS.Timeout | null = null;
let startupTimeoutId: NodeJS.Timeout | null = null;
let isRunning = false;

export interface ReconciliationResult {
  orphansFound: number;
  reconciled: number;
  errors: number;
}

const MAX_ORPHANS_PER_RUN = 50;

export async function reconcileOrphanedDayPassPurchases(): Promise<ReconciliationResult> {
  const result: ReconciliationResult = { orphansFound: 0, reconciled: 0, errors: 0 };

  const orphanRows = await db.execute(sql`
    SELECT DISTINCT ON (LOWER(TRIM(dpp.purchaser_email)))
      dpp.id as purchase_id,
      TRIM(dpp.purchaser_email) as purchaser_email,
      dpp.purchaser_first_name,
      dpp.purchaser_last_name,
      dpp.purchaser_phone,
      dpp.user_id
    FROM day_pass_purchases dpp
    LEFT JOIN users u ON LOWER(TRIM(u.email)) = LOWER(TRIM(dpp.purchaser_email)) AND u.archived_at IS NULL
    WHERE u.id IS NULL
      AND dpp.purchaser_email IS NOT NULL
      AND TRIM(dpp.purchaser_email) != ''
    ORDER BY LOWER(TRIM(dpp.purchaser_email)), dpp.purchased_at DESC
    LIMIT ${MAX_ORPHANS_PER_RUN}
  `);

  const orphans = orphanRows.rows as Array<{
    purchase_id: string;
    purchaser_email: string;
    purchaser_first_name: string | null;
    purchaser_last_name: string | null;
    purchaser_phone: string | null;
    user_id: string | null;
  }>;

  result.orphansFound = orphans.length;

  if (orphans.length === 0) {
    return result;
  }

  logger.warn(`[Visitor Reconciliation] Found ${orphans.length} orphaned day pass purchaser(s) with no matching user record`);

  for (const orphan of orphans) {
    try {
      const user = await upsertVisitor({
        email: orphan.purchaser_email,
        firstName: orphan.purchaser_first_name || undefined,
        lastName: orphan.purchaser_last_name || undefined,
        phone: orphan.purchaser_phone || undefined,
      });

      const unlinkedPurchases = await db.execute(sql`
        SELECT id FROM day_pass_purchases
        WHERE LOWER(TRIM(purchaser_email)) = LOWER(TRIM(${orphan.purchaser_email}))
          AND (user_id IS NULL OR user_id != ${user.id})
      `);

      for (const row of unlinkedPurchases.rows as Array<{ id: string }>) {
        await linkPurchaseToUser(row.id, user.id);
      }

      const linkedCount = (unlinkedPurchases.rows as unknown[]).length;
      logger.info(`[Visitor Reconciliation] Reconciled orphaned purchaser`, {
        extra: {
          userId: user.id,
          linkedPurchases: linkedCount,
        },
      });

      result.reconciled++;
    } catch (err: unknown) {
      logger.error(`[Visitor Reconciliation] Failed to reconcile orphaned purchaser`, {
        extra: {
          error: getErrorMessage(err),
        },
      });
      result.errors++;
    }
  }

  logger.info(`[Visitor Reconciliation] Completed: ${result.reconciled} reconciled, ${result.errors} errors out of ${result.orphansFound} orphans`);
  return result;
}

async function checkAndRunReconciliation(): Promise<void> {
  if (isRunning) {
    logger.info('[Visitor Reconciliation] Skipping run — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    const result = await reconcileOrphanedDayPassPurchases();
    if (result.orphansFound > 0) {
      schedulerTracker.recordRun('Visitor Reconciliation', result.errors === 0);
    } else {
      schedulerTracker.recordRun('Visitor Reconciliation', true);
    }
  } catch (error: unknown) {
    logger.error('[Visitor Reconciliation] Scheduler error:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun('Visitor Reconciliation', false, getErrorMessage(error));
  } finally {
    isRunning = false;
  }
}

const RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startVisitorReconciliationScheduler(): NodeJS.Timeout {
  stopVisitorReconciliationScheduler();
  logger.info('[Startup] Visitor reconciliation scheduler enabled (backfills missing visitor records for day pass purchasers)');

  startupTimeoutId = setTimeout(async () => {
    startupTimeoutId = null;
    if (isRunning) return;
    isRunning = true;
    try {
      logger.info('[Visitor Reconciliation] Running startup reconciliation...');
      const result = await reconcileOrphanedDayPassPurchases();
      if (result.orphansFound > 0) {
        logger.info(`[Visitor Reconciliation] Startup reconciliation: ${result.reconciled} reconciled, ${result.errors} errors`);
      } else {
        logger.info('[Visitor Reconciliation] No orphaned day pass purchasers found');
      }
      schedulerTracker.recordRun('Visitor Reconciliation', result.errors === 0);
    } catch (error: unknown) {
      logger.error('[Visitor Reconciliation] Startup reconciliation error:', { extra: { error: getErrorMessage(error) } });
      schedulerTracker.recordRun('Visitor Reconciliation', false, getErrorMessage(error));
    } finally {
      isRunning = false;
    }
  }, 60000);

  intervalId = setInterval(() => {
    checkAndRunReconciliation().catch((err) => {
      logger.error('[Visitor Reconciliation] Uncaught error:', { extra: { error: getErrorMessage(err) } });
    });
  }, RECONCILIATION_INTERVAL_MS);
  return intervalId;
}

export function stopVisitorReconciliationScheduler(): void {
  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
