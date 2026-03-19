export { logger } from '../../core/logger';
export { isAdmin } from '../../core/middleware';
export { validateQuery, validateBody } from '../../middleware/validate';
export { pool, safeRelease } from '../../core/db';
export { db } from '../../db';
export { sql } from 'drizzle-orm';
export { broadcastDataIntegrityUpdate } from '../../core/websocket';
export { logFromRequest } from '../../core/auditLog';
export type { ResourceType } from '../../core/auditLog';
export { getSessionUser } from '../../types/session';
export { getErrorMessage } from '../../utils/errorUtils';
export type { Request } from 'express';

import type { Response } from 'express';
import { parseConstraintError, safeErrorDetail } from '../../utils/errorUtils';

export function sendFixError(res: Response, error: unknown, fallbackMessage = 'Operation failed'): void {
  const parsed = parseConstraintError(error);
  if (parsed.isConstraintError) {
    res.status(409).json({
      success: false,
      error: parsed.message,
      table: parsed.table,
      constraint: parsed.constraintName,
    });
  } else {
    res.status(500).json({
      success: false,
      message: fallbackMessage,
      details: safeErrorDetail(error),
    });
  }
}
