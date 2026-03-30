import { Router } from 'express';
import { isAuthenticated, isStaffOrAdmin } from '../../core/middleware';
import { db } from '../../db';
import { events, eventRsvps, users, notifications } from '../../../shared/schema';
import { eq, and, or, sql, gte, desc } from 'drizzle-orm';
import { notifyAllStaff, notifyMember } from '../../core/notificationService';
import { formatDateDisplayWithDay, getTodayPacific, formatTime12Hour } from '../../utils/dateUtils';
import { broadcastToStaff } from '../../core/websocket';
import { getSessionUser } from '../../types/session';
import { logFromRequest } from '../../core/auditLog';
import { getErrorMessage } from '../../utils/errorUtils';
import { logger, logAndRespond } from '../../core/logger';
import { getMemberDisplayName } from './shared';
import { validateBody } from '../../middleware/validate';
import { z } from 'zod';
import { numericIdParam, requiredStringParam } from '../../middleware/paramSchemas';
import { bookingRateLimiter } from '../../middleware/rateLimiting';
import { createEventRsvp } from '../../core/registrationService';

const rsvpCreateSchema = z.object({
  event_id: z.number().int().positive('event_id is required'),
  user_email: z.string().email('Valid email is required'),
});

const router = Router();

router.get('/api/rsvps', isAuthenticated, async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const { user_email: rawEmail } = req.query;
    const user_email = rawEmail ? decodeURIComponent(rawEmail as string) : null;
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    
    if (user_email && user_email.toLowerCase() !== sessionEmail) {
      const { isAdminEmail, getAuthPool, queryWithRetry } = await import('../../replit_integrations/auth/replitAuth');
      const isAdmin = await isAdminEmail(sessionEmail);
      if (!isAdmin) {
        const pool = getAuthPool();
        let isStaff = false;
        if (pool) {
          try {
            const { getAlternateDomainEmail } = await import('../../core/utils/emailNormalization');
            const altEmail = getAlternateDomainEmail(sessionEmail);
            const emailsToCheck = altEmail ? [sessionEmail, altEmail] : [sessionEmail];
            const result = await queryWithRetry(
              pool,
              `SELECT id FROM staff_users WHERE LOWER(email) = ANY($1::text[]) AND is_active = true`,
              [emailsToCheck.map(e => e.toLowerCase())]
            );
            isStaff = (result as unknown as { rows: Array<Record<string, unknown>> }).rows.length > 0;
          } catch (error: unknown) {
            logger.warn('[events] Staff check query failed', { extra: { error: getErrorMessage(error) } });
          }
        }
        if (!isStaff) {
          return res.status(403).json({ error: 'You can only view your own RSVPs' });
        }
      }
    }
    
    const { include_past } = req.query;
    
    const conditions = [
      eq(eventRsvps.status, 'confirmed'),
    ];
    
    if (include_past !== 'true') {
      conditions.push(gte(events.eventDate, getTodayPacific()));
    }
    
    if (user_email) {
      const userLookup = await db.select({ id: users.id })
        .from(users)
        .where(sql`LOWER(${users.email}) = LOWER(${user_email})`)
        .limit(1);
      
      if (userLookup.length > 0) {
        conditions.push(
          or(
            eq(eventRsvps.userEmail, user_email),
            eq(eventRsvps.matchedUserId, userLookup[0].id)
          )!
        );
      } else {
        conditions.push(eq(eventRsvps.userEmail, user_email));
      }
    }
    
    const result = await db.select({
      id: eventRsvps.id,
      event_id: eventRsvps.eventId,
      user_email: eventRsvps.userEmail,
      status: eventRsvps.status,
      created_at: eventRsvps.createdAt,
      order_date: eventRsvps.orderDate,
      title: events.title,
      event_date: events.eventDate,
      start_time: events.startTime,
      end_time: events.endTime,
      location: events.location,
      category: events.category,
      image_url: events.imageUrl,
    })
    .from(eventRsvps)
    .innerJoin(events, eq(eventRsvps.eventId, events.id))
    .where(and(...conditions))
    .orderBy(events.eventDate, events.startTime)
    .limit(500);
    
    res.json(result);
  } catch (error: unknown) {
    logger.error('API error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Request failed' });
  }
});

router.post('/api/rsvps', isAuthenticated, bookingRateLimiter, validateBody(rsvpCreateSchema), async (req, res) => {
  try {
    const { event_id, user_email: raw_user_email } = req.body;
    const user_email = raw_user_email?.trim()?.toLowerCase();
    
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    if (!user_email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const isOwnAction = sessionEmail === user_email;
    const isAdminOrStaff = sessionUser.role === 'admin' || sessionUser.role === 'staff';
    if (!isOwnAction && !isAdminOrStaff) {
      return res.status(403).json({ error: 'You can only perform this action for yourself' });
    }
    
    const memberName = await getMemberDisplayName(user_email);
    
    const { rsvp } = await createEventRsvp(event_id, {
      userEmail: user_email,
      sessionEmail,
      isStaffOverride: !isOwnAction && isAdminOrStaff,
    }, memberName);
    
    res.status(201).json(rsvp);
  } catch (error: unknown) {
    const err = error as { statusCode?: number };
    if (err.statusCode === 400 || err.statusCode === 404) {
      return logAndRespond(req, res, err.statusCode, getErrorMessage(error) || 'Request failed');
    }
    logAndRespond(req, res, 500, 'Failed to create RSVP. Staff notification is required.', error);
  }
});

router.delete('/api/rsvps/:event_id/:user_email', isAuthenticated, async (req, res) => {
  try {
    const { event_id, user_email: rawUserEmail } = req.params;
    const eventIdParse = numericIdParam.safeParse(event_id);
    if (!eventIdParse.success) return res.status(400).json({ error: 'Invalid event ID' });
    const parsedEventId = parseInt(eventIdParse.data, 10);
    if (isNaN(parsedEventId)) return res.status(400).json({ error: 'Invalid event ID' });
    const userEmailParse = requiredStringParam.safeParse(rawUserEmail);
    if (!userEmailParse.success) return res.status(400).json({ error: 'Invalid user email parameter' });
    const user_email = decodeURIComponent(userEmailParse.data).trim().toLowerCase();
    
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    const isOwnAction = sessionEmail === user_email;
    const isAdminOrStaff = sessionUser.role === 'admin' || sessionUser.role === 'staff';
    if (!isOwnAction && !isAdminOrStaff) {
      return res.status(403).json({ error: 'You can only perform this action for yourself' });
    }
    
    const eventData = await db.select({
      title: events.title,
      eventDate: events.eventDate,
    }).from(events).where(eq(events.id, parsedEventId));
    
    if (eventData.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    const evt = eventData[0];
    const formattedDate = formatDateDisplayWithDay(evt.eventDate);
    const memberName = await getMemberDisplayName(user_email as string);
    const staffMessage = `${memberName} cancelled their RSVP for ${evt.title} on ${formattedDate}`;
    
    await db.transaction(async (tx) => {
      await tx.update(eventRsvps)
        .set({ status: 'cancelled' })
        .where(and(
          eq(eventRsvps.eventId, parsedEventId),
          eq(eventRsvps.userEmail, user_email as string)
        ));
    });
    
    notifyAllStaff(
      'Event RSVP Cancelled',
      staffMessage,
      'event_rsvp_cancelled',
      { relatedId: parsedEventId, relatedType: 'event', url: '/admin/calendar' }
    ).catch((err: unknown) => logger.warn('Failed to notify staff of RSVP cancellation', { extra: { error: getErrorMessage(err) } }));
    
    notifyMember({
      userEmail: user_email as string,
      title: 'RSVP Cancelled',
      message: `Your RSVP for "${evt.title}" on ${formattedDate} has been cancelled`,
      type: 'event',
      relatedId: parsedEventId,
      relatedType: 'event',
      url: '/events'
    }).catch((err: unknown) => logger.warn('Failed to notify member of RSVP cancellation', { extra: { error: getErrorMessage(err) } }));
    
    broadcastToStaff({
      type: 'rsvp_event',
      action: 'rsvp_cancelled',
      eventId: parsedEventId,
      memberEmail: user_email
    });
    
    logFromRequest(req, 'cancel_event_rsvp', 'event', eventIdParse.data, undefined, {
      member_email: user_email,
      event_title: evt.title,
      event_date: evt.eventDate
    });
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('RSVP cancellation error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to cancel RSVP. Staff notification is required.' });
  }
});

router.get('/api/events/:id/rsvps', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const idParse = numericIdParam.safeParse(id);
    if (!idParse.success) return res.status(400).json({ error: 'Invalid event ID' });
    const eventId = parseInt(idParse.data, 10);
    if (isNaN(eventId)) return res.status(400).json({ error: 'Invalid event ID' });
    
    const result = await db.select({
      id: eventRsvps.id,
      userEmail: eventRsvps.userEmail,
      status: eventRsvps.status,
      source: eventRsvps.source,
      attendeeName: eventRsvps.attendeeName,
      ticketClass: eventRsvps.ticketClass,
      checkedIn: eventRsvps.checkedIn,
      matchedUserId: eventRsvps.matchedUserId,
      guestCount: eventRsvps.guestCount,
      orderDate: eventRsvps.orderDate,
      createdAt: eventRsvps.createdAt,
      firstName: users.firstName,
      lastName: users.lastName,
      phone: users.phone,
    })
    .from(eventRsvps)
    .leftJoin(users, or(
      eq(eventRsvps.userEmail, users.email),
      eq(eventRsvps.matchedUserId, users.id)
    ))
    .where(and(
      eq(eventRsvps.eventId, eventId),
      eq(eventRsvps.status, 'confirmed')
    ))
    .orderBy(desc(eventRsvps.createdAt));
    
    res.json(result);
  } catch (error: unknown) {
    logger.error('API error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch RSVPs' });
  }
});

router.delete('/api/events/:eventId/rsvps/:rsvpId', isStaffOrAdmin, async (req, res) => {
  try {
    const { eventId, rsvpId } = req.params;
    const eventIdParse = numericIdParam.safeParse(eventId);
    if (!eventIdParse.success) return res.status(400).json({ error: 'Invalid event ID' });
    const parsedEventId = parseInt(eventIdParse.data, 10);
    const rsvpIdParse = numericIdParam.safeParse(rsvpId);
    if (!rsvpIdParse.success) return res.status(400).json({ error: 'Invalid RSVP ID' });
    const parsedRsvpId = parseInt(rsvpIdParse.data, 10);
    if (isNaN(parsedEventId) || isNaN(parsedRsvpId)) return res.status(400).json({ error: 'Invalid event or RSVP ID' });
    
    const existingRsvp = await db.select()
      .from(eventRsvps)
      .where(and(
        eq(eventRsvps.id, parsedRsvpId),
        eq(eventRsvps.eventId, parsedEventId)
      ))
      .limit(1);
    
    if (existingRsvp.length === 0) {
      return res.status(404).json({ error: 'RSVP not found' });
    }
    
    const rsvp = existingRsvp[0];
    const eventData = await db.select({
      title: events.title,
      eventDate: events.eventDate
    }).from(events).where(eq(events.id, parsedEventId));
    
    await db.delete(eventRsvps)
      .where(eq(eventRsvps.id, parsedRsvpId));
    
    const event = eventData[0] || { title: 'Unknown', eventDate: '' };
    logFromRequest(req, 'remove_rsvp', 'event', eventIdParse.data, event.title, {
      rsvp_email: rsvp.userEmail,
      attendee_name: rsvp.attendeeName,
      event_date: event.eventDate
    });
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('RSVP deletion error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to delete RSVP' });
  }
});

router.post('/api/events/:id/rsvps/manual', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const idParse = numericIdParam.safeParse(id);
    if (!idParse.success) return res.status(400).json({ error: 'Invalid event ID' });
    const parsedEventId = parseInt(idParse.data, 10);
    if (isNaN(parsedEventId)) return res.status(400).json({ error: 'Invalid event ID' });
    const { email: rawEmail } = req.body;
    const email = rawEmail?.trim()?.toLowerCase();
    
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const existingRsvp = await db.select()
      .from(eventRsvps)
      .where(and(
        eq(eventRsvps.eventId, parsedEventId),
        eq(eventRsvps.userEmail, email),
        eq(eventRsvps.status, 'confirmed')
      ))
      .limit(1);
    
    if (existingRsvp.length > 0) {
      return res.status(400).json({ error: 'This email is already registered for this event' });
    }

    await db.insert(eventRsvps).values({
      eventId: parsedEventId,
      userEmail: email,
      status: 'confirmed',
      checkedIn: true,
    });
    
    const eventData = await db.select({
      title: events.title,
      eventDate: events.eventDate
    }).from(events).where(eq(events.id, parsedEventId));
    
    const event = eventData[0] || { title: 'Unknown', eventDate: '' };
    logFromRequest(req, 'manual_rsvp', 'event', idParse.data, event.title, {
      attendee_email: email,
      event_date: event.eventDate
    });
    
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('Manual RSVP error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to add RSVP' });
  }
});

export default router;
