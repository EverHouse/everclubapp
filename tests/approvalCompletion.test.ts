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
    gt: vi.fn(),
    lt: vi.fn(),
    lte: vi.fn(),
    gte: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  bookingRequests: { id: 'id', userEmail: 'userEmail', userName: 'userName', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', sessionId: 'sessionId', staffNotes: 'staffNotes', version: 'version', isUnmatched: 'isUnmatched', updatedAt: 'updatedAt', requestParticipants: 'requestParticipants', calendarEventId: 'calendarEventId', trackmanBookingId: 'trackmanBookingId', userId: 'userId', notes: 'notes' },
  resources: { id: 'id', type: 'type', name: 'name' },
  notifications: { relatedId: 'relatedId', relatedType: 'relatedType', type: 'type', isRead: 'isRead' },
  users: { id: 'id', email: 'email', firstName: 'firstName', lastName: 'lastName' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId', userId: 'userId', participantType: 'participantType' },
  stripePaymentIntents: {},
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

vi.mock('../server/core/billing/guestPassService', () => ({
  refundGuestPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/memberSync', () => ({
  updateHubSpotContactVisitCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  createSessionWithUsageTracking: vi.fn().mockResolvedValue({ success: true, session: { id: 100 }, participants: [{ id: 1 }] }),
  ensureSessionForBooking: vi.fn().mockResolvedValue({ sessionId: 100, created: true }),
  createOrFindGuest: vi.fn().mockResolvedValue(10),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  recalculateSessionFees: vi.fn().mockResolvedValue({ totals: { totalCents: 500, overageCents: 0, guestCents: 0 } }),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: { markPaymentRefunded: vi.fn() },
}));

vi.mock('../server/core/stripe', () => ({
  cancelPaymentIntent: vi.fn(),
  getStripeClient: vi.fn().mockResolvedValue({ paymentIntents: { retrieve: vi.fn(), cancel: vi.fn() }, refunds: { create: vi.fn() } }),
}));

vi.mock('../server/routes/bays/helpers', () => ({
  getCalendarNameForBayAsync: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/calendar/index', () => ({
  getCalendarIdByName: vi.fn().mockResolvedValue(null),
  createCalendarEventOnCalendar: vi.fn().mockResolvedValue(null),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/guestPassHoldService', () => ({
  releaseGuestPassHold: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../server/core/billing/prepaymentService', () => ({
  createPrepaymentIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  voidBookingInvoice: vi.fn().mockResolvedValue(undefined),
  finalizeAndPayInvoice: vi.fn().mockResolvedValue(undefined),
  syncBookingInvoice: vi.fn().mockResolvedValue(undefined),
  getBookingInvoiceId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/billing/paymentIntentCleanup', () => ({
  cancelPendingPaymentIntentsForBooking: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn().mockResolvedValue({ id: 'v1' }),
}));

vi.mock('../server/core/errors', () => ({
  AppError: class AppError extends Error {
    statusCode: number;
    constructor(statusCode: number, message: string) {
      super(message);
      this.statusCode = statusCode;
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
  refreshBookingPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/utils/dateUtils', () => ({
  formatNotificationDateTime: vi.fn(() => 'Jan 1 at 10:00 AM'),
  formatDateDisplayWithDay: vi.fn(() => 'Wed, Jan 1'),
  formatTime12Hour: vi.fn(() => '10:00 AM'),
  formatDateFromDb: vi.fn((d: unknown) => String(d)),
}));

vi.mock('../server/routes/push', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('stripe', () => ({ default: vi.fn() }));

vi.mock('../server/core/bookingService/approvalCheckin', () => ({
  DevConfirmBookingRow: {},
}));

import { devConfirmBooking } from '../server/core/bookingService/approvalCompletion';
import { ensureSessionForBooking } from '../server/core/bookingService/sessionManager';
import { notifyMember } from '../server/core/notificationService';
import { sendNotificationToUser } from '../server/core/websocket';
import { recalculateSessionFees } from '../server/core/billing/unifiedFeeService';

describe('Approval Completion — devConfirmBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when booking not found', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await devConfirmBooking({ bookingId: 999, staffEmail: 'staff@example.com' });

    expect(result.error).toBe('Booking not found');
    expect(result.statusCode).toBe(404);
  });

  it('returns error when booking is already approved', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1,
        status: 'approved',
        user_email: 'test@example.com',
        user_name: 'Test',
        resource_id: 5,
        request_date: '2025-06-15',
        start_time: '10:00',
        end_time: '11:00',
        session_id: null,
        request_participants: null,
        user_id: 'user-1',
      }],
    });

    const result = await devConfirmBooking({ bookingId: 1, staffEmail: 'staff@example.com' });

    expect(result.error).toContain('already approved');
    expect(result.statusCode).toBe(400);
  });

  it('creates session when booking has no session', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1,
        status: 'pending',
        user_email: 'test@example.com',
        user_name: 'Test',
        resource_id: 5,
        request_date: '2025-06-15',
        start_time: '10:00',
        end_time: '11:00',
        session_id: null,
        request_participants: null,
        user_id: 'user-1',
        stripe_customer_id: null,
        tier: 'full',
        owner_email: 'test@example.com',
        duration_minutes: 60,
      }],
    });

    const txMock = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

    const result = await devConfirmBooking({ bookingId: 1, staffEmail: 'staff@example.com' });

    expect(ensureSessionForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 1,
        resourceId: 5,
        source: 'staff_manual',
        createdBy: 'dev_confirm',
      })
    );
  });

  it('transfers request participants to session', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1,
        status: 'pending',
        user_email: 'owner@example.com',
        user_name: 'Owner',
        resource_id: 5,
        request_date: '2025-06-15',
        start_time: '10:00',
        end_time: '11:00',
        session_id: null,
        request_participants: [
          { email: 'member@example.com', type: 'member', name: 'Member One' },
          { email: 'guest@example.com', type: 'guest', name: 'Guest One' },
        ],
        user_id: 'user-1',
        stripe_customer_id: null,
        tier: 'full',
        owner_email: 'owner@example.com',
        duration_minutes: 60,
      }],
    });

    const txExecute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'member-id', first_name: 'Member', last_name: 'One' }] })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const txMock = { execute: txExecute };
    mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

    const result = await devConfirmBooking({ bookingId: 1, staffEmail: 'staff@example.com' });

    expect(result.success).toBe(true);
    expect(txExecute).toHaveBeenCalledTimes(8);
  });

  it('sends notifications to booking owner after confirmation', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1,
        status: 'pending',
        user_email: 'owner@example.com',
        user_name: 'Owner',
        resource_id: 5,
        request_date: '2025-06-15',
        start_time: '10:00',
        end_time: '11:00',
        session_id: 100,
        request_participants: null,
        user_id: 'user-1',
        stripe_customer_id: null,
        tier: 'full',
        owner_email: 'owner@example.com',
        duration_minutes: 60,
      }],
    });

    const txMock = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

    await devConfirmBooking({ bookingId: 1, staffEmail: 'staff@example.com' });

    expect(notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'owner@example.com',
        type: 'booking_confirmed',
      }),
      expect.objectContaining({ sendPush: true })
    );

    expect(sendNotificationToUser).toHaveBeenCalledWith(
      'owner@example.com',
      expect.objectContaining({ type: 'notification', title: 'Booking Confirmed' }),
      expect.anything()
    );
  });

  it('calculates fees after session creation', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1,
        status: 'pending',
        user_email: 'owner@example.com',
        user_name: 'Owner',
        resource_id: 5,
        request_date: '2025-06-15',
        start_time: '10:00',
        end_time: '11:00',
        session_id: null,
        request_participants: null,
        user_id: 'user-1',
        stripe_customer_id: null,
        tier: 'full',
        owner_email: 'owner@example.com',
        duration_minutes: 60,
      }],
    });

    const txMock = {
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rows: [] }),
    };
    mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

    await devConfirmBooking({ bookingId: 1, staffEmail: 'staff@example.com' });

    expect(recalculateSessionFees).toHaveBeenCalledWith(100, 'approval');
  });

  it('skips duplicate participants already in session', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 1,
        status: 'pending',
        user_email: 'owner@example.com',
        user_name: 'Owner',
        resource_id: 5,
        request_date: '2025-06-15',
        start_time: '10:00',
        end_time: '11:00',
        session_id: null,
        request_participants: [
          { email: 'member@example.com', type: 'member', userId: 'existing-user', name: 'Already There' },
        ],
        user_id: 'user-1',
        stripe_customer_id: null,
        tier: 'full',
        owner_email: 'owner@example.com',
        duration_minutes: 60,
      }],
    });

    const txExecute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ user_id: 'existing-user', display_name: 'Already There', participant_type: 'member' }] })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rows: [] });

    const txMock = { execute: txExecute };
    mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

    const result = await devConfirmBooking({ bookingId: 1, staffEmail: 'staff@example.com' });

    expect(result.success).toBe(true);
    expect(txExecute).toHaveBeenCalledTimes(5);
  });
});
