import pRetry, { AbortError } from 'p-retry';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
interface HubSpotErrorObject {
  response?: { statusCode?: number };
  status?: number;
  code?: number;
}

export function isRateLimitError(error: unknown): boolean {
  const errorMsg = getErrorMessage(error);
  const errObj = error as HubSpotErrorObject;
  const statusCode = errObj?.response?.statusCode || errObj?.status || errObj?.code;
  return (
    statusCode === 429 ||
    errorMsg.includes("429") ||
    errorMsg.includes("RATELIMIT_EXCEEDED") ||
    errorMsg.toLowerCase().includes("rate limit")
  );
}

let lastRequestTime = 0;
let consecutiveRateLimits = 0;
const MIN_REQUEST_SPACING_MS = 120;
const RATE_LIMIT_COOLDOWN_MS = 10_000;
let throttleChain: Promise<void> = Promise.resolve();
let _rateLimitEncountered = false;

export function wasRateLimitEncountered(): boolean {
  const val = _rateLimitEncountered;
  _rateLimitEncountered = false;
  return val;
}

async function throttle(): Promise<void> {
  const ticket = throttleChain.then(async () => {
    const now = Date.now();
    const spacing = consecutiveRateLimits > 0
      ? Math.min(MIN_REQUEST_SPACING_MS * Math.pow(2, consecutiveRateLimits), RATE_LIMIT_COOLDOWN_MS)
      : MIN_REQUEST_SPACING_MS;
    const elapsed = now - lastRequestTime;
    if (elapsed < spacing) {
      await new Promise(resolve => setTimeout(resolve, spacing - elapsed));
    }
    lastRequestTime = Date.now();
  });
  throttleChain = ticket.catch(() => { /* intentional: prevents unhandled rejection on the shared chain; the original ticket promise propagates the error to the caller */ });
  return ticket;
}

export async function retryableHubSpotRequest<T>(fn: () => Promise<T>): Promise<T> {
  return pRetry(
    async () => {
      await throttle();
      try {
        const result = await fn();
        if (consecutiveRateLimits > 0) {
          consecutiveRateLimits = Math.max(0, consecutiveRateLimits - 1);
        }
        return result;
      } catch (error: unknown) {
        if (isRateLimitError(error)) {
          consecutiveRateLimits++;
          _rateLimitEncountered = true;
          logger.warn(`HubSpot Rate Limit hit (consecutive: ${consecutiveRateLimits}), backing off...`);
          throw error;
        }
        throw new AbortError(getErrorMessage(error));
      }
    },
    {
      retries: 3,
      minTimeout: 5000,
      maxTimeout: 30000,
      factor: 2
    }
  );
}
