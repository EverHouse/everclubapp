import { db } from '../db';
import { getErrorMessage, getErrorStatusCode } from '../utils/errorUtils';
import { users } from '../../shared/schema';
import { communicationLogs } from '../../shared/models/membership';
import { getHubSpotClient } from './integrations';
import { sql, eq } from 'drizzle-orm';
import { retryableHubSpotRequest } from './hubspot/request';
import { isRetryableError } from './retry';
import pLimit from 'p-limit';
import { logger } from './logger';
import {
  type HubSpotCallRecord,
  type HubSpotCommunicationRecord,
  delay,
  isProduction,
} from './memberSyncHelpers';

async function dbWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      if (!isRetryableError(error) || attempt === maxRetries) {
        throw error;
      }
      const backoff = Math.min(100 * Math.pow(2, attempt - 1), 2000);
      logger.warn(`[CommLogs] DB retry (attempt ${attempt}/${maxRetries}) after ${backoff}ms`, {
        extra: { error: getErrorMessage(error) }
      });
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
  throw new Error('unreachable');
}

let commLogsSyncInProgress = false;
let lastCommLogsSyncTime = 0;
const COMM_LOGS_SYNC_COOLDOWN = 30 * 60 * 1000;

export async function syncCommunicationLogsFromHubSpot(): Promise<{ synced: number; errors: number }> {
  if (commLogsSyncInProgress) {
    if (!isProduction) logger.info('[CommLogs] Sync already in progress, skipping');
    return { synced: 0, errors: 0 };
  }
  
  const now = Date.now();
  if (now - lastCommLogsSyncTime < COMM_LOGS_SYNC_COOLDOWN) {
    if (!isProduction) logger.info('[CommLogs] Sync cooldown active, skipping');
    return { synced: 0, errors: 0 };
  }
  
  commLogsSyncInProgress = true;
  lastCommLogsSyncTime = now;
  
  let synced = 0;
  let errors = 0;
  
  try {
    const hubspot = await getHubSpotClient();
    
    const membersResult = await dbWithRetry(() =>
      db.select({
        email: users.email,
        hubspotId: users.hubspotId
      })
      .from(users)
      .where(sql`${users.hubspotId} IS NOT NULL AND ${users.archivedAt} IS NULL`)
    );
    
    const emailByHubSpotId = new Map<string, string>();
    for (const m of membersResult) {
      if (m.hubspotId) {
        emailByHubSpotId.set(m.hubspotId, m.email!);
      }
    }
    
    if (!isProduction) logger.info(`[CommLogs] Found ${emailByHubSpotId.size} members with HubSpot IDs`);
    
    const callProperties = [
      'hs_call_body',
      'hs_call_direction',
      'hs_call_disposition',
      'hs_call_duration',
      'hs_call_from_number',
      'hs_call_status',
      'hs_call_title',
      'hs_call_to_number',
      'hs_timestamp',
      'hubspot_owner_id'
    ];
    
    let allCalls: HubSpotCallRecord[] = [];
    let after: string | undefined = undefined;
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    do {
      try {
        const response = await retryableHubSpotRequest(() => hubspot.crm.objects.calls.basicApi.getPage(
          100,
          after,
          callProperties
        ));
        
        const recentCalls = (response as unknown as { results: HubSpotCallRecord[] }).results.filter((call) => {
          const timestamp = call.properties?.hs_timestamp;
          if (!timestamp) return false;
          return new Date(timestamp) >= ninetyDaysAgo;
        });
        
        allCalls = allCalls.concat(recentCalls);
        after = (response as unknown as { paging?: { next?: { after?: string } } }).paging?.next?.after;
        
        await delay(200);
      } catch (err: unknown) {
        if (getErrorStatusCode(err) === 429) {
          if (!isProduction) logger.info('[CommLogs] Rate limited, waiting 10 seconds...');
          await delay(10000);
          continue;
        }
        throw err;
      }
    } while (after && allCalls.length < 1000);
    
    if (!isProduction) logger.info(`[CommLogs] Fetched ${allCalls.length} calls from HubSpot`);
    
    const BATCH_SIZE = 3;
    const callLimit = pLimit(BATCH_SIZE);
    let hubspotCallAssocFailCount = 0;
    
    for (let i = 0; i < allCalls.length; i += BATCH_SIZE) {
      if (i > 0) {
        await delay(200);
      }
      const batch = allCalls.slice(i, i + BATCH_SIZE);
      
      await Promise.all(
        batch.map(call =>
          callLimit(async () => {
            try {
              const callId = call.id;
              const props = call.properties || {};
              
              const existingLog = await dbWithRetry(() =>
                db.select({ id: communicationLogs.id })
                  .from(communicationLogs)
                  .where(eq(communicationLogs.hubspotEngagementId, callId))
                  .limit(1)
              );
              
              if (existingLog.length > 0) {
                return;
              }
              
              let memberEmail: string | null = null;
              
              try {
                const assocResponse = await retryableHubSpotRequest(async () => {
                  const res = await hubspot.apiRequest({
                    method: 'GET',
                    path: `/crm/v3/objects/calls/${callId}/associations/contacts`
                  });
                  if (res.status === 429) {
                    throw new Error('HTTP 429 Rate Limit from HubSpot call associations API');
                  }
                  return res;
                });
                const assocData = await assocResponse.json() as { results?: Array<{ id: string }> };
                
                if (assocData.results && assocData.results.length > 0) {
                  const contactId = assocData.results[0].id;
                  memberEmail = emailByHubSpotId.get(contactId) || null;
                  
                  if (!memberEmail) {
                    try {
                      const contact = await retryableHubSpotRequest(() => hubspot.crm.contacts.basicApi.getById(contactId, ['email']));
                      memberEmail = contact.properties?.email?.toLowerCase() || null;
                    } catch (err) {
                      logger.debug('HubSpot contact not found by ID', { extra: { error: getErrorMessage(err) } });
                    }
                  }
                }
              } catch (err: unknown) {
                logger.warn('[MemberSync] HubSpot call association failed', { extra: { error: getErrorMessage(err) } });
                hubspotCallAssocFailCount++;
              }
              
              if (!memberEmail) {
                return;
              }
              
              const direction = props.hs_call_direction === 'INBOUND' ? 'inbound' : 'outbound';
              
              const occurredAt = props.hs_timestamp ? new Date(props.hs_timestamp as string) : new Date();
              
              const subject = (props.hs_call_title as string) || 
                `${direction === 'inbound' ? 'Inbound' : 'Outbound'} Call`;
              
              let body = (props.hs_call_body as string) || '';
              if (props.hs_call_duration) {
                const durationSecs = parseInt(props.hs_call_duration as string, 10);
                const mins = Math.floor(durationSecs / 60);
                const secs = durationSecs % 60;
                body = `Duration: ${mins}m ${secs}s\n${body}`.trim();
              }
              if (props.hs_call_disposition) {
                body = `Outcome: ${props.hs_call_disposition}\n${body}`.trim();
              }
              
              let status = 'completed';
              if (props.hs_call_status === 'NO_ANSWER') status = 'no_answer';
              if (props.hs_call_status === 'BUSY') status = 'busy';
              if (props.hs_call_status === 'FAILED') status = 'failed';
              
              await dbWithRetry(() =>
                db.insert(communicationLogs).values({
                  memberEmail,
                  type: 'call',
                  direction,
                  subject,
                  body: body || null,
                  status,
                  hubspotEngagementId: callId,
                  hubspotSyncedAt: new Date(),
                  loggedBy: 'system',
                  loggedByName: 'HubSpot Sync',
                  occurredAt,
                  createdAt: new Date(),
                  updatedAt: new Date()
                })
              );
              
              synced++;
            } catch (err: unknown) {
              errors++;
              logger.error('[CommLogs] Error processing call:', { extra: { error: getErrorMessage(err) } });
            }
          })
        )
      );
      
      if (i + BATCH_SIZE < allCalls.length) {
        await delay(500);
      }
    }
    
    if (hubspotCallAssocFailCount > 0) {
      logger.debug(`HubSpot call associations unavailable for ${hubspotCallAssocFailCount} calls (expected if HubSpot plan doesn't support call associations)`);
    }
    
    try {
      let allComms: HubSpotCommunicationRecord[] = [];
      let commAfter: string | undefined = undefined;
      
      const commProperties = [
        'hs_communication_channel_type',
        'hs_communication_body',
        'hs_timestamp',
        'hubspot_owner_id'
      ];
      
      do {
        try {
          const response = await retryableHubSpotRequest(async () => {
            const res = await hubspot.apiRequest({
              method: 'GET',
              path: `/crm/v3/objects/communications?limit=100${commAfter ? `&after=${commAfter}` : ''}&properties=${commProperties.join(',')}`
            });
            if (res.status === 429) {
              throw new Error(`HTTP 429 Rate Limit from HubSpot communications API`);
            }
            return res;
          });
          
          const data = await response.json();
          
          const recentComms = (data.results || []).filter((comm: HubSpotCommunicationRecord) => {
            const channelType = comm.properties?.hs_communication_channel_type;
            const timestamp = comm.properties?.hs_timestamp;
            if (!timestamp) return false;
            return (channelType === 'SMS' || channelType === 'WHATS_APP') &&
                   new Date(timestamp) >= ninetyDaysAgo;
          });
          
          allComms = allComms.concat(recentComms);
          commAfter = data.paging?.next?.after;
          
          await delay(200);
        } catch (err: unknown) {
          if (getErrorStatusCode(err) === 429) {
            await delay(10000);
            continue;
          }
          if (!isProduction) logger.info('[CommLogs] Communications object not available, skipping SMS sync');
          break;
        }
      } while (commAfter && allComms.length < 500);
      
      if (!isProduction && allComms.length > 0) {
        logger.info(`[CommLogs] Fetched ${allComms.length} SMS/communications from HubSpot`);
      }
      
      let hubspotCommAssocFailCount = 0;
      for (const comm of allComms) {
        try {
          const commId = comm.id;
          const props = comm.properties || {};
          
          const existingSms = await dbWithRetry(() =>
            db.select({ id: communicationLogs.id })
              .from(communicationLogs)
              .where(eq(communicationLogs.hubspotEngagementId, `sms_${commId}`))
              .limit(1)
          );
          
          if (existingSms.length > 0) continue;
          
          let memberEmail: string | null = null;
          try {
            const assocResponse = await retryableHubSpotRequest(async () => {
              const res = await hubspot.apiRequest({
                method: 'GET',
                path: `/crm/v3/objects/communications/${commId}/associations/contacts`
              });
              if (res.status === 429) {
                throw new Error(`HTTP 429 Rate Limit from HubSpot associations API`);
              }
              return res;
            });
            const assocData = await assocResponse.json();
            
            if (assocData.results && assocData.results.length > 0) {
              const contactId = assocData.results[0].id;
              memberEmail = emailByHubSpotId.get(contactId) || null;
              
              if (!memberEmail) {
                try {
                  const contact = await retryableHubSpotRequest(() => hubspot.crm.contacts.basicApi.getById(contactId, ['email']));
                  memberEmail = contact.properties?.email?.toLowerCase() || null;
                } catch (err) {
                  logger.debug('HubSpot contact not found by ID for communication', { extra: { error: getErrorMessage(err) } });
                }
              }
            }
          } catch (err: unknown) {
            logger.warn('[MemberSync] HubSpot communication association failed', { extra: { error: getErrorMessage(err) } });
            hubspotCommAssocFailCount++;
          }
          
          if (!memberEmail) continue;
          
          const occurredAt = props.hs_timestamp ? new Date(props.hs_timestamp as string) : new Date();
          const channelType = props.hs_communication_channel_type === 'WHATS_APP' ? 'whatsapp' : 'sms';
          
          await dbWithRetry(() =>
            db.insert(communicationLogs).values({
              memberEmail,
              type: channelType,
              direction: 'outbound',
              subject: `${channelType.toUpperCase()} Message`,
              body: (props.hs_communication_body as string) || null,
              status: 'sent',
              hubspotEngagementId: `sms_${commId}`,
              hubspotSyncedAt: new Date(),
              loggedBy: 'system',
              loggedByName: 'HubSpot Sync',
              occurredAt,
              createdAt: new Date(),
              updatedAt: new Date()
            })
          );
          
          synced++;
        } catch (err: unknown) {
          errors++;
          logger.error('[CommLogs] Error processing SMS:', { extra: { error: getErrorMessage(err) } });
        }
      }
      
      if (hubspotCommAssocFailCount > 0) {
        logger.debug(`HubSpot communication associations unavailable for ${hubspotCommAssocFailCount} communications (expected if HubSpot plan doesn't support communication associations)`);
      }
      
    } catch (err: unknown) {
      if (!isProduction) logger.info('[CommLogs] SMS sync skipped:', { extra: { detail: getErrorMessage(err) } });
    }
    
    if (!isProduction) logger.info(`[CommLogs] Complete - Synced: ${synced}, Errors: ${errors}`);
    
    return { synced, errors };
  } catch (error: unknown) {
    logger.error('[CommLogs] Fatal error:', { extra: { error: getErrorMessage(error) } });
    return { synced: 0, errors: 1 };
  } finally {
    commLogsSyncInProgress = false;
  }
}

export function triggerCommunicationLogsSync(): void {
  syncCommunicationLogsFromHubSpot().catch(err => {
    logger.error('[CommLogs] Background sync failed:', { extra: { error: getErrorMessage(err) } });
  });
}

export async function updateHubSpotContactVisitCount(hubspotId: string, visitCount: number): Promise<boolean> {
  const { isHubSpotReadOnly, logHubSpotWriteSkipped } = await import('./hubspot/readOnlyGuard');
  if (isHubSpotReadOnly()) {
    logHubSpotWriteSkipped('update_visit_count', hubspotId);
    return true;
  }

  try {
    const hubspot = await getHubSpotClient();
    await retryableHubSpotRequest(() => hubspot.crm.contacts.basicApi.update(hubspotId, {
      properties: {
        total_visit_count: String(visitCount)
      }
    }));
    if (!isProduction) logger.info(`[MemberSync] Updated HubSpot contact ${hubspotId} visit count to ${visitCount}`);
    return true;
  } catch (error: unknown) {
    logger.error(`[MemberSync] Failed to update HubSpot visit count for ${hubspotId}:`, { extra: { error: getErrorMessage(error) } });
    return false;
  }
}

export async function updateHubSpotContactPreferences(
  hubspotId: string, 
  preferences: { emailOptIn?: boolean; smsOptIn?: boolean }
): Promise<boolean> {
  const { isHubSpotReadOnly, logHubSpotWriteSkipped } = await import('./hubspot/readOnlyGuard');
  if (isHubSpotReadOnly()) {
    logHubSpotWriteSkipped('update_preferences', hubspotId);
    return true;
  }

  try {
    const hubspot = await getHubSpotClient();
    const properties: Record<string, string> = {};
    
    if (preferences.emailOptIn !== undefined) {
      properties.eh_email_updates_opt_in = preferences.emailOptIn ? 'true' : 'false';
    }
    if (preferences.smsOptIn !== undefined) {
      properties.eh_sms_updates_opt_in = preferences.smsOptIn ? 'true' : 'false';
    }
    
    if (Object.keys(properties).length === 0) {
      return true;
    }
    
    await retryableHubSpotRequest(() => hubspot.crm.contacts.basicApi.update(hubspotId, { properties }));
    if (!isProduction) logger.info(`[MemberSync] Updated HubSpot contact ${hubspotId} preferences:`, { extra: { detail: properties } });
    return true;
  } catch (error: unknown) {
    logger.error(`[MemberSync] Failed to update HubSpot preferences for ${hubspotId}:`, { extra: { error: getErrorMessage(error) } });
    return false;
  }
}
