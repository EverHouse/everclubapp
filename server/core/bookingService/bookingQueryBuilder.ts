import { bookingRequests } from '../../../shared/schema';
import { or, sql, SQL } from 'drizzle-orm';

export function buildUserEmailConditions(userEmail: string): SQL {
  const userEmailLower = userEmail.toLowerCase();
  const condition = or(
    sql`LOWER(${bookingRequests.userEmail}) = ${userEmailLower}`,
    sql`LOWER(${bookingRequests.userEmail}) IN (SELECT LOWER(ule.linked_email) FROM user_linked_emails ule WHERE LOWER(ule.primary_email) = ${userEmailLower})`,
    sql`LOWER(${bookingRequests.userEmail}) IN (SELECT LOWER(ule.primary_email) FROM user_linked_emails ule WHERE LOWER(ule.linked_email) = ${userEmailLower})`,
    sql`${bookingRequests.sessionId} IN (SELECT bp.session_id FROM booking_participants bp JOIN users u ON bp.user_id = u.id WHERE LOWER(u.email) = ${userEmailLower})`
  );
  return condition ?? sql`FALSE`;
}

export function buildUserEmailConditionsExtended(userEmail: string): SQL {
  const userEmailLower = userEmail.toLowerCase();
  const condition = or(
    sql`LOWER(${bookingRequests.userEmail}) = ${userEmailLower}`,
    sql`LOWER(${bookingRequests.userEmail}) IN (SELECT LOWER(ule.linked_email) FROM user_linked_emails ule WHERE LOWER(ule.primary_email) = ${userEmailLower})`,
    sql`LOWER(${bookingRequests.userEmail}) IN (SELECT LOWER(ule.primary_email) FROM user_linked_emails ule WHERE LOWER(ule.linked_email) = ${userEmailLower})`,
    sql`${bookingRequests.sessionId} IN (SELECT bp.session_id FROM booking_participants bp JOIN users u ON bp.user_id = u.id WHERE LOWER(u.email) = ${userEmailLower})`,
    sql`${bookingRequests.id} IN (
      SELECT br2.id FROM booking_requests br2
      JOIN booking_sessions bs ON bs.id = br2.session_id
      JOIN booking_participants bp ON bp.session_id = bs.id
      JOIN users u ON u.id = bp.user_id
      WHERE LOWER(u.email) = ${userEmailLower}
    )`
  );
  return condition ?? sql`FALSE`;
}

export function calculateTotalPlayerCount(opts: {
  trackmanPlayerCount: number | null;
  participantTotal: number;
  legacyGuestCount: number;
}): number {
  const { trackmanPlayerCount, participantTotal, legacyGuestCount } = opts;
  if (trackmanPlayerCount && trackmanPlayerCount > 0) {
    return trackmanPlayerCount;
  }
  if (participantTotal > 0) {
    return participantTotal;
  }
  return Math.max(legacyGuestCount + 1, 1);
}
