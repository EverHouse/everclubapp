import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

export class AbortError extends Error {
  readonly name = 'AbortError';
  constructor(messageOrError: string | Error) {
    super(typeof messageOrError === 'string' ? messageOrError : messageOrError.message);
    if (messageOrError instanceof Error) {
      this.stack = messageOrError.stack;
    }
  }
}

export interface FailedAttemptError extends Error {
  attemptNumber: number;
  retriesLeft: number;
}

export interface RetryOptions {
  retries?: number;
  context?: string;
  onRetry?: (error: FailedAttemptError, attempt: number) => void;
}

interface ErrorWithResponse {
  response?: { status?: number; statusCode?: number };
  status?: number | string;
  code?: number | string;
  message?: string;
}

function isRetryableError(error: unknown): boolean {
  const errObj = error as ErrorWithResponse;
  const response = errObj?.response;
  const statusCode = response?.status || response?.statusCode || errObj?.status || errObj?.code;
  const errorMsg = getErrorMessage(error);
  
  if (statusCode === 429) return true;
  if (typeof statusCode === 'number' && statusCode >= 500 && statusCode < 600) return true;
  
  const networkPatterns = [
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'network',
    'socket hang up',
    'timeout',
    'rate limit',
    'too many requests',
    '429',
    '500',
    '502',
    '503',
    '504'
  ];
  
  const lowerMsg = errorMsg.toLowerCase();
  return networkPatterns.some(pattern => lowerMsg.includes(pattern.toLowerCase()));
}

function isNonRetryableClientError(error: unknown): boolean {
  const errObj = error as ErrorWithResponse;
  const response = errObj?.response;
  const statusCode = response?.status || response?.statusCode || errObj?.status || errObj?.code;
  
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
    return true;
  }
  
  const errorMsg = getErrorMessage(error);
  const lowerMsg = errorMsg.toLowerCase();
  const clientErrorPatterns = [
    'not found',
    'unauthorized',
    'forbidden',
    'bad request',
    'invalid',
    '400',
    '401',
    '403',
    '404'
  ];
  
  if (clientErrorPatterns.some(pattern => lowerMsg.includes(pattern)) && !isRetryableError(error)) {
    return true;
  }
  
  return false;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    retries: number;
    minTimeout: number;
    maxTimeout: number;
    factor: number;
    onFailedAttempt?: (error: FailedAttemptError) => void;
  }
): Promise<T> {
  const { retries, minTimeout, maxTimeout, factor, onFailedAttempt } = options;

  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (error instanceof AbortError) {
        throw error;
      }

      const isLastAttempt = attempt > retries;
      if (isLastAttempt) {
        throw error;
      }

      const failedErr = Object.assign(
        error instanceof Error ? error : new Error(getErrorMessage(error)),
        { attemptNumber: attempt, retriesLeft: retries - attempt + 1 }
      ) as FailedAttemptError;

      if (onFailedAttempt) {
        onFailedAttempt(failedErr);
      }

      const delay = Math.min(minTimeout * Math.pow(factor, attempt - 1), maxTimeout);
      const jitter = delay * 0.1 * Math.random();
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }

  throw new Error('Retry loop exited unexpectedly');
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { retries = 3, context = 'API' } = options;

  return retryWithBackoff(
    async () => {
      try {
        return await fn();
      } catch (error: unknown) {
        if (isNonRetryableClientError(error)) {
          throw new AbortError(getErrorMessage(error));
        }

        if (isRetryableError(error)) {
          throw error;
        }

        throw new AbortError(getErrorMessage(error));
      }
    },
    {
      retries,
      minTimeout: 1000,
      maxTimeout: 30000,
      factor: 2,
      onFailedAttempt: (error) => {
        logger.warn(`[${context}] Retry attempt ${error.attemptNumber}/${retries + 1}`, {
          extra: {
            event: 'retry_attempt',
            context,
            attempt: error.attemptNumber,
            retriesLeft: error.retriesLeft,
            error: getErrorMessage(error)
          }
        });

        if (options.onRetry) {
          options.onRetry(error, error.attemptNumber);
        }
      }
    }
  );
}

export async function withCalendarRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries: number = 3
): Promise<T> {
  return withRetry(fn, {
    retries,
    context: `Calendar:${operation}`
  });
}

export async function withResendRetry<T>(
  fn: () => Promise<T>,
  retries: number = 3
): Promise<T> {
  return withRetry(fn, {
    retries,
    context: 'Resend'
  });
}

export async function withHubSpotRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries: number = 3
): Promise<T> {
  return withRetry(fn, {
    retries,
    context: `HubSpot:${operation}`
  });
}

export async function withStripeRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries: number = 2
): Promise<T> {
  return withRetry(fn, {
    retries,
    context: `Stripe:${operation}`
  });
}

export async function withDatabaseRetry<T>(
  fn: () => Promise<T>,
  operation: string,
  retries: number = 2
): Promise<T> {
  return withRetry(fn, {
    retries,
    context: `Database:${operation}`
  });
}

export function createConcurrencyLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          if (queue.length > 0) {
            queue.shift()!();
          }
        });
      };

      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}
