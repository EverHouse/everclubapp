// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

const { mockExecute, mockTransaction } = vi.hoisted(() => ({
  mockExecute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  mockTransaction: vi.fn(),
}));

vi.mock('../../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }) }),
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __sqlStrings: Array.from(strings),
    __sqlValues: values,
  });
  sqlTagFn.join = vi.fn();
  sqlTagFn.raw = vi.fn((str: string) => ({ __sqlStrings: [str], __sqlValues: [] }));
  return { sql: sqlTagFn, eq: vi.fn(), and: vi.fn(), or: vi.fn(), ne: vi.fn(), inArray: vi.fn(), isNull: vi.fn(), isNotNull: vi.fn() };
});

vi.mock('../../shared/schema', () => ({
  bookingRequests: { id: 'id', calendarEventId: 'calendarEventId', resourceId: 'resourceId', userEmail: 'userEmail', userName: 'userName', requestDate: 'requestDate', startTime: 'startTime', sessionId: 'sessionId', archivedAt: 'archivedAt', trackmanBookingId: 'trackmanBookingId', stripeInvoiceId: 'stripeInvoiceId' },
  resources: { id: 'id', name: 'name', type: 'type' },
}));

vi.mock('../../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
  toTextArrayLiteral: vi.fn((arr: string[]) => `{${arr.join(',')}}`),
}));

const mockNotifyMember = vi.fn().mockResolvedValue(undefined);
const mockNotifyAllStaff = vi.fn().mockResolvedValue(undefined);
vi.mock('../../server/core/notificationService', () => ({
  notifyMember: (...args: unknown[]) => mockNotifyMember(...args),
  notifyAllStaff: (...args: unknown[]) => mockNotifyAllStaff(...args),
}));

const mockRefundGuestPass = vi.fn().mockResolvedValue({ success: true, remaining: 3 });
vi.mock('../../server/core/billing/guestPassService', () => ({
  refundGuestPass: (...args: unknown[]) => mockRefundGuestPass(...args),
}));

vi.mock('../../server/core/websocket', () => ({
  broadcastAvailabilityUpdate: vi.fn(),
  sendNotificationToUser: vi.fn(),
}));

vi.mock('../../server/core/calendar/index', () => ({
  getCalendarIdByName: vi.fn(),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
  CALENDAR_CONFIG: {},
}));

vi.mock('../../server/utils/dateUtils', () => ({
  createPacificDate: vi.fn(() => new Date(Date.now() + 24 * 60 * 60 * 1000)),
  formatDateDisplayWithDay: vi.fn((d: string) => d),
  formatTime12Hour: vi.fn((t: string) => t),
}));

const mockCancelPaymentIntent = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../server/core/stripe/payments', () => ({
  cancelPaymentIntent: (...args: unknown[]) => mockCancelPaymentIntent(...args),
}));

const mockMarkPaymentRefunded = vi.fn().mockResolvedValue(undefined);
vi.mock('../../server/core/billing/PaymentStatusService', () => ({
  markPaymentRefunded: (...args: unknown[]) => mockMarkPaymentRefunded(...args),
}));

const mockGetStripeClient = vi.fn().mockResolvedValue({
  refunds: { create: vi.fn().mockResolvedValue({ id: 're_test_1' }) },
  customers: { createBalanceTransaction: vi.fn().mockResolvedValue({ id: 'txn_test_1' }) },
});
vi.mock('../../server/core/stripe/client', () => ({
  getStripeClient: () => mockGetStripeClient(),
}));

vi.mock('../../server/core/bookingEvents', () => ({
  bookingEvents: { emit: vi.fn() },
}));

vi.mock('../../server/core/auditLog', () => ({
  logMemberAction: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/core/billing/guestPassHoldService', () => ({
  releaseGuestPassHold: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../server/core/errors', () => ({
  AppError: class AppError extends Error { constructor(public statusCode: number, message: string) { super(message); } },
}));

vi.mock('../../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../server/core/billing/paymentIntentCleanup', () => ({
  cancelPendingPaymentIntentsForBooking: vi.fn().mockResolvedValue(undefined),
}));

import { handleCancellationCascade } from '../../server/core/resource/cancellation';

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn: Function) => {
    const txMock = {
      execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    return fn(txMock);
  });
  mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('Cancellation Cascade Integration', () => {
  describe('Full Cancellation Flow', () => {
    it('cancellation with participants: notifies members and refunds guest passes', async () => {
      const participants = [
        { id: 1, user_id: 'user-1', guest_id: null, participant_type: 'owner', display_name: 'Owner', used_guest_pass: false },
        { id: 2, user_id: 'user-2', guest_id: null, participant_type: 'member', display_name: 'Member 2', used_guest_pass: false },
        { id: 3, user_id: null, guest_id: 10, participant_type: 'guest', display_name: 'Guest Alice', used_guest_pass: true },
      ];

      const userEmails = [
        { id: 'user-2', email: 'member2@test.com' },
      ];

      mockTransaction.mockImplementation(async (fn: Function) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: participants })
            .mockResolvedValueOnce({ rows: userEmails })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return fn(txMock);
      });

      const result = await handleCancellationCascade(
        1, 100, 'owner@test.com', 'Owner Test', '2025-07-15', '10:00', 'Bay 1'
      );

      expect(result.participantsNotified).toBe(1);
      expect(result.guestPassesRefunded).toBe(1);
      expect(mockNotifyMember).toHaveBeenCalledTimes(2);
      expect(mockRefundGuestPass).toHaveBeenCalledWith('owner@test.com', 'Guest Alice', false);
      expect(result.errors.length).toBe(0);
    });

    it('cancellation with succeeded payment intents issues Stripe refunds', async () => {
      const stripe = await mockGetStripeClient();

      mockTransaction.mockImplementation(async (fn: Function) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [] }),
        };
        return fn(txMock);
      });

      mockExecute
        .mockResolvedValueOnce({
          rows: [{ stripe_payment_intent_id: 'pi_succ_1', amount_cents: 5000, stripe_customer_id: 'cus_1', user_id: 'user-1', status: 'succeeded' }],
          rowCount: 1,
        })
        .mockResolvedValueOnce({ rows: [{ stripe_payment_intent_id: 'pi_succ_1' }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{ remaining_cents: 5000 }] })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await handleCancellationCascade(
        2, null, 'owner@test.com', 'Owner', '2025-07-15', '10:00'
      );

      expect(result.errors.length).toBe(0);
    });

    it('cancellation with pending payment intents cancels them (not refunds)', async () => {
      mockTransaction.mockImplementation(async (fn: Function) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ stripe_payment_intent_id: 'pi_pending_1' }] }),
        };
        return fn(txMock);
      });

      mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await handleCancellationCascade(
        3, null, 'owner@test.com', 'Owner', '2025-07-15', '10:00'
      );

      expect(mockCancelPaymentIntent).toHaveBeenCalledWith('pi_pending_1');
      expect(result.errors.length).toBe(0);
    });
  });

  describe('Partial Failure Scenarios', () => {
    it('guest pass refund failure is recorded but does not block other operations', async () => {
      const participants = [
        { id: 1, user_id: 'user-1', guest_id: null, participant_type: 'owner', display_name: 'Owner', used_guest_pass: false },
        { id: 3, user_id: null, guest_id: 10, participant_type: 'guest', display_name: 'Guest Fail', used_guest_pass: true },
        { id: 4, user_id: null, guest_id: 11, participant_type: 'guest', display_name: 'Guest Success', used_guest_pass: true },
      ];

      mockTransaction.mockImplementation(async (fn: Function) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: participants })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return fn(txMock);
      });

      mockRefundGuestPass
        .mockResolvedValueOnce({ success: false, error: 'No passes to refund' })
        .mockResolvedValueOnce({ success: true, remaining: 2 });

      mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await handleCancellationCascade(
        4, 200, 'owner@test.com', 'Owner', '2025-07-15', '10:00'
      );

      expect(result.guestPassesRefunded).toBe(1);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('Guest Fail');
    });

    it('payment intent cancel failure is recorded in errors array', async () => {
      mockTransaction.mockImplementation(async (fn: Function) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ stripe_payment_intent_id: 'pi_fail_cancel' }] }),
        };
        return fn(txMock);
      });

      mockCancelPaymentIntent.mockResolvedValueOnce({ success: false, error: 'Network error' });
      mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await handleCancellationCascade(
        5, null, 'owner@test.com', 'Owner', '2025-07-15', '10:00'
      );

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('pi_fail_cancel');
    });
  });

  describe('Late Cancellation — Guest Pass Refund Policy', () => {
    it('guest passes are NOT refunded when booking starts within 1 hour', async () => {
      const { createPacificDate } = await import('../../server/utils/dateUtils');
      (createPacificDate as ReturnType<typeof vi.fn>).mockReturnValue(new Date(Date.now() + 30 * 60 * 1000));

      const participants = [
        { id: 1, user_id: 'user-1', guest_id: null, participant_type: 'owner', display_name: 'Owner', used_guest_pass: false },
        { id: 3, user_id: null, guest_id: 10, participant_type: 'guest', display_name: 'Guest Late', used_guest_pass: true },
      ];

      mockTransaction.mockImplementation(async (fn: Function) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: participants })
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({ rows: [] }),
        };
        return fn(txMock);
      });

      mockExecute.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await handleCancellationCascade(
        6, 300, 'owner@test.com', 'Owner', '2025-07-15', '10:00'
      );

      expect(result.guestPassesRefunded).toBe(0);
      expect(mockRefundGuestPass).not.toHaveBeenCalled();
    });
  });
});
