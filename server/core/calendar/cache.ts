import { getGoogleCalendarClient, isUsingServiceAccount } from '../integrations';
import { CALENDAR_CONFIG } from './config';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
const calendarIdCache: Record<string, string> = {};
let cacheLastRefreshed: number = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

let calendarDiscoveryLogged = false;
let serviceAccountSubscriptionAttempted = false;

export function clearCalendarCache(): void {
  Object.keys(calendarIdCache).forEach(key => delete calendarIdCache[key]);
  cacheLastRefreshed = 0;
  calendarDiscoveryLogged = false;
  serviceAccountSubscriptionAttempted = false;
}

function isCacheValid(): boolean {
  const hasItems = Object.keys(calendarIdCache).length > 0;
  const isNotExpired = cacheLastRefreshed > 0 && (Date.now() - cacheLastRefreshed <= CACHE_TTL_MS);
  return hasItems && isNotExpired;
}

async function subscribeToSharedCalendars(calendar: Awaited<ReturnType<typeof getGoogleCalendarClient>>): Promise<void> {
  if (serviceAccountSubscriptionAttempted) return;
  serviceAccountSubscriptionAttempted = true;

  const configNames = Object.values(CALENDAR_CONFIG).map(c => c.name);
  const response = await calendar.calendarList.list();
  const alreadyListed = new Set((response.data.items || []).map(c => c.summary));

  for (const name of configNames) {
    if (alreadyListed.has(name)) continue;
    try {
      const searchResponse = await calendar.calendarList.list();
      const found = (searchResponse.data.items || []).find(c => c.summary === name);
      if (!found) {
        logger.debug(`[Calendar] Service account: calendar "${name}" not yet visible, will retry on next refresh`);
      }
    } catch (err: unknown) {
      logger.debug(`[Calendar] Service account: could not check calendar "${name}": ${getErrorMessage(err)}`);
    }
  }
}

export async function discoverCalendarIds(forceRefresh: boolean = false): Promise<void> {
  if (!forceRefresh && isCacheValid()) {
    return;
  }
  
  try {
    const calendar = await getGoogleCalendarClient();
    const usingServiceAccount = isUsingServiceAccount();

    if (usingServiceAccount) {
      await subscribeToSharedCalendars(calendar);
    }

    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];
    
    Object.keys(calendarIdCache).forEach(key => delete calendarIdCache[key]);
    
    for (const cal of calendars) {
      if (cal.summary && cal.id) {
        calendarIdCache[cal.summary] = cal.id;
      }
    }
    
    cacheLastRefreshed = Date.now();
    
    if (!calendarDiscoveryLogged) {
      logger.info(`[Calendar] Discovered ${calendars.length} calendars`);
      if (usingServiceAccount && calendars.length === 0) {
        logger.warn('[Calendar] Service account found 0 calendars — ensure calendars are shared with the service account email and sharing is set to "Make changes to events"');
      }
      calendarDiscoveryLogged = true;
    }
  } catch (error: unknown) {
    logger.error('[Calendar] Error discovering calendars:', { extra: { error: getErrorMessage(error) } });
  }
}

export async function getCalendarIdByName(name: string): Promise<string | null> {
  if (calendarIdCache[name] && isCacheValid()) {
    return calendarIdCache[name];
  }
  
  await discoverCalendarIds();
  return calendarIdCache[name] || null;
}

export async function getCalendarStatus(): Promise<{
  configured: { key: string; name: string; calendarId: string | null; status: 'connected' | 'not_found' }[];
  discovered: { name: string; calendarId: string }[];
}> {
  await discoverCalendarIds();
  
  const DEPRECATED_CALENDARS = ['golf'];
  
  const configured = Object.entries(CALENDAR_CONFIG)
    .filter(([key]) => !DEPRECATED_CALENDARS.includes(key))
    .map(([key, config]) => {
      const calendarId = calendarIdCache[config.name] || null;
      return {
        key,
        name: config.name,
        calendarId,
        status: calendarId ? 'connected' as const : 'not_found' as const
      };
    });
  
  const discovered = Object.entries(calendarIdCache).map(([name, calendarId]) => ({
    name,
    calendarId
  }));
  
  return { configured, discovered };
}
