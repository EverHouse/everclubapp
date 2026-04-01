import { db } from '../../db';
import { resources } from '../../../shared/schema';
import { eq } from 'drizzle-orm';
import { CALENDAR_CONFIG } from './index';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';

export async function getCalendarNameForBayAsync(bayId: number | null): Promise<string | null> {
  if (!bayId) return null;
  
  try {
    const result = await db.select({ name: resources.name, type: resources.type }).from(resources).where(eq(resources.id, bayId));
    const resourceType = result[0]?.type?.toLowerCase() || '';
    const resourceName = result[0]?.name?.toLowerCase() || '';
    if (resourceType === 'conference_room' || resourceName.includes('conference')) {
      return CALENDAR_CONFIG.conference.name;
    }
  } catch (e: unknown) {
    logger.error('[Bays] Failed to get calendar name for bay', { extra: { error: getErrorMessage(e) } });
  }
  
  return null;
}

export function getCalendarNameForBay(_bayId: number | null): string | null {
  return null;
}
