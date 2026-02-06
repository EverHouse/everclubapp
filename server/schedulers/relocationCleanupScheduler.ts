import { clearStaleRelocations } from '../routes/bays/reschedule';

export function startRelocationCleanupScheduler(): void {
  setInterval(async () => {
    try {
      await clearStaleRelocations();
    } catch (err) {
      console.error('[Relocation Cleanup] Scheduler error:', err);
    }
  }, 5 * 60 * 1000);

  console.log('[Startup] Relocation cleanup scheduler enabled (runs every 5 minutes)');
}
