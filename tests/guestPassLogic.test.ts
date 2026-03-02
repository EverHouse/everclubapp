// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => String(e)),
}));

const { mockClient, mockPool } = vi.hoisted(() => {
  const mockClient = {
    query: vi.fn(),
    release: vi.fn(),
  };
  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
  };
  return { mockClient, mockPool };
});

vi.mock('../server/core/db', () => ({
  pool: mockPool,
}));

import {
  getAvailableGuestPasses,
  cleanupExpiredHolds,
  createGuestPassHold,
  releaseGuestPassHold,
  convertHoldToUsage,
} from '../server/core/billing/guestPassHoldService';

describe('GuestPassHoldService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  describe('getAvailableGuestPasses', () => {
    it('returns full allowance when no passes used and no holds', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(4);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('subtracts used passes from total', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 2, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(2);
    });

    it('subtracts held passes from available', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 1, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '1' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(2);
    });

    it('returns 0 when all passes are used', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 4, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(0);
    });

    it('returns 0 when passes used plus holds exceed total', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 3, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '2' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(0);
    });

    it('defaults to 4 guest passes when tier not found', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(4);
    });

    it('updates passes_total when tier allows more than current total', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 6 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 1, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const result = await getAvailableGuestPasses('test@example.com');
      expect(result).toBe(5);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE guest_passes'),
        expect.arrayContaining([6]),
      );
    });

    it('does not release client when externalClient is provided', async () => {
      const externalClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ total_held: '0' }] }),
        release: vi.fn(),
      };

      const result = await getAvailableGuestPasses('test@example.com', undefined, externalClient as any);
      expect(result).toBe(4);
      expect(externalClient.release).not.toHaveBeenCalled();
    });

    it('normalizes email to lowercase and trimmed', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 4 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      await getAvailableGuestPasses('  TEST@Example.COM  ');
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.any(String),
        ['test@example.com'],
      );
    });
  });

  describe('cleanupExpiredHolds', () => {
    it('returns count of deleted expired holds', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
        rowCount: 3,
      });

      const result = await cleanupExpiredHolds();
      expect(result).toBe(3);
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM guest_pass_holds'),
      );
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns 0 when no expired holds exist', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await cleanupExpiredHolds();
      expect(result).toBe(0);
    });

    it('releases client even when no holds are deleted', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      await cleanupExpiredHolds();
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('createGuestPassHold', () => {
    it('returns success with 0 held when passesNeeded is 0', async () => {
      const result = await createGuestPassHold('test@example.com', 1, 0);
      expect(result.success).toBe(true);
      expect(result.passesHeld).toBe(0);
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('returns success with 0 held when passesNeeded is negative', async () => {
      const result = await createGuestPassHold('test@example.com', 1, -1);
      expect(result.success).toBe(true);
      expect(result.passesHeld).toBe(0);
    });

    it('returns error when not enough passes available', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_month: 2 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 2, passes_total: 2 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] })
        .mockResolvedValueOnce(undefined);

      const result = await createGuestPassHold('test@example.com', 1, 3);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Not enough guest passes');
    });
  });

  describe('releaseGuestPassHold', () => {
    it('returns passes released count', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [{ passes_held: 2 }, { passes_held: 1 }],
        rowCount: 2,
      });

      const result = await releaseGuestPassHold(123);
      expect(result.success).toBe(true);
      expect(result.passesReleased).toBe(3);
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('returns 0 when no holds exist for booking', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [],
        rowCount: 0,
      });

      const result = await releaseGuestPassHold(999);
      expect(result.success).toBe(true);
      expect(result.passesReleased).toBe(0);
    });

    it('returns failure on DB error', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('DB error'));

      const result = await releaseGuestPassHold(123);
      expect(result.success).toBe(false);
      expect(result.passesReleased).toBe(0);
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  describe('convertHoldToUsage', () => {
    it('returns 0 when no holds exist for booking', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined);

      const result = await convertHoldToUsage(123, 'test@example.com');
      expect(result.success).toBe(true);
      expect(result.passesConverted).toBe(0);
    });

    it('converts held passes to usage', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [{ id: 1, passes_held: 3 }] })
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined);

      const result = await convertHoldToUsage(123, 'test@example.com');
      expect(result.success).toBe(true);
      expect(result.passesConverted).toBe(3);
    });

    it('returns failure on DB error and rolls back', async () => {
      mockClient.query
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('DB error'));

      const result = await convertHoldToUsage(123, 'test@example.com');
      expect(result.success).toBe(false);
      expect(result.passesConverted).toBe(0);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });
});
