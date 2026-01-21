import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { pool } from '../core/db';
import { logger } from '../core/logger';
import { isStaffOrAdmin } from '../core/middleware';
import { sendNotificationToUser } from '../core/websocket';
import { sendBookingConfirmationEmail } from '../emails/bookingEmails';

const router = Router();

const isProduction = process.env.NODE_ENV === 'production';

interface TrackmanBookingPayload {
  id?: string;
  booking_id?: string;
  bookingId?: string;
  status?: string;
  bay_id?: string;
  bayId?: string;
  bay_name?: string;
  bayName?: string;
  start_time?: string;
  startTime?: string;
  end_time?: string;
  endTime?: string;
  date?: string;
  customer?: {
    email?: string;
    name?: string;
    phone?: string;
    id?: string;
  };
  user?: {
    email?: string;
    name?: string;
    phone?: string;
    id?: string;
  };
  player_count?: number;
  playerCount?: number;
  created_at?: string;
  updated_at?: string;
}

interface TrackmanWebhookPayload {
  event_type?: string;
  eventType?: string;
  data?: TrackmanBookingPayload;
  booking?: TrackmanBookingPayload;
  user?: any;
  purchase?: any;
  timestamp?: string;
}

function validateTrackmanWebhookSignature(req: Request): boolean {
  const webhookSecret = process.env.TRACKMAN_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    if (isProduction) {
      logger.warn('[Trackman Webhook] No TRACKMAN_WEBHOOK_SECRET configured - rejecting in production');
      return false;
    }
    logger.warn('[Trackman Webhook] No TRACKMAN_WEBHOOK_SECRET configured - allowing in development');
    return true;
  }
  
  const signature = req.headers['x-trackman-signature'] || 
                    req.headers['x-webhook-signature'] ||
                    req.headers['x-signature'];
  
  if (!signature) {
    logger.warn('[Trackman Webhook] No signature header found');
    return !isProduction;
  }
  
  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    logger.warn('[Trackman Webhook] No raw body available for signature validation');
    return !isProduction;
  }
  
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');
  
  const providedSig = Array.isArray(signature) ? signature[0] : signature;
  const isValid = crypto.timingSafeEqual(
    Buffer.from(providedSig),
    Buffer.from(expectedSignature)
  );
  
  if (!isValid) {
    logger.warn('[Trackman Webhook] Signature validation failed');
  }
  
  return isValid || !isProduction;
}

function extractBookingData(payload: TrackmanWebhookPayload): TrackmanBookingPayload | null {
  return payload.data || payload.booking || null;
}

function normalizeBookingFields(booking: TrackmanBookingPayload) {
  return {
    trackmanBookingId: booking.id || booking.booking_id || booking.bookingId,
    bayId: booking.bay_id || booking.bayId,
    bayName: booking.bay_name || booking.bayName,
    startTime: booking.start_time || booking.startTime,
    endTime: booking.end_time || booking.endTime,
    date: booking.date,
    customerEmail: booking.customer?.email || booking.user?.email,
    customerName: booking.customer?.name || booking.user?.name,
    customerPhone: booking.customer?.phone || booking.user?.phone,
    customerId: booking.customer?.id || booking.user?.id,
    playerCount: booking.player_count || booking.playerCount || 1,
    status: booking.status,
  };
}

function mapBayNameToResourceId(bayName: string | undefined, bayId: string | undefined): number | null {
  if (!bayName && !bayId) return null;
  
  const name = (bayName || bayId || '').toLowerCase();
  
  if (name.includes('1') || name === 'bay1' || name === 'bay 1') return 1;
  if (name.includes('2') || name === 'bay2' || name === 'bay 2') return 2;
  if (name.includes('3') || name === 'bay3' || name === 'bay 3') return 3;
  if (name.includes('4') || name === 'bay4' || name === 'bay 4') return 4;
  
  return null;
}

function parseDateTime(dateTimeStr: string | undefined, dateStr: string | undefined): { date: string; time: string } | null {
  if (!dateTimeStr && !dateStr) return null;
  
  try {
    if (dateTimeStr) {
      const dt = new Date(dateTimeStr);
      if (!isNaN(dt.getTime())) {
        const pacificFormatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Los_Angeles',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        const timeFormatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Los_Angeles',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });
        
        return {
          date: pacificFormatter.format(dt),
          time: timeFormatter.format(dt).replace(/^24:/, '00:'),
        };
      }
    }
    
    if (dateStr) {
      return { date: dateStr, time: '00:00' };
    }
  } catch (e) {
    logger.warn('[Trackman Webhook] Failed to parse date/time', { extra: { dateTimeStr, dateStr } });
  }
  
  return null;
}

async function logWebhookEvent(
  eventType: string,
  payload: any,
  trackmanBookingId?: string,
  trackmanUserId?: string,
  matchedBookingId?: number,
  matchedUserId?: string,
  error?: string
): Promise<number> {
  try {
    const result = await pool.query(
      `INSERT INTO trackman_webhook_events 
       (event_type, payload, trackman_booking_id, trackman_user_id, matched_booking_id, matched_user_id, processed_at, processing_error)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7)
       RETURNING id`,
      [eventType, JSON.stringify(payload), trackmanBookingId, trackmanUserId, matchedBookingId, matchedUserId, error]
    );
    return result.rows[0]?.id;
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to log webhook event', { error: e as Error });
    return 0;
  }
}

async function updateBaySlotCache(
  trackmanBookingId: string,
  resourceId: number,
  slotDate: string,
  startTime: string,
  endTime: string,
  status: 'booked' | 'cancelled' | 'completed',
  customerEmail?: string,
  customerName?: string,
  playerCount?: number
): Promise<void> {
  try {
    if (status === 'cancelled') {
      await pool.query(
        `UPDATE trackman_bay_slots 
         SET status = 'cancelled', updated_at = NOW()
         WHERE trackman_booking_id = $1`,
        [trackmanBookingId]
      );
    } else {
      await pool.query(
        `INSERT INTO trackman_bay_slots 
         (resource_id, slot_date, start_time, end_time, status, trackman_booking_id, customer_email, customer_name, player_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (resource_id, slot_date, start_time, trackman_booking_id)
         DO UPDATE SET 
           end_time = EXCLUDED.end_time,
           status = EXCLUDED.status,
           customer_email = EXCLUDED.customer_email,
           customer_name = EXCLUDED.customer_name,
           player_count = EXCLUDED.player_count,
           updated_at = NOW()`,
        [resourceId, slotDate, startTime, endTime, status, trackmanBookingId, customerEmail, customerName, playerCount || 1]
      );
    }
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to update bay slot cache', { error: e as Error });
  }
}

async function tryAutoApproveBooking(
  customerEmail: string,
  slotDate: string,
  startTime: string,
  trackmanBookingId: string
): Promise<{ matched: boolean; bookingId?: number }> {
  try {
    const result = await pool.query(
      `UPDATE booking_requests 
       SET status = 'approved',
           trackman_booking_id = $1,
           reviewed_at = NOW(),
           reviewed_by = 'trackman_webhook',
           staff_notes = COALESCE(staff_notes, '') || ' [Auto-approved via Trackman webhook]',
           updated_at = NOW()
       WHERE LOWER(user_email) = LOWER($2)
         AND request_date = $3
         AND start_time = $4
         AND status = 'pending'
       RETURNING id`,
      [trackmanBookingId, customerEmail, slotDate, startTime]
    );
    
    if (result.rowCount && result.rowCount > 0) {
      logger.info('[Trackman Webhook] Auto-approved booking', {
        extra: { bookingId: result.rows[0].id, email: customerEmail, date: slotDate, time: startTime }
      });
      return { matched: true, bookingId: result.rows[0].id };
    }
    
    const fuzzyResult = await pool.query(
      `UPDATE booking_requests 
       SET status = 'approved',
           trackman_booking_id = $1,
           reviewed_at = NOW(),
           reviewed_by = 'trackman_webhook',
           staff_notes = COALESCE(staff_notes, '') || ' [Auto-approved via Trackman webhook - fuzzy time match]',
           updated_at = NOW()
       WHERE LOWER(user_email) = LOWER($2)
         AND request_date = $3
         AND ABS(EXTRACT(EPOCH FROM (start_time::time - $4::time))) <= 1800
         AND status = 'pending'
       RETURNING id`,
      [trackmanBookingId, customerEmail, slotDate, startTime]
    );
    
    if (fuzzyResult.rowCount && fuzzyResult.rowCount > 0) {
      logger.info('[Trackman Webhook] Auto-approved booking (fuzzy match)', {
        extra: { bookingId: fuzzyResult.rows[0].id, email: customerEmail, date: slotDate }
      });
      return { matched: true, bookingId: fuzzyResult.rows[0].id };
    }
    
    return { matched: false };
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to auto-approve booking', { error: e as Error });
    return { matched: false };
  }
}

async function notifyMemberBookingConfirmed(
  customerEmail: string,
  bookingId: number,
  slotDate: string,
  startTime: string,
  bayName?: string
): Promise<void> {
  try {
    const userResult = await pool.query(
      `SELECT id, first_name, last_name, email FROM users WHERE LOWER(email) = LOWER($1)`,
      [customerEmail]
    );
    
    if (userResult.rows.length > 0) {
      const user = userResult.rows[0];
      
      await pool.query(
        `INSERT INTO notifications (user_id, title, message, type, link, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          user.id,
          'Booking Confirmed',
          `Your simulator booking for ${slotDate} at ${startTime}${bayName ? ` (${bayName})` : ''} has been confirmed.`,
          'booking',
          '/bookings'
        ]
      );
      
      sendNotificationToUser(user.email, {
        type: 'booking_confirmed',
        title: 'Booking Confirmed',
        message: `Your booking for ${slotDate} at ${startTime} is confirmed!`,
        data: { bookingId },
      });
      
      try {
        await sendBookingConfirmationEmail(customerEmail, {
          date: slotDate,
          time: startTime,
          bayName: bayName || 'Simulator Bay',
          memberName: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Member',
        });
      } catch (emailError) {
        logger.warn('[Trackman Webhook] Failed to send confirmation email', { extra: { email: customerEmail } });
      }
    }
  } catch (e) {
    logger.error('[Trackman Webhook] Failed to notify member', { error: e as Error });
  }
}

async function handleBookingUpdate(payload: TrackmanWebhookPayload): Promise<{ success: boolean; matchedBookingId?: number }> {
  const bookingData = extractBookingData(payload);
  if (!bookingData) {
    return { success: false };
  }
  
  const normalized = normalizeBookingFields(bookingData);
  
  if (!normalized.trackmanBookingId) {
    logger.warn('[Trackman Webhook] No booking ID in payload');
    return { success: false };
  }
  
  const startParsed = parseDateTime(normalized.startTime, normalized.date);
  const endParsed = parseDateTime(normalized.endTime, undefined);
  
  if (!startParsed) {
    logger.warn('[Trackman Webhook] Could not parse start time', { extra: { startTime: normalized.startTime } });
    return { success: false };
  }
  
  const resourceId = mapBayNameToResourceId(normalized.bayName, normalized.bayId);
  
  const status = normalized.status?.toLowerCase();
  const isCancel = status === 'cancelled' || status === 'canceled' || status === 'deleted';
  const slotStatus: 'booked' | 'cancelled' | 'completed' = isCancel ? 'cancelled' : 
    (status === 'completed' || status === 'finished') ? 'completed' : 'booked';
  
  if (resourceId) {
    await updateBaySlotCache(
      normalized.trackmanBookingId,
      resourceId,
      startParsed.date,
      startParsed.time,
      endParsed?.time || startParsed.time,
      slotStatus,
      normalized.customerEmail,
      normalized.customerName,
      normalized.playerCount
    );
  }
  
  let matchedBookingId: number | undefined;
  
  if (normalized.customerEmail && !isCancel) {
    const autoApproveResult = await tryAutoApproveBooking(
      normalized.customerEmail,
      startParsed.date,
      startParsed.time,
      normalized.trackmanBookingId
    );
    
    if (autoApproveResult.matched && autoApproveResult.bookingId) {
      matchedBookingId = autoApproveResult.bookingId;
      
      await notifyMemberBookingConfirmed(
        normalized.customerEmail,
        autoApproveResult.bookingId,
        startParsed.date,
        startParsed.time,
        normalized.bayName
      );
    }
  }
  
  return { success: true, matchedBookingId };
}

router.post('/api/webhooks/trackman', async (req: Request, res: Response) => {
  logger.info('[Trackman Webhook] Received webhook', {
    extra: { 
      headers: Object.keys(req.headers).filter(h => h.startsWith('x-')),
      bodyKeys: Object.keys(req.body || {})
    }
  });
  
  if (!validateTrackmanWebhookSignature(req)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  const payload: TrackmanWebhookPayload = req.body;
  const eventType = payload.event_type || payload.eventType || 'unknown';
  
  res.status(200).json({ received: true });
  
  try {
    let trackmanBookingId: string | undefined;
    let trackmanUserId: string | undefined;
    let matchedBookingId: number | undefined;
    let matchedUserId: string | undefined;
    let processingError: string | undefined;
    
    const bookingData = extractBookingData(payload);
    if (bookingData) {
      const normalized = normalizeBookingFields(bookingData);
      trackmanBookingId = normalized.trackmanBookingId;
      matchedUserId = normalized.customerEmail;
    }
    
    if (payload.user?.id) {
      trackmanUserId = payload.user.id;
    }
    
    switch (eventType) {
      case 'booking_update':
      case 'Booking Update':
      case 'booking.update':
      case 'booking.created':
      case 'booking.cancelled':
        const result = await handleBookingUpdate(payload);
        matchedBookingId = result.matchedBookingId;
        if (!result.success) {
          processingError = 'Failed to process booking update';
        }
        break;
        
      case 'user_update':
      case 'User Update':
      case 'user.update':
        logger.info('[Trackman Webhook] User update received - logging only', { extra: { payload } });
        break;
        
      case 'purchase_update':
      case 'Purchase Update':
      case 'purchase.update':
        logger.info('[Trackman Webhook] Purchase update received - logging only', { extra: { payload } });
        break;
        
      case 'purchase_paid':
      case 'Purchase Paid':
      case 'purchase.paid':
        logger.info('[Trackman Webhook] Purchase paid received - logging only', { extra: { payload } });
        break;
        
      default:
        logger.info('[Trackman Webhook] Unknown event type', { extra: { eventType, payload } });
    }
    
    await logWebhookEvent(
      eventType,
      payload,
      trackmanBookingId,
      trackmanUserId,
      matchedBookingId,
      matchedUserId,
      processingError
    );
  } catch (error: any) {
    logger.error('[Trackman Webhook] Processing error', { error });
    
    await logWebhookEvent(
      payload.event_type || payload.eventType || 'unknown',
      payload,
      undefined,
      undefined,
      undefined,
      undefined,
      error.message
    );
  }
});

router.get('/api/admin/trackman-webhooks', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const eventType = req.query.event_type as string;
    
    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;
    
    if (eventType) {
      whereClause += ` AND event_type = $${paramIndex}`;
      params.push(eventType);
      paramIndex++;
    }
    
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM trackman_webhook_events ${whereClause}`,
      params
    );
    
    const result = await pool.query(
      `SELECT 
        id,
        event_type,
        trackman_booking_id,
        trackman_user_id,
        matched_booking_id,
        matched_user_id,
        processing_error,
        processed_at,
        created_at,
        payload
       FROM trackman_webhook_events
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );
    
    res.json({
      events: result.rows,
      totalCount: parseInt(countResult.rows[0].total),
      limit,
      offset,
    });
  } catch (error: any) {
    logger.error('[Trackman Webhook] Failed to fetch webhook events', { error });
    res.status(500).json({ error: 'Failed to fetch webhook events' });
  }
});

router.get('/api/admin/trackman-webhooks/stats', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const stats = await pool.query(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(*) FILTER (WHERE event_type = 'booking_update') as booking_updates,
        COUNT(*) FILTER (WHERE matched_booking_id IS NOT NULL) as auto_approved,
        COUNT(*) FILTER (WHERE processing_error IS NOT NULL) as errors,
        MAX(created_at) as last_event_at
      FROM trackman_webhook_events
      WHERE created_at >= NOW() - INTERVAL '30 days'
    `);
    
    const slotStats = await pool.query(`
      SELECT 
        COUNT(*) as total_slots,
        COUNT(*) FILTER (WHERE status = 'booked') as booked,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled,
        COUNT(*) FILTER (WHERE slot_date >= CURRENT_DATE) as upcoming
      FROM trackman_bay_slots
    `);
    
    res.json({
      webhookStats: stats.rows[0],
      slotStats: slotStats.rows[0],
    });
  } catch (error: any) {
    logger.error('[Trackman Webhook] Failed to fetch stats', { error });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/api/availability/trackman-cache', async (req: Request, res: Response) => {
  try {
    const { start_date, end_date, resource_id } = req.query;
    
    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }
    
    let whereClause = `WHERE slot_date >= $1 AND slot_date <= $2 AND status = 'booked'`;
    const params: any[] = [start_date, end_date];
    
    if (resource_id) {
      whereClause += ` AND resource_id = $3`;
      params.push(resource_id);
    }
    
    const result = await pool.query(
      `SELECT 
        id,
        resource_id,
        TO_CHAR(slot_date, 'YYYY-MM-DD') as slot_date,
        start_time,
        end_time,
        status,
        trackman_booking_id,
        customer_name,
        player_count
       FROM trackman_bay_slots
       ${whereClause}
       ORDER BY slot_date, start_time`,
      params
    );
    
    res.json(result.rows);
  } catch (error: any) {
    logger.error('[Trackman Webhook] Failed to fetch availability cache', { error });
    res.status(500).json({ error: 'Failed to fetch availability' });
  }
});

export default router;
