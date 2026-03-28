import { db } from '../../db';
import { sql } from 'drizzle-orm';

export interface LifetimeVisitStats {
  totalVisits: number;
  bookingCount: number;
  eventCount: number;
  wellnessCount: number;
  walkInCount: number;
}

export async function getLifetimeVisitStats(email: string): Promise<LifetimeVisitStats> {
  const normalizedEmail = email.trim().toLowerCase();

  const [bookingResult, eventResult, wellnessResult, walkInResult] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(DISTINCT booking_id) as count FROM (
        SELECT id as booking_id FROM booking_requests
        WHERE LOWER(user_email) = ${normalizedEmail}
          AND request_date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
          AND status NOT IN ('cancelled', 'declined', 'cancellation_pending', 'deleted')
        UNION
        SELECT br.id as booking_id FROM booking_requests br
        JOIN booking_sessions bs ON br.session_id = bs.id
        JOIN booking_participants bp ON bp.session_id = bs.id
        LEFT JOIN users bp_user ON bp.user_id = bp_user.id
        LEFT JOIN guests bp_guest ON bp.guest_id = bp_guest.id
        WHERE (LOWER(COALESCE(bp_user.email, bp_guest.email, '')) = ${normalizedEmail})
          AND bp.participant_type != 'owner'
          AND LOWER(br.user_email) != ${normalizedEmail}
          AND br.request_date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
          AND br.status NOT IN ('cancelled', 'declined', 'cancellation_pending', 'deleted')
      ) all_bookings
    `),
    db.execute(sql`
      SELECT COUNT(*) as count FROM event_rsvps er
      JOIN events e ON er.event_id = e.id
      WHERE LOWER(er.user_email) = ${normalizedEmail}
        AND e.event_date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
        AND er.status NOT IN ('cancelled')
    `),
    db.execute(sql`
      SELECT COUNT(*) as count FROM wellness_enrollments we
      JOIN wellness_classes wc ON we.class_id = wc.id
      WHERE LOWER(we.user_email) = ${normalizedEmail}
        AND wc.date < (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
        AND we.status NOT IN ('cancelled')
    `),
    db.execute(sql`
      SELECT COUNT(*)::int as count FROM walk_in_visits
      WHERE LOWER(member_email) = ${normalizedEmail}
    `),
  ]);

  const bookingCount = Number((bookingResult.rows as Record<string, unknown>[])[0]?.count || 0);
  const eventCount = Number((eventResult.rows as Record<string, unknown>[])[0]?.count || 0);
  const wellnessCount = Number((wellnessResult.rows as Record<string, unknown>[])[0]?.count || 0);
  const walkInCount = Number((walkInResult.rows as Record<string, unknown>[])[0]?.count || 0);

  return {
    totalVisits: bookingCount + eventCount + wellnessCount + walkInCount,
    bookingCount,
    eventCount,
    wellnessCount,
    walkInCount,
  };
}
