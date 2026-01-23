const CLEANUP_DAY = 0;
const CLEANUP_HOUR = 3;
let lastCleanupWeek = -1;

async function checkAndRunCleanup(): Promise<void> {
  try {
    const now = new Date();
    const currentDay = now.getDay();
    const currentHour = now.getHours();
    const currentWeek = Math.floor(now.getTime() / (7 * 24 * 60 * 60 * 1000));
    
    if (currentDay === CLEANUP_DAY && currentHour === CLEANUP_HOUR && currentWeek !== lastCleanupWeek) {
      lastCleanupWeek = currentWeek;
      console.log('[Cleanup] Starting weekly cleanup...');
      
      const { runScheduledCleanup } = await import('../core/databaseCleanup');
      await runScheduledCleanup();
      
      const { runSessionCleanup } = await import('../core/sessionCleanup');
      await runSessionCleanup();
      
      console.log('[Cleanup] Weekly cleanup completed');
    }
  } catch (err) {
    console.error('[Cleanup] Scheduler error:', err);
  }
}

export function startWeeklyCleanupScheduler(): void {
  setInterval(checkAndRunCleanup, 60 * 60 * 1000);
  console.log('[Startup] Weekly cleanup scheduler enabled (runs Sundays at 3am)');
}
