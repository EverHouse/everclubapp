// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/billing/guestPassHoldService', () => ({
  convertHoldToUsage: vi.fn(),
  releaseGuestPassHold: vi.fn(),
}));

vi.mock('../server/core/billing/guestPassConsumer', () => ({
  consumeGuestPassForParticipant: vi.fn(),
  refundGuestPassForParticipant: vi.fn(),
}));

import { processGuestPass, refundGuestPass } from '../server/core/billing/guestPassProcessor';
import { convertHoldToUsage, releaseGuestPassHold } from '../server/core/billing/guestPassHoldService';
import { consumeGuestPassForParticipant, refundGuestPassForParticipant } from '../server/core/billing/guestPassConsumer';

const mockConvertHoldToUsage = convertHoldToUsage as ReturnType<typeof vi.fn>;
const mockReleaseGuestPassHold = releaseGuestPassHold as ReturnType<typeof vi.fn>;
const mockConsumeGuestPassForParticipant = consumeGuestPassForParticipant as ReturnType<typeof vi.fn>;
const mockRefundGuestPassForParticipant = refundGuestPassForParticipant as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Guest Pass Processor', () => {
  describe('processGuestPass', () => {
    const baseOptions = {
      participantId: 5,
      ownerEmail: 'member@example.com',
      guestName: 'John Guest',
      sessionId: 10,
      sessionDate: new Date('2026-03-15'),
    };

    it('converts hold to usage when bookingId is provided and hold exists', async () => {
      mockConvertHoldToUsage.mockResolvedValue({ success: true, passesConverted: 1 });

      const result = await processGuestPass({ ...baseOptions, bookingId: 100 });

      expect(result.success).toBe(true);
      expect(mockConvertHoldToUsage).toHaveBeenCalledWith(100, 'member@example.com');
      expect(mockConsumeGuestPassForParticipant).not.toHaveBeenCalled();
    });

    it('falls back to direct consumption when no hold exists', async () => {
      mockConvertHoldToUsage.mockResolvedValue({ success: true, passesConverted: 0 });
      mockConsumeGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 3 });

      const result = await processGuestPass({ ...baseOptions, bookingId: 100 });

      expect(result.success).toBe(true);
      expect(result.passesRemaining).toBe(3);
      expect(mockConsumeGuestPassForParticipant).toHaveBeenCalled();
    });

    it('falls back to direct consumption when hold conversion fails', async () => {
      mockConvertHoldToUsage.mockRejectedValue(new Error('DB error'));
      mockConsumeGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 2 });

      const result = await processGuestPass({ ...baseOptions, bookingId: 100 });

      expect(result.success).toBe(true);
      expect(mockConsumeGuestPassForParticipant).toHaveBeenCalled();
    });

    it('uses direct consumption when no bookingId provided', async () => {
      mockConsumeGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 4 });

      const result = await processGuestPass(baseOptions);

      expect(result.success).toBe(true);
      expect(mockConvertHoldToUsage).not.toHaveBeenCalled();
      expect(mockConsumeGuestPassForParticipant).toHaveBeenCalledWith(
        5, 'member@example.com', 'John Guest', 10, baseOptions.sessionDate, undefined
      );
    });

    it('passes staffEmail through to consumption', async () => {
      mockConsumeGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 1 });

      await processGuestPass({ ...baseOptions, staffEmail: 'staff@example.com' });

      expect(mockConsumeGuestPassForParticipant).toHaveBeenCalledWith(
        5, 'member@example.com', 'John Guest', 10, baseOptions.sessionDate, 'staff@example.com'
      );
    });
  });

  describe('refundGuestPass', () => {
    const baseOptions = {
      participantId: 5,
      ownerEmail: 'member@example.com',
      guestName: 'John Guest',
    };

    it('refunds guest pass and releases hold', async () => {
      mockRefundGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 4 });
      mockReleaseGuestPassHold.mockResolvedValue({ success: true, passesReleased: 1 });

      const result = await refundGuestPass({ ...baseOptions, bookingId: 100 });

      expect(result.success).toBe(true);
      expect(result.passesRemaining).toBe(4);
      expect(mockReleaseGuestPassHold).toHaveBeenCalledWith(100);
    });

    it('skips hold release when no bookingId', async () => {
      mockRefundGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 5 });

      const result = await refundGuestPass(baseOptions);

      expect(result.success).toBe(true);
      expect(mockReleaseGuestPassHold).not.toHaveBeenCalled();
    });

    it('returns refund result even if hold release fails', async () => {
      mockRefundGuestPassForParticipant.mockResolvedValue({ success: true, passesRemaining: 3 });
      mockReleaseGuestPassHold.mockRejectedValue(new Error('Hold release failed'));

      const result = await refundGuestPass({ ...baseOptions, bookingId: 100 });

      expect(result.success).toBe(true);
      expect(result.passesRemaining).toBe(3);
    });

    it('does not release hold when refund fails', async () => {
      mockRefundGuestPassForParticipant.mockResolvedValue({ success: false, error: 'Not found' });

      const result = await refundGuestPass({ ...baseOptions, bookingId: 100 });

      expect(result.success).toBe(false);
      expect(mockReleaseGuestPassHold).not.toHaveBeenCalled();
    });
  });
});
