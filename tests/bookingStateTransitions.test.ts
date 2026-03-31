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
  getErrorStatusCode: vi.fn(() => 500),
}));

const { mockExecute, mockTransaction, mockSelect, mockUpdate } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
    select: mockSelect,
    update: mockUpdate,
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
    or: vi.fn(),
    ne: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  bookingRequests: { id: 'id', userEmail: 'userEmail', userName: 'userName', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', calendarEventId: 'calendarEventId', sessionId: 'sessionId', trackmanBookingId: 'trackmanBookingId', staffNotes: 'staffNotes', cancellationPendingAt: 'cancellationPendingAt', updatedAt: 'updatedAt', version: 'version' },
  resources: { id: 'id', type: 'type', name: 'name' },
  notifications: { relatedId: 'relatedId', relatedType: 'relatedType', type: 'type', isRead: 'isRead' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId', stripePaymentIntentId: 'stripePaymentIntentId', cachedFeeCents: 'cachedFeeCents', displayName: 'displayName', paymentStatus: 'paymentStatus', participantType: 'participantType', usedGuestPass: 'usedGuestPass', refundedAt: 'refundedAt' },
  stripePaymentIntents: { bookingId: 'bookingId', stripePaymentIntentId: 'stripePaymentIntentId', status: 'status', amountCents: 'amountCents' },
  users: {},
  failedSideEffects: {},
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
  notifyMember: vi.fn().mockResolvedValue(undefined),
  isSyntheticEmail: vi.fn().mockReturnValue(false),
  isNotifiableEmail: vi.fn().mockReturnValue(true),
}));

vi.mock('../server/core/bookingEvents', () => ({
  bookingEvents: { publish: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../server/core/websocket', () => ({
  sendNotificationToUser: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
}));

vi.mock('../server/routes/guestPasses', () => ({
  refundGuestPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: { markPaymentRefunded: vi.fn(), markPaymentCancelled: vi.fn() },
  markPaymentRefunded: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/stripe', () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
  getStripeClient: vi.fn().mockResolvedValue({
    paymentIntents: { retrieve: vi.fn(), cancel: vi.fn() },
    refunds: { create: vi.fn() },
    customers: { createBalanceTransaction: vi.fn() },
  }),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn().mockResolvedValue({
    paymentIntents: { retrieve: vi.fn(), cancel: vi.fn() },
    refunds: { create: vi.fn() },
    customers: { createBalanceTransaction: vi.fn() },
  }),
}));

vi.mock('../server/core/stripe/payments', () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/routes/bays/helpers', () => ({
  getCalendarNameForBayAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/calendar/index', () => ({
  getCalendarIdByName: vi.fn().mockResolvedValue(null),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  voidBookingInvoice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/utils/dateUtils', () => ({
  formatNotificationDateTime: vi.fn(() => 'Jan 1 at 10:00 AM'),
  createPacificDate: vi.fn(() => new Date(Date.now() + 86400000)),
}));

vi.mock('../server/utils/dateTimeUtils', () => ({
  ensureDateString: vi.fn((d: string) => d),
  ensureTimeString: vi.fn((t: string) => t),
}));

vi.mock('../server/core/errors', () => ({
  assertBookingVersion: vi.fn(),
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
}));

vi.mock('../server/core/jobQueue', () => ({
  queueJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('stripe', () => ({ default: vi.fn() }));

import { BookingStateService } from '../server/core/bookingService/bookingStateService';
import { updateGenericStatus } from '../server/core/bookingService/approvalCheckin';

function mockDbSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(result),
  };
  mockSelect.mockReturnValue(chain);
  return chain;
}

function createBookingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userEmail: 'test@example.com',
    userName: 'Test User',
    resourceId: 5,
    requestDate: '2025-06-15',
    startTime: '10:00',
    durationMinutes: 60,
    status: 'approved',
    calendarEventId: null,
    sessionId: null,
    trackmanBookingId: null,
    staffNotes: null,
    version: 1,
    ...overrides,
  };
}

describe('BookingStateService — State Transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Valid state transitions', () => {
    it('cancels a pending booking', async () => {
      const booking = createBookingRecord({ status: 'pending' });
      mockDbSelectChain([booking]);

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([]),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });

    it('cancels an approved booking', async () => {
      const booking = createBookingRecord({ status: 'approved' });
      mockDbSelectChain([booking]);

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([]),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });

    it('cancels a confirmed booking', async () => {
      const booking = createBookingRecord({ status: 'confirmed' });
      mockDbSelectChain([booking]);

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([]),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });
  });

  describe('Already-terminal state handling', () => {
    it('returns success for already-cancelled booking', async () => {
      const booking = createBookingRecord({ status: 'cancelled' });
      mockDbSelectChain([booking]);

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });

    it('returns cancellation_pending for member cancelling already-pending booking', async () => {
      const booking = createBookingRecord({ status: 'cancellation_pending', trackmanBookingId: '12345' });
      mockDbSelectChain([booking]);

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'member',
        cancelledBy: 'test@example.com',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancellation_pending');
    });
  });

  describe('Pending cancellation flow (Trackman-linked)', () => {
    it('routes to pending cancellation for approved Trackman-linked booking from member', async () => {
      const booking = createBookingRecord({
        status: 'approved',
        trackmanBookingId: '67890',
      });

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ name: 'Bay 1' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'member',
        cancelledBy: 'test@example.com',
      });

      expect(result.status).toBe('cancellation_pending');
    });

    it('routes Trackman-linked confirmed booking to pending cancellation from staff', async () => {
      const booking = createBookingRecord({
        status: 'confirmed',
        trackmanBookingId: '67890',
      });

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ name: 'Bay 1' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
        cancelledBy: 'staff@example.com',
      });

      expect(result.status).toBe('cancellation_pending');
    });

    it('directly cancels Trackman-linked booking from trackman_webhook source', async () => {
      const booking = createBookingRecord({
        status: 'approved',
        trackmanBookingId: '67890',
      });
      mockDbSelectChain([booking]);

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnThis(),
            where: vi.fn().mockResolvedValue([]),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'trackman_webhook',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });
  });

  describe('Error handling', () => {
    it('returns 404 when booking not found', async () => {
      mockDbSelectChain([]);

      const result = await BookingStateService.cancelBooking({
        bookingId: 999,
        source: 'staff',
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });
  });

  describe('completePendingCancellation', () => {
    it('returns 404 when booking not found', async () => {
      mockDbSelectChain([]);

      const result = await BookingStateService.completePendingCancellation({
        bookingId: 999,
        staffEmail: 'staff@example.com',
        source: 'trackman_webhook',
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it('returns error when booking is not in cancellation_pending status', async () => {
      const booking = createBookingRecord({ status: 'approved' });
      mockDbSelectChain([booking]);

      const result = await BookingStateService.completePendingCancellation({
        bookingId: 1,
        staffEmail: 'staff@example.com',
        source: 'trackman_webhook',
      });

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(400);
    });

    it('returns already-cancelled error for cancelled booking', async () => {
      const booking = createBookingRecord({ status: 'cancelled' });
      mockDbSelectChain([booking]);

      const result = await BookingStateService.completePendingCancellation({
        bookingId: 1,
        staffEmail: 'staff@example.com',
        source: 'trackman_webhook',
      });

      expect(result.success).toBe(false);
      expect(result.alreadyCancelled).toBe(true);
    });
  });

  describe('State transition matrix validation', () => {
    it('allows cancellation of attended booking via force cancel', async () => {
      const booking = createBookingRecord({ status: 'attended' });

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });

    it('allows cancellation of no_show booking via force cancel', async () => {
      const booking = createBookingRecord({ status: 'no_show' });

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });

    it('allows staff to force cancel a declined booking', async () => {
      const booking = createBookingRecord({ status: 'declined' });

      mockSelect.mockReturnValueOnce({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([booking]),
      }).mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ type: 'simulator' }]),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) }),
          update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
        };
        return fn(txMock);
      });

      const result = await BookingStateService.cancelBooking({
        bookingId: 1,
        source: 'staff',
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe('cancelled');
    });
  });

  describe('updateGenericStatus', () => {
    it('rejects invalid state transitions', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'pending', version: 1 }]),
      });

      await expect(updateGenericStatus(1, 'attended')).rejects.toThrow(
        "Invalid status transition from 'pending' to 'attended'"
      );
    });

    it('allows valid transition from pending to approved', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'pending', version: 1 }]),
      });

      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, status: 'approved' }]),
          }),
        }),
      });

      const result = await updateGenericStatus(1, 'approved');
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('approved');
    });

    it('allows valid transition from approved to confirmed', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'approved', version: 1 }]),
      });

      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, status: 'confirmed' }]),
          }),
        }),
      });

      const result = await updateGenericStatus(1, 'confirmed');
      expect(result[0].status).toBe('confirmed');
    });

    it('rejects transition from cancelled (terminal state)', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'cancelled', version: 1 }]),
      });

      await expect(updateGenericStatus(1, 'approved')).rejects.toThrow(
        "Invalid status transition from 'cancelled' to 'approved'"
      );
    });

    it('rejects transition from attended (terminal state)', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'attended', version: 1 }]),
      });

      await expect(updateGenericStatus(1, 'cancelled')).rejects.toThrow(
        "Invalid status transition from 'attended' to 'cancelled'"
      );
    });

    it('throws 404 when booking not found', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([]),
      });

      await expect(updateGenericStatus(999, 'approved')).rejects.toThrow('not found');
    });

    it('throws on concurrent modification', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'pending', version: 1 }]),
      });

      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(updateGenericStatus(1, 'approved')).rejects.toThrow('status changed concurrently');
    });

    it('allows declined to be reopened to pending', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'declined', version: 1 }]),
      });

      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, status: 'pending' }]),
          }),
        }),
      });

      const result = await updateGenericStatus(1, 'pending');
      expect(result[0].status).toBe('pending');
    });

    it('allows cancellation_pending to return to approved', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue([{ status: 'cancellation_pending', version: 1 }]),
      });

      mockUpdate.mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1, status: 'approved' }]),
          }),
        }),
      });

      const result = await updateGenericStatus(1, 'approved');
      expect(result[0].status).toBe('approved');
    });
  });
});
