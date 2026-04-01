// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAndRespond: vi.fn((req, res, status, msg) => res.status(status).json({ error: msg })),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorStatusCode: vi.fn(() => null),
}));

const { mockExecute, mockTransaction, mockSelect, mockInsert, mockDelete, mockProcessWalkInCheckin } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
  mockProcessWalkInCheckin: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result: Record<string, unknown> = { __sqlStrings: Array.from(strings), __sqlValues: values };
    result.as = vi.fn().mockReturnValue(result);
    return result;
  };
  sqlTagFn.join = vi.fn();
  return {
    sql: sqlTagFn,
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  bookingRequests: { id: 'id', userEmail: 'userEmail', userName: 'userName', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', sessionId: 'sessionId', declaredPlayerCount: 'declaredPlayerCount', userId: 'userId', updatedAt: 'updatedAt' },
  resources: { id: 'id', type: 'type', name: 'name', capacity: 'capacity' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId', userId: 'userId', guestId: 'guestId', participantType: 'participantType', displayName: 'displayName', slotDuration: 'slotDuration', paymentStatus: 'paymentStatus', cachedFeeCents: 'cachedFeeCents', usedGuestPass: 'usedGuestPass', createdAt: 'createdAt' },
  notifications: { id: 'id', userEmail: 'userEmail', title: 'title', message: 'message', type: 'type', relatedId: 'relatedId', relatedType: 'relatedType', isRead: 'isRead', createdAt: 'createdAt' },
  users: { id: 'id', email: 'email', firstName: 'firstName', lastName: 'lastName', tier: 'tier', role: 'role' },
  bookingSessions: {},
  staffUsers: { email: 'email', isActive: 'isActive' },
  pushSubscriptions: { id: 'id', userEmail: 'userEmail', endpoint: 'endpoint', p256dh: 'p256dh', auth: 'auth' },
  walletPassDeviceRegistrations: { id: 'id', serialNumber: 'serialNumber' },
}));

vi.mock('../server/core/walkInCheckinService', () => ({
  processWalkInCheckin: mockProcessWalkInCheckin,
}));

vi.mock('../server/core/notificationService', () => ({
  notifyMember: vi.fn().mockResolvedValue(undefined),
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
  isSyntheticEmail: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/websocket', () => ({
  sendNotificationToUser: vi.fn().mockReturnValue({ sentCount: 0, connectionCount: 0, hasActiveSocket: false }),
  broadcastToStaff: vi.fn(),
  broadcastMemberStatsUpdated: vi.fn(),
  broadcastBookingRosterUpdate: vi.fn(),
  broadcastBookingInvoiceUpdate: vi.fn(),
  broadcastBillingUpdate: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
}));

vi.mock('../server/core/memberSync', () => ({
  updateHubSpotContactVisitCount: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/emails/firstVisitEmail', () => ({
  sendFirstVisitConfirmationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/auditLog', () => ({
  logPaymentAudit: vi.fn().mockResolvedValue(undefined),
  logFromRequest: vi.fn(),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  createOrFindGuest: vi.fn().mockResolvedValue(10),
  ensureSessionForBooking: vi.fn().mockResolvedValue({ sessionId: 100 }),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  computeFeeBreakdown: vi.fn().mockResolvedValue({ totalCents: 0, participants: [] }),
  recalculateSessionFees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  PRICING: { GUEST_FEE_CENTS: 7500, GUEST_FEE_DOLLARS: 75 },
}));

vi.mock('../server/core/billing/prepaymentService', () => ({
  createPrepaymentIntent: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  syncBookingInvoice: vi.fn().mockResolvedValue(undefined),
  voidBookingInvoice: vi.fn().mockResolvedValue(undefined),
  finalizeInvoicePaidOutOfBand: vi.fn().mockResolvedValue({ success: true }),
  getBookingInvoiceId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/billing/guestPassConsumer', () => ({
  canUseGuestPass: vi.fn().mockResolvedValue({ canUse: true, remaining: 3, total: 5 }),
}));

vi.mock('../server/core/billing/guestPassProcessor', () => ({
  processGuestPass: vi.fn().mockResolvedValue({ success: true, passesRemaining: 2 }),
}));

vi.mock('../server/core/bookingService/tierRules', () => ({
  enforceSocialTierRules: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../server/core/bookingService/approvalCheckin', () => ({
  checkinBooking: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../server/core/stripe', () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue({ success: true }),
  getStripeClient: vi.fn().mockResolvedValue({}),
  getOrCreateStripeCustomer: vi.fn().mockResolvedValue('cus_test'),
  createBalanceAwarePayment: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn().mockResolvedValue({
    customers: { retrieve: vi.fn().mockResolvedValue({ balance: 0 }) },
  }),
}));

vi.mock('../server/core/stripe/customers', () => ({
  resolveUserByEmail: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: { markPaid: vi.fn(), markWaived: vi.fn() },
}));

vi.mock('../server/core/billing/guestPassHoldService', () => ({
  releaseGuestPassHold: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn().mockResolvedValue('1234'),
}));

vi.mock('../server/middleware/paramSchemas', () => ({
  numericIdParam: { safeParse: vi.fn((v: string) => ({ success: true, data: v })) },
}));

vi.mock('../server/middleware/validate', () => ({
  validateBody: vi.fn(() => (req: unknown, res: unknown, next: () => void) => next()),
}));

vi.mock('../server/core/middleware', () => ({
  isAuthenticated: vi.fn((req: unknown, res: unknown, next: () => void) => next()),
  isStaffOrAdmin: vi.fn((req: unknown, res: unknown, next: () => void) => next()),
}));

vi.mock('../server/types/session', () => ({
  getSessionUser: vi.fn().mockReturnValue({ email: 'staff@test.com', name: 'Staff' }),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toTextArrayLiteral: vi.fn((arr: string[]) => arr),
  toIntArrayLiteral: vi.fn((arr: number[]) => arr),
}));

vi.mock('stripe', () => ({ default: vi.fn() }));

vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
  },
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn().mockResolvedValue({ statusCode: 201 }),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/core/errors', () => ({
  AppError: class extends Error { statusCode: number; constructor(msg: string, code: number) { super(msg); this.statusCode = code; } },
  STALE_BOOKING_MESSAGE: 'Stale booking',
  StaleBookingVersionError: class extends Error { statusCode: number; constructor() { super('Stale'); this.statusCode = 409; } },
  assertBookingVersion: vi.fn(),
  GuestPassHoldError: class extends Error { passesAvailable?: number; constructor(msg: string, pa?: number) { super(msg); this.passesAvailable = pa; } },
}));

vi.mock('../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn().mockResolvedValue(undefined),
  refreshBookingPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/approvalTypes', () => ({}));

vi.mock('../server/core/bookingValidation', () => ({
  checkClosureConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
  checkAvailabilityBlockConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
}));

vi.mock('../server/core/bookingEvents', () => ({
  bookingEvents: { emit: vi.fn() },
}));

vi.mock('../server/routes/push', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(undefined),
  sendPushNotificationToStaff: vi.fn().mockResolvedValue(0),
  isPushNotificationsEnabled: vi.fn().mockReturnValue(false),
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

vi.mock('../server/core/billing/paymentIntentCleanup', () => ({
  cancelPendingPaymentIntentsForBooking: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/guestPassService', () => ({
  refundGuestPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn().mockResolvedValue({ id: 'visitor-1' }),
}));

import { broadcastToStaff, broadcastMemberStatsUpdated } from '../server/core/websocket';
import { notifyMember } from '../server/core/notificationService';
import { updateHubSpotContactVisitCount } from '../server/core/memberSync';
import { sendFirstVisitConfirmationEmail } from '../server/emails/firstVisitEmail';
import { checkinBooking } from '../server/core/bookingService/approvalCheckin';
import { processWalkInCheckin } from '../server/core/walkInCheckinService';
import { ensureSessionForBooking } from '../server/core/bookingService/sessionManager';
import { recalculateSessionFees, computeFeeBreakdown } from '../server/core/billing/unifiedFeeService';
import { broadcastBookingRosterUpdate } from '../server/core/websocket';
import { syncBookingInvoice } from '../server/core/billing/bookingInvoiceService';

function createMockReq(body: Record<string, unknown> = {}, params: Record<string, string> = {}, session: Record<string, unknown> = {}) {
  return {
    body,
    params,
    query: {},
    session: {
      user: { email: 'staff@test.com', name: 'Staff', role: 'admin' },
      ...session,
    },
    ip: '127.0.0.1',
  } as unknown;
}

function createMockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.set = vi.fn().mockReturnValue(res);
  return res as unknown as { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> };
}

async function callRouteHandler(router: unknown, method: string, path: string, req: unknown, res: unknown) {
  const routerObj = router as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> };
  const layer = routerObj.stack.find(
    (l) => l.route?.path === path && l.route?.methods[method]
  );
  if (!layer?.route) throw new Error(`Route ${method} ${path} not found. Available: ${routerObj.stack.map(l => l.route?.path).filter(Boolean).join(', ')}`);
  const handlers = layer.route.stack.map(s => s.handle);
  let stopped = false;
  for (const handler of handlers) {
    if (stopped) break;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };
      try {
        const result = handler(req, res, (err?: unknown) => {
          if (err) { stopped = true; reject(err); return; }
          settle();
        });
        if (result instanceof Promise) {
          result.then(() => settle()).catch((e: unknown) => { if (!settled) { settled = true; reject(e); } });
        }
      } catch (e) {
        if (!settled) { settled = true; reject(e); }
      }
    });
  }
}

describe('Walk-in Check-in Service (real implementation)', () => {
  let realProcessWalkInCheckin: typeof processWalkInCheckin;

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<typeof import('../server/core/walkInCheckinService')>('../server/core/walkInCheckinService');
    realProcessWalkInCheckin = actual.processWalkInCheckin;
  });

  it('successfully processes a walk-in check-in with member lookup and session creation', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', hubspot_id: 'hs-123', lifetime_visits: 5,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 6 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [{ content: 'VIP member', created_by_name: 'Admin' }] });

    const result = await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(result.success).toBe(true);
    expect(result.memberName).toBe('John Doe');
    expect(result.memberEmail).toBe('member@test.com');
    expect(result.lifetimeVisits).toBe(6);
    expect(result.tier).toBe('Gold');
    expect(result.pinnedNotes).toHaveLength(1);
    expect(result.pinnedNotes[0].content).toBe('VIP member');
  });

  it('returns member not found when member does not exist', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const result = await realProcessWalkInCheckin({
      memberId: 'nonexistent',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('Member not found');
  });

  it('returns alreadyCheckedIn when checked in within 2 minutes', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', hubspot_id: null, lifetime_visits: 5,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [{ id: 1, created_at: new Date().toISOString() }] }),
      };
      return fn(tx);
    });

    const result = await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'nfc',
    });

    expect(result.success).toBe(false);
    expect(result.alreadyCheckedIn).toBe(true);
  });

  it('syncs visit count to HubSpot when hubspot_id is present', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'Jane', last_name: 'Smith',
        membership_status: 'active', tier: 'Silver', hubspot_id: 'hs-456', lifetime_visits: 10,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 11 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'kiosk',
    });

    expect(updateHubSpotContactVisitCount).toHaveBeenCalledWith('hs-456', 11);
  });

  it('sends first visit email for trial members on first visit', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'trial@test.com', first_name: 'Trial', last_name: 'User',
        membership_status: 'trialing', tier: null, hubspot_id: null, lifetime_visits: 0,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 1 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(sendFirstVisitConfirmationEmail).toHaveBeenCalledWith('trial@test.com', { firstName: 'Trial' });
  });

  it('broadcasts check-in event to staff via WebSocket', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', hubspot_id: null, lifetime_visits: 5,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 6 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(broadcastToStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'walkin_checkin',
        data: expect.objectContaining({
          memberName: 'John Doe',
          memberEmail: 'member@test.com',
          source: 'qr',
        }),
      })
    );
  });

  it('sends push notification to member on successful check-in', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', hubspot_id: null, lifetime_visits: 5,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 6 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'nfc',
    });

    expect(notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'member@test.com',
        title: 'Check-In Complete',
        type: 'booking',
      })
    );
  });

  it('broadcasts member stats update via WebSocket', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', hubspot_id: null, lifetime_visits: 5,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 6 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(broadcastMemberStatsUpdated).toHaveBeenCalledWith(
      'member@test.com',
      expect.objectContaining({ lifetimeVisits: 6 })
    );
  });

  it('does not send first visit email for non-trial members', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'Active', last_name: 'Member',
        membership_status: 'active', tier: 'Gold', hubspot_id: null, lifetime_visits: 0,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 1 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(sendFirstVisitConfirmationEmail).not.toHaveBeenCalled();
  });

  it('does not sync to HubSpot when hubspot_id is null', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'No', last_name: 'HubSpot',
        membership_status: 'active', tier: 'Gold', hubspot_id: null, lifetime_visits: 5,
      }],
    });

    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn()
          .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [] })
          .mockResolvedValueOnce({ rows: [{ lifetime_visits: 6 }] }),
      };
      return fn(tx);
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    await realProcessWalkInCheckin({
      memberId: 'user-1',
      checkedInBy: 'staff@test.com',
      checkedInByName: 'Staff',
      source: 'qr',
    });

    expect(updateHubSpotContactVisitCount).not.toHaveBeenCalled();
  });
});

describe('NFC Check-in Route', () => {
  let nfcRouter: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/routes/nfcCheckin');
    nfcRouter = mod.default;
  });

  it('blocks check-in for cancelled membership', async () => {
    const { getSessionUser } = await import('../server/types/session');
    (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'cancelled@test.com', name: 'Cancel User' });

    mockExecute.mockResolvedValueOnce({
      rows: [{ id: 'user-1', membership_status: 'cancelled' }],
    });

    const req = createMockReq();
    const res = createMockRes();
    await callRouteHandler(nfcRouter, 'post', '/api/member/nfc-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('not active') })
    );
  });

  it('blocks check-in for suspended membership', async () => {
    const { getSessionUser } = await import('../server/types/session');
    (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'suspended@test.com', name: 'Suspended User' });

    mockExecute.mockResolvedValueOnce({
      rows: [{ id: 'user-2', membership_status: 'suspended' }],
    });

    const req = createMockReq();
    const res = createMockRes();
    await callRouteHandler(nfcRouter, 'post', '/api/member/nfc-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 404 when member not found', async () => {
    const { getSessionUser } = await import('../server/types/session');
    (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'unknown@test.com', name: 'Unknown' });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq();
    const res = createMockRes();
    await callRouteHandler(nfcRouter, 'post', '/api/member/nfc-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('successfully processes NFC check-in and calls processWalkInCheckin with source nfc', async () => {
    const { getSessionUser } = await import('../server/types/session');
    (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'member@test.com', name: 'John Doe' });

    mockExecute.mockResolvedValueOnce({
      rows: [{ id: 'user-1', membership_status: 'active' }],
    });

    mockProcessWalkInCheckin.mockResolvedValueOnce({
      success: true,
      memberName: 'John Doe',
      memberEmail: 'member@test.com',
      tier: 'Gold',
      lifetimeVisits: 6,
      pinnedNotes: [],
      membershipStatus: 'active',
    });

    const req = createMockReq();
    const res = createMockRes();
    await callRouteHandler(nfcRouter, 'post', '/api/member/nfc-checkin', req, res);

    expect(mockProcessWalkInCheckin).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: 'user-1',
        checkedInBy: 'member@test.com',
        source: 'nfc',
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        memberName: 'John Doe',
        tier: 'Gold',
        lifetimeVisits: 6,
        membershipStatus: 'active',
      })
    );
  });

  it('returns 409 when already checked in within cooldown', async () => {
    const { getSessionUser } = await import('../server/types/session');
    (getSessionUser as ReturnType<typeof vi.fn>).mockReturnValue({ email: 'member@test.com', name: 'John' });

    mockExecute.mockResolvedValueOnce({
      rows: [{ id: 'user-1', membership_status: 'active' }],
    });

    mockProcessWalkInCheckin.mockResolvedValueOnce({
      success: false,
      alreadyCheckedIn: true,
      error: 'Already checked in',
    });

    const req = createMockReq();
    const res = createMockRes();
    await callRouteHandler(nfcRouter, 'post', '/api/member/nfc-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyCheckedIn: true })
    );
  });
});

describe('QR Check-in Route', () => {
  let directAddRouter: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/routes/staffCheckin/directAdd');
    directAddRouter = mod.default;
  });

  it('requires memberId for QR check-in', async () => {
    const req = createMockReq({});
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/staff/qr-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('Member ID required') })
    );
  });

  it('blocks QR check-in for cancelled members', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ membership_status: 'cancelled' }],
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/staff/qr-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('successfully processes QR check-in and returns booking info', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ membership_status: 'active' }],
    });

    mockProcessWalkInCheckin.mockResolvedValueOnce({
      success: true,
      memberName: 'John Doe',
      memberEmail: 'member@test.com',
      tier: 'Gold',
      lifetimeVisits: 10,
      pinnedNotes: [],
      membershipStatus: 'active',
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 42,
        start_time: '10:00',
        end_time: '11:00',
        bay_name: 'Bay 1',
        resource_type: 'golf_simulator',
      }],
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/staff/qr-checkin', req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        memberName: 'John Doe',
        hasBooking: true,
        bookingId: 42,
      })
    );
    expect(mockProcessWalkInCheckin).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: 'user-1',
        source: 'qr',
      })
    );
  });

  it('processes QR check-in as walk-in when no booking exists', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ membership_status: 'active' }],
    });

    mockProcessWalkInCheckin.mockResolvedValueOnce({
      success: true,
      memberName: 'Walk In',
      memberEmail: 'walkin@test.com',
      tier: 'Silver',
      lifetimeVisits: 3,
      pinnedNotes: [],
      membershipStatus: 'active',
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({ memberId: 'user-2' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/staff/qr-checkin', req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        memberName: 'Walk In',
        hasBooking: false,
      })
    );
  });

  it('returns 409 when already checked in with no booking', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ membership_status: 'active' }],
    });

    mockProcessWalkInCheckin.mockResolvedValueOnce({
      success: false,
      alreadyCheckedIn: true,
      error: 'Already checked in',
      memberEmail: 'member@test.com',
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/staff/qr-checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyCheckedIn: true })
    );
  });
});

describe('Kiosk Check-in Route', () => {
  let kioskRouter: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/routes/kioskCheckin');
    kioskRouter = mod.default;
  });

  it('returns 404 for nonexistent member in preflight', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({ memberId: 'nonexistent' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin-preflight', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('blocks preflight for inactive membership', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'inactive@test.com', first_name: 'In', last_name: 'Active',
        membership_status: 'suspended', tier: null, lifetime_visits: 0,
      }],
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin-preflight', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns walk-in data when no booking exists during kiosk checkin', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'Walk', last_name: 'In',
        membership_status: 'active', tier: 'Gold', lifetime_visits: 5,
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockProcessWalkInCheckin.mockResolvedValueOnce({
      success: true,
      memberName: 'Walk In',
      memberEmail: 'member@test.com',
      tier: 'Gold',
      lifetimeVisits: 6,
      pinnedNotes: [],
      membershipStatus: 'active',
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin', req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        memberName: 'Walk In',
        upcomingBooking: null,
      })
    );
    expect(mockProcessWalkInCheckin).toHaveBeenCalledWith(
      expect.objectContaining({
        memberId: 'user-1',
        source: 'kiosk',
      })
    );
  });

  it('returns 402 when outstanding fees block booking check-in', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', lifetime_visits: 10,
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: 100, start_time: '10:00', end_time: '11:00',
        declared_player_count: 2, owner_email: 'member@test.com', resource_name: 'Bay 1',
        resource_type: 'golf_simulator', owner_name: 'John Doe', unpaid_fee_cents: 7500,
      }],
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'OUTSTANDING_BALANCE',
        requiresPayment: true,
      })
    );
  });

  it('checks in successfully for booking with no outstanding fees', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', lifetime_visits: 10,
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: 100, start_time: '10:00', end_time: '11:00',
        declared_player_count: 2, owner_email: 'member@test.com', resource_name: 'Bay 1',
        resource_type: 'golf_simulator', owner_name: 'John Doe', unpaid_fee_cents: 0,
      }],
    });

    (checkinBooking as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: true,
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{ lifetime_visits: 11 }],
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin', req, res);

    expect(checkinBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 1,
        targetStatus: 'attended',
        skipRosterCheck: true,
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        memberName: 'John Doe',
        lifetimeVisits: 11,
      })
    );
  });

  it('returns 409 when booking already attended', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-1', email: 'member@test.com', first_name: 'John', last_name: 'Doe',
        membership_status: 'active', tier: 'Gold', lifetime_visits: 10,
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: 100, start_time: '10:00', end_time: '11:00',
        declared_player_count: 2, owner_email: 'member@test.com', resource_name: 'Bay 1',
        resource_type: 'golf_simulator', owner_name: 'John Doe', unpaid_fee_cents: 0,
      }],
    });

    (checkinBooking as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      success: false,
      alreadyProcessed: true,
    });

    const req = createMockReq({ memberId: 'user-1' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ alreadyCheckedIn: true })
    );
  });

  it('blocks non-owner participant with unpaid fees', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'user-2', email: 'guest@test.com', first_name: 'Guest', last_name: 'User',
        membership_status: 'active', tier: 'Gold', lifetime_visits: 3,
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: 100, start_time: '10:00', end_time: '11:00',
        declared_player_count: 2, owner_email: 'owner@test.com', resource_name: 'Bay 1',
        resource_type: 'golf_simulator', owner_name: 'Owner', unpaid_fee_cents: 5000,
      }],
    });

    const req = createMockReq({ memberId: 'user-2' });
    const res = createMockRes();
    await callRouteHandler(kioskRouter, 'post', '/api/kiosk/checkin', req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'NON_OWNER_UNPAID' })
    );
  });
});

describe('Direct Add Participant', () => {
  let directAddRouter: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/routes/staffCheckin/directAdd');
    directAddRouter = mod.default;
  });

  it('rejects invalid participant type', async () => {
    const req = createMockReq({ participantType: 'invalid' }, { id: '1' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('participantType must be member or guest') })
    );
  });

  it('returns 404 when booking not found for direct add', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({ participantType: 'guest', guestName: 'Guest 1' }, { id: '999' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('requires guestName for guest participants', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session_id: 100, resource_id: 1, request_date: '2025-06-15',
        owner_email: 'owner@test.com', user_name: 'Owner', start_time: '10:00', end_time: '11:00',
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{ tier_name: 'Gold', guest_passes: 5 }],
    });

    const { enforceSocialTierRules } = await import('../server/core/bookingService/tierRules');
    (enforceSocialTierRules as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ allowed: true });

    const req = createMockReq({ participantType: 'guest' }, { id: '1' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('guestName required') })
    );
  });

  it('requires memberEmail for member participants', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session_id: 100, resource_id: 1, request_date: '2025-06-15',
        owner_email: 'owner@test.com', user_name: 'Owner', start_time: '10:00', end_time: '11:00',
      }],
    });

    const req = createMockReq({ participantType: 'member' }, { id: '1' });
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('memberEmail required') })
    );
  });

  it('successfully adds a member participant with session creation and fee recalculation', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session_id: null, resource_id: 1, request_date: '2025-06-15',
        owner_email: 'owner@test.com', user_name: 'Owner', start_time: '10:00', end_time: '11:00',
      }],
    });

    (ensureSessionForBooking as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId: 200 });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'member-1', email: 'newmember@test.com', first_name: 'New', last_name: 'Member',
        tier_name: 'Gold', can_book_simulators: true,
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    mockExecute.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const req = createMockReq(
      { participantType: 'member', memberEmail: 'newmember@test.com' },
      { id: '1' }
    );
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(ensureSessionForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 1,
        resourceId: 1,
      })
    );
    expect(recalculateSessionFees).toHaveBeenCalledWith(200, 'staff_add_member');
    expect(broadcastBookingRosterUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 1,
        sessionId: 200,
        action: 'participant_added',
      })
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        sessionId: 200,
      })
    );
  });

  it('uses existing session when session_id is already set', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session_id: 100, resource_id: 1, request_date: '2025-06-15',
        owner_email: 'owner@test.com', user_name: 'Owner', start_time: '10:00', end_time: '11:00',
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'member-1', email: 'member2@test.com', first_name: 'Existing', last_name: 'Member',
        tier_name: 'Gold', can_book_simulators: true,
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    mockExecute.mockResolvedValueOnce({ rows: [{ id: 1 }] });

    const req = createMockReq(
      { participantType: 'member', memberEmail: 'member2@test.com' },
      { id: '1' }
    );
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(ensureSessionForBooking).not.toHaveBeenCalled();
    expect(recalculateSessionFees).toHaveBeenCalledWith(100, 'staff_add_member');
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        sessionId: 100,
      })
    );
  });

  it('returns duplicate error when member already in booking', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session_id: 100, resource_id: 1, request_date: '2025-06-15',
        owner_email: 'owner@test.com', user_name: 'Owner', start_time: '10:00', end_time: '11:00',
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'member-1', email: 'existing@test.com', first_name: 'Existing', last_name: 'Member',
        tier_name: 'Gold', can_book_simulators: true,
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [{ id: 99 }] });

    const req = createMockReq(
      { participantType: 'member', memberEmail: 'existing@test.com' },
      { id: '1' }
    );
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('already in this booking') })
    );
  });

  it('requires override reason for member whose tier cannot book simulators', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        session_id: 100, resource_id: 1, request_date: '2025-06-15',
        owner_email: 'owner@test.com', user_name: 'Owner', start_time: '10:00', end_time: '11:00',
      }],
    });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        id: 'member-1', email: 'social@test.com', first_name: 'Social', last_name: 'Member',
        tier_name: 'Social', can_book_simulators: false,
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq(
      { participantType: 'member', memberEmail: 'social@test.com' },
      { id: '1' }
    );
    const res = createMockRes();
    await callRouteHandler(directAddRouter, 'post', '/api/bookings/:id/staff-direct-add', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ requiresOverride: true })
    );
  });
});

describe('Staff Check-in Context (Full Flow)', () => {
  let contextRouter: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../server/routes/staffCheckin/context');
    contextRouter = mod.default;
  });

  it('returns 404 when booking not found', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({}, { id: '999' });
    const res = createMockRes();
    await callRouteHandler(contextRouter, 'get', '/api/bookings/:id/staff-checkin-context', req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'Booking not found' })
    );
  });

  it('creates session via ensureSessionForBooking when session_id is null', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: null, resource_id: 5, owner_id: 'user-1',
        owner_email: 'owner@test.com', owner_name: 'Owner', booking_date: '2025-06-15',
        start_time: '10:00', end_time: '11:00', member_notes: null,
        declared_player_count: 2, resource_name: 'Bay 1',
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [{ id: 'user-1' }] });

    (ensureSessionForBooking as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ sessionId: 200 });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [{ count: '0' }] });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        participant_id: 1, display_name: 'Guest 2', participant_type: 'guest',
        user_id: null, payment_status: 'pending', waiver_reviewed_at: null,
        used_guest_pass: false, cached_total_fee: '0',
      }],
    });

    (computeFeeBreakdown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalCents: 0,
      participants: [],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({}, { id: '1' });
    const res = createMockRes();
    await callRouteHandler(contextRouter, 'get', '/api/bookings/:id/staff-checkin-context', req, res);

    expect(ensureSessionForBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingId: 1,
        resourceId: 5,
        ownerEmail: 'owner@test.com',
        source: 'staff_manual',
      })
    );
    expect(recalculateSessionFees).toHaveBeenCalledWith(200, 'checkin');
    expect(res.json).toHaveBeenCalled();
  });

  it('skips session creation when session_id already exists', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: 100, resource_id: 5, owner_id: 'user-1',
        owner_email: 'owner@test.com', owner_name: 'Owner', booking_date: '2025-06-15',
        start_time: '10:00', end_time: '11:00', member_notes: null,
        declared_player_count: 1, resource_name: 'Bay 1',
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({
      rows: [{
        participant_id: 1, display_name: 'Owner', participant_type: 'owner',
        user_id: 'user-1', payment_status: 'paid', waiver_reviewed_at: null,
        used_guest_pass: false, cached_total_fee: '0',
      }],
    });

    (computeFeeBreakdown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalCents: 0,
      participants: [],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({}, { id: '1' });
    const res = createMockRes();
    await callRouteHandler(contextRouter, 'get', '/api/bookings/:id/staff-checkin-context', req, res);

    expect(ensureSessionForBooking).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();
  });

  it('returns billing data with participant fees and outstanding totals', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{
        booking_id: 1, session_id: 100, resource_id: 5, owner_id: 'user-1',
        owner_email: 'owner@test.com', owner_name: 'Owner', booking_date: '2025-06-15',
        start_time: '10:00', end_time: '11:00', member_notes: null,
        declared_player_count: 2, resource_name: 'Bay 1',
      }],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({
      rows: [
        {
          participant_id: 1, display_name: 'Owner', participant_type: 'owner',
          user_id: 'user-1', payment_status: 'paid', waiver_reviewed_at: null,
          used_guest_pass: false, cached_total_fee: '0',
        },
        {
          participant_id: 2, display_name: 'Guest 2', participant_type: 'guest',
          user_id: null, payment_status: 'pending', waiver_reviewed_at: null,
          used_guest_pass: false, cached_total_fee: '75',
        },
      ],
    });

    (computeFeeBreakdown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      totalCents: 7500,
      participants: [
        { participantId: 1, totalCents: 0, overageCents: 0, guestCents: 0 },
        { participantId: 2, totalCents: 7500, overageCents: 0, guestCents: 7500, tierName: 'Guest' },
      ],
    });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    mockExecute.mockResolvedValueOnce({ rows: [] });

    const req = createMockReq({}, { id: '1' });
    const res = createMockRes();
    await callRouteHandler(contextRouter, 'get', '/api/bookings/:id/staff-checkin-context', req, res);

    expect(computeFeeBreakdown).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 100,
        source: 'checkin',
      })
    );
    const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(jsonArg).toBeDefined();
    expect(jsonArg.bookingId).toBe(1);
    expect(jsonArg.sessionId).toBe(100);
    expect(jsonArg.participants).toHaveLength(2);
    expect(jsonArg.totalOutstanding).toBe(75);
    expect(jsonArg.hasUnpaidBalance).toBe(true);
    expect(jsonArg.ownerEmail).toBe('owner@test.com');
  });
});

describe('Push Subscription Lifecycle (real route handlers)', () => {
  let pushRouter: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    const actual = await vi.importActual<{ default: unknown }>('../server/routes/push');
    pushRouter = actual.default;
  });

  it('returns VAPID public key from environment', async () => {
    const originalKey = process.env.VAPID_PUBLIC_KEY;
    process.env.VAPID_PUBLIC_KEY = 'test-vapid-public-key-123';

    const req = createMockReq();
    const res = createMockRes();
    const routerObj = pushRouter as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: Function }> } }> };
    const layer = routerObj.stack.find(l => l.route?.path === '/api/push/vapid-public-key' && l.route?.methods['get']);
    layer!.route!.stack[0].handle(req, res);

    expect(res.json).toHaveBeenCalledWith({ publicKey: 'test-vapid-public-key-123' });

    if (originalKey) process.env.VAPID_PUBLIC_KEY = originalKey;
    else delete process.env.VAPID_PUBLIC_KEY;
  });

  it('registers a push subscription via upsert on endpoint conflict', async () => {
    const onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    const values = vi.fn().mockReturnValue({ onConflictDoUpdate });
    mockInsert.mockReturnValueOnce({ values });

    const req = createMockReq({
      subscription: {
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
        keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
      },
    });
    (req as { session: Record<string, unknown> }).session = { user: { email: 'member@test.com' } };
    const res = createMockRes();
    await callRouteHandler(pushRouter, 'post', '/api/push/subscribe', req, res);

    expect(mockInsert).toHaveBeenCalled();
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        userEmail: 'member@test.com',
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
        p256dh: 'test-p256dh-key',
        auth: 'test-auth-key',
      })
    );
    expect(onConflictDoUpdate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('returns 400 when subscription object is missing', async () => {
    const req = createMockReq({});
    (req as { session: Record<string, unknown> }).session = { user: { email: 'member@test.com' } };
    const res = createMockRes();
    await callRouteHandler(pushRouter, 'post', '/api/push/subscribe', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'subscription is required' })
    );
  });

  it('unsubscribes by deleting endpoint from push_subscriptions table', async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    mockDelete.mockReturnValueOnce({ where });

    const req = createMockReq({ endpoint: 'https://fcm.googleapis.com/endpoint1' });
    (req as { session: Record<string, unknown> }).session = { user: { email: 'member@test.com' } };
    const res = createMockRes();
    await callRouteHandler(pushRouter, 'post', '/api/push/unsubscribe', req, res);

    expect(mockDelete).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });

  it('returns 400 when endpoint is missing for unsubscribe', async () => {
    const req = createMockReq({});
    (req as { session: Record<string, unknown> }).session = { user: { email: 'member@test.com' } };
    const res = createMockRes();
    await callRouteHandler(pushRouter, 'post', '/api/push/unsubscribe', req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'endpoint is required' })
    );
  });
});
