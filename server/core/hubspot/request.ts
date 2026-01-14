import pRetry, { AbortError } from 'p-retry';
import { isProduction } from '../db';

export function isRateLimitError(error: any): boolean {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const statusCode = error?.response?.statusCode || error?.status || error?.code;
  return (
    statusCode === 429 ||
    errorMsg.includes("429") ||
    errorMsg.includes("RATELIMIT_EXCEEDED") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

export async function retryableHubSpotRequest<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(
    async () => {
      try {
        return await fn();
      } catch (error: any) {
        if (isRateLimitError(error)) {
          if (!isProduction) console.warn('HubSpot Rate Limit hit, retrying...');
          throw error;
        }
        throw new AbortError(error);
      }
    },
    {
      retries: 5,
      minTimeout: 1000,
      maxTimeout: 30000,
      factor: 2
    }
  );
}
