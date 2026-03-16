import { isProduction } from '../db';
import { logger } from '../logger';

let loggedOnce = false;

export function isHubSpotReadOnly(): boolean {
  const readOnly = !isProduction;
  if (readOnly && !loggedOnce) {
    logger.info('[HubSpot] Running in READ-ONLY mode (non-production environment). All HubSpot write operations will be skipped.');
    loggedOnce = true;
  }
  return readOnly;
}

export function logHubSpotWriteSkipped(operation: string, context?: string): void {
  const detail = context ? ` for ${context}` : '';
  logger.info(`[HubSpot] Write skipped (read-only in dev): ${operation}${detail}`);
}
