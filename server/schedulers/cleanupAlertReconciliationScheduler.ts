import { schedulerTracker } from '../core/schedulerTracker';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { scheduleCleanupAlert } from '../core/bookingService/cleanupAlertScheduler';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

const SCHEDULER_NAME = 'Cleanup Alert Reconciliation';
const PERIODIC_INTERVAL_MS = 30 * 60 * 1000;
const PERIODIC_LOOKAHEAD_HOURS = 3;

let intervalId: NodeJS.Timeout | null = null;
let startupTimeoutId: NodeJS.Timeout | null = null;
let isRunning = false;

interface MissingAlertBooking {
  id: number;
  request_date: string;
  end_time: string;
}

async function reconcileCleanupAlerts(options: { isStartup: boolean }): Promise<void> {
  const label = options.isStartup ? 'Startup' : 'Periodic';

  try {
    const lookaheadCondition = options.isStartup
      ? sql`TRUE`
      : sql`(br.request_date + br.end_time::time) < ((NOW() AT TIME ZONE 'America/Los_Angeles') + INTERVAL '${sql.raw(String(PERIODIC_LOOKAHEAD_HOURS))} hours')::timestamp`;

    const result = await db.execute(sql`
      SELECT br.id, br.request_date::text AS request_date, br.end_time::text AS end_time
      FROM booking_requests br
      WHERE br.status IN ('approved', 'confirmed', 'checked_in')
        AND br.end_time IS NOT NULL
        AND br.cleanup_notified_at IS NULL
        AND (br.request_date > CURRENT_DATE OR (br.request_date = CURRENT_DATE AND br.end_time > (NOW() AT TIME ZONE 'America/Los_Angeles')::time))
        AND ${lookaheadCondition}
        AND NOT EXISTS (
          SELECT 1 FROM job_queue jq
          WHERE jq.job_type = 'booking_cleanup_alert'
            AND jq.status = 'pending'
            AND (jq.payload->>'bookingId')::int = br.id
        )
      ORDER BY br.request_date, br.end_time
    `);

    const bookings = result.rows as unknown as MissingAlertBooking[];

    if (bookings.length === 0) {
      logger.info(`[CleanupAlert] ${label} reconciliation: no missing cleanup alert jobs found`);
      schedulerTracker.recordRun(SCHEDULER_NAME, true);
      return;
    }

    logger.info(`[CleanupAlert] ${label} reconciliation: found ${bookings.length} booking(s) missing cleanup alert jobs`);

    let scheduled = 0;
    let skipped = 0;

    for (const booking of bookings) {
      try {
        await scheduleCleanupAlert({
          bookingId: booking.id,
          requestDate: booking.request_date,
          endTime: booking.end_time,
        });
        scheduled++;
      } catch (err: unknown) {
        skipped++;
        logger.warn(`[CleanupAlert] ${label} reconciliation: failed to schedule alert for booking ${booking.id}`, {
          extra: { error: getErrorMessage(err) }
        });
      }
    }

    logger.info(`[CleanupAlert] ${label} reconciliation complete: ${scheduled} scheduled, ${skipped} skipped`);
    schedulerTracker.recordRun(SCHEDULER_NAME, true);
  } catch (err: unknown) {
    logger.error(`[CleanupAlert] ${label} reconciliation failed`, {
      extra: { error: getErrorMessage(err) }
    });
    schedulerTracker.recordRun(SCHEDULER_NAME, false, getErrorMessage(err));
  }
}

async function guardedReconcile(isStartup: boolean): Promise<void> {
  if (isRunning) {
    logger.info('[CleanupAlert] Skipping reconciliation — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    await reconcileCleanupAlerts({ isStartup });
  } finally {
    isRunning = false;
  }
}

export function startCleanupAlertReconciliationScheduler(): void {
  if (intervalId) {
    logger.info('[CleanupAlert] Reconciliation scheduler already running');
    return;
  }

  logger.info(`[Startup] Cleanup alert reconciliation scheduler enabled (runs every ${PERIODIC_INTERVAL_MS / 60000} minutes)`);

  startupTimeoutId = setTimeout(() => {
    startupTimeoutId = null;
    guardedReconcile(true).catch((err: unknown) => {
      logger.error('[CleanupAlert] Startup reconciliation error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 15_000);

  intervalId = setInterval(() => {
    guardedReconcile(false).catch((err: unknown) => {
      logger.error('[CleanupAlert] Periodic reconciliation error:', { extra: { error: getErrorMessage(err) } });
    });
  }, PERIODIC_INTERVAL_MS);
}

export function stopCleanupAlertReconciliationScheduler(): void {
  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[CleanupAlert] Reconciliation scheduler stopped');
  }
}
