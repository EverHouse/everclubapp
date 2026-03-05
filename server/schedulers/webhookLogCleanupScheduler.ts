import { schedulerTracker } from '../core/schedulerTracker';
import { getPacificHour } from '../utils/dateUtils';
import { logger } from '../core/logger';

let isRunning = false;
let intervalId: NodeJS.Timeout | null = null;

async function scheduleWebhookLogCleanup(): Promise<void> {
  try {
    const { cleanupOldWebhookLogs } = await import('../routes/trackman/index');
    await cleanupOldWebhookLogs();
    schedulerTracker.recordRun('Webhook Log Cleanup', true);
  } catch (err: unknown) {
    logger.error('[Webhook Cleanup] Scheduler error:', { error: err as Error });
    schedulerTracker.recordRun('Webhook Log Cleanup', false, String(err));
  }
}

export function startWebhookLogCleanupScheduler(): NodeJS.Timeout {
  stopWebhookLogCleanupScheduler();
  logger.info('[Startup] Webhook log cleanup scheduler enabled (runs daily at 4am Pacific, deletes logs older than 30 days)');
  intervalId = setInterval(async () => {
    if (isRunning) {
      logger.info('[Webhook Cleanup] Skipping run — previous run still in progress');
      return;
    }
    try {
      if (getPacificHour() === 4) {
        isRunning = true;
        await scheduleWebhookLogCleanup();
      }
    } catch (err: unknown) {
      logger.error('[Webhook Cleanup] Check error:', { error: err as Error });
    } finally {
      isRunning = false;
    }
  }, 60 * 60 * 1000);
  return intervalId;
}

export function stopWebhookLogCleanupScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
