const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3001';

export async function setup(): Promise<void> {
  console.log('[E2E Global Setup] Checking API server availability...');
  
  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${BASE_URL}/api/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(5000) 
      });
      
      if (response.ok) {
        console.log(`[E2E Global Setup] API server is available at ${BASE_URL}`);
        return;
      }
      
      lastError = new Error(`API server returned status ${response.status}`);
    } catch (err) {
      lastError = err as Error;
    }
    
    if (i < maxRetries - 1) {
      console.log(`[E2E Global Setup] Retry ${i + 1}/${maxRetries} - waiting 2s...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  throw new Error(
    `\n\n` +
    `==========================================================\n` +
    `  CRITICAL: API SERVER IS NOT AVAILABLE\n` +
    `==========================================================\n` +
    `\n` +
    `  URL: ${BASE_URL}\n` +
    `  Error: ${lastError?.message || 'Unknown error'}\n` +
    `\n` +
    `  E2E tests require a running API server.\n` +
    `  Please start the server before running tests.\n` +
    `\n` +
    `==========================================================\n`
  );
}

export async function teardown(): Promise<void> {
  console.log('[E2E Global Setup] Test suite completed.');
}
