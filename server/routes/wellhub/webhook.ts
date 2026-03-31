import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { logger } from '../../core/logger';
import { broadcastToStaff } from '../../core/websocket';
import { processWalkInCheckin } from '../../core/walkInCheckinService';
import { getErrorMessage } from '../../utils/errorUtils';
import { reportWellhubUsageEvent, markEventReported } from '../../core/wellhubEventsService';
import { queueJob } from '../../core/jobQueue';

const router = Router();

interface WellhubEventData {
  unique_token: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone_number?: string;
}

interface WellhubWebhookPayload {
  event_type: string;
  gym_id: string | number;
  event_timestamp?: string;
  expires_at?: string;
  booking_number?: string;
  event_data: {
    user: WellhubEventData;
  };
}

interface WellhubStatusWebhookPayload {
  event_type: string;
  gym_id: string | number;
  event_timestamp?: string;
  event_data: {
    user: WellhubEventData;
    plan?: {
      id?: string | number;
      name?: string;
      tier?: string;
    };
    reason?: string;
  };
}

function verifyWellhubSignature(req: Request): boolean {
  const webhookSecret = process.env.WELLHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.warn('[Wellhub Webhook] No WELLHUB_WEBHOOK_SECRET configured');
    return false;
  }

  const signature = req.headers['x-gympass-signature'] as string | undefined;
  if (!signature) {
    logger.warn('[Wellhub Webhook] No X-Gympass-Signature header found');
    return false;
  }

  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (!rawBody) {
    logger.warn('[Wellhub Webhook] No raw body available for signature validation');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha1', webhookSecret)
    .update(rawBody)
    .digest('hex')
    .toUpperCase();

  try {
    const providedBuffer = Buffer.from(signature.toUpperCase());
    const expectedBuffer = Buffer.from(expectedSignature);

    if (providedBuffer.length !== expectedBuffer.length) {
      logger.warn('[Wellhub Webhook] Signature length mismatch');
      return false;
    }

    return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
  } catch (err: unknown) {
    logger.error('[Wellhub Webhook] Signature verification error', { extra: { error: getErrorMessage(err) } });
    return false;
  }
}

async function tryClaimEvent(eventId: string, eventType: string): Promise<'claimed' | 'duplicate' | 'error'> {
  try {
    const result = await db.execute(sql`
      INSERT INTO webhook_processed_events (event_id, event_type, processed_at)
      VALUES (${eventId}, ${eventType}, NOW())
      ON CONFLICT (event_id) DO NOTHING
      RETURNING id
    `);
    return (result.rows?.length ?? 0) > 0 ? 'claimed' : 'duplicate';
  } catch (err: unknown) {
    logger.error('[Wellhub Webhook] DB error claiming event', { extra: { error: getErrorMessage(err), eventId } });
    return 'error';
  }
}

async function findOrCreateWellhubUser(userData: WellhubEventData): Promise<{ userId: string; email: string; displayName: string }> {
  const wellhubId = userData.unique_token;
  const email = userData.email?.toLowerCase().trim();
  const firstName = userData.first_name?.trim() || null;
  const lastName = userData.last_name?.trim() || null;
  const phone = userData.phone_number?.trim() || null;
  const displayName = [firstName, lastName].filter(Boolean).join(' ') || email || wellhubId;

  const existingByWellhubId = await db.execute(sql`
    SELECT id, email, first_name, last_name, role FROM users WHERE wellhub_id = ${wellhubId} LIMIT 1
  `);

  if (existingByWellhubId.rows.length > 0) {
    const user = existingByWellhubId.rows[0] as { id: string; email: string; first_name: string | null; last_name: string | null; role: string };
    const updates: string[] = [];
    if (phone) updates.push('phone');
    if (firstName && !user.first_name) updates.push('first_name');
    if (lastName && !user.last_name) updates.push('last_name');

    if (updates.length > 0) {
      await db.execute(sql`
        UPDATE users SET
          phone = COALESCE(NULLIF(phone, ''), ${phone}, phone),
          first_name = COALESCE(NULLIF(first_name, ''), ${firstName}),
          last_name = COALESCE(NULLIF(last_name, ''), ${lastName}),
          updated_at = NOW()
        WHERE id = ${user.id}
      `);
    }

    return { userId: String(user.id), email: user.email, displayName };
  }

  if (email) {
    const existingByEmail = await db.execute(sql`
      SELECT id, email, role, wellhub_id FROM users WHERE LOWER(email) = ${email} LIMIT 1
    `);

    if (existingByEmail.rows.length > 0) {
      const user = existingByEmail.rows[0] as { id: string; email: string; role: string; wellhub_id: string | null };
      await db.execute(sql`
        UPDATE users SET
          wellhub_id = ${wellhubId},
          phone = COALESCE(NULLIF(phone, ''), ${phone}, phone),
          first_name = COALESCE(NULLIF(first_name, ''), ${firstName}, first_name),
          last_name = COALESCE(NULLIF(last_name, ''), ${lastName}, last_name),
          updated_at = NOW()
        WHERE id = ${user.id}
      `);

      if (user.role === 'visitor') {
        await db.execute(sql`
          UPDATE users SET visitor_type = 'wellhub' WHERE id = ${user.id} AND (visitor_type IS NULL OR visitor_type NOT IN ('day_pass'))
        `);
      }

      return { userId: String(user.id), email: user.email, displayName };
    }
  }

  const visitorEmail = email || `wellhub-${wellhubId}@visitors.everclub.co`;
  try {
    const newUserResult = await db.execute(sql`
      INSERT INTO users (id, email, first_name, last_name, phone, role, membership_status, visitor_type, wellhub_id, created_at, updated_at)
      VALUES (gen_random_uuid(), ${visitorEmail}, ${firstName}, ${lastName}, ${phone}, 'visitor', 'visitor', 'wellhub', ${wellhubId}, NOW(), NOW())
      ON CONFLICT (email) DO UPDATE SET
        wellhub_id = COALESCE(users.wellhub_id, EXCLUDED.wellhub_id),
        first_name = COALESCE(NULLIF(users.first_name, ''), EXCLUDED.first_name),
        last_name = COALESCE(NULLIF(users.last_name, ''), EXCLUDED.last_name),
        updated_at = NOW()
      RETURNING id, email
    `);

    const newUser = newUserResult.rows[0] as { id: string; email: string };
    logger.info('[Wellhub Webhook] Auto-registered new Wellhub visitor', { extra: { email: visitorEmail, wellhubId } });

    return { userId: String(newUser.id), email: newUser.email, displayName };
  } catch (insertErr: unknown) {
    const retryByWellhubId = await db.execute(sql`
      SELECT id, email FROM users WHERE wellhub_id = ${wellhubId} LIMIT 1
    `);
    if (retryByWellhubId.rows.length > 0) {
      const user = retryByWellhubId.rows[0] as { id: string; email: string };
      return { userId: String(user.id), email: user.email, displayName };
    }
    throw insertErr;
  }
}

async function logCheckin(
  wellhubUserId: string,
  userId: string | null,
  gymId: string,
  eventType: string,
  bookingNumber: string | null,
  eventTimestamp: string | null,
  expiresAt: string | null,
  validationStatus: string,
  errorDetail: string | null
): Promise<number | null> {
  try {
    const result = await db.execute(sql`
      INSERT INTO wellhub_checkins (wellhub_user_id, user_id, gym_id, event_type, booking_number, event_timestamp, expires_at, validation_status, validated_at, error_detail, created_at)
      VALUES (
        ${wellhubUserId},
        ${userId},
        ${gymId},
        ${eventType},
        ${bookingNumber},
        ${eventTimestamp ? new Date(eventTimestamp) : null},
        ${expiresAt ? new Date(expiresAt) : null},
        ${validationStatus},
        ${validationStatus === 'validated' ? new Date() : null},
        ${errorDetail},
        NOW()
      )
      RETURNING id
    `);
    return (result.rows[0] as { id: number })?.id ?? null;
  } catch (err: unknown) {
    logger.error('[Wellhub Webhook] Failed to log check-in', { extra: { error: getErrorMessage(err) } });
    return null;
  }
}

async function validateWithWellhub(uniqueToken: string): Promise<{ status: string; errorDetail?: string }> {
  const bearerToken = process.env.WELLHUB_BEARER_TOKEN;
  const gymId = process.env.WELLHUB_GYM_ID;
  const isProduction = process.env.NODE_ENV === 'production' || process.env.REPLIT_DEPLOYMENT === '1';
  const defaultBaseUrl = isProduction
    ? 'https://api.partners.gympass.com'
    : 'https://apitesting.partners.gympass.com';
  const baseUrl = process.env.WELLHUB_API_BASE_URL || defaultBaseUrl;

  if (!bearerToken || !gymId) {
    return { status: 'error', errorDetail: 'Missing WELLHUB_BEARER_TOKEN or WELLHUB_GYM_ID configuration' };
  }

  logger.debug('[Wellhub Webhook] Validating against Wellhub API', { extra: { baseUrl, isProduction } });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(`${baseUrl}/access/v1/validate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'X-Gym-Id': gymId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gympass_id: uniqueToken }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (response.ok) {
      return { status: 'validated' };
    }

    if (response.status === 400) {
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      const reason = String(body?.message || body?.error || '').toLowerCase();

      let status = 'error';
      if (reason.includes('cancel')) {
        status = 'cancelled';
      } else if (reason.includes('already') || reason.includes('validated')) {
        status = 'already_validated';
      } else if (reason.includes('expir')) {
        status = 'expired';
      }

      return { status, errorDetail: String(body?.message || body?.error || 'rejected_by_wellhub') };
    }

    if (response.status === 404) {
      return { status: 'not_found', errorDetail: 'Check-in not found in Wellhub system' };
    }

    return { status: 'error', errorDetail: `Unexpected response: ${response.status}` };
  } catch (err: unknown) {
    return { status: 'error', errorDetail: getErrorMessage(err) };
  }
}

async function getUserWellhubStatus(userId: string): Promise<string | null> {
  try {
    const result = await db.execute(sql`
      SELECT wellhub_status FROM users WHERE id = ${userId} LIMIT 1
    `);
    if (result.rows.length > 0) {
      return (result.rows[0] as { wellhub_status: string | null }).wellhub_status;
    }
    return null;
  } catch (err: unknown) {
    logger.error('[Wellhub Webhook] Failed to get user wellhub_status', { extra: { error: getErrorMessage(err), userId } });
    return null;
  }
}

async function logStatusEvent(
  wellhubUserId: string,
  userId: string | null,
  eventType: string,
  previousStatus: string | null,
  newStatus: string,
  tierInfo: Record<string, unknown> | null,
  rawPayload: Record<string, unknown> | null
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO wellhub_status_events (wellhub_user_id, user_id, event_type, previous_status, new_status, tier_info, raw_payload, created_at)
      VALUES (${wellhubUserId}, ${userId}, ${eventType}, ${previousStatus}, ${newStatus}, ${tierInfo ? JSON.stringify(tierInfo) : null}::jsonb, ${rawPayload ? JSON.stringify(rawPayload) : null}::jsonb, NOW())
    `);
  } catch (err: unknown) {
    logger.error('[Wellhub Webhook] Failed to log status event', { extra: { error: getErrorMessage(err) } });
  }
}

async function updateUserWellhubStatus(userId: string, newStatus: string): Promise<void> {
  await db.execute(sql`
    UPDATE users SET wellhub_status = ${newStatus}, updated_at = NOW() WHERE id = ${userId}
  `);
}

async function processWellhubCheckin(payload: WellhubWebhookPayload): Promise<void> {
  const userData = payload.event_data?.user;
  if (!userData?.unique_token) {
    logger.warn('[Wellhub Webhook] Missing user data in payload');
    return;
  }

  const wellhubUserId = userData.unique_token;
  const gymId = String(payload.gym_id);
  const eventType = payload.event_type;
  const bookingNumber = payload.booking_number || null;
  const eventTimestamp = payload.event_timestamp || null;
  const expiresAt = payload.expires_at || null;

  try {
    const { userId, email, displayName } = await findOrCreateWellhubUser(userData);

    const wellhubStatus = await getUserWellhubStatus(userId);
    if (wellhubStatus === 'cancelled' || wellhubStatus === 'paused') {
      await logCheckin(wellhubUserId, userId, gymId, eventType, bookingNumber, eventTimestamp, expiresAt, 'blocked_status', `User wellhub_status is ${wellhubStatus}`);

      broadcastToStaff({
        type: 'wellhub_status_blocked',
        title: 'Wellhub Check-in Blocked',
        message: `${displayName} attempted check-in but their Wellhub status is ${wellhubStatus}`,
        data: { memberName: displayName, memberEmail: email, wellhubStatus, wellhubUserId }
      });

      logger.warn('[Wellhub Webhook] Check-in blocked — user wellhub_status is inactive', { extra: { wellhubUserId, userId, wellhubStatus } });
      return;
    }

    if (expiresAt) {
      const expiryDate = new Date(expiresAt);
      if (expiryDate.getTime() < Date.now()) {
        await logCheckin(wellhubUserId, userId, gymId, eventType, bookingNumber, eventTimestamp, expiresAt, 'expired', 'Check-in expired before validation');

        broadcastToStaff({
          type: 'wellhub_validation_failed',
          title: 'Wellhub Check-in Expired',
          message: `Wellhub check-in expired for ${displayName} — please verify manually`,
          data: { memberName: displayName, memberEmail: email, reason: 'expired', wellhubUserId }
        });

        logger.info('[Wellhub Webhook] Check-in expired before validation', { extra: { wellhubUserId, expiresAt } });
        return;
      }
    }

    const validationResult = await validateWithWellhub(wellhubUserId);

    const checkinId = await logCheckin(wellhubUserId, userId, gymId, eventType, bookingNumber, eventTimestamp, expiresAt, validationResult.status, validationResult.errorDetail || null);

    if (validationResult.status === 'validated') {
      if (!wellhubStatus || wellhubStatus !== 'active') {
        await updateUserWellhubStatus(userId, 'active');
        await logStatusEvent(wellhubUserId, userId, 'checkin_auto_activate', wellhubStatus, 'active', null, null);
      }

      const checkinResult = await processWalkInCheckin({
        memberId: userId,
        checkedInBy: 'wellhub',
        checkedInByName: 'Wellhub',
        source: 'wellhub',
        isWellhub: true,
      });

      if (checkinResult.success) {
        logger.info('[Wellhub Webhook] Check-in validated and walk-in recorded', { extra: { wellhubUserId, userId, displayName } });
      } else if (checkinResult.alreadyCheckedIn) {
        logger.info('[Wellhub Webhook] Check-in validated but duplicate walk-in (already checked in recently)', { extra: { wellhubUserId, userId } });
      } else {
        logger.warn('[Wellhub Webhook] Check-in validated but walk-in recording failed', { extra: { wellhubUserId, userId, error: checkinResult.error } });
      }

      const usageTimestamp = eventTimestamp ? new Date(eventTimestamp) : new Date();
      try {
        const reportResult = await reportWellhubUsageEvent(wellhubUserId, 'checkin', usageTimestamp);
        if (reportResult.success) {
          if (checkinId) {
            await markEventReported(checkinId);
          }
          logger.info('[Wellhub Webhook] Usage event reported to Wellhub', { extra: { wellhubUserId, checkinId } });
        } else {
          logger.warn('[Wellhub Webhook] Usage event report failed, queuing retry', { extra: { wellhubUserId, checkinId, error: reportResult.error } });
          await queueJob('wellhub_report_event', {
            checkinId: checkinId || 0,
            wellhubUserId,
            eventType: 'checkin',
            eventTimestamp: usageTimestamp.toISOString(),
          }, { maxRetries: 5 });
        }
      } catch (reportErr: unknown) {
        logger.error('[Wellhub Webhook] Error reporting usage event, queuing retry', { extra: { wellhubUserId, checkinId, error: getErrorMessage(reportErr) } });
        await queueJob('wellhub_report_event', {
          checkinId: checkinId || 0,
          wellhubUserId,
          eventType: 'checkin',
          eventTimestamp: usageTimestamp.toISOString(),
        }, { maxRetries: 5 }).catch(qErr => {
          logger.error('[Wellhub Webhook] Failed to queue usage event retry', { extra: { error: getErrorMessage(qErr) } });
        });
      }
    } else {
      broadcastToStaff({
        type: 'wellhub_validation_failed',
        title: 'Wellhub Check-in Failed',
        message: `Wellhub check-in ${validationResult.status} for ${displayName} — please verify manually`,
        data: { memberName: displayName, memberEmail: email, reason: validationResult.status, detail: validationResult.errorDetail, wellhubUserId }
      });

      logger.warn('[Wellhub Webhook] Check-in validation failed', { extra: { wellhubUserId, status: validationResult.status, detail: validationResult.errorDetail } });
    }
  } catch (err: unknown) {
    logger.error('[Wellhub Webhook] Error processing check-in', { extra: { wellhubUserId, error: getErrorMessage(err) } });

    await logCheckin(wellhubUserId, null, gymId, eventType, bookingNumber, eventTimestamp, expiresAt, 'error', getErrorMessage(err));
  }
}

async function processWellhubCancel(payload: WellhubStatusWebhookPayload): Promise<void> {
  const userData = payload.event_data?.user;
  if (!userData?.unique_token) {
    logger.warn('[Wellhub Cancel] Missing user data in payload');
    return;
  }

  const wellhubUserId = userData.unique_token;
  const eventType = payload.event_type.toLowerCase();
  const reason = payload.event_data?.reason;

  try {
    const { userId, email, displayName } = await findOrCreateWellhubUser(userData);

    const previousStatus = await getUserWellhubStatus(userId);
    const newStatus = eventType === 'pause' ? 'paused' : 'cancelled';

    await updateUserWellhubStatus(userId, newStatus);

    await logStatusEvent(wellhubUserId, userId, eventType, previousStatus, newStatus, null, payload as unknown as Record<string, unknown>);

    broadcastToStaff({
      type: 'wellhub_status_change',
      title: `Wellhub Member ${newStatus === 'paused' ? 'Paused' : 'Cancelled'}`,
      message: `${displayName} (${email}) — Wellhub status changed to ${newStatus}${reason ? ` (${reason})` : ''}`,
      data: { memberName: displayName, memberEmail: email, previousStatus, newStatus, reason: reason || null, wellhubUserId }
    });

    logger.info(`[Wellhub Cancel] User status updated to ${newStatus}`, { extra: { wellhubUserId, userId, previousStatus, newStatus, reason } });
  } catch (err: unknown) {
    logger.error('[Wellhub Cancel] Error processing cancel/pause', { extra: { wellhubUserId, error: getErrorMessage(err) } });
  }
}

async function processWellhubChange(payload: WellhubStatusWebhookPayload): Promise<void> {
  const userData = payload.event_data?.user;
  if (!userData?.unique_token) {
    logger.warn('[Wellhub Change] Missing user data in payload');
    return;
  }

  const wellhubUserId = userData.unique_token;
  const eventType = payload.event_type.toLowerCase();
  const planInfo = payload.event_data?.plan || null;

  try {
    const { userId, email, displayName } = await findOrCreateWellhubUser(userData);

    const previousStatus = await getUserWellhubStatus(userId);
    const isReactivation = eventType === 'reactivation' || eventType === 'reactivate';
    const newStatus = isReactivation ? 'active' : (previousStatus || 'active');

    if (isReactivation || !previousStatus) {
      await updateUserWellhubStatus(userId, 'active');
    }

    const tierInfo = planInfo ? { id: planInfo.id, name: planInfo.name, tier: planInfo.tier } : null;
    await logStatusEvent(wellhubUserId, userId, eventType, previousStatus, isReactivation ? 'active' : (previousStatus || 'active'), tierInfo, payload as unknown as Record<string, unknown>);

    const action = isReactivation ? 'Reactivated' : (eventType === 'upgrade' ? 'Upgraded' : eventType === 'downgrade' ? 'Downgraded' : 'Changed');

    broadcastToStaff({
      type: 'wellhub_status_change',
      title: `Wellhub Member ${action}`,
      message: `${displayName} (${email}) — Wellhub plan ${action.toLowerCase()}${planInfo?.name ? ` to ${planInfo.name}` : ''}`,
      data: { memberName: displayName, memberEmail: email, previousStatus, newStatus: isReactivation ? 'active' : newStatus, action, planInfo: tierInfo, wellhubUserId }
    });

    logger.info(`[Wellhub Change] User plan ${action.toLowerCase()}`, { extra: { wellhubUserId, userId, previousStatus, eventType, planInfo: tierInfo } });
  } catch (err: unknown) {
    logger.error('[Wellhub Change] Error processing change', { extra: { wellhubUserId, error: getErrorMessage(err) } });
  }
}

router.post('/api/webhooks/wellhub', async (req: Request, res: Response) => {
  if (!verifyWellhubSignature(req)) {
    logger.warn('[Wellhub Webhook] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body as WellhubWebhookPayload;

  if (!payload?.event_type || !payload?.event_data?.user?.unique_token) {
    logger.warn('[Wellhub Webhook] Invalid payload structure');
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const supportedEvents = ['checkin', 'checkin-booking-occurred'];
  if (!supportedEvents.includes(payload.event_type)) {
    logger.info('[Wellhub Webhook] Unsupported event type, acknowledging', { extra: { eventType: payload.event_type } });
    return res.status(200).json({ status: 'acknowledged' });
  }

  const configuredGymId = process.env.WELLHUB_GYM_ID;
  if (configuredGymId && String(payload.gym_id) !== String(configuredGymId)) {
    logger.warn('[Wellhub Webhook] Gym ID mismatch, rejecting', { extra: { received: payload.gym_id, expected: configuredGymId } });
    return res.status(403).json({ error: 'Gym ID mismatch' });
  }

  const eventTimestampKey = payload.event_timestamp || crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  const eventId = `wellhub_${payload.event_type}_${payload.event_data.user.unique_token}_${eventTimestampKey}`;

  const claimResult = await tryClaimEvent(eventId, payload.event_type);
  if (claimResult === 'duplicate') {
    logger.info('[Wellhub Webhook] Duplicate event, skipping', { extra: { eventId } });
    return res.status(200).json({ status: 'duplicate' });
  }
  if (claimResult === 'error') {
    logger.error('[Wellhub Webhook] Could not claim event due to DB error, returning 500 for retry', { extra: { eventId } });
    return res.status(500).json({ error: 'Internal error, please retry' });
  }

  res.status(200).json({ status: 'received' });

  setImmediate(() => {
    processWellhubCheckin(payload).catch(err => {
      logger.error('[Wellhub Webhook] Async processing error', { extra: { error: getErrorMessage(err) } });
    });
  });
});

router.post('/api/webhooks/wellhub/cancel', async (req: Request, res: Response) => {
  if (!verifyWellhubSignature(req)) {
    logger.warn('[Wellhub Cancel] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body as WellhubStatusWebhookPayload;

  if (!payload?.event_type || !payload?.event_data?.user?.unique_token) {
    logger.warn('[Wellhub Cancel] Invalid payload structure');
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const configuredGymId = process.env.WELLHUB_GYM_ID;
  if (configuredGymId && String(payload.gym_id) !== String(configuredGymId)) {
    logger.warn('[Wellhub Cancel] Gym ID mismatch', { extra: { received: payload.gym_id, expected: configuredGymId } });
    return res.status(403).json({ error: 'Gym ID mismatch' });
  }

  const allowedCancelEvents = ['cancel', 'cancellation', 'pause'];
  if (!allowedCancelEvents.includes(payload.event_type.toLowerCase())) {
    logger.warn('[Wellhub Cancel] Unexpected event_type on cancel endpoint', { extra: { eventType: payload.event_type } });
    return res.status(400).json({ error: `Unsupported event_type for cancel endpoint: ${payload.event_type}` });
  }

  const eventTimestampKey = payload.event_timestamp || crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  const eventId = `wellhub_cancel_${payload.event_type}_${payload.event_data.user.unique_token}_${eventTimestampKey}`;

  const claimResult = await tryClaimEvent(eventId, `cancel_${payload.event_type}`);
  if (claimResult === 'duplicate') {
    logger.info('[Wellhub Cancel] Duplicate event, skipping', { extra: { eventId } });
    return res.status(200).json({ status: 'duplicate' });
  }
  if (claimResult === 'error') {
    return res.status(500).json({ error: 'Internal error, please retry' });
  }

  res.status(200).json({ status: 'received' });

  setImmediate(() => {
    processWellhubCancel(payload).catch(err => {
      logger.error('[Wellhub Cancel] Async processing error', { extra: { error: getErrorMessage(err) } });
    });
  });
});

router.post('/api/webhooks/wellhub/change', async (req: Request, res: Response) => {
  if (!verifyWellhubSignature(req)) {
    logger.warn('[Wellhub Change] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = req.body as WellhubStatusWebhookPayload;

  if (!payload?.event_type || !payload?.event_data?.user?.unique_token) {
    logger.warn('[Wellhub Change] Invalid payload structure');
    return res.status(400).json({ error: 'Invalid payload' });
  }

  const configuredGymId = process.env.WELLHUB_GYM_ID;
  if (configuredGymId && String(payload.gym_id) !== String(configuredGymId)) {
    logger.warn('[Wellhub Change] Gym ID mismatch', { extra: { received: payload.gym_id, expected: configuredGymId } });
    return res.status(403).json({ error: 'Gym ID mismatch' });
  }

  const allowedChangeEvents = ['reactivation', 'reactivate', 'upgrade', 'downgrade', 'change', 'plan_change'];
  if (!allowedChangeEvents.includes(payload.event_type.toLowerCase())) {
    logger.warn('[Wellhub Change] Unexpected event_type on change endpoint', { extra: { eventType: payload.event_type } });
    return res.status(400).json({ error: `Unsupported event_type for change endpoint: ${payload.event_type}` });
  }

  const eventTimestampKey = payload.event_timestamp || crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  const eventId = `wellhub_change_${payload.event_type}_${payload.event_data.user.unique_token}_${eventTimestampKey}`;

  const claimResult = await tryClaimEvent(eventId, `change_${payload.event_type}`);
  if (claimResult === 'duplicate') {
    logger.info('[Wellhub Change] Duplicate event, skipping', { extra: { eventId } });
    return res.status(200).json({ status: 'duplicate' });
  }
  if (claimResult === 'error') {
    return res.status(500).json({ error: 'Internal error, please retry' });
  }

  res.status(200).json({ status: 'received' });

  setImmediate(() => {
    processWellhubChange(payload).catch(err => {
      logger.error('[Wellhub Change] Async processing error', { extra: { error: getErrorMessage(err) } });
    });
  });
});

export default router;
