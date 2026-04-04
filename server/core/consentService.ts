import { db } from '../db';
import { consentEvents, users } from '../../shared/schema';
import { eq, desc, sql } from 'drizzle-orm';
import { logger } from './logger';
import { getErrorMessage } from '../utils/errorUtils';
import type { Request } from 'express';

export type ConsentType = 'marketing' | 'transactional' | 'reminders';
export type ConsentAction = 'granted' | 'revoked';
export type ConsentMethod =
  | 'form_submission'
  | 'profile_toggle'
  | 'spam_complaint'
  | 'admin_action'
  | 'hubspot_sync'
  | 'system_backfill';

interface RecordConsentParams {
  userId?: string;
  email: string;
  consentType: ConsentType;
  action: ConsentAction;
  method: ConsentMethod;
  source?: string;
  ipAddress?: string;
  details?: Record<string, unknown>;
}

export async function resolveUserIdByEmail(email: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export function getClientIpFromRequest(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

export async function recordConsentEvent(params: RecordConsentParams): Promise<void> {
  try {
    await db.insert(consentEvents).values({
      userId: params.userId || null,
      email: params.email.toLowerCase().trim(),
      consentType: params.consentType,
      action: params.action,
      method: params.method,
      source: params.source || null,
      ipAddress: params.ipAddress || null,
      details: params.details || null,
    });
  } catch (error: unknown) {
    logger.error('[ConsentService] Failed to record consent event', {
      extra: {
        error: getErrorMessage(error),
        email: params.email,
        consentType: params.consentType,
        action: params.action,
      },
    });
  }
}

export async function recordEmailConsentChange(params: {
  userId?: string;
  email: string;
  granted: boolean;
  method: ConsentMethod;
  source?: string;
  req?: Request;
  details?: Record<string, unknown>;
}): Promise<void> {
  await recordConsentEvent({
    userId: params.userId,
    email: params.email,
    consentType: 'marketing',
    action: params.granted ? 'granted' : 'revoked',
    method: params.method,
    source: params.source,
    ipAddress: params.req ? (getClientIpFromRequest(params.req) ?? undefined) : undefined,
    details: params.details,
  });
}

export async function getConsentHistory(
  email: string,
  limit = 100
): Promise<Array<{
  id: number;
  userId: string | null;
  email: string;
  consentType: string;
  action: string;
  method: string;
  source: string | null;
  ipAddress: string | null;
  details: unknown;
  createdAt: Date;
}>> {
  try {
    const normalizedEmail = email.toLowerCase().trim();
    const userId = await resolveUserIdByEmail(normalizedEmail);

    const results = await db
      .select()
      .from(consentEvents)
      .where(
        userId
          ? sql`(${consentEvents.email} = ${normalizedEmail} OR ${consentEvents.userId} = ${userId})`
          : eq(consentEvents.email, normalizedEmail)
      )
      .orderBy(desc(consentEvents.createdAt))
      .limit(limit);
    return results;
  } catch (error: unknown) {
    logger.error('[ConsentService] Failed to fetch consent history', {
      extra: { error: getErrorMessage(error), email },
    });
    return [];
  }
}

export async function backfillConsentBaseline(): Promise<{ count: number }> {
  try {
    const result = await db.execute(sql`
      INSERT INTO consent_events (user_id, email, consent_type, action, method, source, details)
      SELECT
        u.id,
        LOWER(TRIM(u.email)),
        'marketing',
        CASE WHEN u.email_opt_in = true THEN 'granted' ELSE 'revoked' END,
        'system_backfill',
        'baseline_migration',
        jsonb_build_object(
          'note', 'Baseline record created from existing email_opt_in state',
          'original_value', COALESCE(u.email_opt_in, false)
        )
      FROM users u
      WHERE u.email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM consent_events ce
          WHERE ce.email = LOWER(TRIM(u.email))
            AND ce.method = 'system_backfill'
            AND ce.source = 'baseline_migration'
        )
    `);
    const count = result.rowCount || 0;
    logger.info(`[ConsentService] Backfilled ${count} baseline consent records`);
    return { count };
  } catch (error: unknown) {
    logger.error('[ConsentService] Backfill failed', {
      extra: { error: getErrorMessage(error) },
    });
    return { count: 0 };
  }
}
