import { queueJob } from '../jobQueue';
import { logger } from '../logger';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../../utils/errorUtils';
import { createPacificDate } from '../../utils/dateUtils';

const CLEANUP_ALERT_MINUTES_BEFORE = 10;

export async function scheduleCleanupAlert(params: {
  bookingId: number;
  requestDate: string;
  endTime: string;
}): Promise<void> {
  const { bookingId, requestDate, endTime } = params;

  try {
    const dateStr = requestDate.split('T')[0];
    const alertDate = createPacificDate(dateStr, endTime);
    alertDate.setMinutes(alertDate.getMinutes() - CLEANUP_ALERT_MINUTES_BEFORE);

    if (alertDate <= new Date()) {
      logger.info(`[CleanupAlert] Skipping schedule — alert time already passed for booking ${bookingId}`);
      return;
    }

    await db.execute(sql`UPDATE booking_requests SET cleanup_notified_at = NULL WHERE id = ${bookingId} AND cleanup_notified_at IS NOT NULL`);

    await queueJob('booking_cleanup_alert', { bookingId }, {
      scheduledFor: alertDate,
      maxRetries: 1,
    });

    logger.info(`[CleanupAlert] Scheduled cleanup alert for booking ${bookingId} at ${alertDate.toISOString()}`);
  } catch (err: unknown) {
    logger.error(`[CleanupAlert] Failed to schedule cleanup alert for booking ${bookingId}`, {
      extra: { error: getErrorMessage(err) }
    });
  }
}

export async function cancelCleanupAlert(bookingId: number): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE job_queue
      SET status = 'completed', processed_at = NOW()
      WHERE job_type = 'booking_cleanup_alert'
        AND status = 'pending'
        AND (payload->>'bookingId')::int = ${bookingId}
    `);
    const rowCount = (result as unknown as { rowCount: number }).rowCount || 0;
    if (rowCount > 0) {
      logger.info(`[CleanupAlert] Cancelled ${rowCount} pending cleanup alert(s) for booking ${bookingId}`);
    }
  } catch (err: unknown) {
    logger.error(`[CleanupAlert] Failed to cancel cleanup alert for booking ${bookingId}`, {
      extra: { error: getErrorMessage(err) }
    });
  }
}
