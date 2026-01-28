import { Router } from 'express';
import { pool } from '../../core/db';
import { isStaffOrAdmin } from '../../core/middleware';
import { notifyAllStaff } from '../../core/staffNotifications';
import { broadcastAvailabilityUpdate } from '../../core/websocket';
import { logFromRequest } from '../../core/auditLog';
import { logAndRespond } from '../../core/logger';
import { formatDateDisplayWithDay, formatTime12Hour } from '../../utils/dateUtils';
import { db } from '../../db';
import { resources } from '../../../shared/schema';
import { eq } from 'drizzle-orm';

const router = Router();

router.post('/api/staff/manual-booking', isStaffOrAdmin, async (req, res) => {
  try {
    const { 
      user_email, 
      user_name, 
      resource_id, 
      request_date, 
      start_time, 
      duration_minutes,
      declared_player_count,
      request_participants,
      trackman_external_id
    } = req.body;
    
    if (!user_email || !request_date || !start_time || !duration_minutes) {
      return res.status(400).json({ error: 'Missing required fields: user_email, request_date, start_time, duration_minutes' });
    }
    
    if (!trackman_external_id) {
      return res.status(400).json({ error: 'Missing required field: trackman_external_id' });
    }
    
    const parsedDate = new Date(request_date + 'T00:00:00');
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const [year, month, day] = request_date.split('-').map((n: string) => parseInt(n, 10));
    const validatedDate = new Date(year, month - 1, day);
    if (validatedDate.getFullYear() !== year || 
        validatedDate.getMonth() !== month - 1 || 
        validatedDate.getDate() !== day) {
      return res.status(400).json({ error: 'Invalid date - date does not exist (e.g., Feb 30)' });
    }
    
    if (typeof duration_minutes !== 'number' || !Number.isInteger(duration_minutes) || duration_minutes <= 0 || duration_minutes > 480) {
      return res.status(400).json({ error: 'Invalid duration. Must be a whole number between 1 and 480 minutes.' });
    }
    
    const [hours, mins] = start_time.split(':').map(Number);
    const totalMins = hours * 60 + mins + duration_minutes;
    const endHours = Math.floor(totalMins / 60);
    const endMins = totalMins % 60;
    const end_time = `${endHours.toString().padStart(2, '0')}:${endMins.toString().padStart(2, '0')}:00`;
    
    if (endHours >= 24) {
      return res.status(400).json({ error: 'Booking cannot extend past midnight. Please choose an earlier start time or shorter duration.' });
    }
    
    let sanitizedParticipants: any[] = [];
    if (request_participants && Array.isArray(request_participants)) {
      sanitizedParticipants = request_participants
        .slice(0, 3)
        .map((p: any) => ({
          email: typeof p.email === 'string' ? p.email.toLowerCase().trim() : '',
          type: p.type === 'member' ? 'member' : 'guest',
          userId: p.userId != null ? String(p.userId) : undefined,
          name: typeof p.name === 'string' ? p.name.trim() : undefined
        }))
        .filter((p: any) => p.email || p.userId);
    }
    
    const client = await pool.connect();
    let row: any;
    try {
      await client.query('BEGIN');
      
      await client.query(
        `SELECT id FROM booking_requests 
         WHERE LOWER(user_email) = LOWER($1) 
         AND request_date = $2 
         AND status IN ('pending', 'approved', 'confirmed')
         FOR UPDATE`,
        [user_email, request_date]
      );
      
      if (resource_id) {
        const overlapCheck = await client.query(
          `SELECT id FROM booking_requests 
           WHERE resource_id = $1 
           AND request_date = $2 
           AND status IN ('pending', 'approved', 'confirmed', 'attended')
           AND (start_time < $4 AND end_time > $3)
           FOR UPDATE`,
          [resource_id, request_date, start_time, end_time]
        );
        
        if (overlapCheck.rows.length > 0) {
          await client.query('ROLLBACK');
          client.release();
          return res.status(409).json({ error: 'This time slot is already booked' });
        }
      }
      
      const insertResult = await client.query(
        `INSERT INTO booking_requests (
          user_email, user_name, resource_id, 
          request_date, start_time, duration_minutes, end_time,
          declared_player_count, request_participants,
          trackman_external_id, origin,
          status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', NOW(), NOW())
        RETURNING *`,
        [
          user_email.toLowerCase(),
          user_name || null,
          resource_id || null,
          request_date,
          start_time,
          duration_minutes,
          end_time,
          declared_player_count && declared_player_count >= 1 && declared_player_count <= 4 ? declared_player_count : null,
          sanitizedParticipants.length > 0 ? JSON.stringify(sanitizedParticipants) : '[]',
          trackman_external_id,
          'staff_manual'
        ]
      );
      
      await client.query('COMMIT');
      
      const dbRow = insertResult.rows[0];
      row = {
        id: dbRow.id,
        userEmail: dbRow.user_email,
        userName: dbRow.user_name,
        resourceId: dbRow.resource_id,
        requestDate: dbRow.request_date,
        startTime: dbRow.start_time,
        durationMinutes: dbRow.duration_minutes,
        endTime: dbRow.end_time,
        status: dbRow.status,
        declaredPlayerCount: dbRow.declared_player_count,
        requestParticipants: dbRow.request_participants || [],
        trackmanExternalId: dbRow.trackman_external_id,
        origin: dbRow.origin,
        createdAt: dbRow.created_at,
        updatedAt: dbRow.updated_at
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
    let resourceName = 'Bay';
    if (row.resourceId) {
      try {
        const [resource] = await db.select({ name: resources.name }).from(resources).where(eq(resources.id, row.resourceId));
        if (resource?.name) {
          resourceName = resource.name;
        }
      } catch (e) {
      }
    }
    
    const dateStr = typeof row.requestDate === 'string' 
      ? row.requestDate 
      : request_date;
    const formattedDate = formatDateDisplayWithDay(dateStr);
    const formattedTime12h = formatTime12Hour(row.startTime?.substring(0, 5) || start_time.substring(0, 5));
    
    const durationMins = row.durationMinutes || duration_minutes;
    let durationDisplay = '';
    if (durationMins) {
      if (durationMins < 60) {
        durationDisplay = `${durationMins} min`;
      } else {
        const hours = durationMins / 60;
        durationDisplay = hours === Math.floor(hours) ? `${hours} hr${hours > 1 ? 's' : ''}` : `${hours.toFixed(1)} hrs`;
      }
    }
    
    const playerCount = declared_player_count && declared_player_count > 1 ? ` (${declared_player_count} players)` : '';
    
    const staffTitle = 'Staff Manual Booking Created';
    const staffMessage = `${row.userName || row.userEmail}${playerCount} - ${resourceName} on ${formattedDate} at ${formattedTime12h} for ${durationDisplay} (Trackman: ${trackman_external_id})`;
    
    res.status(201).json({
      id: row.id,
      user_email: row.userEmail,
      user_name: row.userName,
      resource_id: row.resourceId,
      request_date: row.requestDate,
      start_time: row.startTime,
      duration_minutes: row.durationMinutes,
      end_time: row.endTime,
      status: row.status,
      declared_player_count: row.declaredPlayerCount,
      request_participants: row.requestParticipants,
      trackman_external_id: row.trackmanExternalId,
      origin: row.origin,
      created_at: row.createdAt,
      updated_at: row.updatedAt
    });
    
    try {
      notifyAllStaff(
        staffTitle,
        staffMessage,
        'booking',
        row.id,
        'booking_request'
      ).catch(err => console.error('Staff notification failed:', err));
      
      broadcastAvailabilityUpdate({
        resourceId: row.resourceId || undefined,
        resourceType: 'simulator',
        date: row.requestDate,
        action: 'booked'
      });
      
      logFromRequest(req, 'create_booking', 'booking', String(row.id), row.userName || row.userEmail, {
        trackman_external_id: trackman_external_id,
        origin: 'staff_manual',
        resource_id: row.resourceId,
        request_date: row.requestDate,
        start_time: row.startTime
      });
    } catch (postCommitError) {
      console.error('[StaffManualBooking] Post-commit operations failed:', postCommitError);
    }
  } catch (error: any) {
    logAndRespond(req, res, 500, 'Failed to create manual booking', error);
  }
});

export default router;
