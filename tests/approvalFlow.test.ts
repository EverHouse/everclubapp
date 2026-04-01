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
  getErrorCode: vi.fn(() => undefined),
  getErrorStatusCode: vi.fn(() => 500),
}));

const { mockExecute, mockTransaction, mockSelect, mockUpdate, mockInsert } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
  },
}));

vi.mock('../server/core/db', () => ({
  pool: { connect: vi.fn() },
  safeRelease: vi.fn(),
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
  bookingRequests: { id: 'id', userEmail: 'userEmail', userName: 'userName', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', calendarEventId: 'calendarEventId', sessionId: 'sessionId', trackmanBookingId: 'trackmanBookingId', staffNotes: 'staffNotes', version: 'version', isUnmatched: 'isUnmatched', updatedAt: 'updatedAt', requestParticipants: 'requestParticipants', userId: 'userId' },
  resources: { id: 'id', type: 'type', name: 'name' },
  notifications: { relatedId: 'relatedId', relatedType: 'relatedType', type: 'type', isRead: 'isRead' },
  users: { id: 'id', email: 'email', firstName: 'firstName', lastName: 'lastName' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId' },
  stripePaymentIntents: {},
  failedSideEffects: {},
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
  notifyMember: vi.fn().mockResolvedValue(undefined),
  isSyntheticEmail: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/bookingValidation', () => ({
  checkClosureConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
  checkAvailabilityBlockConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
}));

vi.mock('../server/core/bookingEvents', () => ({
  bookingEvents: { publish: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../server/core/websocket', () => ({
  sendNotificationToUser: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
  broadcastMemberStatsUpdated: vi.fn(),
  broadcastBillingUpdate: vi.fn(),
}));

vi.mock('../server/routes/guestPasses', () => ({
  refundGuestPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/memberSync', () => ({
  updateHubSpotContactVisitCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  createSessionWithUsageTracking: vi.fn().mockResolvedValue({
    success: true,
    session: { id: 100 },
    participants: [{ id: 1 }],
    usageLedgerEntries: 1,
  }),
  ensureSessionForBooking: vi.fn().mockResolvedValue({ sessionId: 100, created: true }),
  createOrFindGuest: vi.fn().mockResolvedValue(10),
}));

vi.mock('../server/core/bookingService/conflictDetection', () => ({
  timePeriodsOverlap: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  recalculateSessionFees: vi.fn().mockResolvedValue({ totals: { totalCents: 0, overageCents: 0, guestCents: 0 } }),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: { markPaymentRefunded: vi.fn(), markPaymentCancelled: vi.fn() },
}));

vi.mock('../server/core/stripe', () => ({
  cancelPaymentIntent: vi.fn(),
  getStripeClient: vi.fn().mockResolvedValue({ paymentIntents: { retrieve: vi.fn(), cancel: vi.fn() }, refunds: { create: vi.fn() } }),
}));

vi.mock('../server/routes/bays/helpers', () => ({
  getCalendarNameForBayAsync: vi.fn().mockResolvedValue('Bay 1 Calendar'),
}));

const mockDeferredAddCalls: Array<{ type: string }> = [];
vi.mock('../server/core/deferredSideEffects', () => {
  class MockDeferredSideEffects {
    private actions: Array<{ type: string; fn: () => Promise<void> }> = [];
    add(type: string, fn: () => Promise<void>) { 
      mockDeferredAddCalls.push({ type });
      this.actions.push({ type, fn }); 
    }
    async executeAll() {
      for (const action of this.actions) {
        try { await action.fn(); } catch { /* swallow in test */ }
      }
      return { failures: [] };
    }
  }
  return { DeferredSideEffects: MockDeferredSideEffects };
});

vi.mock('../server/core/calendar/index', () => ({
  getCalendarIdByName: vi.fn().mockResolvedValue('cal-123'),
  createCalendarEventOnCalendar: vi.fn().mockResolvedValue('event-123'),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));


vi.mock('../server/core/billing/prepaymentService', () => ({
  createPrepaymentIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  finalizeAndPayInvoice: vi.fn().mockResolvedValue(undefined),
  syncBookingInvoice: vi.fn().mockResolvedValue(undefined),
  getBookingInvoiceId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn().mockResolvedValue({ id: 'v1' }),
}));

vi.mock('../server/core/errors', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    details?: unknown;
    constructor(statusCode: number, message: string, details?: unknown) {
      super(message);
      this.statusCode = statusCode;
      this.details = details;
      this.name = 'AppError';
    }
  },
  assertBookingVersion: vi.fn(),
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/utils/dateUtils', () => ({
  formatNotificationDateTime: vi.fn(() => 'Jan 1 at 10:00 AM'),
  formatDateDisplayWithDay: vi.fn(() => 'Wed, Jan 1'),
  formatTime12Hour: vi.fn(() => '10:00 AM'),
}));

vi.mock('../server/routes/push', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('stripe', () => ({ default: vi.fn() }));

import { approveBooking, declineBooking } from '../server/core/bookingService/approvalFlow';
import { notifyMember } from '../server/core/notificationService';
import { createSessionWithUsageTracking } from '../server/core/bookingService/sessionManager';
import { checkClosureConflict, checkAvailabilityBlockConflict } from '../server/core/bookingValidation';
import { timePeriodsOverlap } from '../server/core/bookingService/conflictDetection';
import { recalculateSessionFees } from '../server/core/billing/unifiedFeeService';
import { createCalendarEventOnCalendar, getCalendarIdByName } from '../server/core/calendar/index';
import { db } from '../server/db';

function createMockBookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userEmail: 'member@example.com',
    userName: 'Test Member',
    userId: 'user-1',
    resourceId: 5,
    requestDate: '2025-06-15',
    startTime: '10:00',
    endTime: '11:00',
    durationMinutes: 60,
    status: 'pending',
    calendarEventId: null,
    sessionId: null,
    trackmanBookingId: null,
    staffNotes: null,
    version: 1,
    notes: null,
    requestParticipants: null,
    isUnmatched: false,
    ...overrides,
  };
}

function setupApprovalTransaction(bookingRow: Record<string, unknown>) {
  const txMock = {
    execute: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([bookingRow]),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ ...bookingRow, status: 'approved' }]),
        }),
      }),
    }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  };

  mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => {
    return fn(txMock);
  });

  return txMock;
}

describe('Approval Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeferredAddCalls.length = 0;
    vi.mocked(checkClosureConflict).mockResolvedValue({ hasConflict: false });
    vi.mocked(checkAvailabilityBlockConflict).mockResolvedValue({ hasConflict: false });
    vi.mocked(timePeriodsOverlap).mockReturnValue(false);
    vi.mocked(createSessionWithUsageTracking).mockResolvedValue({
      success: true,
      session: { id: 100 } as never,
      participants: [{ id: 1 }] as never[],
      usageLedgerEntries: 1,
    });
  });

  describe('approveBooking', () => {
    it('rejects approval when booking is not found', async () => {
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 999, status: 'approved' })).rejects.toThrow('Request not found');
    });

    it('rejects approval when booking status is not pending', async () => {
      const booking = createMockBookingRow({ status: 'confirmed' });
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 1, status: 'approved' })).rejects.toThrow('already confirmed');
    });

    it('rejects approval when no bay is assigned', async () => {
      const booking = createMockBookingRow({ resourceId: null });
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 1, status: 'approved' })).rejects.toThrow('Bay must be assigned');
    });

    it('rejects approval when time slot has conflict', async () => {
      const booking = createMockBookingRow();
      const existingBooking = createMockBookingRow({ id: 2, status: 'approved', startTime: '10:00', endTime: '11:00' });
      vi.mocked(timePeriodsOverlap).mockReturnValue(true);

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([booking]),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([existingBooking]),
          }),
        };
      });
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 1, status: 'approved' })).rejects.toThrow('conflicts');
    });

    it('rejects approval during facility closure', async () => {
      const booking = createMockBookingRow();
      vi.mocked(checkClosureConflict).mockResolvedValue({ hasConflict: true, closureTitle: 'Holiday Closure' });

      let selectCallCount = 0;
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
          }
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 1, status: 'approved' })).rejects.toThrow('closure');
    });

    it('rejects approval during availability block', async () => {
      const booking = createMockBookingRow();
      vi.mocked(checkAvailabilityBlockConflict).mockResolvedValue({ hasConflict: true, blockType: 'Tournament' });

      let selectCallCount = 0;
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockImplementation(() => {
          selectCallCount++;
          if (selectCallCount === 1) {
            return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
          }
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        }),
        update: vi.fn(),
        insert: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 1, status: 'approved' })).rejects.toThrow('event block');
    });

    it('creates session when booking has no existing session', async () => {
      const booking = createMockBookingRow({ sessionId: null });
      const updatedBooking = { ...booking, status: 'approved', sessionId: null };
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        }
        if (selectCallCount === 2) {
          return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        }
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const result = await approveBooking({ bookingId: 1, status: 'approved' });

      expect(createSessionWithUsageTracking).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerEmail: 'member@example.com',
          resourceId: 5,
        }),
        'member_request',
        expect.anything()
      );
    });

    it('sends notification to member after approval', async () => {
      const booking = createMockBookingRow();
      const updatedBooking = { ...booking, status: 'approved', sessionId: 100 };
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await approveBooking({ bookingId: 1, status: 'approved' });

      expect(notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'member@example.com',
          type: 'booking_approved',
        }),
        expect.objectContaining({ sendPush: true })
      );
    });

    it('allows Trackman ID update on already-approved booking', async () => {
      const booking = createMockBookingRow({ status: 'approved', trackmanBookingId: null });
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        }),
        insert: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const result = await approveBooking({
        bookingId: 1,
        status: 'approved',
        trackman_booking_id: '12345',
      });

      expect(txMock.update).toHaveBeenCalled();
      const setFn = txMock.update.mock.results[0]?.value?.set;
      expect(setFn).toHaveBeenCalledWith(
        expect.objectContaining({ trackmanBookingId: '12345' })
      );
    });

    it('calculates fees after session creation when participants exist', async () => {
      const booking = createMockBookingRow();
      const updatedBooking = { ...booking, status: 'approved', sessionId: null };
      vi.mocked(createSessionWithUsageTracking).mockResolvedValue({
        success: true,
        session: { id: 200 } as never,
        participants: [{ id: 1 }, { id: 2 }] as never[],
        usageLedgerEntries: 2,
      });

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await approveBooking({ bookingId: 1, status: 'approved' });

      expect(recalculateSessionFees).toHaveBeenCalledWith(200, 'approval');
    });

    it('creates calendar event after approval', async () => {
      const booking = createMockBookingRow({ calendarEventId: null });
      const updatedBooking = { ...booking, status: 'approved', sessionId: 100 };

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        if (selectCallCount === 3) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ id: 'user-1', firstName: 'Test', lastName: 'Member' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await approveBooking({ bookingId: 1, status: 'approved' });

      expect(mockDeferredAddCalls.some(c => c.type === 'calendar_sync')).toBe(true);
    });

    it('throws AppError when session creation fails within transaction', async () => {
      const booking = createMockBookingRow({ sessionId: null });
      vi.mocked(createSessionWithUsageTracking).mockResolvedValue({
        success: false,
        session: null as never,
        participants: [] as never[],
        usageLedgerEntries: 0,
        error: 'Resource unavailable',
      });

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ ...booking, status: 'approved' }]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(approveBooking({ bookingId: 1, status: 'approved' })).rejects.toThrow('Failed to create booking session');
    });

    it('continues approval when calendar sync fails (non-blocking)', async () => {
      const booking = createMockBookingRow({ calendarEventId: null });
      const updatedBooking = { ...booking, status: 'approved', sessionId: 100 };
      vi.mocked(createCalendarEventOnCalendar).mockRejectedValue(new Error('Google Calendar API error'));

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const result = await approveBooking({ bookingId: 1, status: 'approved' });

      expect(result).toBeDefined();
      expect(result.updated.status).toBe('approved');
    });

    it('continues approval when fee recalculation fails (non-blocking)', async () => {
      const booking = createMockBookingRow();
      const updatedBooking = { ...booking, status: 'approved', sessionId: null };
      vi.mocked(createSessionWithUsageTracking).mockResolvedValue({
        success: true,
        session: { id: 300 } as never,
        participants: [{ id: 1 }] as never[],
        usageLedgerEntries: 1,
      });
      vi.mocked(recalculateSessionFees).mockRejectedValue(new Error('Fee service unavailable'));

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const result = await approveBooking({ bookingId: 1, status: 'approved' });

      expect(result).toBeDefined();
      expect(result.updated.status).toBe('approved');
      expect(recalculateSessionFees).toHaveBeenCalledWith(300, 'approval');
    });

    it('appends PENDING_TRACKMAN_SYNC marker when pending_trackman_sync is true with no trackman ID', async () => {
      const booking = createMockBookingRow();
      const updatedBooking = { ...booking, status: 'approved', sessionId: 100 };
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        select: vi.fn(),
        update: vi.fn().mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([updatedBooking]),
            }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      };

      let selectCallCount = 0;
      txMock.select.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([booking]) }) };
        if (selectCallCount === 2) return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) };
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([{ name: 'Bay 1', type: 'simulator' }]) }) };
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await approveBooking({
        bookingId: 1,
        status: 'approved',
        pending_trackman_sync: true,
        staff_notes: 'Quick approval',
      });

      expect(txMock.update).toHaveBeenCalled();
      const setCall = txMock.update.mock.results[0]?.value?.set;
      expect(setCall).toBeDefined();
      expect(setCall).toHaveBeenCalledWith(
        expect.objectContaining({
          staffNotes: expect.stringContaining('[PENDING_TRACKMAN_SYNC]'),
        })
      );
    });
  });

  describe('declineBooking', () => {
    it('declines a pending booking and sends notification', async () => {
      const booking = createMockBookingRow({ status: 'pending', version: 1 });
      const updatedBooking = { ...booking, status: 'declined', staffNotes: 'Not enough capacity' };

      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn()
          .mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedBooking]),
              }),
            }),
          })
          .mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const result = await declineBooking({
        bookingId: 1,
        staff_notes: 'Not enough capacity',
        reviewed_by: 'staff@example.com',
      });

      expect(result).toMatchObject({
        updated: expect.objectContaining({
          id: 1,
          status: 'declined',
        }),
      });
      expect(notifyMember).toHaveBeenCalledWith(
        expect.objectContaining({
          userEmail: 'member@example.com',
          type: 'booking_declined',
        }),
        expect.objectContaining({ sendPush: true })
      );
    });

    it('rejects declining a non-pending booking', async () => {
      const booking = createMockBookingRow({ status: 'approved' });
      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(declineBooking({
        bookingId: 1,
        staff_notes: 'Test',
        reviewed_by: 'staff@example.com',
      })).rejects.toThrow('Cannot decline');
    });

    it('throws 404 for non-existent booking', async () => {
      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        }),
        update: vi.fn(),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(declineBooking({
        bookingId: 999,
        staff_notes: 'Test',
        reviewed_by: 'staff@example.com',
      })).rejects.toThrow('not found');
    });

    it('includes suggested alternative time in decline message', async () => {
      const booking = createMockBookingRow({ status: 'pending' });
      const updatedBooking = { ...booking, status: 'declined', suggestedTime: '14:00' };

      const txMock = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([booking]),
          }),
        }),
        update: vi.fn()
          .mockReturnValueOnce({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedBooking]),
              }),
            }),
          })
          .mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
      };
      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await declineBooking({
        bookingId: 1,
        staff_notes: 'Try another time',
        suggested_time: '14:00',
        reviewed_by: 'staff@example.com',
      });

      const updateSetFn = txMock.update.mock.results[0]?.value?.set;
      expect(updateSetFn).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'declined',
          suggestedTime: '14:00',
        })
      );
    });
  });
});
