// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => {
  const mockTxExec = vi.fn();
  return {
    db: {
      execute: vi.fn(),
      transaction: vi.fn((fn: Function) => fn({ execute: mockTxExec })),
      __mockTxExecute: mockTxExec,
    },
  };
});

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/errors', () => ({
  GuestPassHoldError: class GuestPassHoldError extends Error {
    passesAvailable: number | undefined;
    constructor(message: string, passesAvailable?: number) {
      super(message);
      this.name = 'GuestPassHoldError';
      this.passesAvailable = passesAvailable;
    }
  },
}));

import {
  getAvailableGuestPasses,
  createGuestPassHold,
  releaseGuestPassHold,
  convertHoldToUsage,
  cleanupExpiredHolds,
} from '../server/core/billing/guestPassHoldService';
import { db } from '../server/db';

const mockDbExecute = db.execute as ReturnType<typeof vi.fn>;
const mockTxExecute = (db as unknown as { __mockTxExecute: ReturnType<typeof vi.fn> }).__mockTxExecute;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Guest Pass Billing', () => {
  describe('getAvailableGuestPasses', () => {
    it('returns available passes based on tier allocation minus used and held', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 1, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '1' }] });

      const available = await getAvailableGuestPasses('member@example.com');

      expect(available).toBe(2);
    });

    it('returns 0 when all passes are used', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 4, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const available = await getAvailableGuestPasses('member@example.com');

      expect(available).toBe(0);
    });

    it('returns 0 for non-members without tier', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ membership_status: 'visitor' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      const available = await getAvailableGuestPasses('visitor@example.com');

      expect(available).toBe(0);
    });

    it('accounts for active holds in availability calculation', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 6 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 2, passes_total: 6 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '3' }] });

      const available = await getAvailableGuestPasses('member@example.com');

      expect(available).toBe(1);
    });

    it('never returns negative availability', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 2 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 2, passes_total: 2 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '5' }] });

      const available = await getAvailableGuestPasses('member@example.com');

      expect(available).toBe(0);
    });
  });

  describe('createGuestPassHold', () => {
    it('returns success with 0 passes held when passesNeeded is 0', async () => {
      const result = await createGuestPassHold('member@example.com', 1, 0);

      expect(result.success).toBe(true);
      expect(result.passesHeld).toBe(0);
      expect(mockDbExecute).not.toHaveBeenCalled();
    });

    it('creates a hold when passes are available', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 4 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 1, passes_total: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] })
        .mockResolvedValueOnce({ rows: [{ id: 42 }] });

      const result = await createGuestPassHold('member@example.com', 100, 2);

      expect(result.success).toBe(true);
      expect(result.holdId).toBe(42);
      expect(result.passesHeld).toBe(2);
    });

    it('throws GuestPassHoldError when no passes available', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 2 }] })
        .mockResolvedValueOnce({ rows: [{ passes_used: 2, passes_total: 2 }] })
        .mockResolvedValueOnce({ rows: [{ total_held: '0' }] });

      await expect(createGuestPassHold('member@example.com', 100, 1))
        .rejects.toThrow('Not enough guest passes available');
    });
  });

  describe('releaseGuestPassHold', () => {
    it('releases all holds for a booking', async () => {
      mockDbExecute.mockResolvedValue({
        rows: [{ passes_held: 2 }, { passes_held: 1 }],
      });

      const result = await releaseGuestPassHold(100);

      expect(result.success).toBe(true);
      expect(result.passesReleased).toBe(3);
    });

    it('returns 0 when no holds exist', async () => {
      mockDbExecute.mockResolvedValue({ rows: [] });

      const result = await releaseGuestPassHold(999);

      expect(result.success).toBe(true);
      expect(result.passesReleased).toBe(0);
    });

    it('handles database errors gracefully', async () => {
      mockDbExecute.mockRejectedValue(new Error('Connection error'));

      const result = await releaseGuestPassHold(100);

      expect(result.success).toBe(false);
      expect(result.passesReleased).toBe(0);
    });
  });

  describe('convertHoldToUsage', () => {
    it('converts hold to permanent usage', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [{ id: 1, passes_held: 2 }] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] });

      const result = await convertHoldToUsage(100, 'member@example.com');

      expect(result.success).toBe(true);
      expect(result.passesConverted).toBe(2);
    });

    it('returns 0 when no hold exists', async () => {
      mockTxExecute.mockResolvedValueOnce({ rows: [] });

      const result = await convertHoldToUsage(999, 'member@example.com');

      expect(result.success).toBe(true);
      expect(result.passesConverted).toBe(0);
    });

    it('creates guest_passes row when update affects 0 rows', async () => {
      mockTxExecute
        .mockResolvedValueOnce({ rows: [{ id: 1, passes_held: 1 }] })
        .mockResolvedValueOnce({ rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ guest_passes_per_year: 4 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await convertHoldToUsage(100, 'new@example.com');

      expect(result.success).toBe(true);
      expect(result.passesConverted).toBe(1);
    });
  });

  describe('cleanupExpiredHolds', () => {
    it('removes expired holds and returns count', async () => {
      mockDbExecute.mockResolvedValue({ rowCount: 3, rows: [{ id: 1 }, { id: 2 }, { id: 3 }] });

      const deleted = await cleanupExpiredHolds();

      expect(deleted).toBe(3);
    });

    it('returns 0 when no expired holds', async () => {
      mockDbExecute.mockResolvedValue({ rowCount: 0, rows: [] });

      const deleted = await cleanupExpiredHolds();

      expect(deleted).toBe(0);
    });
  });
});
