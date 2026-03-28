import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import {
  convertHoldToUsage,
  releaseGuestPassHold,
} from './guestPassHoldService';
import {
  consumeGuestPassForParticipant,
  refundGuestPassForParticipant,
  type GuestPassConsumptionResult,
} from './guestPassConsumer';

export interface ProcessGuestPassOptions {
  participantId: number;
  ownerEmail: string;
  guestName: string;
  sessionId: number;
  sessionDate: Date;
  bookingId?: number;
  staffEmail?: string;
}

export async function processGuestPass(
  options: ProcessGuestPassOptions
): Promise<GuestPassConsumptionResult> {
  const { participantId, ownerEmail, guestName, sessionId, sessionDate, bookingId, staffEmail } = options;

  if (bookingId) {
    try {
      const holdResult = await convertHoldToUsage(bookingId, ownerEmail);
      if (holdResult.success && holdResult.passesConverted > 0) {
        logger.info('[GuestPassProcessor] Hold converted to usage successfully', {
          extra: { bookingId, participantId, passesConverted: holdResult.passesConverted }
        });
        return { success: true, passesRemaining: undefined };
      }
    } catch (err: unknown) {
      logger.warn('[GuestPassProcessor] Hold conversion failed, falling back to direct consumption', {
        extra: { bookingId, participantId, error: getErrorMessage(err) }
      });
    }
  }

  return consumeGuestPassForParticipant(
    participantId,
    ownerEmail,
    guestName,
    sessionId,
    sessionDate,
    staffEmail
  );
}

export interface RefundGuestPassOptions {
  participantId: number;
  ownerEmail: string;
  guestName: string;
  bookingId?: number;
}

export async function refundGuestPass(
  options: RefundGuestPassOptions
): Promise<{ success: boolean; error?: string; passesRemaining?: number }> {
  const { participantId, ownerEmail, guestName, bookingId } = options;

  const refundResult = await refundGuestPassForParticipant(participantId, ownerEmail, guestName);

  if (refundResult.success && bookingId) {
    try {
      await releaseGuestPassHold(bookingId);
    } catch (err: unknown) {
      logger.warn('[GuestPassProcessor] Hold release after refund failed (non-blocking)', {
        extra: { bookingId, participantId, error: getErrorMessage(err) }
      });
    }
  }

  return refundResult;
}
