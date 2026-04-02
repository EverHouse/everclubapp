import { getGoogleCalendarClient, isUsingServiceAccount } from '../integrations';
import { CALENDAR_CONFIG } from './config';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
const calendarIdCache: Record<string, string> = {};
let cacheLastRefreshed: number = 0;
const CACHE_TTL_MS = 30 * 60 * 1000;

let calendarDiscoveryLogged = false;
let serviceAccountSubscriptionAttempted = false;

const SERVICE_ACCOUNT_CALENDAR_IDS: Record<string, string> = {
  'MBO_Conference_Room': 'c_767c51576bb3d124fd77dfb93636a8879d90ee764629f1ed3b88934df0f4f943@group.calendar.google.com',
  'Events': 'c_40839b007ee0ad0046348fcfe0172260e2cff2c0b369e12381df906be250812e@group.calendar.google.com',
  'Wellness & Classes': 'c_0e89e10c39b9b0ce513c054482a2edfad7ed05fb9cacac2ddabdb2760a413288@group.calendar.google.com',
  'Tours Scheduled': 'members@everclub.co',
  'Internal Calendar': 'c_a5801dab5ec77dfe8afe78c7930457c57e7e653b24a3c9d4af7fc5a29d148118@group.calendar.google.com',
};

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

async function subscribeServiceAccountToCalendars(calendar: Awaited<ReturnType<typeof getGoogleCalendarClient>>): Promise<void> {
  if (serviceAccountSubscriptionAttempted) return;
  serviceAccountSubscriptionAttempted = true;

  const listResponse = await calendar.calendarList.list();
  const alreadySubscribed = new Set((listResponse.data.items || []).map(c => c.id));

  for (const [name, calendarId] of Object.entries(SERVICE_ACCOUNT_CALENDAR_IDS)) {
    if (alreadySubscribed.has(calendarId)) continue;
    try {
      await calendar.calendarList.insert({ requestBody: { id: calendarId } });
      logger.info(`[Calendar] Service account subscribed to "${name}" (${calendarId})`);
    } catch (err: unknown) {
      logger.warn(`[Calendar] Service account could not subscribe to "${name}": ${getErrorMessage(err)}`);
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
      await subscribeServiceAccountToCalendars(calendar);
    }

    const response = await calendar.calendarList.list();
    const calendars = response.data.items || [];
    
    Object.keys(calendarIdCache).forEach(key => delete calendarIdCache[key]);
    
    for (const cal of calendars) {
      if (cal.summary && cal.id) {
        calendarIdCache[cal.summary] = cal.id;
      }
    }

    if (usingServiceAccount) {
      for (const [name, calendarId] of Object.entries(SERVICE_ACCOUNT_CALENDAR_IDS)) {
        if (!calendarIdCache[name]) {
          calendarIdCache[name] = calendarId;
        }
      }
    }
    
    cacheLastRefreshed = Date.now();
    
    if (!calendarDiscoveryLogged) {
      const totalCount = Object.keys(calendarIdCache).length;
      logger.info(`[Calendar] Discovered ${totalCount} calendars${usingServiceAccount ? ' (service account)' : ''}`);
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
