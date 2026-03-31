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

const sqlCalls: Array<{ strings: string[]; values: unknown[] }> = [];

const { mockExecute, mockTransaction, mockSelect, mockUpdate, mockInsert, mockDelete } = vi.hoisted(() => {
  return {
    mockExecute: vi.fn(),
    mockTransaction: vi.fn(),
    mockSelect: vi.fn(),
    mockUpdate: vi.fn(),
    mockInsert: vi.fn(),
    mockDelete: vi.fn(),
  };
});

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
    select: mockSelect,
    update: mockUpdate,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result: Record<string, unknown> = { __sqlStrings: Array.from(strings), __sqlValues: values };
    result.as = vi.fn().mockReturnValue(result);
    sqlCalls.push({ strings: Array.from(strings), values });
    return result;
  };
  sqlTagFn.join = vi.fn();
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
    inArray: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  bookingRequests: { id: 'id', userEmail: 'userEmail', userName: 'userName', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', calendarEventId: 'calendarEventId', sessionId: 'sessionId', trackmanBookingId: 'trackmanBookingId', staffNotes: 'staffNotes', rosterVersion: 'rosterVersion', declaredPlayerCount: 'declaredPlayerCount', isUnmatched: 'isUnmatched', updatedAt: 'updatedAt', userId: 'userId' },
  resources: { id: 'id', type: 'type', name: 'name', capacity: 'capacity' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId', userId: 'userId', guestId: 'guestId', participantType: 'participantType', displayName: 'displayName', slotDuration: 'slotDuration', paymentStatus: 'paymentStatus', createdAt: 'createdAt', stripePaymentIntentId: 'stripePaymentIntentId', cachedFeeCents: 'cachedFeeCents', usedGuestPass: 'usedGuestPass', refundedAt: 'refundedAt', inviteStatus: 'inviteStatus' },
  notifications: { userEmail: 'userEmail', title: 'title', message: 'message', type: 'type', relatedId: 'relatedId', relatedType: 'relatedType', isRead: 'isRead' },
  users: { id: 'id', email: 'email', firstName: 'firstName', lastName: 'lastName', tier: 'tier' },
  bookingSessions: {},
  stripePaymentIntents: { bookingId: 'bookingId', stripePaymentIntentId: 'stripePaymentIntentId', status: 'status', amountCents: 'amountCents' },
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  createOrFindGuest: vi.fn().mockResolvedValue({ id: 10, name: 'Test Guest' }),
  ensureSessionForBooking: vi.fn().mockResolvedValue({ sessionId: 100 }),
  createSessionWithUsageTracking: vi.fn().mockResolvedValue({ sessionId: 100 }),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  computeFeeBreakdown: vi.fn().mockResolvedValue({ totalCents: 0, lineItems: [] }),
  recalculateSessionFees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  PRICING: { GUEST_FEE_CENTS: 7500, GUEST_FEE_DOLLARS: 75 },
}));

vi.mock('../server/core/billing/prepaymentService', () => ({
  createPrepaymentIntent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/notificationService', () => ({
  notifyMember: vi.fn().mockResolvedValue(undefined),
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
  isSyntheticEmail: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/routes/guestPasses', () => ({
  refundGuestPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn().mockResolvedValue({ id: 'visitor-1' }),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  syncBookingInvoice: vi.fn().mockResolvedValue(undefined),
  voidBookingInvoice: vi.fn().mockResolvedValue(undefined),
  finalizeAndPayInvoice: vi.fn().mockResolvedValue(undefined),
  getBookingInvoiceId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/websocket', () => ({
  sendNotificationToUser: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
  broadcastBillingUpdate: vi.fn(),
  broadcastMemberStatsUpdated: vi.fn(),
  broadcastBookingRosterUpdate: vi.fn(),
}));

vi.mock('../server/core/bookingValidation', () => ({
  checkClosureConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
  checkAvailabilityBlockConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
}));

vi.mock('../server/core/bookingEvents', () => ({
  bookingEvents: { emit: vi.fn() },
}));

vi.mock('../server/core/memberSync', () => ({
  updateHubSpotContactVisitCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/stripe', () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue({ success: true }),
  getStripeClient: vi.fn().mockResolvedValue({}),
}));

vi.mock('../server/core/billing/paymentIntentCleanup', () => ({
  cancelPendingPaymentIntentsForBooking: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: { markPaid: vi.fn(), markWaived: vi.fn() },
}));

vi.mock('../server/core/billing/guestPassHoldService', () => ({
  releaseGuestPassHold: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../server/routes/push', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/utils/dateUtils', () => ({
  formatNotificationDateTime: vi.fn().mockReturnValue('June 15, 2025 10:00 AM'),
  formatDateDisplayWithDay: vi.fn().mockReturnValue('Sunday, June 15'),
  formatTime12Hour: vi.fn().mockReturnValue('10:00 AM'),
}));

vi.mock('../server/routes/bays/helpers', () => ({
  getCalendarNameForBayAsync: vi.fn().mockResolvedValue('Bay 1'),
}));

vi.mock('../server/core/calendar/index', () => ({
  getCalendarIdByName: vi.fn().mockResolvedValue(null),
  createCalendarEventOnCalendar: vi.fn().mockResolvedValue(null),
  deleteCalendarEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/errors', () => ({
  AppError: class AppError extends Error { statusCode: number; constructor(msg: string, code: number) { super(msg); this.statusCode = code; } },
  STALE_BOOKING_MESSAGE: 'This booking was updated by someone else. Please refresh and try again.',
  StaleBookingVersionError: class StaleBookingVersionError extends Error { statusCode: number; constructor() { super('This booking was updated by someone else. Please refresh and try again.'); this.statusCode = 409; } },
  assertBookingVersion: vi.fn(),
  GuestPassHoldError: class GuestPassHoldError extends Error { passesAvailable?: number; constructor(msg: string, pa?: number) { super(msg); this.passesAvailable = pa; } },
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
  logFromRequest: vi.fn(),
}));

vi.mock('../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn().mockResolvedValue(undefined),
  refreshBookingPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/approvalTypes', () => ({}));

vi.mock('stripe', () => ({
  default: vi.fn(),
}));

import { checkinBooking } from '../server/core/bookingService/approvalCheckin';

function createTxMock(overrides: Record<string, unknown> = {}) {
  const txExecute = vi.fn();
  const txUpdateReturning = vi.fn();
  const txUpdateWhere = vi.fn().mockReturnValue({ returning: txUpdateReturning });
  const txUpdateSet = vi.fn().mockReturnValue({ where: txUpdateWhere });
  const txUpdate = vi.fn().mockReturnValue({ set: txUpdateSet });

  return {
    execute: txExecute,
    update: txUpdate,
    _set: txUpdateSet,
    _where: txUpdateWhere,
    _returning: txUpdateReturning,
    ...overrides,
  };
}

function setupSelectMock(existingRow: Record<string, unknown>) {
  const fromMock = vi.fn();
  const leftJoinMock = vi.fn();
  const whereMock = vi.fn();

  whereMock.mockResolvedValue([existingRow]);
  leftJoinMock.mockReturnValue({ where: whereMock });
  fromMock.mockReturnValue({ leftJoin: vi.fn().mockReturnValue({ where: whereMock }) });
  mockSelect.mockReturnValue({ from: fromMock });
}

const defaultExistingRow = {
  status: 'approved',
  user_email: 'member@test.com',
  session_id: 100,
  resource_id: 1,
  request_date: '2025-06-15',
  start_time: '10:00',
  end_time: '11:00',
  declared_player_count: 2,
  user_name: 'Test Member',
};

describe('Check-in Precondition Atomicity', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sqlCalls.length = 0;
  });

  describe('SELECT FOR UPDATE locking', () => {
    it('locks booking row with FOR UPDATE inside transaction', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute.mockResolvedValue({ rows: [{ membership_status: 'active' }] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ declared_player_count: 2, trackman_player_count: null, session_id: 100, participant_count: '2' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ tx_outstanding: '0' }] });
      txMock._returning.mockResolvedValue([{ id: 1, status: 'attended', userEmail: 'member@test.com', requestDate: '2025-06-15', startTime: '10:00' }]);

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      const forUpdateCall = sqlCalls.find(c => c.strings.some(s => s.includes('FOR UPDATE')));
      expect(forUpdateCall).toBeDefined();
      expect(forUpdateCall!.strings.some(s => s.includes('booking_requests'))).toBe(true);

      const forShareCall = sqlCalls.find(c => c.strings.some(s => s.includes('FOR SHARE')));
      expect(forShareCall).toBeDefined();
      expect(forShareCall!.strings.some(s => s.includes('booking_participants'))).toBe(true);
    });
  });

  describe('Concurrent fee change during check-in', () => {
    it('returns 409 when outstanding balance appears between UI load and commit', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ declared_player_count: 2, trackman_player_count: null, session_id: 100, participant_count: '2' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ tx_outstanding: '75.00' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Fees were updated');
      expect(result.error).toContain('$75.00');
    });

    it('returns 409 when outstanding balance drifts between UI load and commit (confirmPayment case)', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [{ participant_id: 1, display_name: 'Test', participant_type: 'owner', payment_status: 'pending', fee_amount: '50.00' }] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ declared_player_count: 2, trackman_player_count: null, session_id: 100, participant_count: '2' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ tx_outstanding: '125.00' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        confirmPayment: true,
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Outstanding balance changed');
      expect(result.error).toContain('$50.00');
      expect(result.error).toContain('$125.00');
    });
  });

  describe('Membership status drift', () => {
    it('returns 409 when member status changes to blocked during check-in', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'cancelled' }] });

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Member status changed to "cancelled"');
    });
  });

  describe('Roster drift', () => {
    it('returns 409 when roster becomes incomplete during check-in', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ declared_player_count: 4, trackman_player_count: null, session_id: 100, participant_count: '1' }] });

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Roster changed');
      expect(result.error).toContain('3 player slot(s) now unassigned');
    });
  });

  describe('Booking status drift', () => {
    it('returns 409 when booking status changes concurrently', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'cancelled', session_id: 100, user_email: 'member@test.com' }] });

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.statusCode).toBe(409);
      expect(result.error).toContain('Booking status changed');
      expect(result.error).toContain('"approved"');
      expect(result.error).toContain('"cancelled"');
    });
  });

  describe('Skip flags bypass in-transaction checks', () => {
    it('skipPaymentCheck bypasses membership and balance re-validation inside transaction', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] })
        .mockResolvedValue({ rows: [] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ declared_player_count: 2, trackman_player_count: null, session_id: 100, participant_count: '2' }] });
      txMock.execute.mockResolvedValue({ rows: [] });
      txMock._returning.mockResolvedValue([{ id: 1, status: 'attended', userEmail: 'member@test.com', requestDate: '2025-06-15', startTime: '10:00' }]);

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        skipPaymentCheck: true,
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.success).toBe(true);
    });

    it('skipRosterCheck bypasses roster re-validation inside transaction', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] })
        .mockResolvedValue({ rows: [] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ tx_outstanding: '0' }] });
      txMock._returning.mockResolvedValue([{ id: 1, status: 'attended', userEmail: 'member@test.com', requestDate: '2025-06-15', startTime: '10:00' }]);

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        skipRosterCheck: true,
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('Happy path still works', () => {
    it('successfully checks in when preconditions are stable', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute
        .mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] })
        .mockResolvedValueOnce({ rows: [{ trackman_player_count: null, declared_player_count: 2, session_id: 100, total_slots: '2', empty_slots: '0', participant_count: '2' }] })
        .mockResolvedValueOnce({ rows: [{ null_count: '0' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ prepaid_total: '0' }] })
        .mockResolvedValue({ rows: [] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ membership_status: 'active' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ declared_player_count: 2, trackman_player_count: null, session_id: 100, participant_count: '2' }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      txMock.execute.mockResolvedValueOnce({ rows: [{ tx_outstanding: '0' }] });
      txMock._returning.mockResolvedValue([{ id: 1, status: 'attended', userEmail: 'member@test.com', requestDate: '2025-06-15', startTime: '10:00' }]);

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'attended',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.success).toBe(true);
    });

    it('no_show status skips attended-specific re-validation', async () => {
      setupSelectMock(defaultExistingRow);

      mockExecute.mockResolvedValue({ rows: [] });

      const txMock = createTxMock();
      txMock.execute.mockResolvedValueOnce({ rows: [{ status: 'approved', session_id: 100, user_email: 'member@test.com' }] });
      txMock._returning.mockResolvedValue([{ id: 1, status: 'no_show', userEmail: 'member@test.com', requestDate: '2025-06-15', startTime: '10:00' }]);

      mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(txMock));

      const result = await checkinBooking({
        bookingId: 1,
        targetStatus: 'no_show',
        staffEmail: 'staff@test.com',
        staffName: 'Staff',
      });

      expect(result.success).toBe(true);
    });
  });
});
