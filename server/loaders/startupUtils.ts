import { logger } from '../core/logger';

export async function retryWithBackoff<T>(fn: () => Promise<T>, label: string, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      if (attempt === maxRetries) throw err;
      const delay = Math.pow(2, attempt) * 1000;
      logger.info(`[Startup] ${label} failed (attempt ${attempt}/${maxRetries}), retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('unreachable');
}

export async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<PromiseSettledResult<void>[]> {
  if (tasks.length === 0) return [];
  const effectiveLimit = Math.max(1, limit);
  const results: PromiseSettledResult<void>[] = [];
  let index = 0;
  let completedCount = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const currentIndex = index++;
      try {
        await tasks[currentIndex]();
        results[currentIndex] = { status: 'fulfilled', value: undefined };
      } catch (err) {
        results[currentIndex] = { status: 'rejected', reason: err };
      }
      completedCount++;
      if (completedCount % effectiveLimit === 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    }
  }

  const workers = Array.from({ length: Math.min(effectiveLimit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}
