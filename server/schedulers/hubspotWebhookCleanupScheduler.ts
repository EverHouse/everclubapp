import { schedulerTracker } from '../core/schedulerTracker';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

async function cleanupOldHubSpotWebhooks(): Promise<void> {
  try {
    const result = await db.execute(
      sql`DELETE FROM hubspot_processed_webhooks WHERE processed_at < NOW() - INTERVAL '7 days'`
    );

    logger.info(`[HubSpot Webhook Cleanup] Deleted ${result.rowCount} old webhook deduplication record(s)`);
    schedulerTracker.recordRun('HubSpot Webhook Cleanup', true);
  } catch (error: unknown) {
    logger.error('[HubSpot Webhook Cleanup] Scheduler error:', { error: error as Error });
    schedulerTracker.recordRun('HubSpot Webhook Cleanup', false, getErrorMessage(error));
  }
}

let intervalId: NodeJS.Timeout | null = null;
let isRunning = false;

async function guardedCleanup(): Promise<void> {
  if (isRunning) {
    logger.info('[HubSpot Webhook Cleanup] Skipping run — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    await cleanupOldHubSpotWebhooks();
  } finally {
    isRunning = false;
  }
}

export function startHubSpotWebhookCleanupScheduler(): void {
  if (intervalId) {
    logger.info('[HubSpot Webhook Cleanup] Scheduler already running');
    return;
  }

  logger.info('[Startup] HubSpot webhook cleanup scheduler enabled (runs every 24 hours)');

  intervalId = setInterval(() => {
    guardedCleanup().catch((err: unknown) => {
      logger.error('[HubSpot Webhook Cleanup] Uncaught error:', { error: err as Error });
      schedulerTracker.recordRun('HubSpot Webhook Cleanup', false, getErrorMessage(err));
    });
  }, 24 * 60 * 60 * 1000);

  setTimeout(() => {
    guardedCleanup().catch((err: unknown) => {
      logger.error('[HubSpot Webhook Cleanup] Initial run error:', { error: err as Error });
      schedulerTracker.recordRun('HubSpot Webhook Cleanup', false, getErrorMessage(err));
    });
  }, 6 * 60 * 1000);
}

export function stopHubSpotWebhookCleanupScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[HubSpot Webhook Cleanup] Scheduler stopped');
  }
}
