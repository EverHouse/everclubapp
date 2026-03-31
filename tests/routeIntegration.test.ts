// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { csrfOriginCheck, securityMiddleware } from '../server/middleware/security';

const mockDbSelect = vi.fn();
const mockDbExecute = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();
const mockDbDelete = vi.fn();

vi.mock('../server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
    query: vi.fn(),
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAndRespond: vi.fn((_req: unknown, res: { status: (code: number) => { json: (data: unknown) => void } }, code: number, msg: string) => {
    res.status(code).json({ error: msg });
  }),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
  pool: {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    on: vi.fn(),
  },
  stripSslMode: (s: string) => s,
}));

vi.mock('../server/core/auditLog', () => ({
  logFromRequest: vi.fn(),
  logMemberAction: vi.fn(),
  logSystemAction: vi.fn(),
  logBillingAudit: vi.fn(),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
  getErrorCode: () => 'UNKNOWN',
  safeErrorDetail: (e: unknown) => String(e),
  getErrorStatusCode: () => 500,
}));

vi.mock('../server/core/retry', () => ({
  withRetry: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/queryCache', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCache: vi.fn(),
  invalidateCache: vi.fn(),
}));

vi.mock('../server/core/websocket', () => ({
  broadcastMemberStatsUpdated: vi.fn(),
  broadcastAvailabilityUpdate: vi.fn(),
  broadcastAnnouncementUpdate: vi.fn(),
  broadcastBillingUpdate: vi.fn(),
  broadcastCafeMenuUpdate: vi.fn(),
}));

vi.mock('../server/core/notificationService', () => ({
  isSyntheticEmail: vi.fn().mockReturnValue(false),
  notifyMember: vi.fn(),
  notifyAllStaff: vi.fn(),
}));

vi.mock('../server/core/tierService', () => ({
  getTierLimits: vi.fn().mockResolvedValue({ guest_passes_per_year: 10 }),
  checkDailyBookingLimit: vi.fn().mockResolvedValue({ allowed: true }),
  invalidateTierCache: vi.fn(),
}));

vi.mock('../server/core/tierRegistry', () => ({
  invalidateTierRegistry: vi.fn(),
}));

vi.mock('../server/core/settingsHelper', () => ({
  invalidateSettingsCache: vi.fn(),
}));

vi.mock('../server/walletPass/apnPushService', () => ({
  sendPassUpdateForMemberByEmail: vi.fn(),
}));

vi.mock('../server/core/utils/emailNormalization', () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
  getAlternateDomainEmail: vi.fn().mockReturnValue(null),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  isPlaceholderGuestName: vi.fn().mockReturnValue(false),
  PRICING: {
    OVERAGE_RATE_DOLLARS: 15,
    OVERAGE_RATE_CENTS: 1500,
    GUEST_FEE_DOLLARS: 25,
    GUEST_FEE_CENTS: 2500,
    OVERAGE_BLOCK_MINUTES: 30,
  },
  computeOverageCents: vi.fn().mockReturnValue(0),
  computeOverageDollars: vi.fn().mockReturnValue(0),
  updateOverageRate: vi.fn(),
  updateGuestFee: vi.fn(),
}));

vi.mock('../server/middleware/rateLimiting', () => {
  const passthrough = (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    globalRateLimiter: passthrough,
    authRateLimiterByIp: passthrough,
    authRateLimiter: [],
    bookingRateLimiter: passthrough,
    memberLookupRateLimiter: passthrough,
    sensitiveActionRateLimiter: passthrough,
    checkoutRateLimiter: passthrough,
    subscriptionCreationRateLimiter: passthrough,
    paymentRateLimiter: passthrough,
    apiLimiter: passthrough,
    loginLimiter: passthrough,
    clientErrorLimiter: passthrough,
  };
});

vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue(null),
  getHubSpotClientWithFallback: vi.fn().mockResolvedValue(null),
  getGoogleCalendarClient: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('../server/core/hubspot/contacts', () => ({
  syncSmsPreferencesToHubSpot: vi.fn(),
  syncProfileDetailsToHubSpot: vi.fn(),
}));

vi.mock('../server/core/hubspot/members', () => ({
  findOrCreateHubSpotContact: vi.fn(),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn().mockResolvedValue({
    paymentIntents: { create: vi.fn(), retrieve: vi.fn(), cancel: vi.fn() },
    customers: { create: vi.fn(), list: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    prices: { list: vi.fn().mockResolvedValue({ data: [] }) },
  }),
}));

vi.mock('../server/core/stripe/customers', () => ({
  isPlaceholderEmail: vi.fn().mockReturnValue(false),
  listCustomerPaymentMethods: vi.fn().mockResolvedValue([]),
  resolveUserByEmail: vi.fn().mockResolvedValue(null),
  syncCustomerMetadataToStripe: vi.fn(),
}));

vi.mock('../server/core/stripe/products', () => ({
  syncMembershipTiersToStripe: vi.fn(),
  getTierSyncStatus: vi.fn(),
  cleanupOrphanStripeProducts: vi.fn(),
  syncTierFeaturesToStripe: vi.fn(),
  syncCafeItemsToStripe: vi.fn(),
  pullTierFeaturesFromStripe: vi.fn(),
  pullCafeItemsFromStripe: vi.fn(),
  archiveAllStalePrices: vi.fn(),
}));

vi.mock('../server/core/stripe/autoPush', () => ({
  autoPushTierToStripe: vi.fn(),
  autoPushFeeToStripe: vi.fn(),
}));

vi.mock('../server/core/stripe/groupBilling', () => ({
  getCorporateVolumePrice: vi.fn(),
}));

vi.mock('../server/core/stripe', () => ({
  createPaymentIntent: vi.fn(),
  confirmPaymentSuccess: vi.fn(),
  createInvoiceWithLineItems: vi.fn(),
}));

vi.mock('../server/core/stripe/paymentRepository', () => ({
  getPaymentByIntentId: vi.fn(),
}));

vi.mock('../server/core/billing/updateOverageRate', () => ({
  updateOverageRate: vi.fn(),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  syncBookingInvoice: vi.fn(),
  finalizeAndPayInvoice: vi.fn(),
  getBookingInvoiceId: vi.fn(),
}));

vi.mock('../server/core/billing/guestPassHoldService', () => ({
  createGuestPassHold: vi.fn(),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  computeFeeBreakdown: vi.fn(),
  recalculateSessionFees: vi.fn(),
}));

vi.mock('../server/core/bookingService/createBooking', () => ({
  sanitizeAndResolveParticipants: vi.fn().mockResolvedValue([]),
  checkParticipantOverlaps: vi.fn().mockResolvedValue([]),
  checkParticipantDailyLimits: vi.fn().mockResolvedValue([]),
  prepareBookingCreation: vi.fn().mockResolvedValue({ resolvedEmail: 'test@example.com' }),
  acquireLocksAndCheckConflicts: vi.fn().mockResolvedValue({ conflicts: [] }),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  ensureSessionForBooking: vi.fn(),
  createSessionWithUsageTracking: vi.fn(),
}));

vi.mock('../server/core/bookingService/bookingCreationGuard', () => ({
  acquireBookingLocks: vi.fn().mockResolvedValue({ release: vi.fn() }),
  BookingConflictError: class extends Error {},
}));

vi.mock('../server/core/bookingService/bookingQueryBuilder', () => ({
  buildUserEmailConditions: vi.fn().mockReturnValue(undefined),
}));

vi.mock('../server/core/bookingEvents', () => ({
  bookingEvents: { emit: vi.fn() },
}));

vi.mock('../server/core/bookingService/bookingStateService', () => ({
  BookingStateService: { validateTransition: vi.fn().mockReturnValue({ valid: true }) },
}));

vi.mock('../server/core/errors', () => ({
  GuestPassHoldError: class extends Error {},
}));

vi.mock('../server/core/calendar/index', () => ({
  getCalendarBusyTimes: vi.fn().mockResolvedValue([]),
  getCalendarIdByName: vi.fn().mockReturnValue(null),
  CALENDAR_CONFIG: {},
}));

vi.mock('../server/core/availabilityService', () => ({
  generateSlotsForResource: vi.fn().mockReturnValue([]),
  getBusinessHoursFromSettings: vi.fn().mockResolvedValue({ open: '08:00', close: '20:00' }),
}));

vi.mock('../server/core/memberService/lifetimeVisitStats', () => ({
  getLifetimeVisitStats: vi.fn().mockResolvedValue(null),
}));

vi.mock('../server/core/dataIntegrity', () => ({
  bulkPushToHubSpot: vi.fn(),
}));

vi.mock('../server/core/supabase/client', () => ({
  isSupabaseAvailable: vi.fn().mockResolvedValue(false),
  getSupabaseAdmin: vi.fn(),
}));

vi.mock('../server/emails/paymentEmails', () => ({
  sendPurchaseReceipt: vi.fn(),
}));

vi.mock('../server/core/errorAlerts', () => ({
  alertOnExternalServiceError: vi.fn(),
}));

vi.mock('../server/core/googleSheets/announcementSync', () => ({
  createAnnouncementSheet: vi.fn(),
  getLinkedSheetId: vi.fn().mockResolvedValue(null),
  getSheetUrl: vi.fn().mockReturnValue(null),
  syncFromSheet: vi.fn(),
  syncToSheet: vi.fn(),
  pushSingleAnnouncement: vi.fn(),
  deleteFromSheet: vi.fn(),
}));

vi.mock('../shared/constants/tiers', () => ({
  normalizeTierName: (t: string | null | undefined) => t || null,
}));

vi.mock('../server/utils/tierUtils', () => ({
  normalizeTierName: (t: string | null | undefined) => t || null,
}));

vi.mock('../server/utils/urlUtils', () => ({
  getAppBaseUrl: vi.fn().mockReturnValue('http://localhost:3000'),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2026-03-31'),
  getPacificDateParts: vi.fn().mockReturnValue({ hour: 10, minute: 0 }),
  formatDateDisplayWithDay: vi.fn().mockReturnValue('Tue, Mar 31'),
  formatTime12Hour: vi.fn().mockReturnValue('10:00 AM'),
  formatDatePacific: vi.fn().mockReturnValue('2026-03-31'),
  createPacificDate: vi.fn().mockReturnValue(new Date()),
  CLUB_TIMEZONE: 'America/Los_Angeles',
  getPacificMidnightUTC: vi.fn().mockReturnValue(new Date()),
  addDaysToPacificDate: vi.fn().mockReturnValue('2026-04-01'),
}));

vi.mock('../server/utils/dateTimeUtils', () => ({
  ensureDateString: vi.fn((d: string) => d),
  ensureTimeString: vi.fn((t: string) => t),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn().mockReturnValue('{}'),
  toTextArrayLiteral: vi.fn().mockReturnValue('{}'),
}));

vi.mock('../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn(),
}));

vi.mock('../server/replit_integrations/auth', () => ({
  isAuthenticated: (req: { session?: { user?: unknown } }, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
    next();
  },
  isAdmin: async (req: { session?: { user?: { email?: string } } }, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
    const email = req.session.user.email?.toLowerCase() || '';
    if (email === 'admin@everclub.app') return next();
    return res.status(403).json({ message: 'Forbidden: Admin access required' });
  },
  isStaffOrAdmin: async (req: { session?: { user?: { email?: string } } }, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
    const email = req.session.user.email?.toLowerCase() || '';
    if (email === 'admin@everclub.app' || email === 'staff@everclub.app') return next();
    return res.status(403).json({ message: 'Forbidden: Staff access required' });
  },
  isAdminEmail: async (email: string) => email === 'admin@everclub.app',
  getSession: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  getAuthPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [] }), on: vi.fn() }),
}));

vi.mock('../server/core/middleware', () => ({
  isAuthenticated: (req: { session?: { user?: unknown } }, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
    next();
  },
  isAdmin: async (req: { session?: { user?: { email?: string } } }, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
    const email = req.session.user.email?.toLowerCase() || '';
    if (email === 'admin@everclub.app') return next();
    return res.status(403).json({ message: 'Forbidden: Admin access required' });
  },
  isStaffOrAdmin: async (req: { session?: { user?: { email?: string } } }, res: { status: (code: number) => { json: (data: unknown) => void } }, next: () => void) => {
    if (!req.session?.user) return res.status(401).json({ message: 'Unauthorized' });
    const email = req.session.user.email?.toLowerCase() || '';
    if (email === 'admin@everclub.app' || email === 'staff@everclub.app') return next();
    return res.status(403).json({ message: 'Forbidden: Staff access required' });
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(vi.fn((..._args: unknown[]) => ''), { join: vi.fn() }),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  desc: vi.fn(),
  asc: vi.fn(),
  lt: vi.fn(),
  gte: vi.fn(),
  lte: vi.fn(),
  isNull: vi.fn(),
  inArray: vi.fn(),
  SQL: class {},
}));

vi.mock('../shared/schema', () => ({
  users: { id: 'id', email: 'email', firstName: 'first_name', lastName: 'last_name', tier: 'tier', membershipStatus: 'membership_status', archivedAt: 'archived_at', tags: 'tags', stripeSubscriptionId: 'stripe_subscription_id', stripeCustomerId: 'stripe_customer_id', hubspotId: 'hubspot_id', phone: 'phone' },
  bookingRequests: { id: 'id', userEmail: 'user_email', userName: 'user_name', requestDate: 'request_date', startTime: 'start_time', endTime: 'end_time', status: 'status', calendarEventId: 'calendar_event_id', resourceId: 'resource_id', trackmanBookingId: 'trackman_booking_id', staffNotes: 'staff_notes', sessionId: 'session_id', userId: 'user_id', isUnmatched: 'is_unmatched' },
  resources: { id: 'id', name: 'name', description: 'description', type: 'type', createdAt: 'created_at' },
  guestPasses: { id: 'id', memberEmail: 'member_email', passesUsed: 'passes_used', passesTotal: 'passes_total' },
  staffUsers: { id: 'id', email: 'email', isActive: 'is_active', role: 'role' },
  systemSettings: { key: 'key', value: 'value', category: 'category', updatedAt: 'updated_at' },
  faqs: { id: 'id', isActive: 'is_active', sortOrder: 'sort_order' },
  galleryImages: { id: 'id', imageUrl: 'image_url', category: 'category', title: 'title', sortOrder: 'sort_order', isActive: 'is_active' },
  announcements: { id: 'id', showAsBanner: 'show_as_banner' },
  membershipTiers: { id: 'id', slug: 'slug', isActive: 'is_active', showOnMembershipPage: 'show_on_membership_page' },
  events: {},
  eventRsvps: {},
  wellnessClasses: {},
  wellnessEnrollments: {},
  guestCheckIns: {},
  bookingParticipants: {},
  availabilityBlocks: {},
  guests: {},
}));

vi.mock('../shared/models/scheduling', () => ({
  bookingParticipants: {},
  bookingSessions: {},
  resources: { id: 'id', name: 'name' },
  guests: {},
}));

vi.mock('../shared/models/system', () => ({
  systemSettings: { key: 'key', value: 'value', category: 'category' },
}));

vi.mock('../shared/validators/booking', () => ({
  createBookingRequestSchema: {
    safeParse: vi.fn().mockReturnValue({
      success: true,
      data: {
        user_email: 'member@example.com',
        resource_id: 1,
        request_date: '2026-04-01',
        start_time: '10:00',
        duration_minutes: 60,
      },
    }),
  },
}));

vi.mock('../shared/validators/payments', () => ({
  quickChargeSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  confirmQuickChargeSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  attachEmailSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  chargeSavedCardPosSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  sendReceiptSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  chargeSubscriptionInvoiceSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  createPaymentIntentSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  confirmPaymentSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  cancelPaymentIntentSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  createCustomerSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  chargeSavedCardSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
  markBookingPaidSchema: { safeParse: vi.fn().mockReturnValue({ success: true, data: {} }) },
}));

type SessionUser = { id?: string; email: string; role?: string; tier?: string };

function createAppWithRoutes(router: express.Router, sessionUser?: SessionUser) {
  const app = express();
  app.use(express.json());
  app.use(securityMiddleware);
  app.use(csrfOriginCheck);
  app.use((req, _res, next) => {
    const session: Record<string, unknown> = {
      user: sessionUser || undefined,
      cookie: { maxAge: 2592000000 },
      save: vi.fn((cb: (err: Error | null) => void) => cb(null)),
      regenerate: vi.fn((cb: (err: Error | null) => void) => cb(null)),
      destroy: vi.fn((cb: (err: Error | null) => void) => cb(null)),
    };
    (req as Record<string, unknown>).session = session;
    next();
  });
  app.use(router);
  return app;
}

function setDefaultDbMocks() {
  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        limit: vi.fn().mockResolvedValue([]),
      }),
      orderBy: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
      leftJoin: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
            offset: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([]),
            }),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
      limit: vi.fn().mockResolvedValue([]),
    }),
  }));
  mockDbExecute.mockResolvedValue({ rows: [] });
  mockDbInsert.mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      onConflictDoNothing: vi.fn().mockResolvedValue([]),
    }),
  }));
  mockDbUpdate.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
  }));
  mockDbDelete.mockImplementation(() => ({
    where: vi.fn().mockResolvedValue([]),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  setDefaultDbMocks();
});


describe('Booking Route Integration Tests', () => {
  describe('POST /api/booking-requests', () => {
    it('returns 401 with Unauthorized message for unauthenticated requests', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter);

      const res = await request(app)
        .post('/api/booking-requests')
        .set('Origin', 'https://everclub.app')
        .send({ resource_id: 1, request_date: '2026-04-01', start_time: '10:00', duration_minutes: 60 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('passes auth guard for authenticated member', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/booking-requests')
        .set('Origin', 'https://everclub.app')
        .send({
          user_email: 'member@example.com',
          resource_id: 1,
          request_date: '2026-04-01',
          start_time: '10:00',
          duration_minutes: 60,
        });

      expect(res.status).not.toBe(401);
    });

    it('is blocked by CSRF when no Origin header on POST', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/booking-requests')
        .send({ resource_id: 1, request_date: '2026-04-01', start_time: '10:00', duration_minutes: 60 });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Origin verification failed');
    });
  });

  describe('PUT /api/booking-requests/:id/member-cancel', () => {
    it('returns 401 with message for unauthenticated requests', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter);

      const res = await request(app)
        .put('/api/booking-requests/1/member-cancel')
        .set('Origin', 'https://everclub.app')
        .send({});

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 404 with error object when booking not found', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter, { email: 'member@example.com', role: 'member' });

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }));

      const res = await request(app)
        .put('/api/booking-requests/999/member-cancel')
        .set('Origin', 'https://everclub.app')
        .send({});

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('not found');
    });

    it('is blocked by CSRF when mutative PUT has no Origin', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .put('/api/booking-requests/1/member-cancel')
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Origin verification failed');
    });
  });

  describe('GET /api/booking-requests', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter);

      const res = await request(app).get('/api/booking-requests?user_email=test@example.com');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 400 with error when missing required user_email param', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/booking-requests');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });
});


describe('Member Route Integration Tests', () => {
  describe('GET /api/members/:email/details', () => {
    it('returns 401 with message for unauthenticated requests', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter);

      const res = await request(app).get('/api/members/test@example.com/details');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('passes auth for authenticated member requesting own details', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/members/member@example.com/details');

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('returns synthetic response for special trackman email addresses', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/members/private-event@resolved/details');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('synthetic', true);
      expect(res.body).toHaveProperty('email', 'private-event@resolved');
      expect(res.body).toHaveProperty('firstName', 'Private');
    });
  });

  describe('PUT /api/members/:email/contact-info', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter);

      const res = await request(app)
        .put('/api/members/test@example.com/contact-info')
        .set('Origin', 'https://everclub.app')
        .send({ firstName: 'Test' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 for non-staff members', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .put('/api/members/other@example.com/contact-info')
        .set('Origin', 'https://everclub.app')
        .send({ firstName: 'Changed' });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Staff');
    });

    it('allows staff past auth guard on contact-info route', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'staff@everclub.app', role: 'staff' });

      const res = await request(app)
        .put('/api/members/target@example.com/contact-info')
        .set('Origin', 'https://everclub.app')
        .send({ firstName: 'Updated', lastName: 'User', phone: '555-1234' });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('returns 400 when no valid updates provided', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'staff@everclub.app', role: 'staff' });

      const res = await request(app)
        .put('/api/members/target@example.com/contact-info')
        .set('Origin', 'https://everclub.app')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/members/search', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter);

      const res = await request(app).get('/api/members/search?query=test');

      expect(res.status).toBe(401);
    });

    it('returns empty array for empty query from authenticated user', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/members/search');

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe('GET /api/members/directory', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter);

      const res = await request(app).get('/api/members/directory');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 for non-staff members', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/members/directory');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('message');
    });

    it('allows staff to access directory', async () => {
      const { default: membersRouter } = await import('../server/routes/members');
      const app = createAppWithRoutes(membersRouter, { email: 'staff@everclub.app', role: 'staff' });

      mockDbExecute.mockResolvedValue({ rows: [] });

      const res = await request(app).get('/api/members/directory');

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});


describe('Guest Pass Route Integration Tests', () => {
  describe('GET /api/guest-passes/:email', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter);

      const res = await request(app).get('/api/guest-passes/member@example.com');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 when member requests another users passes', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter, { email: 'member@example.com', role: 'member' });

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }));

      const res = await request(app).get('/api/guest-passes/other@example.com');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('own guest passes');
    });
  });

  describe('POST /api/guest-passes/:email/use (consume)', () => {
    it('returns 401 for unauthenticated consume requests', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter);

      const res = await request(app)
        .post('/api/guest-passes/member@example.com/use')
        .set('Origin', 'https://everclub.app')
        .send({ guest_name: 'Test Guest' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 when member tries to consume another users pass', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter, { email: 'member@example.com', role: 'member' });

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }));

      const res = await request(app)
        .post('/api/guest-passes/other@example.com/use')
        .set('Origin', 'https://everclub.app')
        .send({ guest_name: 'Test Guest' });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('own guest passes');
    });

    it('passes auth and CSRF for own pass consumption', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/guest-passes/member@example.com/use')
        .set('Origin', 'https://everclub.app')
        .send({ guest_name: 'Test Guest' });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });

    it('returns 400 when no passes remaining', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter, { email: 'member@example.com', role: 'member' });

      mockDbUpdate.mockImplementation(() => ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }),
      }));

      const res = await request(app)
        .post('/api/guest-passes/member@example.com/use')
        .set('Origin', 'https://everclub.app')
        .send({ guest_name: 'Test Guest' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('No guest passes remaining');
    });

    it('is blocked by CSRF on POST without Origin', async () => {
      const { default: guestPassesRouter } = await import('../server/routes/guestPasses');
      const app = createAppWithRoutes(guestPassesRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/guest-passes/member@example.com/use')
        .send({ guest_name: 'Test Guest' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Origin verification failed');
    });
  });
});


describe('Public Route Integration Tests', () => {
  describe('GET /api/bays', () => {
    it('returns bay list without authentication as JSON array', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter);

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              { id: 1, name: 'Bay 1', description: 'Simulator bay', isActive: true },
            ]),
          }),
        }),
      }));

      const res = await request(app).get('/api/bays');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('id', 1);
      expect(res.body[0]).toHaveProperty('name', 'Bay 1');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('GET /api/bays/:bayId/availability', () => {
    it('returns 400 with error message when date is missing', async () => {
      const { default: baysRouter } = await import('../server/routes/bays');
      const app = createAppWithRoutes(baysRouter);

      const res = await request(app).get('/api/bays/1/availability');

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Date is required');
    });
  });

  describe('GET /api/faqs', () => {
    it('returns FAQ array without authentication', async () => {
      const { default: faqsRouter } = await import('../server/routes/faqs');
      const app = createAppWithRoutes(faqsRouter);

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { id: 1, question: 'Test?', answer: 'Yes', category: 'General', sortOrder: 1 },
              ]),
            }),
          }),
        }),
      }));

      const res = await request(app).get('/api/faqs');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('question');
      expect(res.body[0]).toHaveProperty('answer');
    });
  });

  describe('GET /api/gallery', () => {
    it('returns formatted gallery image array without auth', async () => {
      const { default: galleryRouter } = await import('../server/routes/gallery');
      const app = createAppWithRoutes(galleryRouter);

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([
                { id: 1, imageUrl: 'https://example.com/img.jpg', category: 'venue', title: 'Test', sortOrder: 1, isActive: true },
              ]),
            }),
          }),
        }),
      }));

      const res = await request(app).get('/api/gallery');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0]).toHaveProperty('id');
      expect(res.body[0]).toHaveProperty('imageUrl');
      expect(res.body[0]).toHaveProperty('category');
    });
  });

  describe('GET /api/announcements', () => {
    it('returns announcements without authentication', async () => {
      const { default: announcementsRouter } = await import('../server/routes/announcements');
      const app = createAppWithRoutes(announcementsRouter);

      mockDbExecute.mockResolvedValue({ rows: [] });

      const res = await request(app).get('/api/announcements');

      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/settings/public', () => {
    it('returns public settings object without authentication', async () => {
      const { default: settingsRouter } = await import('../server/routes/settings');
      const app = createAppWithRoutes(settingsRouter);

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockResolvedValue([]),
      }));

      const res = await request(app).get('/api/settings/public');

      expect(res.status).toBe(200);
      expect(typeof res.body).toBe('object');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });
});


describe('Checkout Validation Tests', () => {
  describe('POST /api/checkout/sessions', () => {
    it('returns 400 with Zod error details for missing tier field', async () => {
      const { default: checkoutRouter } = await import('../server/routes/checkout');
      const app = createAppWithRoutes(checkoutRouter);

      const res = await request(app)
        .post('/api/checkout/sessions')
        .set('Origin', 'https://everclub.app')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
    });

    it('returns 400 for invalid email format', async () => {
      const { default: checkoutRouter } = await import('../server/routes/checkout');
      const app = createAppWithRoutes(checkoutRouter);

      const res = await request(app)
        .post('/api/checkout/sessions')
        .set('Origin', 'https://everclub.app')
        .send({ tier: 'premium', email: 'not-an-email' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('is blocked by CSRF on POST without Origin', async () => {
      const { default: checkoutRouter } = await import('../server/routes/checkout');
      const app = createAppWithRoutes(checkoutRouter);

      const res = await request(app)
        .post('/api/checkout/sessions')
        .send({ tier: 'premium' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Origin verification failed');
    });
  });
});


describe('Admin Guard Integration Tests', () => {
  describe('PUT /api/admin/settings/:key', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: settingsRouter } = await import('../server/routes/settings');
      const app = createAppWithRoutes(settingsRouter);

      const res = await request(app)
        .put('/api/admin/settings/test.key')
        .set('Origin', 'https://everclub.app')
        .send({ value: 'test' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 with Admin message for non-admin user', async () => {
      const { default: settingsRouter } = await import('../server/routes/settings');
      const app = createAppWithRoutes(settingsRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .put('/api/admin/settings/test.key')
        .set('Origin', 'https://everclub.app')
        .send({ value: 'test' });

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Admin');
    });

    it('allows admin users past auth guard', async () => {
      const { default: settingsRouter } = await import('../server/routes/settings');
      const app = createAppWithRoutes(settingsRouter, { email: 'admin@everclub.app', role: 'admin' });

      const res = await request(app)
        .put('/api/admin/settings/test.key')
        .set('Origin', 'https://everclub.app')
        .send({ value: 'test' });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('POST /api/membership-tiers (admin-only)', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: tiersRouter } = await import('../server/routes/membershipTiers');
      const app = createAppWithRoutes(tiersRouter);

      const res = await request(app)
        .post('/api/membership-tiers')
        .set('Origin', 'https://everclub.app')
        .send({ name: 'Test Tier' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 for non-admin users', async () => {
      const { default: tiersRouter } = await import('../server/routes/membershipTiers');
      const app = createAppWithRoutes(tiersRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/membership-tiers')
        .set('Origin', 'https://everclub.app')
        .send({ name: 'Test Tier' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Admin');
    });

    it('returns 403 for staff (not admin) users', async () => {
      const { default: tiersRouter } = await import('../server/routes/membershipTiers');
      const app = createAppWithRoutes(tiersRouter, { email: 'staff@everclub.app', role: 'staff' });

      const res = await request(app)
        .post('/api/membership-tiers')
        .set('Origin', 'https://everclub.app')
        .send({ name: 'Test Tier' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Admin');
    });
  });

  describe('POST /api/data-tools/resync-member (admin-only)', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: dataToolsRouter } = await import('../server/routes/dataTools');
      const app = createAppWithRoutes(dataToolsRouter);

      const res = await request(app)
        .post('/api/data-tools/resync-member')
        .set('Origin', 'https://everclub.app')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-admin users', async () => {
      const { default: dataToolsRouter } = await import('../server/routes/dataTools');
      const app = createAppWithRoutes(dataToolsRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/data-tools/resync-member')
        .set('Origin', 'https://everclub.app')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(403);
    });

    it('returns 403 for staff-only users on admin-only route', async () => {
      const { default: dataToolsRouter } = await import('../server/routes/dataTools');
      const app = createAppWithRoutes(dataToolsRouter, { email: 'staff@everclub.app', role: 'staff' });

      const res = await request(app)
        .post('/api/data-tools/resync-member')
        .set('Origin', 'https://everclub.app')
        .send({ email: 'test@example.com' });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/data-tools/audit-log (admin-only)', () => {
    it('returns 403 for regular member', async () => {
      const { default: dataToolsRouter } = await import('../server/routes/dataTools');
      const app = createAppWithRoutes(dataToolsRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/data-tools/audit-log');

      expect(res.status).toBe(403);
    });
  });
});


describe('Staff Guard Integration Tests', () => {
  describe('GET /api/bookings/:id/staff-checkin-context', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: staffCheckinRouter } = await import('../server/routes/staffCheckin');
      const app = createAppWithRoutes(staffCheckinRouter);

      const res = await request(app).get('/api/bookings/1/staff-checkin-context');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 for non-staff/non-admin members', async () => {
      const { default: staffCheckinRouter } = await import('../server/routes/staffCheckin');
      const app = createAppWithRoutes(staffCheckinRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/bookings/1/staff-checkin-context');

      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('message');
      expect(res.body.message).toContain('Staff');
    });

    it('allows staff users past auth guard', async () => {
      const { default: staffCheckinRouter } = await import('../server/routes/staffCheckin');
      const app = createAppWithRoutes(staffCheckinRouter, { email: 'staff@everclub.app', role: 'staff' });

      mockDbExecute.mockResolvedValue({ rows: [] });

      const res = await request(app).get('/api/bookings/1/staff-checkin-context');

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });

  describe('POST /api/stripe/staff/quick-charge', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: stripeRouter } = await import('../server/routes/stripe');
      const app = createAppWithRoutes(stripeRouter);

      const res = await request(app)
        .post('/api/stripe/staff/quick-charge')
        .set('Origin', 'https://everclub.app')
        .send({ amount: 100, description: 'Test charge' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 for non-staff users', async () => {
      const { default: stripeRouter } = await import('../server/routes/stripe');
      const app = createAppWithRoutes(stripeRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/stripe/staff/quick-charge')
        .set('Origin', 'https://everclub.app')
        .send({ amount: 100, description: 'Test charge' });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain('Staff');
    });
  });

  describe('POST /api/stripe/create-payment-intent', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: stripeRouter } = await import('../server/routes/stripe');
      const app = createAppWithRoutes(stripeRouter);

      const res = await request(app)
        .post('/api/stripe/create-payment-intent')
        .set('Origin', 'https://everclub.app')
        .send({ amount: 5000 });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('returns 403 for non-staff users', async () => {
      const { default: stripeRouter } = await import('../server/routes/stripe');
      const app = createAppWithRoutes(stripeRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/stripe/create-payment-intent')
        .set('Origin', 'https://everclub.app')
        .send({ amount: 5000 });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/admin/faqs (staff route)', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: faqsRouter } = await import('../server/routes/faqs');
      const app = createAppWithRoutes(faqsRouter);

      const res = await request(app).get('/api/admin/faqs');

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-staff users', async () => {
      const { default: faqsRouter } = await import('../server/routes/faqs');
      const app = createAppWithRoutes(faqsRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app).get('/api/admin/faqs');

      expect(res.status).toBe(403);
    });

    it('returns 200 with array for staff users', async () => {
      const { default: faqsRouter } = await import('../server/routes/faqs');
      const app = createAppWithRoutes(faqsRouter, { email: 'staff@everclub.app', role: 'staff' });

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }));

      const res = await request(app).get('/api/admin/faqs');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/admin/gallery (staff route)', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: galleryRouter } = await import('../server/routes/gallery');
      const app = createAppWithRoutes(galleryRouter);

      const res = await request(app)
        .post('/api/admin/gallery')
        .set('Origin', 'https://everclub.app')
        .send({ imageUrl: 'https://example.com/img.jpg' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-staff users', async () => {
      const { default: galleryRouter } = await import('../server/routes/gallery');
      const app = createAppWithRoutes(galleryRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/admin/gallery')
        .set('Origin', 'https://everclub.app')
        .send({ imageUrl: 'https://example.com/img.jpg' });

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/announcements (staff route)', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: announcementsRouter } = await import('../server/routes/announcements');
      const app = createAppWithRoutes(announcementsRouter);

      const res = await request(app)
        .post('/api/announcements')
        .set('Origin', 'https://everclub.app')
        .send({ title: 'Test' });

      expect(res.status).toBe(401);
    });

    it('returns 403 for non-staff users', async () => {
      const { default: announcementsRouter } = await import('../server/routes/announcements');
      const app = createAppWithRoutes(announcementsRouter, { email: 'member@example.com', role: 'member' });

      const res = await request(app)
        .post('/api/announcements')
        .set('Origin', 'https://everclub.app')
        .send({ title: 'Test' });

      expect(res.status).toBe(403);
    });
  });
});


describe('CSRF and Security Middleware Integration Tests', () => {
  describe('CSRF Origin Check on mutative API routes', () => {
    it('allows GET requests without origin header', async () => {
      const app = express();
      app.use(csrfOriginCheck);
      app.get('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/api/test');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('blocks POST /api/ requests without Origin or Referer', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.post('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app).post('/api/test').send({ data: 'test' });
      expect(res.status).toBe(403);
      expect(res.body).toHaveProperty('error');
      expect(res.body.error).toContain('Origin verification failed');
    });

    it('allows POST with valid everclub.app origin', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.post('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app)
        .post('/api/test')
        .set('Origin', 'https://everclub.app')
        .send({ data: 'test' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it('blocks POST with disallowed origin', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.post('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app)
        .post('/api/test')
        .set('Origin', 'https://evil.com')
        .send({ data: 'test' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Origin not allowed');
    });

    it('allows PUT with valid Referer header', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.put('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app)
        .put('/api/test')
        .set('Referer', 'https://everclub.app/dashboard')
        .send({ data: 'test' });

      expect(res.status).toBe(200);
    });

    it('blocks DELETE requests without origin', async () => {
      const app = express();
      app.use(csrfOriginCheck);
      app.delete('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app).delete('/api/test');
      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Origin verification failed');
    });

    it('exempts webhook paths from CSRF check', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.post('/api/stripe/webhook', (_req, res) => res.json({ ok: true }));

      const res = await request(app).post('/api/stripe/webhook').send({});
      expect(res.status).toBe(200);
    });

    it('exempts non-API paths from CSRF check', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.post('/non-api/path', (_req, res) => res.json({ ok: true }));

      const res = await request(app).post('/non-api/path').send({});
      expect(res.status).toBe(200);
    });

    it('exempts HEAD and OPTIONS methods', async () => {
      const app = express();
      app.use(csrfOriginCheck);
      app.head('/api/test', (_req, res) => res.sendStatus(200));
      app.options('/api/test', (_req, res) => res.sendStatus(200));

      const headRes = await request(app).head('/api/test');
      expect(headRes.status).toBe(200);

      const optionsRes = await request(app).options('/api/test');
      expect(optionsRes.status).toBe(200);
    });

    it('exempts HubSpot webhook path', async () => {
      const app = express();
      app.use(express.json());
      app.use(csrfOriginCheck);
      app.post('/api/hubspot/webhooks', (_req, res) => res.json({ ok: true }));

      const res = await request(app).post('/api/hubspot/webhooks').send({});
      expect(res.status).toBe(200);
    });
  });

  describe('Security Headers', () => {
    it('sets all required security headers', async () => {
      const app = express();
      app.use(securityMiddleware);
      app.get('/api/test', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/api/test');

      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
      expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
      expect(res.headers['strict-transport-security']).toContain('max-age=31536000');
      expect(res.headers['strict-transport-security']).toContain('includeSubDomains');
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
      expect(res.headers['content-security-policy']).toContain('js.stripe.com');
      expect(res.headers['permissions-policy']).toBeDefined();
    });

    it('generates CSP nonce in res.locals', async () => {
      const app = express();
      app.use(securityMiddleware);
      app.get('/api/test', (_req, res) => {
        res.json({ hasNonce: !!res.locals.cspNonce, nonceLength: res.locals.cspNonce?.length });
      });

      const res = await request(app).get('/api/test');
      expect(res.body.hasNonce).toBe(true);
      expect(res.body.nonceLength).toBeGreaterThan(0);
    });

    it('sets no-cache headers for non-static API paths', async () => {
      const app = express();
      app.use(securityMiddleware);
      app.get('/api/data', (_req, res) => res.json({ ok: true }));

      const res = await request(app).get('/api/data');
      expect(res.headers['cache-control']).toContain('no-store');
      expect(res.headers['cache-control']).toContain('no-cache');
    });
  });
});


describe('Authenticated Settings Routes', () => {
  describe('GET /api/settings', () => {
    it('returns 401 for unauthenticated requests', async () => {
      const { default: settingsRouter } = await import('../server/routes/settings');
      const app = createAppWithRoutes(settingsRouter);

      const res = await request(app).get('/api/settings');

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('message', 'Unauthorized');
    });

    it('passes auth guard for authenticated users', async () => {
      const { default: settingsRouter } = await import('../server/routes/settings');
      const app = createAppWithRoutes(settingsRouter, { email: 'member@example.com', role: 'member' });

      mockDbSelect.mockImplementation(() => ({
        from: vi.fn().mockResolvedValue([]),
      }));

      const res = await request(app).get('/api/settings');

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    });
  });
});
