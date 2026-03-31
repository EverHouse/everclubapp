// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => {
    if (e instanceof Error) return e.message;
    return String(e);
  }),
}));

const { mockExecute, mockTransaction } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sqlStrings: Array.from(strings),
    __sqlValues: values,
  });
  sqlTagFn.join = vi.fn();
  sqlTagFn.raw = vi.fn((str: string) => ({ __sqlStrings: [str], __sqlValues: [] }));
  return {
    sql: sqlTagFn,
    eq: vi.fn(),
    and: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  usageLedger: { id: 'id', sessionId: 'sessionId', memberId: 'memberId', source: 'source' },
  bookingRequests: {},
  users: { id: 'id', email: 'email' },
  bookingSourceEnum: { enumValues: ['member_request', 'staff_manual'] },
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  PRICING: { OVERAGE_RATE_DOLLARS: 15 },
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  recordUsage: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../shared/constants/statuses', () => ({
  BOOKING_STATUS: {
    ATTENDED: 'attended',
    APPROVED: 'approved',
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
  },
  RECONCILIATION_STATUS: {
    PENDING: 'pending',
    REVIEWED: 'reviewed',
    ADJUSTED: 'adjusted',
  },
}));

import {
  findAttendanceDiscrepancies,
  markAsReconciled,
  adjustLedgerForReconciliation,
  getReconciliationSummary,
} from '../server/core/bookingService/trackmanReconciliation';
import { logPaymentAudit } from '../server/core/auditLog';
import { recordUsage } from '../server/core/bookingService/sessionManager';

describe('Trackman Reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findAttendanceDiscrepancies', () => {
    it('returns discrepancies with correct classification', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '2' }] })
        .mockResolvedValueOnce({
          rows: [{
            total_discrepancies: '2',
            pending_review: '1',
            reviewed: '1',
            adjusted: '0',
          }],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              user_email: 'member@example.com',
              user_name: 'Test Member',
              request_date: '2025-06-15',
              start_time: '10:00',
              end_time: '11:00',
              duration_minutes: '60',
              declared_player_count: '2',
              trackman_player_count: '4',
              reconciliation_status: null,
              reconciled_by: null,
              reconciled_at: null,
              reconciliation_notes: null,
              resource_id: 5,
              trackman_booking_id: '12345',
            },
            {
              id: 2,
              user_email: 'member2@example.com',
              user_name: 'Member Two',
              request_date: '2025-06-15',
              start_time: '14:00',
              end_time: '15:00',
              duration_minutes: '60',
              declared_player_count: '4',
              trackman_player_count: '2',
              reconciliation_status: 'reviewed',
              reconciled_by: 'staff@example.com',
              reconciled_at: new Date(),
              reconciliation_notes: 'Verified',
              resource_id: 3,
              trackman_booking_id: '67890',
            },
          ],
        });

      const result = await findAttendanceDiscrepancies();

      expect(result.discrepancies).toHaveLength(2);
      expect(result.totalCount).toBe(2);

      const underDeclared = result.discrepancies[0];
      expect(underDeclared.discrepancy).toBe('under_declared');
      expect(underDeclared.declaredCount).toBe(2);
      expect(underDeclared.actualCount).toBe(4);
      expect(underDeclared.discrepancyAmount).toBe(2);
      expect(underDeclared.requiresReview).toBe(true);
      expect(underDeclared.potentialFeeAdjustment).toBeGreaterThan(0);

      const overDeclared = result.discrepancies[1];
      expect(overDeclared.discrepancy).toBe('over_declared');
      expect(overDeclared.requiresReview).toBe(false);
      expect(overDeclared.potentialFeeAdjustment).toBe(0);
    });

    it('returns empty results when no discrepancies exist', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            total_discrepancies: '0',
            pending_review: '0',
            reviewed: '0',
            adjusted: '0',
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      const result = await findAttendanceDiscrepancies();

      expect(result.discrepancies).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.stats.totalDiscrepancies).toBe(0);
    });

    it('filters by date range', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '0', pending_review: '0', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await findAttendanceDiscrepancies({
        startDate: '2025-06-01',
        endDate: '2025-06-30',
      });

      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it('filters by reconciliation status', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '0' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '0', pending_review: '0', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      await findAttendanceDiscrepancies({ status: 'pending' });

      expect(mockExecute).toHaveBeenCalledTimes(3);
    });

    it('applies pagination via limit and offset', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '50' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '50', pending_review: '30', reviewed: '10', adjusted: '10' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await findAttendanceDiscrepancies({ limit: 10, offset: 20 });

      expect(result.totalCount).toBe(50);
    });

    it('propagates database errors', async () => {
      mockExecute.mockRejectedValue(new Error('Connection refused'));

      await expect(findAttendanceDiscrepancies()).rejects.toThrow('Connection refused');
    });
  });

  describe('calculatePotentialFeeAdjustment (via discrepancy results)', () => {
    it('calculates fee for under-declared players based on stolen minutes', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '1', pending_review: '1', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_email: 'test@example.com',
            user_name: 'Test',
            request_date: '2025-06-15',
            start_time: '10:00',
            end_time: '11:00',
            duration_minutes: '60',
            declared_player_count: '1',
            trackman_player_count: '3',
            reconciliation_status: null,
            reconciled_by: null,
            reconciled_at: null,
            reconciliation_notes: null,
            resource_id: 5,
            trackman_booking_id: '111',
          }],
        });

      const result = await findAttendanceDiscrepancies();
      const discrepancy = result.discrepancies[0];

      expect(discrepancy.potentialFeeAdjustment).toBeGreaterThan(0);
      expect(discrepancy.discrepancyAmount).toBe(2);
    });

    it('returns zero fee for over-declared players', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '1', pending_review: '0', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_email: 'test@example.com',
            user_name: 'Test',
            request_date: '2025-06-15',
            start_time: '10:00',
            end_time: '11:00',
            duration_minutes: '60',
            declared_player_count: '4',
            trackman_player_count: '2',
            reconciliation_status: null,
            reconciled_by: null,
            reconciled_at: null,
            reconciliation_notes: null,
            resource_id: 5,
            trackman_booking_id: '222',
          }],
        });

      const result = await findAttendanceDiscrepancies();
      expect(result.discrepancies[0].potentialFeeAdjustment).toBe(0);
    });
  });

  describe('markAsReconciled', () => {
    it('marks booking as reviewed successfully', async () => {
      mockExecute
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 1,
            declared_player_count: '2',
            trackman_player_count: '4',
            duration_minutes: '60',
            user_email: 'test@example.com',
            reconciliation_status: null,
            session_id: 100,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, reconciliation_status: 'reviewed' }],
        });

      const result = await markAsReconciled(1, 'staff@example.com', 'reviewed', 'Looks correct');

      expect(result.success).toBe(true);
      expect(logPaymentAudit).not.toHaveBeenCalled();
    });

    it('marks booking as adjusted and logs audit entry', async () => {
      mockExecute
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{
            id: 1,
            declared_player_count: '2',
            trackman_player_count: '4',
            duration_minutes: '60',
            user_email: 'test@example.com',
            reconciliation_status: null,
            session_id: 100,
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, reconciliation_status: 'adjusted' }],
        });

      const result = await markAsReconciled(1, 'staff@example.com', 'adjusted', 'Fee applied');

      expect(result.success).toBe(true);
      expect(logPaymentAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 1,
          action: 'reconciliation_adjusted',
          staffEmail: 'staff@example.com',
        })
      );
    });

    it('returns failure when booking not found', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const result = await markAsReconciled(999, 'staff@example.com', 'reviewed');

      expect(result.success).toBe(false);
    });
  });

  describe('adjustLedgerForReconciliation', () => {
    it('creates usage ledger entry for under-declared players', async () => {
      mockExecute.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 1,
          declared_player_count: '2',
          trackman_player_count: '4',
          duration_minutes: '60',
          user_email: 'member@example.com',
          reconciliation_status: null,
          session_id: 100,
          tier: 'full',
        }],
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [{ reconciliation_status: null }] }),
        };
        return fn(txMock);
      });

      const result = await adjustLedgerForReconciliation(1, 'staff@example.com', 'Undeclared guests');

      expect(result.success).toBe(true);
      expect(result.adjustmentAmount).toBeGreaterThan(0);
      expect(recordUsage).toHaveBeenCalledWith(
        100,
        expect.objectContaining({
          memberId: 'member@example.com',
          minutesCharged: 0,
          paymentMethod: 'unpaid',
        }),
        'staff_manual',
        expect.anything()
      );
    });

    it('returns zero adjustment when actual count does not exceed declared', async () => {
      mockExecute.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 1,
          declared_player_count: '4',
          trackman_player_count: '2',
          duration_minutes: '60',
          user_email: 'member@example.com',
          reconciliation_status: null,
          session_id: 100,
          tier: 'full',
        }],
      });

      const result = await adjustLedgerForReconciliation(1, 'staff@example.com');

      expect(result.success).toBe(true);
      expect(result.adjustmentAmount).toBe(0);
      expect(recordUsage).not.toHaveBeenCalled();
    });

    it('returns failure when booking not found', async () => {
      mockExecute.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      const result = await adjustLedgerForReconciliation(999, 'staff@example.com');

      expect(result.success).toBe(false);
      expect(result.adjustmentAmount).toBe(0);
    });

    it('logs audit entry after ledger adjustment', async () => {
      mockExecute.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{
          id: 1,
          declared_player_count: '1',
          trackman_player_count: '3',
          duration_minutes: '60',
          user_email: 'member@example.com',
          reconciliation_status: null,
          session_id: 100,
          tier: 'full',
        }],
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [{ reconciliation_status: null }] }),
        };
        return fn(txMock);
      });

      await adjustLedgerForReconciliation(1, 'staff@example.com', 'Auto-adjusted');

      expect(logPaymentAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 1,
          action: 'reconciliation_adjusted',
          newStatus: 'adjusted',
          metadata: expect.objectContaining({
            discrepancy: 'under_declared',
          }),
        })
      );
    });
  });

  describe('Trackman-to-booking matching semantics', () => {
    it('classifies under-declared when trackman count exceeds declared count', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '1', pending_review: '1', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 10,
            user_email: 'test@example.com',
            user_name: 'Test',
            request_date: '2025-06-15',
            start_time: '10:00',
            end_time: '11:00',
            duration_minutes: '60',
            declared_player_count: '1',
            trackman_player_count: '4',
            reconciliation_status: null,
            reconciled_by: null,
            reconciled_at: null,
            reconciliation_notes: null,
            resource_id: 5,
            trackman_booking_id: '99999',
          }],
        });

      const result = await findAttendanceDiscrepancies();
      const d = result.discrepancies[0];

      expect(d.discrepancy).toBe('under_declared');
      expect(d.discrepancyAmount).toBe(3);
      expect(d.requiresReview).toBe(true);
      expect(d.potentialFeeAdjustment).toBeGreaterThan(0);
      expect(d.trackmanBookingId).toBe('99999');
      expect(d.resourceId).toBe(5);
    });

    it('classifies over-declared when declared count exceeds trackman count', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '1', pending_review: '0', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 11,
            user_email: 'test@example.com',
            user_name: 'Test',
            request_date: '2025-06-15',
            start_time: '10:00',
            end_time: '11:00',
            duration_minutes: '60',
            declared_player_count: '4',
            trackman_player_count: '1',
            reconciliation_status: null,
            reconciled_by: null,
            reconciled_at: null,
            reconciliation_notes: null,
            resource_id: 3,
            trackman_booking_id: '88888',
          }],
        });

      const result = await findAttendanceDiscrepancies();
      const d = result.discrepancies[0];

      expect(d.discrepancy).toBe('over_declared');
      expect(d.discrepancyAmount).toBe(3);
      expect(d.requiresReview).toBe(false);
      expect(d.potentialFeeAdjustment).toBe(0);
    });

    it('associates discrepancy with correct booking and trackman IDs', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({ rows: [{ total_discrepancies: '1', pending_review: '1', reviewed: '0', adjusted: '0' }] })
        .mockResolvedValueOnce({
          rows: [{
            id: 42,
            user_email: 'member@example.com',
            user_name: 'Member Name',
            request_date: '2025-07-01',
            start_time: '14:00',
            end_time: '15:30',
            duration_minutes: '90',
            declared_player_count: '2',
            trackman_player_count: '3',
            reconciliation_status: null,
            reconciled_by: null,
            reconciled_at: null,
            reconciliation_notes: null,
            resource_id: 7,
            trackman_booking_id: 'TM-42',
          }],
        });

      const result = await findAttendanceDiscrepancies();
      const d = result.discrepancies[0];

      expect(d.bookingId).toBe(42);
      expect(d.trackmanBookingId).toBe('TM-42');
      expect(d.userEmail).toBe('member@example.com');
      expect(d.userName).toBe('Member Name');
      expect(d.resourceId).toBe(7);
      expect(d.requestDate).toBe('2025-07-01');
      expect(d.startTime).toBe('14:00');
      expect(d.endTime).toBe('15:30');
      expect(d.durationMinutes).toBe(90);
    });
  });

  describe('markAsReconciled — state guards and idempotency', () => {
    it('returns not-found for nonexistent booking', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await markAsReconciled(999, 'staff@example.com', 'reviewed');

      expect(result.success).toBe(false);
      expect(result.booking).toBeUndefined();
    });

    it('marks booking as reviewed without triggering audit log', async () => {
      mockExecute
        .mockResolvedValueOnce({
          rows: [{ id: 1, declared_player_count: '2', trackman_player_count: '4', duration_minutes: '60', user_email: 'user@example.com', reconciliation_status: null, session_id: 50 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, reconciliation_status: 'reviewed' }],
          rowCount: 1,
        });

      const result = await markAsReconciled(1, 'staff@example.com', 'reviewed', 'Looks correct');

      expect(result.success).toBe(true);
      expect(logPaymentAudit).not.toHaveBeenCalled();
    });

    it('marks booking as adjusted and logs payment audit with fee adjustment', async () => {
      mockExecute
        .mockResolvedValueOnce({
          rows: [{ id: 1, declared_player_count: '2', trackman_player_count: '4', duration_minutes: '60', user_email: 'user@example.com', reconciliation_status: null, session_id: 50 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, reconciliation_status: 'adjusted' }],
          rowCount: 1,
        });

      const result = await markAsReconciled(1, 'staff@example.com', 'adjusted', 'Fee applied');

      expect(result.success).toBe(true);
      expect(logPaymentAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 1,
          action: 'reconciliation_adjusted',
          staffEmail: 'staff@example.com',
        })
      );
    });

    it('re-reviews already-reviewed booking idempotently', async () => {
      mockExecute
        .mockResolvedValueOnce({
          rows: [{ id: 1, declared_player_count: '2', trackman_player_count: '3', duration_minutes: '60', user_email: 'user@example.com', reconciliation_status: 'reviewed', session_id: 50 }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({
          rows: [{ id: 1, reconciliation_status: 'reviewed' }],
          rowCount: 1,
        });

      const result = await markAsReconciled(1, 'staff@example.com', 'reviewed', 'Second review');

      expect(result.success).toBe(true);
    });
  });

  describe('adjustLedgerForReconciliation — detailed assertions', () => {
    it('returns not-found for nonexistent booking', async () => {
      mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await adjustLedgerForReconciliation(999, 'staff@example.com');

      expect(result.success).toBe(false);
    });

    it('calculates correct adjustment amount for under-declared guests', async () => {
      mockExecute
        .mockResolvedValueOnce({
          rows: [{ id: 1, declared_player_count: '2', trackman_player_count: '5', duration_minutes: '60', user_email: 'user@example.com', session_id: 50, tier: 'full' }],
          rowCount: 1,
        });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [{ reconciliation_status: null }] }),
        };
        return fn(txMock);
      });

      const result = await adjustLedgerForReconciliation(1, 'staff@example.com', 'Undeclared guests');

      expect(result.success).toBe(true);
      expect(result.adjustmentAmount).toBeGreaterThan(0);
      expect(logPaymentAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 1,
          action: 'reconciliation_adjusted',
          staffEmail: 'staff@example.com',
        })
      );
    });
  });

  describe('getReconciliationSummary', () => {
    it('returns stats and recent pending discrepancies', async () => {
      mockExecute
        .mockResolvedValueOnce({ rows: [{ total: '1' }] })
        .mockResolvedValueOnce({
          rows: [{
            total_discrepancies: '1',
            pending_review: '1',
            reviewed: '0',
            adjusted: '0',
          }],
        })
        .mockResolvedValueOnce({
          rows: [{
            id: 1,
            user_email: 'test@example.com',
            user_name: 'Test',
            request_date: '2025-06-15',
            start_time: '10:00',
            end_time: '11:00',
            duration_minutes: '60',
            declared_player_count: '2',
            trackman_player_count: '4',
            reconciliation_status: null,
            reconciled_by: null,
            reconciled_at: null,
            reconciliation_notes: null,
            resource_id: 5,
            trackman_booking_id: '111',
          }],
        });

      const result = await getReconciliationSummary();

      expect(result.stats.pendingReview).toBe(1);
      expect(result.recentDiscrepancies).toHaveLength(1);
    });
  });
});
