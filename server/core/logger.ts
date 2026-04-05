import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getSessionUser } from '../types/session';
import { isPerformanceEnabled, getApiSlowThreshold, recordEndpoint } from './performanceCollector';

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      return value;
    });
  } catch {
    try {
      const ancestors: object[] = [];
      return JSON.stringify(obj, function (_key, value) {
        if (typeof value === 'bigint') return value.toString();
        if (typeof value !== 'object' || value === null) return value;
        while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
          ancestors.pop();
        }
        if (ancestors.includes(value)) return '[Circular]';
        ancestors.push(value);
        return value;
      });
    } catch {
      return '{"level":"ERROR","message":"[Logger] Failed to serialize log entry"}';
    }
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function generateRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  req.requestId = generateRequestId();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

interface LogContext {
  requestId?: string;
  method?: string;
  path?: string;
  userEmail?: string;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  duration?: number;
  statusCode?: number;
  error?: unknown;
  stack?: string;
  extra?: Record<string, unknown>;
  bookingId?: number;
  oldBookingId?: number;
  newBookingId?: number;
  memberEmail?: string;
  bookingEmail?: string | null;
  sessionEmail?: string;
  actingAsEmail?: string;
  normalizedBookingEmail?: string;
  normalizedSessionEmail?: string;
  dbErrorCode?: string;
  dbErrorDetail?: string;
  dbErrorTable?: string;
  dbErrorConstraint?: string;
  [key: string]: unknown;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function sanitize(obj: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!obj) return undefined;
  const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'cookie', 'apikey', 'api_key'];
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export const logger = {
  debug(message: string, context?: LogContext) {
    const log = {
      level: 'DEBUG',
      timestamp: formatTimestamp(),
      message,
      ...context,
      params: sanitize(context?.params),
      query: sanitize(context?.query),
    };
    // eslint-disable-next-line no-console
    console.log(safeStringify(log));
  },

  info(message: string, context?: LogContext) {
    const log = {
      level: 'INFO',
      timestamp: formatTimestamp(),
      message,
      ...context,
      params: sanitize(context?.params),
      query: sanitize(context?.query),
    };
    // eslint-disable-next-line no-console
    console.log(safeStringify(log));
  },

  warn(message: string, context?: LogContext) {
    const log = {
      level: 'WARN',
      timestamp: formatTimestamp(),
      message,
      ...context,
      params: sanitize(context?.params),
      query: sanitize(context?.query),
    };
    console.warn(safeStringify(log));
  },

  error(message: string, context?: LogContext) {
    const errorMsg = context?.error instanceof Error 
      ? context.error.message 
      : context?.error;
    const stack = context?.error instanceof Error 
      ? context.error.stack 
      : context?.stack;
    
    const log = {
      level: 'ERROR',
      timestamp: formatTimestamp(),
      message,
      ...context,
      error: errorMsg,
      stack,
      params: sanitize(context?.params),
      query: sanitize(context?.query),
    };
    console.error(safeStringify(log));
  },
};

const NOISE_PATHS = new Set([
  '/api/v1/workflows',
  '/api/v1/executions',
  '/api/v1/credentials',
  '/api/login',
  '/callback',
  '/index.html.gz',
]);

function isNoisyRequest(method: string, path: string, statusCode: number): boolean {
  if (statusCode === 401) return true;
  if (statusCode === 404 && NOISE_PATHS.has(path)) return true;
  if (statusCode === 404 && method === 'POST' && path.endsWith('.gz')) return true;
  if (statusCode === 404 && (path === '/api/.env' || path === '/api/user' || path === '/api/credentials')) return true;
  return false;
}

export function logRequest(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const context = {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userEmail: getSessionUser(req)?.email,
    };
    const message = `${req.method} ${req.path}`;
    
    if (isPerformanceEnabled() && req.path.startsWith('/api/')) {
      recordEndpoint({
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: duration,
        timestamp: Date.now(),
      });

      const slowThreshold = getApiSlowThreshold();
      if (duration >= slowThreshold) {
        logger.warn(`[Perf] Slow API response: ${req.method} ${req.path} took ${duration}ms (threshold: ${slowThreshold}ms)`, {
          ...context,
          extra: { slowThresholdMs: slowThreshold },
        });
      }
    }

    if (isNoisyRequest(req.method, req.path, res.statusCode)) {
      logger.debug(message, context);
    } else if (res.statusCode >= 400) {
      logger.warn(message, context);
    } else {
      logger.info(message, context);
    }
  });
  
  next();
}

export interface ApiErrorResponse {
  error: string;
  code?: string;
  requestId?: string;
}

export function createErrorResponse(
  req: Request,
  message: string,
  code?: string
): ApiErrorResponse {
  return {
    error: message,
    code,
    requestId: req.requestId,
  };
}

export function logAndRespond(
  req: Request,
  res: Response,
  statusCode: number,
  message: string,
  error?: Error | unknown,
  code?: string
) {
  const err = error instanceof Error ? error : error != null ? new Error(String(error)) : undefined;
  const errObj = (error && typeof error === 'object') ? error as Record<string, unknown> : {};
  
  const dbErrorCode = typeof errObj.code === 'string' ? errObj.code : undefined;
  const dbErrorDetail = typeof errObj.detail === 'string' ? errObj.detail : undefined;
  const dbErrorTable = typeof errObj.table === 'string' ? errObj.table : undefined;
  const dbErrorConstraint = typeof errObj.constraint === 'string' ? errObj.constraint : undefined;
  
  const logPayload = {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    params: req.params,
    query: req.query as Record<string, unknown>,
    error: err?.message,
    stack: err?.stack,
    dbErrorCode,
    dbErrorDetail,
    dbErrorTable,
    dbErrorConstraint,
    userEmail: getSessionUser(req)?.email,
  };

  if (statusCode >= 500) {
    logger.error(`[API Error] ${message}`, logPayload);
  } else if (statusCode === 401) {
    logger.debug(`[API Auth] ${message}`, logPayload);
  } else if (statusCode >= 400) {
    logger.warn(`[API Warn] ${message}`, logPayload);
  } else {
    logger.info(`[API Info] ${message}`, logPayload);
  }
  
  if (statusCode >= 500 && err) {
    import('./errorAlerts').then(({ alertOnServerError }) => {
      alertOnServerError(err, {
        path: req.path,
        method: req.method,
        userEmail: getSessionUser(req)?.email,
        requestId: req.requestId,
        dbErrorCode,
        dbErrorDetail,
        dbErrorTable,
        dbErrorConstraint
      }).catch((err) => {
        console.error('[logger] Failed to send error alert:', err);
      });
    }).catch((err) => {
      console.error('[logger] Failed to send error alert:', err);
    });
  }
  
  res.status(statusCode).json(createErrorResponse(req, message, code));
}
