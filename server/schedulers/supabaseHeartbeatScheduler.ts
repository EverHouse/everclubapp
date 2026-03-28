import { schedulerTracker } from '../core/schedulerTracker';
import { logger } from '../core/logger';
import { isSupabaseConfigured, getSupabaseAdmin, isRealtimeEnabled, resetSupabaseAvailability, enableRealtimeWithRetry } from '../core/supabase/client';
import { getErrorMessage } from '../utils/errorUtils';

let intervalId: NodeJS.Timeout | null = null;
let initialTimerId: NodeJS.Timeout | null = null;

const HEARTBEAT_INTERVAL = 60 * 60 * 1000;

const HEARTBEAT_TIMEOUT = 30000;

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5000;

async function runHeartbeat(): Promise<void> {
  if (!isSupabaseConfigured()) {
    logger.debug('[Supabase Heartbeat] Skipped - Supabase not configured');
    return;
  }

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const supabase = getSupabaseAdmin();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT);

      try {
        const { count, error } = await supabase
          .from('users')
          .select('id', { count: 'exact', head: true })
          .abortSignal(controller.signal);

        clearTimeout(timeoutId);

        if (error) {
          throw new Error(`Supabase heartbeat query failed: ${error.message}`);
        }

        logger.info(`[Supabase Heartbeat] Ping successful - ${count ?? 0} users in Supabase`);
      } catch (err) {
        clearTimeout(timeoutId);
        throw err;
      }

      if (!isRealtimeEnabled()) {
        logger.info('[Supabase Heartbeat] Realtime not enabled — attempting recovery...');
        resetSupabaseAvailability();
        const { successCount, total } = await enableRealtimeWithRetry();
        if (successCount > 0) {
          logger.info(`[Supabase Heartbeat] Realtime recovery succeeded (${successCount}/${total} tables)`);
        } else {
          logger.warn('[Supabase Heartbeat] Realtime recovery failed — will retry next heartbeat');
        }
      }

      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(getErrorMessage(err));
      if (attempt <= MAX_RETRIES) {
        logger.warn(`[Supabase Heartbeat] Attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS / 1000}s...`, { extra: { error: getErrorMessage(lastError) } });
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      }
    }
  }

  throw lastError ?? new Error('Supabase heartbeat failed after retries');
}

export function startSupabaseHeartbeatScheduler(): void {
  stopSupabaseHeartbeatScheduler();
  logger.info('[Startup] Supabase heartbeat scheduler enabled (runs every 1 hour)');

  initialTimerId = setTimeout(async () => {
    initialTimerId = null;
    try {
      await runHeartbeat();
      schedulerTracker.recordRun('Supabase Heartbeat', true);
    } catch (err: unknown) {
      logger.error('[Supabase Heartbeat] Initial run error:', { extra: { error: getErrorMessage(err) } });
      schedulerTracker.recordRun('Supabase Heartbeat', false, getErrorMessage(err));
    }
  }, 30 * 1000);

  let heartbeatRunning = false;
  intervalId = setInterval(() => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;
    runHeartbeat()
      .then(() => schedulerTracker.recordRun('Supabase Heartbeat', true))
      .catch((err: unknown) => {
        logger.error('[Supabase Heartbeat] Scheduler error:', { extra: { error: getErrorMessage(err) } });
        schedulerTracker.recordRun('Supabase Heartbeat', false, getErrorMessage(err));
      })
      .finally(() => { heartbeatRunning = false; });
  }, HEARTBEAT_INTERVAL);
}

export function stopSupabaseHeartbeatScheduler(): void {
  if (initialTimerId) {
    clearTimeout(initialTimerId);
    initialTimerId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
