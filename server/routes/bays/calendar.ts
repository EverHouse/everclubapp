import { Router } from 'express';
import { db } from '../../db';
import { bookingRequests, resources } from '../../../shared/schema';
import { eq, and, or, gte, lte, asc, SQL, sql } from 'drizzle-orm';
import { getConferenceRoomBookingsFromCalendar } from '../../core/calendar/index';
import { isStaffOrAdmin } from '../../core/middleware';
import { getConferenceRoomId } from '../../core/affectedAreas';
import { logAndRespond, logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { getSessionUser } from '../../types/session';
import { getTodayPacific, addDaysToPacificDate } from '../../utils/dateUtils';
import { toIntArrayLiteral, toTextArrayLiteral } from '../../utils/sqlArrayLiteral';


const router = Router();

// PUBLIC ROUTE - conference room bookings visible to authenticated members (auth checked in handler)
router.get('/api/conference-room-bookings', async (req, res) => {
  try {
    const { member_name, member_email } = req.query;
    const sessionUser = getSessionUser(req);
    
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const searchName = member_name as string || sessionUser.name || undefined;
    const searchEmail = (member_email as string)?.trim()?.toLowerCase() || sessionUser?.email?.toLowerCase() || undefined;
    
    const bookings = await getConferenceRoomBookingsFromCalendar(searchName, searchEmail);
    const conferenceRoomId = await getConferenceRoomId();
    
    const formattedBookings = bookings.map(booking => ({
      id: `cal_${booking.id}`,
      source: 'calendar',
      resource_id: conferenceRoomId,
      resource_name: 'Conference Room',
      request_date: booking.date,
      start_time: booking.startTime + ':00',
      end_time: booking.endTime + ':00',
      user_name: booking.memberName,
      status: 'approved',
      notes: booking.description,
      calendar_event_id: booking.id
    }));
    
    res.json(formattedBookings);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch conference room bookings', error);
  }
});

router.get('/api/approved-bookings', isStaffOrAdmin, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const todayStr = getTodayPacific();
    const defaultStartDate = start_date || addDaysToPacificDate(todayStr, -30);
    const defaultEndDate = end_date || addDaysToPacificDate(todayStr, 60);
    
    const conditions: (SQL | undefined)[] = [
      or(
        eq(bookingRequests.status, 'approved'),
        eq(bookingRequests.status, 'confirmed'),
        eq(bookingRequests.status, 'attended'),
        eq(bookingRequests.status, 'cancellation_pending'),
        and(
          eq(bookingRequests.status, 'pending'),
          eq(bookingRequests.isUnmatched, true)
        )
      ),
    ];
    
    conditions.push(gte(bookingRequests.requestDate, defaultStartDate as string));
    conditions.push(lte(bookingRequests.requestDate, defaultEndDate as string));
    
    const dbResult = await db.select({
      id: bookingRequests.id,
      user_email: bookingRequests.userEmail,
      user_name: bookingRequests.userName,
      resource_id: bookingRequests.resourceId,
      resource_preference: bookingRequests.resourcePreference,
      request_date: bookingRequests.requestDate,
      start_time: bookingRequests.startTime,
      duration_minutes: bookingRequests.durationMinutes,
      end_time: bookingRequests.endTime,
      notes: bookingRequests.notes,
      status: bookingRequests.status,
      staff_notes: bookingRequests.staffNotes,
      suggested_time: bookingRequests.suggestedTime,
      reviewed_by: bookingRequests.reviewedBy,
      reviewed_at: bookingRequests.reviewedAt,
      created_at: bookingRequests.createdAt,
      updated_at: bookingRequests.updatedAt,
      calendar_event_id: bookingRequests.calendarEventId,
      resource_name: resources.name,
      resource_type: resources.type,
      trackman_booking_id: bookingRequests.trackmanBookingId,
      declared_player_count: bookingRequests.declaredPlayerCount,
      member_notes: bookingRequests.memberNotes,
      guest_count: bookingRequests.guestCount,
      is_unmatched: bookingRequests.isUnmatched,
      trackman_customer_notes: bookingRequests.trackmanCustomerNotes,
    })
    .from(bookingRequests)
    .leftJoin(resources, eq(bookingRequests.resourceId, resources.id))
    .where(and(...conditions))
    .orderBy(asc(bookingRequests.requestDate), asc(bookingRequests.startTime));
    
    const bookingIds = dbResult.map(b => b.id).filter(Boolean);
    const bookingIdsLiteral = toIntArrayLiteral(bookingIds);

    const uniqueEmails = [...new Set(dbResult.map(b => b.user_email).filter(Boolean))] as string[];

    const userNameMap = new Map<string, string>();
    const paymentStatusMap = new Map<number, { hasUnpaidFees: boolean; totalOwed: number }>();
    const filledSlotsMap = new Map<number, number>();
    let feeSnapshotPaidSet = new Set<number>();

    const parallelQueries: Promise<void>[] = [];

    if (uniqueEmails.length > 0) {
      const emailArrayLiteral = toTextArrayLiteral(uniqueEmails.map(e => e.toLowerCase()));
      parallelQueries.push(
        db.execute(sql`
          SELECT LOWER(email) as email_lower, TRIM(CONCAT_WS(' ', first_name, last_name)) as full_name
          FROM users
          WHERE LOWER(email) = ANY(${emailArrayLiteral}::text[])
        `).then((result) => {
          for (const row of result.rows as Array<{ email_lower: string; full_name: string }>) {
            if (row.full_name && row.full_name.trim()) {
              userNameMap.set(row.email_lower, row.full_name);
            }
          }
        })
      );
    }

    if (bookingIds.length > 0) {
      parallelQueries.push(
        db.execute(sql`
          SELECT 
            br.id as booking_id,
            COALESCE(pending_fees.total_owed, 0)::numeric as total_owed,
            CASE 
              WHEN br.session_id IS NOT NULL 
                AND EXISTS (SELECT 1 FROM booking_participants bp2 WHERE bp2.session_id = br.session_id)
                AND NOT EXISTS (SELECT 1 FROM booking_participants bp3 WHERE bp3.session_id = br.session_id AND bp3.payment_status IN ('pending', 'refunded') AND COALESCE(bp3.cached_fee_cents, 0) > 0)
              THEN true
              ELSE false
            END as all_participants_paid,
            COALESCE((SELECT COUNT(*) FROM booking_participants bp WHERE bp.session_id = br.session_id), 0) as filled_count,
            CASE WHEN EXISTS (SELECT 1 FROM booking_fee_snapshots bfs WHERE bfs.session_id = br.session_id AND bfs.status IN ('completed', 'paid')) THEN true ELSE false END as has_paid_snapshot
          FROM booking_requests br
          LEFT JOIN LATERAL (
            SELECT SUM(COALESCE(bp.cached_fee_cents, 0)) / 100.0 as total_owed
            FROM booking_participants bp
            WHERE bp.session_id = br.session_id
              AND bp.payment_status IN ('pending', 'refunded')
          ) pending_fees ON true
          WHERE br.id = ANY(${bookingIdsLiteral}::int[])
        `).then((result) => {
          for (const row of result.rows as Array<{ booking_id: number; total_owed: string; all_participants_paid: boolean; filled_count: string; has_paid_snapshot: boolean }>) {
            const totalOwed = parseFloat(row.total_owed) || 0;
            if (row.has_paid_snapshot) {
              feeSnapshotPaidSet.add(row.booking_id);
            }
            const snapshotPaid = (row.has_paid_snapshot && totalOwed === 0) || row.all_participants_paid === true;
            paymentStatusMap.set(row.booking_id, {
              hasUnpaidFees: snapshotPaid ? false : totalOwed > 0,
              totalOwed: snapshotPaid ? 0 : totalOwed
            });
            if (snapshotPaid) {
              feeSnapshotPaidSet.add(row.booking_id);
            }
            filledSlotsMap.set(row.booking_id, parseInt(row.filled_count, 10) || 0);
          }
        })
      );
    }

    await Promise.all(parallelQueries);

    const enrichedDbResult = dbResult.map(b => {
      const emailLower = b.user_email?.toLowerCase();
      const resolvedUserName = (emailLower && userNameMap.get(emailLower)) || b.user_name;
      const declaredPlayers = b.declared_player_count || 1;
      const actualFilledSlots = filledSlotsMap.get(b.id);
      const filledSlots = actualFilledSlots !== undefined && actualFilledSlots > 0
        ? actualFilledSlots
        : 1 + (b.guest_count || 0);
      const unfilledSlots = Math.max(0, declaredPlayers - filledSlots);
      
      return {
        ...b,
        user_name: resolvedUserName,
        has_unpaid_fees: paymentStatusMap.get(b.id)?.hasUnpaidFees || false,
        total_owed: paymentStatusMap.get(b.id)?.totalOwed || 0,
        fee_snapshot_paid: feeSnapshotPaidSet.has(b.id) && !(paymentStatusMap.get(b.id)?.hasUnpaidFees),
        unfilled_slots: unfilledSlots,
        filled_player_count: filledSlots
      };
    });
    
    const allBookings = (enrichedDbResult as Array<Record<string, unknown>>)
      .sort((a, b) => {
        const dateCompare = (String(a.request_date || '')).localeCompare(String(b.request_date || ''));
        if (dateCompare !== 0) return dateCompare;
        return (String(a.start_time || '')).localeCompare(String(b.start_time || ''));
      });
    
    res.json(allBookings);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch approved bookings', error);
  }
});

export default router;
