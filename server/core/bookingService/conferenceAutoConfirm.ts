import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { createSessionWithUsageTracking } from './sessionManager';
import type { TransactionContext } from './sessionTypes';

interface ConferenceAutoConfirmInput {
  bookingId: number;
  resourceId: number;
  sessionDate: string;
  startTime: string;
  endTime: string;
  ownerEmail: string;
  durationMinutes: number;
  displayName: string;
  userId?: string;
}

interface ConferenceAutoConfirmResult {
  confirmed: boolean;
  sessionId: number | null;
  staffNote?: string;
}

export async function tryConferenceAutoConfirm(
  input: ConferenceAutoConfirmInput,
  tx: TransactionContext
): Promise<ConferenceAutoConfirmResult> {
  const confParticipants = [{
    participantType: 'owner' as const,
    displayName: input.displayName,
    userId: input.userId,
    guestId: undefined
  }];

  try {
    const sessionResult = await createSessionWithUsageTracking({
      bookingId: input.bookingId,
      resourceId: input.resourceId,
      sessionDate: input.sessionDate,
      startTime: input.startTime,
      endTime: input.endTime,
      ownerEmail: input.ownerEmail,
      durationMinutes: input.durationMinutes,
      declaredPlayerCount: 1,
      participants: confParticipants
    }, 'member_request', tx);

    if (!sessionResult.success) {
      logger.error('[ConferenceRoom] Usage tracking failed, leaving as pending for staff review', {
        extra: { bookingId: input.bookingId, error: sessionResult.error }
      });
      const staffNote = 'Auto-confirm failed: usage tracking error. Please review and approve manually.';
      await tx.execute(sql`UPDATE booking_requests SET staff_notes = ${staffNote}, updated_at = NOW() WHERE id = ${input.bookingId}`);
      return { confirmed: false, sessionId: null, staffNote };
    }

    const sessionCheck = await tx.execute(sql`SELECT session_id FROM booking_requests WHERE id = ${input.bookingId} LIMIT 1`);
    const sessionId = sessionCheck.rows[0]?.session_id as number | null;

    if (!sessionId) {
      logger.error('[ConferenceRoom] Session creation failed — no session_id after successful tracking, leaving as pending', {
        extra: { bookingId: input.bookingId }
      });
      const staffNote = 'Auto-confirm failed: session could not be created. Please review and approve manually.';
      await tx.execute(sql`UPDATE booking_requests SET staff_notes = ${staffNote}, updated_at = NOW() WHERE id = ${input.bookingId}`);
      return { confirmed: false, sessionId: null, staffNote };
    }

    await tx.execute(sql`UPDATE booking_requests SET status = 'confirmed', updated_at = NOW() WHERE id = ${input.bookingId} AND status = 'pending'`);
    return { confirmed: true, sessionId };
  } catch (confError) {
    logger.error('[ConferenceRoom] Conference room auto-confirm failed inside transaction, leaving as pending', {
      extra: { error: getErrorMessage(confError), bookingId: input.bookingId }
    });
    const staffNote = `Auto-confirm failed: ${getErrorMessage(confError)}. Please review and approve manually.`;
    await tx.execute(sql`UPDATE booking_requests SET staff_notes = 'Auto-confirm failed: ' || ${getErrorMessage(confError)} || '. Please review and approve manually.', updated_at = NOW() WHERE id = ${input.bookingId}`);
    return { confirmed: false, sessionId: null, staffNote };
  }
}
