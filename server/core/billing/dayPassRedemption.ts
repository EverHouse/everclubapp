import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';

const DAY_PASS_PRODUCT_TYPE = 'day-pass-golf-sim';
const DAY_PASS_COVERAGE_MINUTES = 60;

interface DayPassRedemptionInput {
  dayPassId: string;
  sessionId: number;
  bookingId: number;
  participantId: number;
  participantEmail: string;
  staffEmail: string;
}

interface DayPassRedemptionResult {
  success: boolean;
  remainingUses: number;
  error?: string;
}

export async function redeemDayPassForBooking(
  input: DayPassRedemptionInput
): Promise<DayPassRedemptionResult> {
  const { dayPassId, sessionId, bookingId, participantId, participantEmail, staffEmail } = input;

  try {
    const result = await db.transaction(async (tx) => {
      const ownershipCheck = await tx.execute(sql`
        SELECT id, purchaser_email FROM day_pass_purchases
        WHERE id = ${dayPassId}
          AND product_type = ${DAY_PASS_PRODUCT_TYPE}
          AND LOWER(purchaser_email) = LOWER(${participantEmail})
      `);
      if (!ownershipCheck.rows || ownershipCheck.rows.length === 0) {
        throw new Error('DAY_PASS_OWNERSHIP_MISMATCH');
      }

      const updateResult = await tx.execute(sql`
        UPDATE day_pass_purchases
        SET remaining_uses = remaining_uses - 1,
            status = CASE WHEN remaining_uses - 1 <= 0 THEN 'exhausted' ELSE status END,
            updated_at = NOW()
        WHERE id = ${dayPassId}
          AND product_type = ${DAY_PASS_PRODUCT_TYPE}
          AND status = 'active'
          AND remaining_uses > 0
        RETURNING remaining_uses
      `);

      if (!updateResult.rows || updateResult.rows.length === 0) {
        throw new Error('DAY_PASS_NOT_AVAILABLE');
      }

      const remainingUses = Number((updateResult.rows[0] as { remaining_uses: number }).remaining_uses);

      await tx.execute(sql`
        UPDATE booking_participants
        SET day_pass_purchase_id = ${dayPassId}
        WHERE id = ${participantId}
      `);

      await tx.execute(sql`
        INSERT INTO pass_redemption_logs (purchase_id, redeemed_by, location, booking_id, redeemed_at)
        VALUES (${dayPassId}, ${staffEmail}, 'booking_resolution', ${bookingId}, NOW())
      `);

      return remainingUses;
    });

    logger.info('[DayPassRedemption] Day pass redeemed for booking participant', {
      extra: { dayPassId, sessionId, bookingId, participantId, staffEmail, remainingUses: result }
    });

    return { success: true, remainingUses: result };
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    if (errorMsg === 'DAY_PASS_NOT_AVAILABLE') {
      return { success: false, remainingUses: 0, error: 'Day pass not available for redemption (inactive, exhausted, or wrong type)' };
    }
    if (errorMsg === 'DAY_PASS_OWNERSHIP_MISMATCH') {
      return { success: false, remainingUses: 0, error: 'Day pass does not belong to the assigned participant' };
    }
    logger.error('[DayPassRedemption] Failed to redeem day pass', {
      extra: { dayPassId, sessionId, bookingId, participantId, error: getErrorMessage(error) }
    });
    return { success: false, remainingUses: 0, error: errorMsg };
  }
}

export async function processBookingDayPassRedemptions(
  redemptions: Array<{ participantEmail: string; dayPassId: string }>,
  sessionId: number,
  bookingId: number,
  staffEmail: string
): Promise<{ redeemed: number; errors: string[] }> {
  if (!redemptions || redemptions.length === 0) {
    return { redeemed: 0, errors: [] };
  }

  const resourceCheck = await db.execute(sql`
    SELECT r.resource_type, bs.duration_minutes, bs.start_time, bs.end_time
    FROM booking_sessions bs
    JOIN resources r ON r.id = bs.resource_id
    WHERE bs.id = ${sessionId}
    LIMIT 1
  `);
  const sessionRow = resourceCheck.rows[0] as { resource_type?: string; duration_minutes?: number; start_time?: string; end_time?: string } | undefined;
  const resourceType = sessionRow?.resource_type;
  if (resourceType && resourceType !== 'simulator') {
    return { redeemed: 0, errors: [`Day passes can only be redeemed for simulator bookings (this is a ${resourceType} booking)`] };
  }

  const participantsResult = await db.execute(sql`
    SELECT bp.id, bp.participant_type, bp.day_pass_purchase_id,
           COALESCE(LOWER(u.email), '') as email
    FROM booking_participants bp
    LEFT JOIN users u ON bp.user_id = u.id
    WHERE bp.session_id = ${sessionId}
  `);

  const participants = participantsResult.rows as Array<{ id: number; participant_type: string; email: string; day_pass_purchase_id: string | null }>;
  const errors: string[] = [];

  const durationMinutes = Number(sessionRow?.duration_minutes) || 60;
  const participantCount = participants.length || 1;
  const minutesPerParticipant = Math.floor(durationMinutes / participantCount);
  if (minutesPerParticipant < DAY_PASS_COVERAGE_MINUTES) {
    logger.info('[DayPassRedemption] Session per-participant time is below day pass coverage', {
      extra: { sessionId, bookingId, durationMinutes, participantCount, minutesPerParticipant, dayPassCoverageMinutes: DAY_PASS_COVERAGE_MINUTES }
    });
  }

  const passUsageCounts = new Map<string, number>();
  for (const r of redemptions) {
    passUsageCounts.set(r.dayPassId, (passUsageCounts.get(r.dayPassId) || 0) + 1);
  }
  for (const [passId, count] of passUsageCounts) {
    if (count > 1) {
      const passCheck = await db.execute(sql`
        SELECT remaining_uses FROM day_pass_purchases WHERE id = ${passId} AND status = 'active'
      `);
      const remaining = passCheck.rows?.[0] ? Number((passCheck.rows[0] as { remaining_uses: number }).remaining_uses) : 0;
      if (remaining < count) {
        errors.push(`Day pass ${passId} has ${remaining} uses remaining but ${count} slots requested`);
        return { redeemed: 0, errors };
      }
    }
  }

  const claimedParticipantIds = new Set<number>();
  const resolvedRedemptions: Array<{
    participantId: number;
    participantEmail: string;
    dayPassId: string;
  }> = [];

  for (const redemption of redemptions) {
    const targetEmail = redemption.participantEmail.trim().toLowerCase();
    if (!targetEmail) {
      errors.push('Empty email in day pass redemption request');
      continue;
    }

    const participant = participants.find(
      p => p.email === targetEmail
        && !claimedParticipantIds.has(p.id)
        && p.participant_type !== 'guest'
        && !p.day_pass_purchase_id
    );
    if (!participant) {
      const anyMatch = participants.find(p => p.email === targetEmail);
      if (!anyMatch) {
        errors.push(`No participant found with email ${targetEmail}`);
      } else if (participants.every(p => p.email !== targetEmail || p.participant_type === 'guest')) {
        errors.push(`${targetEmail}: Day passes cannot be applied to guest placeholders`);
      } else if (participants.every(p => p.email !== targetEmail || !!p.day_pass_purchase_id || claimedParticipantIds.has(p.id))) {
        errors.push(`${targetEmail}: All matching participants already have a day pass redeemed or targeted in this batch`);
      } else {
        errors.push(`${targetEmail}: No eligible participant available for day pass redemption`);
      }
      continue;
    }

    claimedParticipantIds.add(participant.id);
    resolvedRedemptions.push({
      participantId: participant.id,
      participantEmail: participant.email,
      dayPassId: redemption.dayPassId,
    });
  }

  if (errors.length > 0) {
    return { redeemed: 0, errors };
  }

  if (resolvedRedemptions.length === 0) {
    return { redeemed: 0, errors: ['No valid redemptions to process'] };
  }

  try {
    await db.transaction(async (tx) => {
      for (const r of resolvedRedemptions) {
        const ownershipCheck = await tx.execute(sql`
          SELECT id, purchaser_email FROM day_pass_purchases
          WHERE id = ${r.dayPassId}
            AND product_type = ${DAY_PASS_PRODUCT_TYPE}
            AND LOWER(purchaser_email) = LOWER(${r.participantEmail})
        `);
        if (!ownershipCheck.rows || ownershipCheck.rows.length === 0) {
          throw new Error(`DAY_PASS_OWNERSHIP_MISMATCH:${r.participantEmail}`);
        }

        const updateResult = await tx.execute(sql`
          UPDATE day_pass_purchases
          SET remaining_uses = remaining_uses - 1,
              status = CASE WHEN remaining_uses - 1 <= 0 THEN 'exhausted' ELSE status END,
              updated_at = NOW()
          WHERE id = ${r.dayPassId}
            AND product_type = ${DAY_PASS_PRODUCT_TYPE}
            AND status = 'active'
            AND remaining_uses > 0
          RETURNING remaining_uses
        `);
        if (!updateResult.rows || updateResult.rows.length === 0) {
          throw new Error(`DAY_PASS_NOT_AVAILABLE:${r.dayPassId}`);
        }

        const participantUpdate = await tx.execute(sql`
          UPDATE booking_participants
          SET day_pass_purchase_id = ${r.dayPassId}
          WHERE id = ${r.participantId}
            AND day_pass_purchase_id IS NULL
          RETURNING id
        `);
        if (!participantUpdate.rows || participantUpdate.rows.length === 0) {
          throw new Error(`DAY_PASS_ALREADY_ASSIGNED:${r.participantEmail}`);
        }

        await tx.execute(sql`
          INSERT INTO pass_redemption_logs (purchase_id, redeemed_by, location, booking_id, redeemed_at)
          VALUES (${r.dayPassId}, ${staffEmail}, 'booking_resolution', ${bookingId}, NOW())
        `);
      }
    });

    logger.info('[DayPassRedemption] Batch day pass redemption completed atomically', {
      extra: { sessionId, bookingId, staffEmail, count: resolvedRedemptions.length, participants: resolvedRedemptions.map(r => r.participantEmail) }
    });

    return { redeemed: resolvedRedemptions.length, errors: [] };
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    if (errorMsg.startsWith('DAY_PASS_OWNERSHIP_MISMATCH:')) {
      const email = errorMsg.split(':')[1];
      return { redeemed: 0, errors: [`${email}: Day pass does not belong to the assigned participant. All redemptions rolled back.`] };
    }
    if (errorMsg.startsWith('DAY_PASS_NOT_AVAILABLE:')) {
      const passId = errorMsg.split(':')[1];
      return { redeemed: 0, errors: [`Day pass ${passId} is no longer available. All redemptions rolled back.`] };
    }
    if (errorMsg.startsWith('DAY_PASS_ALREADY_ASSIGNED:')) {
      const email = errorMsg.split(':')[1];
      return { redeemed: 0, errors: [`${email}: Participant already has a day pass assigned (race condition). All redemptions rolled back.`] };
    }
    logger.error('[DayPassRedemption] Batch redemption failed — all rolled back', {
      extra: { sessionId, bookingId, redemptionCount: resolvedRedemptions.length, error: getErrorMessage(error) }
    });
    return { redeemed: 0, errors: [`Batch redemption failed: ${errorMsg}. All redemptions rolled back.`] };
  }
}
