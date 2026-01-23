async function scheduleWebhookLogCleanup(): Promise<void> {
  try {
    const { cleanupOldWebhookLogs } = await import('../routes/trackmanWebhook');
    await cleanupOldWebhookLogs();
  } catch (err) {
    console.error('[Webhook Cleanup] Scheduler error:', err);
  }
}

export function startWebhookLogCleanupScheduler(): void {
  setInterval(async () => {
    try {
      const pacificTime = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        hour: 'numeric',
        hour12: false
      }).format(new Date());
      
      if (parseInt(pacificTime) === 4) {
        await scheduleWebhookLogCleanup();
      }
    } catch (err) {
      console.error('[Webhook Cleanup] Check error:', err);
    }
  }, 60 * 60 * 1000);
  
  console.log('[Startup] Webhook log cleanup scheduler enabled (runs daily at 4am Pacific, deletes logs older than 30 days)');
}
