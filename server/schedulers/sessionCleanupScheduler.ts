export function startSessionCleanupScheduler(): void {
  setInterval(async () => {
    try {
      const pacificTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false
      }).format(new Date());
      
      if (parseInt(pacificTime) === 2) {
        const { runSessionCleanup } = await import('../core/sessionCleanup');
        await runSessionCleanup();
      }
    } catch (err) {
      console.error('[Session Cleanup] Scheduler error:', err);
    }
  }, 60 * 60 * 1000);
  
  console.log('[Startup] Session cleanup scheduler enabled (runs daily at 2am Pacific)');
}
