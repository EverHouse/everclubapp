import { schedulerTracker } from '../core/schedulerTracker';
import { syncGoogleCalendarEvents, syncWellnessCalendarEvents, syncInternalCalendarToClosures, syncConferenceRoomCalendarToBookings } from '../core/calendar/index';
import { syncToursFromCalendar } from '../routes/tours';
import { alertOnSyncFailure } from '../core/dataAlerts';

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
const consecutiveFailures: Record<string, number> = {};
const ALERT_THRESHOLD = 2;

async function syncWithRetry<T extends { error?: string }>(
  name: string,
  syncFn: () => Promise<T>,
  fallback: T
): Promise<T> {
  let result: T;
  try {
    result = await syncFn();
  } catch {
    result = fallback;
  }

  if (!result.error) {
    if (consecutiveFailures[name] && consecutiveFailures[name] > 0) {
      console.log(`[Auto-sync] ${name} recovered after ${consecutiveFailures[name]} consecutive failure(s)`);
    }
    consecutiveFailures[name] = 0;
    return result;
  }

  console.warn(`[Auto-sync] ${name} failed, retrying in 5s...`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    result = await syncFn();
  } catch {
    result = fallback;
  }

  if (!result.error) {
    consecutiveFailures[name] = 0;
    console.log(`[Auto-sync] ${name} succeeded on retry`);
    return result;
  }

  consecutiveFailures[name] = (consecutiveFailures[name] || 0) + 1;
  console.error(`[Auto-sync] ${name} failed after retry (consecutive: ${consecutiveFailures[name]})`);

  if (consecutiveFailures[name] >= ALERT_THRESHOLD) {
    alertOnSyncFailure(
      'calendar',
      `${name} calendar sync`,
      new Error(result.error || `${name} sync failed`),
      { calendarName: name }
    ).catch(err => {
      console.error(`[Auto-sync] Failed to send ${name} failure alert:`, err);
    });
  } else {
    console.log(`[Auto-sync] ${name}: first consecutive failure — will alert if next sync also fails`);
  }

  return result;
}

const runBackgroundSync = async () => {
  try {
    const eventsResult = await syncWithRetry('Events', () => syncGoogleCalendarEvents({ suppressAlert: true }), { synced: 0, created: 0, updated: 0, deleted: 0, error: 'Events sync failed' });
    const wellnessResult = await syncWithRetry('Wellness', () => syncWellnessCalendarEvents({ suppressAlert: true }), { synced: 0, created: 0, updated: 0, deleted: 0, error: 'Wellness sync failed' });
    const toursResult = await syncWithRetry('Tours', () => syncToursFromCalendar(), { synced: 0, created: 0, updated: 0, cancelled: 0, error: 'Tours sync failed' });
    const closuresResult = await syncWithRetry('Closures', () => syncInternalCalendarToClosures(), { synced: 0, created: 0, updated: 0, deleted: 0, error: 'Closures sync failed' });
    const confRoomResult = await syncWithRetry('ConfRoom', () => syncConferenceRoomCalendarToBookings(), { synced: 0, linked: 0, created: 0, skipped: 0, error: 'Conference room sync failed' }) as { synced: number; linked: number; created: number; skipped: number; error?: string; warning?: string };
    const eventsMsg = eventsResult.error ? eventsResult.error : `${eventsResult.synced} synced`;
    const wellnessMsg = wellnessResult.error ? wellnessResult.error : `${wellnessResult.synced} synced`;
    const toursMsg = toursResult.error ? toursResult.error : `${(toursResult as any).synced} synced`;
    const closuresMsg = closuresResult.error ? closuresResult.error : `${(closuresResult as any).synced} synced`;
    const confRoomMsg = confRoomResult.error ? confRoomResult.error : (confRoomResult.warning ? 'not configured' : `${confRoomResult.synced} synced`);
    console.log(`[Auto-sync] Events: ${eventsMsg}, Wellness: ${wellnessMsg}, Tours: ${toursMsg}, Closures: ${closuresMsg}, ConfRoom: ${confRoomMsg}`);
  } catch (err) {
    console.error('[Auto-sync] Calendar sync failed:', err);
    schedulerTracker.recordRun('Background Sync', false, String(err));
  } finally {
    setTimeout(runBackgroundSync, SYNC_INTERVAL_MS);
  }
};

export function startBackgroundSyncScheduler(): void {
  setTimeout(runBackgroundSync, SYNC_INTERVAL_MS);
  console.log('[Startup] Background calendar sync enabled (every 5 minutes, first sync in 5 minutes)');
}
