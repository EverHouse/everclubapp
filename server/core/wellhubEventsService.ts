import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';

interface WellhubEventPayload {
  gym_id: string;
  user_id: string;
  event_type: string;
  event_timestamp: string;
}

interface ReportResult {
  success: boolean;
  rateLimited?: boolean;
  error?: string;
}

const RATE_LIMIT_MAX = 45;
const RATE_LIMIT_WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

function pruneOldTimestamps(): void {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS;
  while (requestTimestamps.length > 0 && requestTimestamps[0] < cutoff) {
    requestTimestamps.shift();
  }
}

async function waitForRateSlot(): Promise<void> {
  pruneOldTimestamps();
  if (requestTimestamps.length < RATE_LIMIT_MAX) {
    return;
  }
  const oldestInWindow = requestTimestamps[0];
  const waitMs = oldestInWindow + RATE_LIMIT_WINDOW_MS - Date.now() + 100;
  if (waitMs > 0) {
    logger.info(`[Wellhub Events] Rate limiter: waiting ${waitMs}ms before next request`);
    await new Promise(resolve => setTimeout(resolve, waitMs));
  }
  pruneOldTimestamps();
}

export async function reportWellhubUsageEvent(
  wellhubUserId: string,
  eventType: string,
  eventTimestamp: Date
): Promise<ReportResult> {
  const bearerToken = process.env.WELLHUB_BEARER_TOKEN;
  const gymId = process.env.WELLHUB_GYM_ID;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  const defaultBaseUrl = isProduction
    ? 'https://api.partners.gympass.com'
    : 'https://apitesting.partners.gympass.com';
  const baseUrl = process.env.WELLHUB_API_BASE_URL || defaultBaseUrl;

  if (!bearerToken || !gymId) {
    return { success: false, error: 'Missing WELLHUB_BEARER_TOKEN or WELLHUB_GYM_ID configuration' };
  }

  await waitForRateSlot();

  const payload: WellhubEventPayload = {
    gym_id: gymId,
    user_id: wellhubUserId,
    event_type: eventType,
    event_timestamp: eventTimestamp.toISOString(),
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    requestTimestamps.push(Date.now());

    const response = await fetch(`${baseUrl}/partner-app/v1/events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      logger.info('[Wellhub Events] Usage event reported successfully', {
        extra: { wellhubUserId, eventType },
      });
      return { success: true };
    }

    if (response.status === 429) {
      logger.warn('[Wellhub Events] Rate limited by Wellhub API', {
        extra: { wellhubUserId, eventType },
      });
      return { success: false, rateLimited: true, error: 'Rate limited (429)' };
    }

    const body = await response.text().catch(() => '');
    const errorMsg = `Wellhub Events API error: ${response.status} — ${body.slice(0, 200)}`;
    logger.error('[Wellhub Events] Failed to report usage event', {
      extra: { wellhubUserId, eventType, status: response.status, body: body.slice(0, 200) },
    });
    return { success: false, error: errorMsg };
  } catch (err: unknown) {
    const errorMsg = getErrorMessage(err);
    logger.error('[Wellhub Events] Request error', {
      extra: { wellhubUserId, eventType, error: errorMsg },
    });
    return { success: false, error: errorMsg };
  }
}

export async function markEventReported(checkinId: number): Promise<void> {
  await db.execute(sql`
    UPDATE wellhub_checkins SET event_reported_at = NOW() WHERE id = ${checkinId}
  `);
}

export async function getUnreportedCheckins(olderThanDays: number = 35): Promise<Array<{
  id: number;
  wellhub_user_id: string;
  event_type: string;
  event_timestamp: Date | null;
  created_at: Date;
}>> {
  const result = await db.execute(sql`
    SELECT id, wellhub_user_id, event_type, event_timestamp, created_at
    FROM wellhub_checkins
    WHERE validation_status = 'validated'
      AND event_reported_at IS NULL
      AND created_at > NOW() - INTERVAL '1 day' * ${olderThanDays}
    ORDER BY created_at ASC
  `);
  return result.rows as unknown as Array<{
    id: number;
    wellhub_user_id: string;
    event_type: string;
    event_timestamp: Date | null;
    created_at: Date;
  }>;
}

export async function getUnreportedCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int as count
    FROM wellhub_checkins
    WHERE validation_status = 'validated'
      AND event_reported_at IS NULL
      AND created_at > NOW() - INTERVAL '35 days'
  `);
  return (result.rows[0] as { count: number }).count;
}

export async function getUnreportedForMonth(year: number, month: number): Promise<Array<{
  id: number;
  wellhub_user_id: string;
  event_type: string;
  event_timestamp: Date | null;
  created_at: Date;
}>> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1);
  const result = await db.execute(sql`
    SELECT id, wellhub_user_id, event_type, event_timestamp, created_at
    FROM wellhub_checkins
    WHERE validation_status = 'validated'
      AND event_reported_at IS NULL
      AND created_at >= ${startDate}
      AND created_at < ${endDate}
    ORDER BY created_at ASC
  `);
  return result.rows as unknown as Array<{
    id: number;
    wellhub_user_id: string;
    event_type: string;
    event_timestamp: Date | null;
    created_at: Date;
  }>;
}
