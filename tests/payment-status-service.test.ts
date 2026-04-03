// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockBusinessQuery, mockClientQuery, mockClient, mockPool } = vi.hoisted(() => {
  const mockBusinessQuery = vi.fn();
  const mockClientQuery = vi.fn().mockImplementation(async (text: string, params?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    return mockBusinessQuery(text, params);
  });
  const mockClient = {
    query: mockClientQuery,
    release: vi.fn(),
  };
  const mockPool = {
    connect: vi.fn().mockResolvedValue(mockClient),
  };
  return { mockBusinessQuery, mockClientQuery, mockClient, mockPool };
});

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/db', () => ({
  pool: mockPool,
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
}));

import { PaymentStatusService } from '../server/core/billing/PaymentStatusService';
import { db } from '../server/db';

beforeEach(() => {
  vi.clearAllMocks();
  mockPool.connect.mockResolvedValue(mockClient);
  mockBusinessQuery.mockReset();
  mockClientQuery.mockClear();
  mockClientQuery.mockImplementation(async (text: string, params?: unknown[]) => {
    if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
      return { rows: [], rowCount: 0 };
    }
    return mockBusinessQuery(text, params);
  });
});

describe('PaymentStatusService', () => {
  describe('markPaymentSucceeded', () => {
    it('updates snapshot and participants to paid when snapshot exists', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            session_id: 10,
            booking_id: 100,
            participant_fees: [{ id: 5, amountCents: 2500 }, { id: 6, amountCents: 2500 }],
            total_cents: 5000,
            status: 'pending',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await PaymentStatusService.markPaymentSucceeded({
        paymentIntentId: 'pi_success',
        staffEmail: 'staff@example.com',
        staffName: 'Staff User',
      });

      expect(result.success).toBe(true);
      expect(result.participantsUpdated).toBe(2);
      expect(result.snapshotsUpdated).toBe(1);
    });

    it('handles no-snapshot fallback path', async () => {
      mockBusinessQuery.mockResolvedValue({ rows: [] });

      const result = await PaymentStatusService.markPaymentSucceeded({
        paymentIntentId: 'pi_nofee',
      });

      expect(result.success).toBe(true);
    });

    it('skips update when amount mismatch exceeds tolerance', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ booking_id: 100, session_id: 10, amount_cents: 5000 }],
        })
        .mockResolvedValueOnce({ rows: [{ session_id: 10 }] })
        .mockResolvedValueOnce({
          rows: [{ id: 5, cached_fee_cents: 9999 }],
        });

      const result = await PaymentStatusService.markPaymentSucceeded({
        paymentIntentId: 'pi_mismatch',
      });

      expect(result.success).toBe(true);
      expect(result.participantsUpdated).toBe(0);
    });

    it('skips already completed snapshots', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            session_id: 10,
            booking_id: 100,
            participant_fees: [],
            total_cents: 5000,
            status: 'completed',
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await PaymentStatusService.markPaymentSucceeded({
        paymentIntentId: 'pi_done',
      });

      expect(result.success).toBe(true);
      expect(result.participantsUpdated).toBe(0);
      expect(result.snapshotsUpdated).toBe(0);
    });

    it('returns error on database failure', async () => {
      mockPool.connect.mockRejectedValueOnce(new Error('DB connection lost'));

      const result = await PaymentStatusService.markPaymentSucceeded({
        paymentIntentId: 'pi_fail',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('DB connection lost');
    });
  });

  describe('markPaymentRefunded', () => {
    it('refunds payment and updates snapshot and participants', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            session_id: 10,
            booking_id: 100,
            participant_fees: [{ id: 5, amountCents: 2500 }],
            total_cents: 2500,
            status: 'completed',
          }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await PaymentStatusService.markPaymentRefunded({
        paymentIntentId: 'pi_refund',
        staffEmail: 'admin@example.com',
      });

      expect(result.success).toBe(true);
    });

    it('handles refund with no snapshot', async () => {
      mockBusinessQuery.mockResolvedValue({ rows: [] });

      const result = await PaymentStatusService.markPaymentRefunded({
        paymentIntentId: 'pi_nosnap',
      });

      expect(result.success).toBe(true);
    });

    it('returns error on failure', async () => {
      mockPool.connect.mockRejectedValueOnce(new Error('Transaction failed'));

      const result = await PaymentStatusService.markPaymentRefunded({
        paymentIntentId: 'pi_fail',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Transaction failed');
    });
  });

  describe('markPaymentCancelled', () => {
    it('cancels payment and updates snapshots', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValue({ rows: [] });

      const result = await PaymentStatusService.markPaymentCancelled({
        paymentIntentId: 'pi_cancel',
      });

      expect(result.success).toBe(true);
    });

    it('handles cancellation with no snapshots', async () => {
      mockBusinessQuery.mockResolvedValue({ rows: [] });

      const result = await PaymentStatusService.markPaymentCancelled({
        paymentIntentId: 'pi_no_snap',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('syncFromStripe', () => {
    it('delegates to markPaymentSucceeded for succeeded status', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await PaymentStatusService.syncFromStripe('pi_sync', 'succeeded');

      expect(result.success).toBe(true);
    });

    it('delegates to markPaymentCancelled for canceled status', async () => {
      mockBusinessQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await PaymentStatusService.syncFromStripe('pi_sync', 'canceled');

      expect(result.success).toBe(true);
    });

    it('updates status directly for other statuses', async () => {
      (db.execute as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

      const result = await PaymentStatusService.syncFromStripe('pi_sync', 'processing');

      expect(result.success).toBe(true);
      expect(db.execute).toHaveBeenCalled();
    });
  });
});
