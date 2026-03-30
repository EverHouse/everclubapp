import { Request, Response, NextFunction, RequestHandler } from 'express';
import { logFromRequest, AuditAction, ResourceType } from '../core/auditLog';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

declare global {
  namespace Express {
    interface Request {
      _auditLogged?: boolean;
    }
  }
}

interface StaffAuditOptions {
  action: AuditAction;
  resourceType: ResourceType;
  getResourceId?: (req: Request) => string | undefined;
  getResourceName?: (req: Request) => string | undefined;
  getDetails?: (req: Request) => Record<string, unknown>;
}

export function staffAuditLog(options: StaffAuditOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);

    res.json = function (body: unknown) {
      if (!req._auditLogged && res.statusCode >= 200 && res.statusCode < 300) {
        req._auditLogged = true;

        const resourceId = options.getResourceId?.(req);
        const resourceName = options.getResourceName?.(req);
        const details = options.getDetails?.(req);

        logFromRequest(req, {
          action: options.action,
          resourceType: options.resourceType,
          resourceId,
          resourceName,
          details,
        }).catch((err) => {
          logger.error('[staffAuditLog] Failed to log action', {
            extra: { error: getErrorMessage(err), action: options.action },
          });
        });
      }

      return originalJson(body);
    } as typeof res.json;

    next();
  };
}

export function markAuditLogged(req: Request): void {
  req._auditLogged = true;
}
