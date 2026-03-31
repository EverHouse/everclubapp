import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';
import { schedulerTracker } from '../core/schedulerTracker';
import { reportWellhubUsageEvent, markEventReported, getUnreportedCheckins, getUnreportedForMonth } from '../core/wellhubEventsService';
import { notifyAllStaff } from '../core/notificationService';

let nightlyIntervalId: NodeJS.Timeout | null = null;
let monthlyIntervalId: NodeJS.Timeout | null = null;
let startupTimeoutId: NodeJS.Timeout | null = null;
let isRunningNightly = false;
let isRunningMonthly = false;
let lastMonthlySweepDate: string | null = null;

const NIGHTLY_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MONTHLY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RATE_LIMIT_DELAY_MS = 1300;
const BATCH_PAUSE_MS = 5000;
const BATCH_SIZE = 40;

export async function reconcileUnreportedEvents(): Promise<{ attempted: number; succeeded: number; failed: number; rateLimited: number }> {
  const unreported = await getUnreportedCheckins(35);
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let rateLimited = 0;

  if (unreported.length === 0) {
    logger.info('[Wellhub Event Reconciliation] No unreported events found');
    return { attempted, succeeded, failed, rateLimited };
  }

  logger.info(`[Wellhub Event Reconciliation] Found ${unreported.length} unreported events to reconcile`);

  let consecutiveRateLimits = 0;
  const MAX_RATE_LIMIT_RETRIES = 3;

  for (let i = 0; i < unreported.length; i++) {
    const checkin = unreported[i];
    attempted++;

    try {
      const eventTimestamp = checkin.event_timestamp || checkin.created_at;
      const result = await reportWellhubUsageEvent(checkin.wellhub_user_id, 'checkin', new Date(eventTimestamp));

      if (result.success) {
        await markEventReported(checkin.id);
        succeeded++;
        consecutiveRateLimits = 0;
      } else if (result.rateLimited) {
        rateLimited++;
        consecutiveRateLimits++;
        if (consecutiveRateLimits >= MAX_RATE_LIMIT_RETRIES) {
          logger.warn('[Wellhub Event Reconciliation] Too many consecutive rate limits, stopping batch');
          break;
        }
        logger.warn('[Wellhub Event Reconciliation] Rate limited, pausing 60s before retry', { extra: { checkinId: checkin.id } });
        await new Promise(resolve => setTimeout(resolve, 60000));
        i--;
        continue;
      } else {
        failed++;
        logger.warn('[Wellhub Event Reconciliation] Failed to report event', { extra: { checkinId: checkin.id, error: result.error } });
      }
    } catch (err: unknown) {
      failed++;
      logger.error('[Wellhub Event Reconciliation] Error reporting event', { extra: { checkinId: checkin.id, error: getErrorMessage(err) } });
    }

    if ((i + 1) % BATCH_SIZE === 0) {
      await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
    } else if (i < unreported.length - 1) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }
  }

  logger.info('[Wellhub Event Reconciliation] Complete', { extra: { attempted, succeeded, failed, rateLimited } });
  return { attempted, succeeded, failed, rateLimited };
}

function isPacificHour(targetHour: number): boolean {
  const now = new Date();
  const pacificTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return pacificTime.getHours() === targetHour;
}

async function nightlyCheck(): Promise<void> {
  if (isRunningNightly) {
    logger.info('[Wellhub Event Reconciliation] Skipping nightly — previous run still in progress');
    return;
  }

  if (!isPacificHour(2)) {
    return;
  }

  isRunningNightly = true;
  try {
    const result = await reconcileUnreportedEvents();
    schedulerTracker.recordRun('Wellhub Event Reconciliation', true);

    if (result.failed > 0) {
      await notifyAllStaff(
        'Wellhub Event Reconciliation Issues',
        `Nightly reconciliation: ${result.succeeded} reported, ${result.failed} failed, ${result.rateLimited} rate-limited out of ${result.attempted} total`,
        'warning'
      );
    }
  } catch (error: unknown) {
    logger.error('[Wellhub Event Reconciliation] Nightly check error:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun('Wellhub Event Reconciliation', false, getErrorMessage(error));
  } finally {
    isRunningNightly = false;
  }
}

export async function monthlyDeadlineSweep(): Promise<void> {
  if (isRunningMonthly) {
    logger.info('[Wellhub Monthly Sweep] Skipping — previous run still in progress');
    return;
  }

  const now = new Date();
  const pacificTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

  if (pacificTime.getDate() !== 3) {
    return;
  }

  const todayKey = `${pacificTime.getFullYear()}-${pacificTime.getMonth()}-${pacificTime.getDate()}`;
  if (lastMonthlySweepDate === todayKey) {
    return;
  }

  isRunningMonthly = true;
  lastMonthlySweepDate = todayKey;
  try {
    const priorMonth = pacificTime.getMonth() === 0 ? 12 : pacificTime.getMonth();
    const priorYear = pacificTime.getMonth() === 0 ? pacificTime.getFullYear() - 1 : pacificTime.getFullYear();

    const unreported = await getUnreportedForMonth(priorYear, priorMonth);

    if (unreported.length === 0) {
      logger.info('[Wellhub Monthly Sweep] All prior-month events reported');
      schedulerTracker.recordRun('Wellhub Monthly Sweep', true);
      return;
    }

    logger.info(`[Wellhub Monthly Sweep] Found ${unreported.length} unreported events from ${priorYear}-${String(priorMonth).padStart(2, '0')}`);

    let succeeded = 0;
    let failed = 0;
    let consecutiveRateLimits = 0;

    for (let i = 0; i < unreported.length; i++) {
      const checkin = unreported[i];
      try {
        const eventTimestamp = checkin.event_timestamp || checkin.created_at;
        const result = await reportWellhubUsageEvent(checkin.wellhub_user_id, 'checkin', new Date(eventTimestamp));

        if (result.success) {
          await markEventReported(checkin.id);
          succeeded++;
          consecutiveRateLimits = 0;
        } else if (result.rateLimited) {
          consecutiveRateLimits++;
          if (consecutiveRateLimits >= 3) {
            logger.warn('[Wellhub Monthly Sweep] Too many consecutive rate limits, stopping batch');
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 60000));
          i--;
          continue;
        } else {
          failed++;
        }
      } catch (err: unknown) {
        failed++;
        logger.error('[Wellhub Monthly Sweep] Error', { extra: { checkinId: checkin.id, error: getErrorMessage(err) } });
      }

      if (i > 0 && i % BATCH_SIZE === 0) {
        await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
      } else if (i < unreported.length - 1) {
        await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
      }
    }

    const remainingUnreported = await getUnreportedForMonth(priorYear, priorMonth);

    if (remainingUnreported.length > 0) {
      await notifyAllStaff(
        'Wellhub Monthly Deadline Warning',
        `${remainingUnreported.length} Wellhub usage events from ${priorYear}-${String(priorMonth).padStart(2, '0')} remain unreported. Wellhub deadline is the 5th. Please investigate.`,
        'error'
      );
    }

    logger.info('[Wellhub Monthly Sweep] Complete', { extra: { succeeded, failed, remaining: remainingUnreported.length } });
    schedulerTracker.recordRun('Wellhub Monthly Sweep', true);
  } catch (error: unknown) {
    logger.error('[Wellhub Monthly Sweep] Error:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun('Wellhub Monthly Sweep', false, getErrorMessage(error));
  } finally {
    isRunningMonthly = false;
  }
}

export function startWellhubEventReconciliationScheduler(): void {
  stopWellhubEventReconciliationScheduler();

  startupTimeoutId = setTimeout(() => {
    nightlyCheck().catch(err => logger.error('[Wellhub Event Reconciliation] Startup error', { extra: { error: getErrorMessage(err) } }));
  }, 120000);

  nightlyIntervalId = setInterval(() => {
    nightlyCheck().catch(err => logger.error('[Wellhub Event Reconciliation] Interval error', { extra: { error: getErrorMessage(err) } }));
  }, 60 * 60 * 1000);

  monthlyIntervalId = setInterval(() => {
    monthlyDeadlineSweep().catch(err => logger.error('[Wellhub Monthly Sweep] Interval error', { extra: { error: getErrorMessage(err) } }));
  }, MONTHLY_CHECK_INTERVAL_MS);
}

export function stopWellhubEventReconciliationScheduler(): void {
  if (startupTimeoutId) {
    clearTimeout(startupTimeoutId);
    startupTimeoutId = null;
  }
  if (nightlyIntervalId) {
    clearInterval(nightlyIntervalId);
    nightlyIntervalId = null;
  }
  if (monthlyIntervalId) {
    clearInterval(monthlyIntervalId);
    monthlyIntervalId = null;
  }
}
