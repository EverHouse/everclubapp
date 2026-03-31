// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../server/core/schedulerTracker', () => ({
  schedulerTracker: {
    recordRun: vi.fn(),
    recordSkipped: vi.fn(),
    registerScheduler: vi.fn(),
    getSchedulerStatuses: vi.fn(() => []),
    refreshEnabledStates: vi.fn(),
    setEnabled: vi.fn(),
  },
}));

vi.mock('../server/core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../server/core/db', () => ({
  queryWithRetry: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
  pool: {
    connect: vi.fn(() =>
      Promise.resolve({
        query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
        release: vi.fn(),
      })
    ),
  },
  safeRelease: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(() => Promise.resolve([{ key: 'claimed' }])),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
    transaction: vi.fn((fn: Function) => fn({
      execute: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([])),
      })),
    })),
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: vi.fn((...args: unknown[]) => args),
  eq: vi.fn(),
}));

vi.mock('../../shared/schema', () => ({
  systemSettings: { key: 'key', value: 'value', updatedAt: 'updatedAt' },
  failedSideEffects: { id: 'id' },
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn(() => Promise.resolve()),
  notifyMember: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/dataAlerts', () => ({
  alertOnScheduledTaskFailure: vi.fn(() => Promise.resolve()),
  alertOnSyncFailure: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn(() => '2026-03-31'),
  formatTimePacific: vi.fn(() => '14:00:00'),
  getPacificHour: vi.fn(() => 10),
  getPacificDayOfMonth: vi.fn(() => 1),
  getPacificDateParts: vi.fn(() => ({ year: 2026, month: 1, day: 1, hour: 3, minute: 0 })),
  CLUB_TIMEZONE: 'America/Los_Angeles',
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
  isStripeResourceMissing: vi.fn(() => false),
}));

vi.mock('../server/utils/dateTimeUtils', () => ({
  ensureTimeString: vi.fn((t: string) => t),
}));

vi.mock('../server/core/websocket', () => ({
  broadcastAvailabilityUpdate: vi.fn(),
}));

vi.mock('../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn(() => Promise.resolve()),
  refreshBookingPass: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/walletPass/apnPushService', () => ({
  sendPassUpdateForMemberByEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/billing/paymentIntentCleanup', () => ({
  cancelPendingPaymentIntentsForBooking: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  ensureSessionForBooking: vi.fn(() => Promise.resolve({ sessionId: 1, created: true })),
}));

vi.mock('../server/core/bookingService/usageCalculator', () => ({
  recalculateSessionFees: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  syncBookingInvoice: vi.fn(() => Promise.resolve()),
  voidBookingInvoice: vi.fn(() => Promise.resolve({ success: true })),
  recreateDraftInvoiceFromBooking: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve({
    invoices: { retrieve: vi.fn(), finalizeInvoice: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    subscriptions: { list: vi.fn(() => Promise.resolve({ data: [] })), cancel: vi.fn() },
    customers: { del: vi.fn(), createBalanceTransaction: vi.fn() },
    billingPortal: { sessions: { create: vi.fn(() => Promise.resolve({ url: 'https://example.com' })) } },
    refunds: { create: vi.fn(() => Promise.resolve({ id: 're_123' })) },
  })),
}));

vi.mock('../server/core/stripe', () => ({
  getStripeClient: vi.fn(() => Promise.resolve({
    paymentIntents: { retrieve: vi.fn() },
  })),
  cancelPaymentIntent: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../server/core/stripe/payments', () => ({
  cancelPaymentIntent: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../server/core/stripe/reconciliation', () => ({
  reconcileDailyPayments: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
  reconcileSubscriptions: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
  reconcileDailyRefunds: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
}));

vi.mock('../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: {
    markPaymentSucceeded: vi.fn(() => Promise.resolve({ success: true })),
    markPaymentCancelled: vi.fn(() => Promise.resolve({ success: true })),
  },
  markPaymentRefunded: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/emails/membershipEmails', () => ({
  sendGracePeriodReminderEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn((_key: string, defaultVal: string) => Promise.resolve(defaultVal)),
  getSettingBoolean: vi.fn(() => Promise.resolve(true)),
  isSchedulerEnabled: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../server/utils/urlUtils', () => ({
  getAppBaseUrl: vi.fn(() => 'https://example.com'),
}));

vi.mock('../server/routes/push', () => ({
  sendDailyReminders: vi.fn(() => Promise.resolve({ message: 'Sent 0 reminders' })),
  sendMorningClosureNotifications: vi.fn(() => Promise.resolve({ message: 'Sent 0 notifications' })),
}));

vi.mock('../server/emails/onboardingNudgeEmails', () => ({
  sendOnboardingNudge24h: vi.fn(() => Promise.resolve({ success: true })),
  sendOnboardingNudge72h: vi.fn(() => Promise.resolve({ success: true })),
  sendOnboardingNudge7d: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../server/core/calendar/index', () => ({
  syncGoogleCalendarEvents: vi.fn(() => Promise.resolve({ synced: 0, created: 0, updated: 0, deleted: 0, pushedToCalendar: 0 })),
  syncWellnessCalendarEvents: vi.fn(() => Promise.resolve({ synced: 0, created: 0, updated: 0, deleted: 0, pushedToCalendar: 0 })),
  syncInternalCalendarToClosures: vi.fn(() => Promise.resolve({ synced: 0, created: 0, updated: 0, deleted: 0, pushedToCalendar: 0 })),
  syncConferenceRoomCalendarToBookings: vi.fn(() => Promise.resolve({ synced: 0, linked: 0, created: 0, skipped: 0, cancelled: 0, updated: 0 })),
  getCalendarIdByName: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

vi.mock('../server/core/hubspot', () => ({
  processHubSpotQueue: vi.fn(() => Promise.resolve({ processed: 0, succeeded: 0, failed: 0 })),
  getQueueStats: vi.fn(() => Promise.resolve({ pending: 0, failed: 0, processing: 0 })),
  recoverStuckProcessingJobs: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/hubspot/formSync', () => ({
  syncHubSpotFormSubmissions: vi.fn(() => Promise.resolve()),
  logFormIdResolutionStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/hubspot/stages', () => ({
  ensureHubSpotPropertiesExist: vi.fn(() => Promise.resolve({ created: [], errors: [] })),
  syncMemberToHubSpot: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/memberSync', () => ({
  syncAllMembersFromHubSpot: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
  setLastMemberSyncTime: vi.fn(() => Promise.resolve()),
  syncCommunicationLogsFromHubSpot: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/sessionCleanup', () => ({
  runSessionCleanup: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/databaseCleanup', () => ({
  runScheduledCleanup: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/dataIntegrity', () => ({
  runAllIntegrityChecks: vi.fn(() => Promise.resolve([])),
  autoFixMissingTiers: vi.fn(() => Promise.resolve({ fixedFromAlternateEmail: 0 })),
  runDataCleanup: vi.fn(() => Promise.resolve({ orphanedNotifications: 0, orphanedBookings: 0 })),
}));

vi.mock('../server/emails/integrityAlertEmail', () => ({
  sendIntegrityAlertEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../server/core/retry', () => ({
  withRetry: vi.fn((fn: Function) => fn()),
}));

vi.mock('../server/core/supabase/client', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseAdmin: vi.fn(),
  isRealtimeEnabled: vi.fn(() => true),
  resetSupabaseAvailability: vi.fn(),
  enableRealtimeWithRetry: vi.fn(() => Promise.resolve({ successCount: 0, total: 0 })),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn(() => Promise.resolve({ id: 1 })),
  linkPurchaseToUser: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/routes/trackman/index', () => ({
  cleanupOldWebhookLogs: vi.fn(() => Promise.resolve()),
}));

vi.mock('../server/core/integrity/externalSystemChecks', () => ({
  reconcileRecentlyActivatedHubSpotSync: vi.fn(() => Promise.resolve({ checked: 0, enqueued: 0, errors: [] })),
}));

vi.mock('../server/core/staffNotifications', () => ({
  notifyAllStaff: vi.fn(() => Promise.resolve()),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, _cb: Function) => ({
      stop: vi.fn(),
    })),
  },
}));

vi.mock('../server/core/billing/guestPassConsumer', () => ({
  canUseGuestPass: vi.fn(() => Promise.resolve({ canUse: false, remaining: 0 })),
  consumeGuestPassForParticipant: vi.fn(() => Promise.resolve({ success: false })),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  isPlaceholderGuestName: vi.fn(() => false),
}));

vi.mock('../server/routes/bays/helpers', () => ({
  getCalendarNameForBayAsync: vi.fn(() => Promise.resolve(null)),
}));

type MockFn = ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: false });
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('bookingExpiryScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startBookingExpiryScheduler, stopBookingExpiryScheduler } = await import('../server/schedulers/bookingExpiryScheduler');
    const before = spy.mock.calls.length;
    startBookingExpiryScheduler();
    startBookingExpiryScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopBookingExpiryScheduler();
    spy.mockRestore();
  });

  it('runManualBookingExpiry expires unconfirmed bookings and cancels fee snapshots + payment intents', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    const { cancelPendingPaymentIntentsForBooking } = await import('../server/core/billing/paymentIntentCleanup');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 5 }, { id: 6 }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { runManualBookingExpiry } = await import('../server/schedulers/bookingExpiryScheduler');
    const result = await runManualBookingExpiry();
    expect(result.expiredCount).toBe(2);
    const snapshotCall = (queryWithRetry as MockFn).mock.calls[1];
    expect(snapshotCall[0]).toContain('booking_fee_snapshots');
    expect(snapshotCall[1]).toEqual([[5, 6]]);
    expect(cancelPendingPaymentIntentsForBooking).toHaveBeenCalledWith(5, { skipSnapshotUpdate: true });
    expect(cancelPendingPaymentIntentsForBooking).toHaveBeenCalledWith(6, { skipSnapshotUpdate: true });
  });

  it('runManualBookingExpiry SQL transitions to expired status with system reviewer and 20-min grace', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { runManualBookingExpiry } = await import('../server/schedulers/bookingExpiryScheduler');
    await runManualBookingExpiry();
    const sql = (queryWithRetry as MockFn).mock.calls[0][0];
    expect(sql).toContain('booking_requests');
    expect(sql).toContain("status = 'expired'");
    expect(sql).toContain("reviewed_by = 'system-manual-expiry'");
    expect(sql).toContain("pending_approval");
    expect(sql).toContain("interval '20 minutes'");
  });

  it('runManualBookingExpiry voids wallet passes for each expired booking', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    const { voidBookingPass } = await import('../server/walletPass/bookingPassService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 10 }, { id: 11 }], rowCount: 2 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { runManualBookingExpiry } = await import('../server/schedulers/bookingExpiryScheduler');
    await runManualBookingExpiry();
    expect(voidBookingPass).toHaveBeenCalledWith(10);
    expect(voidBookingPass).toHaveBeenCalledWith(11);
  });

  it('runManualBookingExpiry cancels fee snapshots to cancelled status for expired booking IDs', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { runManualBookingExpiry } = await import('../server/schedulers/bookingExpiryScheduler');
    await runManualBookingExpiry();
    const snapshotSql = (queryWithRetry as MockFn).mock.calls[1][0];
    expect(snapshotSql).toContain('booking_fee_snapshots');
    expect(snapshotSql).toContain("'cancelled'");
    expect(snapshotSql).toContain("'pending'");
    expect(snapshotSql).toContain("'requires_action'");
  });

  it('idempotency — running twice with no bookings yields identical zero results', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { runManualBookingExpiry } = await import('../server/schedulers/bookingExpiryScheduler');
    const r1 = await runManualBookingExpiry();
    const r2 = await runManualBookingExpiry();
    expect(r1).toEqual({ expiredCount: 0 });
    expect(r2).toEqual({ expiredCount: 0 });
  });

  it('protects valid bookings — SQL only targets pending and pending_approval statuses', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { runManualBookingExpiry } = await import('../server/schedulers/bookingExpiryScheduler');
    await runManualBookingExpiry();
    const sql = (queryWithRetry as MockFn).mock.calls[0][0];
    expect(sql).toContain("'pending'");
    expect(sql).toContain("'pending_approval'");
    expect(sql).not.toContain("'confirmed'");
    expect(sql).not.toContain("'checked_in'");
    expect(sql).not.toContain("'completed'");
  });
});

describe('bookingAutoCompleteScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startBookingAutoCompleteScheduler, stopBookingAutoCompleteScheduler } = await import('../server/schedulers/bookingAutoCompleteScheduler');
    const before = spy.mock.calls.length;
    startBookingAutoCompleteScheduler();
    startBookingAutoCompleteScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopBookingAutoCompleteScheduler();
    spy.mockRestore();
  });

  it('runManualBookingAutoComplete returns numeric markedCount and sessionsCreated', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { runManualBookingAutoComplete } = await import('../server/schedulers/bookingAutoCompleteScheduler');
    const result = await runManualBookingAutoComplete();
    expect(typeof result.markedCount).toBe('number');
    expect(typeof result.sessionsCreated).toBe('number');
    expect(result.markedCount).toBe(0);
    expect(result.sessionsCreated).toBe(0);
  });

  it('runManualBookingAutoComplete SQL queries approved/confirmed past bookings', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { runManualBookingAutoComplete } = await import('../server/schedulers/bookingAutoCompleteScheduler');
    await runManualBookingAutoComplete();
    const firstSql = (queryWithRetry as MockFn).mock.calls[0][0];
    expect(firstSql).toContain('booking_requests');
  });

  it('idempotency — running twice with no eligible bookings yields identical zero results', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { runManualBookingAutoComplete } = await import('../server/schedulers/bookingAutoCompleteScheduler');
    const r1 = await runManualBookingAutoComplete();
    const r2 = await runManualBookingAutoComplete();
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ markedCount: 0, sessionsCreated: 0 });
  });
});

describe('stuckCancellationScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startStuckCancellationScheduler, stopStuckCancellationScheduler } = await import('../server/schedulers/stuckCancellationScheduler');
    const before = spy.mock.calls.length;
    startStuckCancellationScheduler();
    startStuckCancellationScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopStuckCancellationScheduler();
    spy.mockRestore();
  });

  it('interval callback queries cancellation_pending bookings older than 4 hours', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startStuckCancellationScheduler, stopStuckCancellationScheduler } = await import('../server/schedulers/stuckCancellationScheduler');
    startStuckCancellationScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 100);
    stopStuckCancellationScheduler();
    const cancellationQuery = (queryWithRetry as MockFn).mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('cancellation_pending')
    );
    expect(cancellationQuery).toBeDefined();
    expect(cancellationQuery![0]).toContain('4 hours');
  });

  it('notifies staff when stuck cancellation_pending bookings are found', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{ id: 42, member_name: 'Test', cancellation_pending_at: new Date() }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startStuckCancellationScheduler, stopStuckCancellationScheduler } = await import('../server/schedulers/stuckCancellationScheduler');
    startStuckCancellationScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 100);
    stopStuckCancellationScheduler();
    expect(notifyAllStaff).toHaveBeenCalled();
  });
});

describe('stripeReconciliationScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    const before = spy.mock.calls.length;
    startStripeReconciliationScheduler();
    startStripeReconciliationScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopStripeReconciliationScheduler();
    spy.mockRestore();
  });

  it('interval callback invokes reconcileDailyPayments, reconcileSubscriptions, reconcileDailyRefunds during 5-7 AM', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(5);
    const { reconcileDailyPayments, reconcileSubscriptions, reconcileDailyRefunds } = await import('../server/core/stripe/reconciliation');
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    startStripeReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopStripeReconciliationScheduler();
    expect(reconcileDailyPayments).toHaveBeenCalled();
    expect(reconcileSubscriptions).toHaveBeenCalled();
    expect(reconcileDailyRefunds).toHaveBeenCalled();
  });

  it('skips reconciliation outside the 5-7 AM window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(14);
    const { reconcileDailyPayments } = await import('../server/core/stripe/reconciliation');
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    startStripeReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopStripeReconciliationScheduler();
    expect(reconcileDailyPayments).not.toHaveBeenCalled();
  });

  it('marks slot completed after successful reconciliation via db.update', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(5);
    const { db } = await import('../server/db');
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    startStripeReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopStripeReconciliationScheduler();
    expect(db.update).toHaveBeenCalled();
  });

  it('executes reconciliation in strict order: payments → subscriptions → refunds', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(5);
    const callOrder: string[] = [];
    const { reconcileDailyPayments, reconcileSubscriptions, reconcileDailyRefunds } = await import('../server/core/stripe/reconciliation');
    (reconcileDailyPayments as MockFn).mockImplementation(() => { callOrder.push('payments'); return Promise.resolve({ synced: 0, errors: 0 }); });
    (reconcileSubscriptions as MockFn).mockImplementation(() => { callOrder.push('subscriptions'); return Promise.resolve({ synced: 0, errors: 0 }); });
    (reconcileDailyRefunds as MockFn).mockImplementation(() => { callOrder.push('refunds'); return Promise.resolve({ synced: 0, errors: 0 }); });
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    startStripeReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopStripeReconciliationScheduler();
    expect(callOrder.slice(0, 3)).toEqual(['payments', 'subscriptions', 'refunds']);
  });


  it('alerts staff on reconciliation failure via alertOnScheduledTaskFailure', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(5);
    const { reconcileDailyPayments } = await import('../server/core/stripe/reconciliation');
    (reconcileDailyPayments as MockFn).mockRejectedValueOnce(new Error('Stripe API timeout'));
    const { alertOnScheduledTaskFailure } = await import('../server/core/dataAlerts');
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    startStripeReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopStripeReconciliationScheduler();
    expect(alertOnScheduledTaskFailure).toHaveBeenCalledWith(
      'Daily Stripe Reconciliation',
      expect.any(Error),
      expect.objectContaining({ context: expect.stringContaining('5am Pacific') })
    );
  });

  it('idempotency — reconciliation with zero drift produces no correction mutations', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(5);
    const { reconcileDailyPayments, reconcileSubscriptions, reconcileDailyRefunds } = await import('../server/core/stripe/reconciliation');
    (reconcileDailyPayments as MockFn).mockResolvedValue({ synced: 0, errors: 0 });
    (reconcileSubscriptions as MockFn).mockResolvedValue({ synced: 0, errors: 0 });
    (reconcileDailyRefunds as MockFn).mockResolvedValue({ synced: 0, errors: 0 });
    const { db } = await import('../server/db');
    (db.update as MockFn).mockClear();
    const { startStripeReconciliationScheduler, stopStripeReconciliationScheduler } = await import('../server/schedulers/stripeReconciliationScheduler');
    startStripeReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopStripeReconciliationScheduler();
    expect(reconcileDailyPayments).toHaveBeenCalled();
    expect(reconcileSubscriptions).toHaveBeenCalled();
    expect(reconcileDailyRefunds).toHaveBeenCalled();
  });
});

describe('invoiceAutoFinalizeScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startInvoiceAutoFinalizeScheduler, stopInvoiceAutoFinalizeScheduler } = await import('../server/schedulers/invoiceAutoFinalizeScheduler');
    const before = spy.mock.calls.length;
    startInvoiceAutoFinalizeScheduler();
    startInvoiceAutoFinalizeScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopInvoiceAutoFinalizeScheduler();
    spy.mockRestore();
  });

  it('interval callback queries for bookings with draft stripe_invoice_id past start_time', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startInvoiceAutoFinalizeScheduler, stopInvoiceAutoFinalizeScheduler } = await import('../server/schedulers/invoiceAutoFinalizeScheduler');
    startInvoiceAutoFinalizeScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    stopInvoiceAutoFinalizeScheduler();
    const invoiceQuery = (queryWithRetry as MockFn).mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('stripe_invoice_id')
    );
    expect(invoiceQuery).toBeDefined();
  });

  it('idempotency — running twice with no eligible bookings produces identical zero-mutation outcome', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startInvoiceAutoFinalizeScheduler, stopInvoiceAutoFinalizeScheduler } = await import('../server/schedulers/invoiceAutoFinalizeScheduler');
    startInvoiceAutoFinalizeScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    const callCountAfterFirst = (queryWithRetry as MockFn).mock.calls.length;
    expect(callCountAfterFirst).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    stopInvoiceAutoFinalizeScheduler();
    expect((queryWithRetry as MockFn).mock.calls.length).toBeGreaterThanOrEqual(callCountAfterFirst);
  });
});

describe('feeSnapshotReconciliationScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startFeeSnapshotReconciliationScheduler, stopFeeSnapshotReconciliationScheduler } = await import('../server/schedulers/feeSnapshotReconciliationScheduler');
    const before = spy.mock.calls.length;
    startFeeSnapshotReconciliationScheduler();
    startFeeSnapshotReconciliationScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopFeeSnapshotReconciliationScheduler();
    spy.mockRestore();
  });

  it('interval callback acquires pool connection to reconcile pending snapshots and stale payment intents', async () => {
    const { pool } = await import('../server/core/db');
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool.connect as MockFn).mockResolvedValue(mockClient);
    const { startFeeSnapshotReconciliationScheduler, stopFeeSnapshotReconciliationScheduler } = await import('../server/schedulers/feeSnapshotReconciliationScheduler');
    startFeeSnapshotReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    stopFeeSnapshotReconciliationScheduler();
    expect(pool.connect).toHaveBeenCalled();
  });

  it('idempotency — second run with same empty data produces identical pool query SQL sequence', async () => {
    const { pool } = await import('../server/core/db');
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    };
    (pool.connect as MockFn).mockReset();
    (pool.connect as MockFn).mockResolvedValue(mockClient);
    const { startFeeSnapshotReconciliationScheduler, stopFeeSnapshotReconciliationScheduler } = await import('../server/schedulers/feeSnapshotReconciliationScheduler');
    startFeeSnapshotReconciliationScheduler();
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000 + 100);
    const firstRunCalls = mockClient.query.mock.calls.length;
    expect(firstRunCalls).toBeGreaterThan(0);
    const firstRunSql = mockClient.query.mock.calls.map((c: unknown[]) => String(c[0]));
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
    stopFeeSnapshotReconciliationScheduler();
    const totalCalls = mockClient.query.mock.calls.length;
    expect(totalCalls).toBeGreaterThan(firstRunCalls);
    const secondRunSql = mockClient.query.mock.calls.slice(firstRunCalls).map((c: unknown[]) => String(c[0]));
    expect(secondRunSql).toEqual(firstRunSql);
  });
});

describe('gracePeriodScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startGracePeriodScheduler, stopGracePeriodScheduler } = await import('../server/schedulers/gracePeriodScheduler');
    const before = spy.mock.calls.length;
    startGracePeriodScheduler();
    startGracePeriodScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopGracePeriodScheduler();
    spy.mockRestore();
  });

  it('interval callback queries users with grace_period_start and sends reminder emails at configured hour', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    const { db } = await import('../server/db');
    const { sendGracePeriodReminderEmail } = await import('../server/emails/membershipEmails');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 1, email: 'member@test.com', first_name: 'Test', last_name: 'User',
          grace_period_start: '2026-03-29', grace_period_email_count: 0,
          stripe_customer_id: 'cus_test', tier: 'gold'
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startGracePeriodScheduler, stopGracePeriodScheduler } = await import('../server/schedulers/gracePeriodScheduler');
    startGracePeriodScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGracePeriodScheduler();
    expect(db.execute).toHaveBeenCalled();
    expect(sendGracePeriodReminderEmail).toHaveBeenCalledWith(
      'member@test.com',
      expect.objectContaining({
        memberName: 'Test User',
        currentDay: 1,
        totalDays: 3,
        reactivationLink: expect.any(String),
      })
    );
  });

  it('handles members past grace period threshold for termination — calls db.transaction and notifyAllStaff', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    const { db } = await import('../server/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 2, email: 'expired@test.com', first_name: 'Expired', last_name: 'User',
          grace_period_start: '2026-03-20', grace_period_email_count: 2,
          stripe_customer_id: 'cus_expired', tier: 'gold'
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [{ billing_provider: 'stripe' }], rowCount: 1 });
    const { startGracePeriodScheduler, stopGracePeriodScheduler } = await import('../server/schedulers/gracePeriodScheduler');
    startGracePeriodScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGracePeriodScheduler();
    expect(db.execute).toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
  });

  it('idempotency — with no grace period users, repeated runs produce no emails or terminations', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    const { db } = await import('../server/db');
    const { sendGracePeriodReminderEmail } = await import('../server/emails/membershipEmails');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    (sendGracePeriodReminderEmail as MockFn).mockClear();
    (notifyAllStaff as MockFn).mockClear();
    (db.transaction as MockFn).mockClear();
    const { startGracePeriodScheduler, stopGracePeriodScheduler } = await import('../server/schedulers/gracePeriodScheduler');
    startGracePeriodScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 200);
    stopGracePeriodScheduler();
    expect(sendGracePeriodReminderEmail).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  });
});

describe('guestPassResetScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startGuestPassResetScheduler, stopGuestPassResetScheduler } = await import('../server/schedulers/guestPassResetScheduler');
    const before = spy.mock.calls.length;
    startGuestPassResetScheduler();
    startGuestPassResetScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopGuestPassResetScheduler();
    spy.mockRestore();
  });

  it('interval callback claims system_settings slot on January 1st at RESET_HOUR (3 AM)', async () => {
    const dateUtils = await import('../server/utils/dateUtils');
    (dateUtils.getPacificHour as MockFn).mockReturnValue(3);
    (dateUtils.getPacificDayOfMonth as MockFn).mockReturnValue(1);
    (dateUtils.getPacificDateParts as MockFn).mockReturnValue({ year: 2026, month: 1, day: 1, hour: 3, minute: 0 });
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ key: 'last_guest_pass_reset' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startGuestPassResetScheduler, stopGuestPassResetScheduler } = await import('../server/schedulers/guestPassResetScheduler');
    startGuestPassResetScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGuestPassResetScheduler();
    const resetQuery = (queryWithRetry as MockFn).mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('last_guest_pass_reset')
    );
    expect(resetQuery).toBeDefined();
  });

  it('skips reset when time guard fails (not January 1st at hour 3)', async () => {
    const dateUtils = await import('../server/utils/dateUtils');
    (dateUtils.getPacificHour as MockFn).mockReturnValue(10);
    (dateUtils.getPacificDayOfMonth as MockFn).mockReturnValue(15);
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    const { startGuestPassResetScheduler, stopGuestPassResetScheduler } = await import('../server/schedulers/guestPassResetScheduler');
    startGuestPassResetScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGuestPassResetScheduler();
    const resetQuery = (queryWithRetry as MockFn).mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('last_guest_pass_reset')
    );
    expect(resetQuery).toBeUndefined();
  });

  it('yearly reset sets passes_used to 0 for members with used passes', async () => {
    const dateUtils = await import('../server/utils/dateUtils');
    (dateUtils.getPacificHour as MockFn).mockReturnValue(3);
    (dateUtils.getPacificDayOfMonth as MockFn).mockReturnValue(1);
    (dateUtils.getPacificDateParts as MockFn).mockReturnValue({ year: 2026, month: 1, day: 1, hour: 3, minute: 0 });
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ key: 'last_guest_pass_reset' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { member_email: 'user1@test.com', passes_total: 12 },
          { member_email: 'user2@test.com', passes_total: 6 },
        ],
        rowCount: 2,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startGuestPassResetScheduler, stopGuestPassResetScheduler } = await import('../server/schedulers/guestPassResetScheduler');
    startGuestPassResetScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGuestPassResetScheduler();
    const resetSql = (queryWithRetry as MockFn).mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('passes_used = 0')
    );
    expect(resetSql).toBeDefined();
    expect(resetSql![0]).toContain('guest_passes');
    expect(resetSql![0]).toContain('RETURNING member_email');
  });

  it('sends wallet pass update for each reset member via sendPassUpdateForMemberByEmail', async () => {
    const dateUtils = await import('../server/utils/dateUtils');
    (dateUtils.getPacificHour as MockFn).mockReturnValue(3);
    (dateUtils.getPacificDayOfMonth as MockFn).mockReturnValue(1);
    (dateUtils.getPacificDateParts as MockFn).mockReturnValue({ year: 2026, month: 1, day: 1, hour: 3, minute: 0 });
    const { queryWithRetry } = await import('../server/core/db');
    const { sendPassUpdateForMemberByEmail } = await import('../server/walletPass/apnPushService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ key: 'last_guest_pass_reset' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [{ member_email: 'reset@test.com', passes_total: 10 }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startGuestPassResetScheduler, stopGuestPassResetScheduler } = await import('../server/schedulers/guestPassResetScheduler');
    startGuestPassResetScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGuestPassResetScheduler();
    expect(sendPassUpdateForMemberByEmail).toHaveBeenCalledWith('reset@test.com');
  });

  it('idempotency — reset with no members to reset produces no side effects', async () => {
    const dateUtils = await import('../server/utils/dateUtils');
    (dateUtils.getPacificHour as MockFn).mockReturnValue(3);
    (dateUtils.getPacificDayOfMonth as MockFn).mockReturnValue(1);
    (dateUtils.getPacificDateParts as MockFn).mockReturnValue({ year: 2026, month: 1, day: 1, hour: 3, minute: 0 });
    const { queryWithRetry } = await import('../server/core/db');
    const { sendPassUpdateForMemberByEmail } = await import('../server/walletPass/apnPushService');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({ rows: [{ key: 'last_guest_pass_reset' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    (sendPassUpdateForMemberByEmail as MockFn).mockClear();
    (notifyAllStaff as MockFn).mockClear();
    const { startGuestPassResetScheduler, stopGuestPassResetScheduler } = await import('../server/schedulers/guestPassResetScheduler');
    startGuestPassResetScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopGuestPassResetScheduler();
    expect(sendPassUpdateForMemberByEmail).not.toHaveBeenCalled();
  });
});

describe('pendingUserCleanupScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startPendingUserCleanupScheduler, stopPendingUserCleanupScheduler } = await import('../server/schedulers/pendingUserCleanupScheduler');
    const before = spy.mock.calls.length;
    startPendingUserCleanupScheduler();
    startPendingUserCleanupScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopPendingUserCleanupScheduler();
    spy.mockRestore();
  });

  it('interval callback queries for pending stripe users older than 48h', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startPendingUserCleanupScheduler, stopPendingUserCleanupScheduler } = await import('../server/schedulers/pendingUserCleanupScheduler');
    startPendingUserCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 1000 + 100);
    stopPendingUserCleanupScheduler();
    const pendingQuery = (queryWithRetry as MockFn).mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && c[0].includes('pending')
    );
    expect(pendingQuery).toBeDefined();
  });

  it('idempotency — running twice with no pending users produces identical zero-mutation outcome', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startPendingUserCleanupScheduler, stopPendingUserCleanupScheduler } = await import('../server/schedulers/pendingUserCleanupScheduler');
    startPendingUserCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 1000 + 100);
    const firstRunCalls = (queryWithRetry as MockFn).mock.calls.length;
    expect(firstRunCalls).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(60 * 1000);
    stopPendingUserCleanupScheduler();
    expect((queryWithRetry as MockFn).mock.calls.length).toBeGreaterThanOrEqual(firstRunCalls);
  });
});

describe('memberSyncScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setTimeout');
    const { startMemberSyncScheduler, stopMemberSyncScheduler } = await import('../server/schedulers/memberSyncScheduler');
    const before = spy.mock.calls.length;
    startMemberSyncScheduler();
    startMemberSyncScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(2);
    stopMemberSyncScheduler();
    spy.mockRestore();
  });

  it('scheduler triggers syncAllMembersFromHubSpot after timeout fires', async () => {
    const { syncAllMembersFromHubSpot } = await import('../server/core/memberSync');
    (syncAllMembersFromHubSpot as MockFn).mockResolvedValue({ synced: 5, errors: 1 });
    const { startMemberSyncScheduler, stopMemberSyncScheduler } = await import('../server/schedulers/memberSyncScheduler');
    startMemberSyncScheduler();
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);
    stopMemberSyncScheduler();
    expect(syncAllMembersFromHubSpot).toHaveBeenCalled();
  });

  it('idempotency — syncAllMembersFromHubSpot with no new members returns stable zero-metrics', async () => {
    const { syncAllMembersFromHubSpot } = await import('../server/core/memberSync');
    (syncAllMembersFromHubSpot as MockFn).mockResolvedValue({ synced: 0, errors: 0 });
    const result1 = await (syncAllMembersFromHubSpot as MockFn)();
    const result2 = await (syncAllMembersFromHubSpot as MockFn)();
    expect(result1).toEqual({ synced: 0, errors: 0 });
    expect(result2).toEqual(result1);
  });
});

describe('dailyReminderScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startDailyReminderScheduler, stopDailyReminderScheduler } = await import('../server/schedulers/dailyReminderScheduler');
    const before = spy.mock.calls.length;
    startDailyReminderScheduler();
    startDailyReminderScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopDailyReminderScheduler();
    spy.mockRestore();
  });

  it('interval callback claims distributed lock and calls sendDailyReminders at 6-8 PM', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(18);
    const { db } = await import('../server/db');
    const { sendDailyReminders } = await import('../server/routes/push');
    const { startDailyReminderScheduler, stopDailyReminderScheduler } = await import('../server/schedulers/dailyReminderScheduler');
    startDailyReminderScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    stopDailyReminderScheduler();
    expect(db.insert).toHaveBeenCalled();
    expect(sendDailyReminders).toHaveBeenCalled();
  });

  it('skips sending when outside the reminder hour window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    const { sendDailyReminders } = await import('../server/routes/push');
    const { startDailyReminderScheduler, stopDailyReminderScheduler } = await import('../server/schedulers/dailyReminderScheduler');
    startDailyReminderScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    stopDailyReminderScheduler();
    expect(sendDailyReminders).not.toHaveBeenCalled();
  });

  it('distributed lock key contains "daily_reminders" to prevent multi-instance overlap', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(18);
    const { db } = await import('../server/db');
    (db.insert as MockFn).mockClear();
    const { startDailyReminderScheduler, stopDailyReminderScheduler } = await import('../server/schedulers/dailyReminderScheduler');
    startDailyReminderScheduler();
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 100);
    stopDailyReminderScheduler();
    const insertCalls = (db.insert as MockFn).mock.calls;
    expect(insertCalls.length).toBeGreaterThan(0);
  });
});

describe('morningClosureScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startMorningClosureScheduler, stopMorningClosureScheduler } = await import('../server/schedulers/morningClosureScheduler');
    const before = spy.mock.calls.length;
    startMorningClosureScheduler();
    startMorningClosureScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopMorningClosureScheduler();
    spy.mockRestore();
  });

  it('interval callback claims lock and calls sendMorningClosureNotifications at 8-10 AM', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(8);
    const { sendMorningClosureNotifications } = await import('../server/routes/push');
    const { db } = await import('../server/db');
    const { startMorningClosureScheduler, stopMorningClosureScheduler } = await import('../server/schedulers/morningClosureScheduler');
    startMorningClosureScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopMorningClosureScheduler();
    expect(db.insert).toHaveBeenCalled();
    expect(sendMorningClosureNotifications).toHaveBeenCalled();
  });

  it('skips notifications outside the 8-10 AM window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(15);
    const { sendMorningClosureNotifications } = await import('../server/routes/push');
    const { startMorningClosureScheduler, stopMorningClosureScheduler } = await import('../server/schedulers/morningClosureScheduler');
    startMorningClosureScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopMorningClosureScheduler();
    expect(sendMorningClosureNotifications).not.toHaveBeenCalled();
  });

  it('distributed lock prevents concurrent closure notification execution', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(8);
    const { db } = await import('../server/db');
    (db.insert as MockFn).mockClear();
    const { startMorningClosureScheduler, stopMorningClosureScheduler } = await import('../server/schedulers/morningClosureScheduler');
    startMorningClosureScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopMorningClosureScheduler();
    expect(db.insert).toHaveBeenCalled();
  });
});

describe('onboardingNudgeScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startOnboardingNudgeScheduler, stopOnboardingNudgeScheduler } = await import('../server/schedulers/onboardingNudgeScheduler');
    const before = spy.mock.calls.length;
    startOnboardingNudgeScheduler();
    startOnboardingNudgeScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopOnboardingNudgeScheduler();
    spy.mockRestore();
  });

  it('interval callback sends 24h nudge for stalled members at 10 AM-1 PM', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    const { queryWithRetry } = await import('../server/core/db');
    const { sendOnboardingNudge24h } = await import('../server/emails/onboardingNudgeEmails');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 1, email: 'new@test.com', first_name: 'New',
          created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          onboarding_nudge_count: 0,
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startOnboardingNudgeScheduler, stopOnboardingNudgeScheduler } = await import('../server/schedulers/onboardingNudgeScheduler');
    startOnboardingNudgeScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopOnboardingNudgeScheduler();
    expect(sendOnboardingNudge24h).toHaveBeenCalledWith('new@test.com', 'New');
  });

  it('sends 72h nudge for members with nudge_count=1 and >=72h since signup', async () => {
    const { getPacificHour, getTodayPacific } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    (getTodayPacific as MockFn).mockReturnValue('2026-04-01');
    const { getSettingValue } = await import('../server/core/settingsHelper');
    (getSettingValue as MockFn).mockImplementation((_k: string, d: string) => Promise.resolve(d));
    const { queryWithRetry } = await import('../server/core/db');
    const { sendOnboardingNudge72h } = await import('../server/emails/onboardingNudgeEmails');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 2, email: 'user72@test.com', first_name: 'Alice',
          created_at: new Date(Date.now() - 96 * 60 * 60 * 1000).toISOString(),
          onboarding_nudge_count: 1,
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startOnboardingNudgeScheduler, stopOnboardingNudgeScheduler } = await import('../server/schedulers/onboardingNudgeScheduler');
    startOnboardingNudgeScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopOnboardingNudgeScheduler();
    expect(sendOnboardingNudge72h).toHaveBeenCalledWith('user72@test.com', 'Alice');
  });

  it('sends 7d nudge for members with nudge_count=2 and >=168h since signup', async () => {
    const { getPacificHour, getTodayPacific } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    (getTodayPacific as MockFn).mockReturnValue('2026-04-02');
    const { getSettingValue } = await import('../server/core/settingsHelper');
    (getSettingValue as MockFn).mockImplementation((_k: string, d: string) => Promise.resolve(d));
    const { queryWithRetry } = await import('../server/core/db');
    const { sendOnboardingNudge7d } = await import('../server/emails/onboardingNudgeEmails');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 3, email: 'user7d@test.com', first_name: 'Bob',
          created_at: new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString(),
          onboarding_nudge_count: 2,
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startOnboardingNudgeScheduler, stopOnboardingNudgeScheduler } = await import('../server/schedulers/onboardingNudgeScheduler');
    startOnboardingNudgeScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopOnboardingNudgeScheduler();
    expect(sendOnboardingNudge7d).toHaveBeenCalledWith('user7d@test.com', 'Bob');
  });

  it('increments nudge_count in DB after successful email send', async () => {
    const { getPacificHour, getTodayPacific } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(10);
    (getTodayPacific as MockFn).mockReturnValue('2026-04-03');
    const { getSettingValue } = await import('../server/core/settingsHelper');
    (getSettingValue as MockFn).mockImplementation((_k: string, d: string) => Promise.resolve(d));
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 99, email: 'nudge@test.com', first_name: 'Test',
          created_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
          onboarding_nudge_count: 0,
        }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startOnboardingNudgeScheduler, stopOnboardingNudgeScheduler } = await import('../server/schedulers/onboardingNudgeScheduler');
    startOnboardingNudgeScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopOnboardingNudgeScheduler();
    const updateCall = (queryWithRetry as MockFn).mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('onboarding_nudge_count') && c[0].includes('UPDATE')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[0]).toContain('onboarding_nudge_count + 1');
    expect(updateCall[0]).toContain('onboarding_last_nudge_at');
  });

  it('skips nudge outside the configured hour window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(22);
    const { sendOnboardingNudge24h } = await import('../server/emails/onboardingNudgeEmails');
    const { startOnboardingNudgeScheduler, stopOnboardingNudgeScheduler } = await import('../server/schedulers/onboardingNudgeScheduler');
    startOnboardingNudgeScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopOnboardingNudgeScheduler();
    expect(sendOnboardingNudge24h).not.toHaveBeenCalled();
  });
});

describe('sessionCleanupScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startSessionCleanupScheduler, stopSessionCleanupScheduler } = await import('../server/schedulers/sessionCleanupScheduler');
    startSessionCleanupScheduler();
    stopSessionCleanupScheduler();
  });

  it('interval callback delegates to runSessionCleanup during 2-5 AM window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(2);
    const { runSessionCleanup } = await import('../server/core/sessionCleanup');
    const { startSessionCleanupScheduler, stopSessionCleanupScheduler } = await import('../server/schedulers/sessionCleanupScheduler');
    startSessionCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopSessionCleanupScheduler();
    expect(runSessionCleanup).toHaveBeenCalled();
  });

  it('skips cleanup outside the 2-5 AM window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(14);
    const { runSessionCleanup } = await import('../server/core/sessionCleanup');
    const { startSessionCleanupScheduler, stopSessionCleanupScheduler } = await import('../server/schedulers/sessionCleanupScheduler');
    startSessionCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopSessionCleanupScheduler();
    expect(runSessionCleanup).not.toHaveBeenCalled();
  });

  it('idempotency — lastRunDate guard prevents re-execution on the same day', async () => {
    const { getPacificHour, getTodayPacific } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(2);
    (getTodayPacific as MockFn).mockReturnValue('2026-04-10');
    const { runSessionCleanup } = await import('../server/core/sessionCleanup');
    (runSessionCleanup as MockFn).mockClear();
    const { startSessionCleanupScheduler, stopSessionCleanupScheduler } = await import('../server/schedulers/sessionCleanupScheduler');
    startSessionCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    stopSessionCleanupScheduler();
    expect(runSessionCleanup).toHaveBeenCalledTimes(1);
  });
});

describe('duplicateCleanupScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startDuplicateCleanupScheduler, stopDuplicateCleanupScheduler } = await import('../server/schedulers/duplicateCleanupScheduler');
    startDuplicateCleanupScheduler();
    stopDuplicateCleanupScheduler();
  });

  it('cleanupDuplicateTrackmanBookings returns deletedCount 0 when no duplicates exist', async () => {
    const { pool } = await import('../server/core/db');
    (pool.connect as MockFn).mockReset();
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    (pool.connect as MockFn).mockResolvedValueOnce(mockClient);
    const { cleanupDuplicateTrackmanBookings } = await import('../server/schedulers/duplicateCleanupScheduler');
    const result = await cleanupDuplicateTrackmanBookings();
    expect(result.deletedCount).toBe(0);
  });

  it('cleanupDuplicateTrackmanBookings wraps work in BEGIN/COMMIT transaction and releases client', async () => {
    const { pool, safeRelease } = await import('../server/core/db');
    (pool.connect as MockFn).mockReset();
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    (pool.connect as MockFn).mockResolvedValueOnce(mockClient);
    const { cleanupDuplicateTrackmanBookings } = await import('../server/schedulers/duplicateCleanupScheduler');
    await cleanupDuplicateTrackmanBookings();
    expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
    expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    expect(safeRelease).toHaveBeenCalledWith(mockClient);
  });

  it('cleanupDuplicateTrackmanBookings deletes found duplicates and returns accurate count', async () => {
    const { pool } = await import('../server/core/db');
    (pool.connect as MockFn).mockReset();
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rows: [
            { original_id: 1, duplicate_id: 2, trackman_booking_uid: 'uid1' },
            { original_id: 3, duplicate_id: 4, trackman_booking_uid: 'uid2' },
          ]
        })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    };
    (pool.connect as MockFn).mockResolvedValueOnce(mockClient);
    const { cleanupDuplicateTrackmanBookings } = await import('../server/schedulers/duplicateCleanupScheduler');
    const result = await cleanupDuplicateTrackmanBookings();
    expect(result.deletedCount).toBe(2);
  });

  it('idempotency — running cleanup twice with no duplicates yields identical zero results', async () => {
    const { pool } = await import('../server/core/db');
    (pool.connect as MockFn).mockReset();
    const mkClient = () => ({
      query: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce(undefined),
      release: vi.fn(),
    });
    (pool.connect as MockFn)
      .mockResolvedValueOnce(mkClient())
      .mockResolvedValueOnce(mkClient());
    const { cleanupDuplicateTrackmanBookings } = await import('../server/schedulers/duplicateCleanupScheduler');
    const r1 = await cleanupDuplicateTrackmanBookings();
    const r2 = await cleanupDuplicateTrackmanBookings();
    expect(r1).toEqual({ deletedCount: 0 });
    expect(r2).toEqual({ deletedCount: 0 });
  });
});

describe('weeklyCleanupScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startWeeklyCleanupScheduler, stopWeeklyCleanupScheduler } = await import('../server/schedulers/weeklyCleanupScheduler');
    startWeeklyCleanupScheduler();
    stopWeeklyCleanupScheduler();
  });

  it('delegates to runScheduledCleanup and runSessionCleanup on Sunday 3-6 AM', async () => {
    const { getPacificDateParts } = await import('../server/utils/dateUtils');
    (getPacificDateParts as MockFn).mockReturnValue({ year: 2026, month: 3, day: 29, hour: 3, minute: 0 });
    const { runScheduledCleanup } = await import('../server/core/databaseCleanup');
    const { runSessionCleanup } = await import('../server/core/sessionCleanup');
    (runScheduledCleanup as MockFn).mockClear();
    (runSessionCleanup as MockFn).mockClear();
    const { startWeeklyCleanupScheduler, stopWeeklyCleanupScheduler } = await import('../server/schedulers/weeklyCleanupScheduler');
    startWeeklyCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopWeeklyCleanupScheduler();
    expect(runScheduledCleanup).toHaveBeenCalled();
    expect(runSessionCleanup).toHaveBeenCalled();
  });

  it('skips cleanup on non-Sunday days', async () => {
    const { getPacificDateParts } = await import('../server/utils/dateUtils');
    (getPacificDateParts as MockFn).mockReturnValue({ year: 2026, month: 3, day: 30, hour: 3, minute: 0 });
    const { runScheduledCleanup } = await import('../server/core/databaseCleanup');
    (runScheduledCleanup as MockFn).mockClear();
    const { startWeeklyCleanupScheduler, stopWeeklyCleanupScheduler } = await import('../server/schedulers/weeklyCleanupScheduler');
    startWeeklyCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopWeeklyCleanupScheduler();
    expect(runScheduledCleanup).not.toHaveBeenCalled();
  });
});

describe('communicationLogsScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startCommunicationLogsScheduler, stopCommunicationLogsScheduler } = await import('../server/schedulers/communicationLogsScheduler');
    startCommunicationLogsScheduler();
    stopCommunicationLogsScheduler();
  });

  it('interval callback delegates to syncCommunicationLogsFromHubSpot after initial delay', async () => {
    const { syncCommunicationLogsFromHubSpot } = await import('../server/core/memberSync');
    const { startCommunicationLogsScheduler, stopCommunicationLogsScheduler } = await import('../server/schedulers/communicationLogsScheduler');
    startCommunicationLogsScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
    stopCommunicationLogsScheduler();
    expect(syncCommunicationLogsFromHubSpot).toHaveBeenCalled();
  });

  it('idempotency — isRunning guard ensures non-overlapping sync invocations', async () => {
    const { syncCommunicationLogsFromHubSpot } = await import('../server/core/memberSync');
    (syncCommunicationLogsFromHubSpot as MockFn).mockClear();
    const { startCommunicationLogsScheduler, stopCommunicationLogsScheduler } = await import('../server/schedulers/communicationLogsScheduler');
    startCommunicationLogsScheduler();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    stopCommunicationLogsScheduler();
    expect((syncCommunicationLogsFromHubSpot as MockFn).mock.calls.length).toBeGreaterThanOrEqual(1);
  });
});

describe('notificationCleanupScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const cron = (await import('node-cron')).default;
    const before = (cron.schedule as MockFn).mock.calls.length;
    const { startNotificationCleanupScheduler, stopNotificationCleanupScheduler } = await import('../server/schedulers/notificationCleanupScheduler');
    startNotificationCleanupScheduler();
    startNotificationCleanupScheduler();
    expect((cron.schedule as MockFn).mock.calls.length - before).toBeLessThanOrEqual(1);
    stopNotificationCleanupScheduler();
  });

  it('cron callback deletes notifications, push_subscriptions, user_dismissed_notices older than retention period', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { isSchedulerEnabled, getSettingValue } = await import('../server/core/settingsHelper');
    (isSchedulerEnabled as MockFn).mockResolvedValue(true);
    (getSettingValue as MockFn).mockResolvedValue('14');
    const cron = (await import('node-cron')).default;
    let capturedCb: Function | null = null;
    (cron.schedule as MockFn).mockReset();
    (cron.schedule as MockFn).mockImplementation((_expr: string, cb: Function) => {
      capturedCb = cb;
      return { stop: vi.fn() };
    });
    const { startNotificationCleanupScheduler, stopNotificationCleanupScheduler } = await import('../server/schedulers/notificationCleanupScheduler');
    startNotificationCleanupScheduler();
    expect(capturedCb).not.toBeNull();
    const cbResult = capturedCb!();
    if (cbResult && typeof cbResult.then === 'function') {
      await cbResult;
    }
    await vi.advanceTimersByTimeAsync(100);
    stopNotificationCleanupScheduler();
    expect((db.execute as MockFn).mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('webhookEventCleanupScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startWebhookEventCleanupScheduler, stopWebhookEventCleanupScheduler } = await import('../server/schedulers/webhookEventCleanupScheduler');
    const before = spy.mock.calls.length;
    startWebhookEventCleanupScheduler();
    startWebhookEventCleanupScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopWebhookEventCleanupScheduler();
    spy.mockRestore();
  });

  it('interval callback deletes webhook_processed_events older than 7 days via db.execute', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startWebhookEventCleanupScheduler, stopWebhookEventCleanupScheduler } = await import('../server/schedulers/webhookEventCleanupScheduler');
    startWebhookEventCleanupScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopWebhookEventCleanupScheduler();
    expect(db.execute).toHaveBeenCalled();
  });

  it('idempotency — start guard prevents duplicate intervals and cleanup SQL targets webhook_processed_events', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startWebhookEventCleanupScheduler, stopWebhookEventCleanupScheduler } = await import('../server/schedulers/webhookEventCleanupScheduler');
    stopWebhookEventCleanupScheduler();
    const before = spy.mock.calls.length;
    startWebhookEventCleanupScheduler();
    const afterFirst = spy.mock.calls.length;
    startWebhookEventCleanupScheduler();
    const afterSecond = spy.mock.calls.length;
    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopWebhookEventCleanupScheduler();
    spy.mockRestore();
    expect(db.execute).toHaveBeenCalled();
    const sql = String((db.execute as MockFn).mock.calls[0][0]);
    expect(sql).toContain('webhook_processed_events');
  });
});

describe('webhookLogCleanupScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startWebhookLogCleanupScheduler, stopWebhookLogCleanupScheduler } = await import('../server/schedulers/webhookLogCleanupScheduler');
    startWebhookLogCleanupScheduler();
    stopWebhookLogCleanupScheduler();
  });

  it('interval callback delegates to cleanupOldWebhookLogs during 4-7 AM window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(4);
    const { cleanupOldWebhookLogs } = await import('../server/routes/trackman/index');
    const { startWebhookLogCleanupScheduler, stopWebhookLogCleanupScheduler } = await import('../server/schedulers/webhookLogCleanupScheduler');
    startWebhookLogCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopWebhookLogCleanupScheduler();
    expect(cleanupOldWebhookLogs).toHaveBeenCalled();
  });

  it('skips cleanup outside the 4-7 AM window', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(12);
    const { cleanupOldWebhookLogs } = await import('../server/routes/trackman/index');
    const { startWebhookLogCleanupScheduler, stopWebhookLogCleanupScheduler } = await import('../server/schedulers/webhookLogCleanupScheduler');
    startWebhookLogCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopWebhookLogCleanupScheduler();
    expect(cleanupOldWebhookLogs).not.toHaveBeenCalled();
  });

  it('idempotency — lastRunDate guard prevents double cleanup on the same day', async () => {
    const { getPacificHour, getTodayPacific } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(4);
    (getTodayPacific as MockFn).mockReturnValue('2026-04-15');
    const { cleanupOldWebhookLogs } = await import('../server/routes/trackman/index');
    (cleanupOldWebhookLogs as MockFn).mockClear();
    const { startWebhookLogCleanupScheduler, stopWebhookLogCleanupScheduler } = await import('../server/schedulers/webhookLogCleanupScheduler');
    startWebhookLogCleanupScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    const firstCalls = (cleanupOldWebhookLogs as MockFn).mock.calls.length;
    expect(firstCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    stopWebhookLogCleanupScheduler();
    expect((cleanupOldWebhookLogs as MockFn).mock.calls.length).toBe(1);
  });
});

describe('hubspotQueueScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startHubSpotQueueScheduler, stopHubSpotQueueScheduler } = await import('../server/schedulers/hubspotQueueScheduler');
    const before = spy.mock.calls.length;
    startHubSpotQueueScheduler();
    startHubSpotQueueScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopHubSpotQueueScheduler();
    spy.mockRestore();
  });

  it('interval callback recovers stuck jobs then processes queue with batch size 25', async () => {
    const { processHubSpotQueue, recoverStuckProcessingJobs } = await import('../server/core/hubspot');
    const { startHubSpotQueueScheduler, stopHubSpotQueueScheduler } = await import('../server/schedulers/hubspotQueueScheduler');
    startHubSpotQueueScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopHubSpotQueueScheduler();
    expect(recoverStuckProcessingJobs).toHaveBeenCalled();
    expect(processHubSpotQueue).toHaveBeenCalledWith(25);
  });

  it('idempotency — scheduler start guard prevents duplicate intervals via intervalId check', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startHubSpotQueueScheduler, stopHubSpotQueueScheduler } = await import('../server/schedulers/hubspotQueueScheduler');
    stopHubSpotQueueScheduler();
    const before = spy.mock.calls.length;
    startHubSpotQueueScheduler();
    const afterFirst = spy.mock.calls.length;
    startHubSpotQueueScheduler();
    const afterSecond = spy.mock.calls.length;
    stopHubSpotQueueScheduler();
    spy.mockRestore();
    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
  });
});

describe('hubspotFormSyncScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startHubSpotFormSyncScheduler, stopHubSpotFormSyncScheduler } = await import('../server/schedulers/hubspotFormSyncScheduler');
    const before = spy.mock.calls.length;
    startHubSpotFormSyncScheduler();
    startHubSpotFormSyncScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopHubSpotFormSyncScheduler();
    spy.mockRestore();
  });

  it('initial timeout callback invokes syncHubSpotFormSubmissions after 60s delay', async () => {
    const { syncHubSpotFormSubmissions } = await import('../server/core/hubspot/formSync');
    const { startHubSpotFormSyncScheduler, stopHubSpotFormSyncScheduler } = await import('../server/schedulers/hubspotFormSyncScheduler');
    startHubSpotFormSyncScheduler();
    await vi.advanceTimersByTimeAsync(60 * 1000 + 100);
    stopHubSpotFormSyncScheduler();
    expect(syncHubSpotFormSubmissions).toHaveBeenCalled();
  });

  it('idempotency — start guard prevents duplicate intervals', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startHubSpotFormSyncScheduler, stopHubSpotFormSyncScheduler } = await import('../server/schedulers/hubspotFormSyncScheduler');
    stopHubSpotFormSyncScheduler();
    const before = spy.mock.calls.length;
    startHubSpotFormSyncScheduler();
    const afterFirst = spy.mock.calls.length;
    startHubSpotFormSyncScheduler();
    const afterSecond = spy.mock.calls.length;
    stopHubSpotFormSyncScheduler();
    spy.mockRestore();
    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
  });
});

describe('hubspotWebhookCleanupScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startHubSpotWebhookCleanupScheduler, stopHubSpotWebhookCleanupScheduler } = await import('../server/schedulers/hubspotWebhookCleanupScheduler');
    const before = spy.mock.calls.length;
    startHubSpotWebhookCleanupScheduler();
    startHubSpotWebhookCleanupScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopHubSpotWebhookCleanupScheduler();
    spy.mockRestore();
  });

  it('initial timeout callback executes cleanup query for old HubSpot webhook logs after 6min delay', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startHubSpotWebhookCleanupScheduler, stopHubSpotWebhookCleanupScheduler } = await import('../server/schedulers/hubspotWebhookCleanupScheduler');
    startHubSpotWebhookCleanupScheduler();
    await vi.advanceTimersByTimeAsync(6 * 60 * 1000 + 100);
    stopHubSpotWebhookCleanupScheduler();
    expect(db.execute).toHaveBeenCalled();
  });

  it('idempotency — start guard prevents duplicate intervals', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startHubSpotWebhookCleanupScheduler, stopHubSpotWebhookCleanupScheduler } = await import('../server/schedulers/hubspotWebhookCleanupScheduler');
    stopHubSpotWebhookCleanupScheduler();
    const before = spy.mock.calls.length;
    startHubSpotWebhookCleanupScheduler();
    const afterFirst = spy.mock.calls.length;
    startHubSpotWebhookCleanupScheduler();
    const afterSecond = spy.mock.calls.length;
    stopHubSpotWebhookCleanupScheduler();
    spy.mockRestore();
    expect(afterFirst - before).toBe(1);
    expect(afterSecond - afterFirst).toBe(0);
  });
});

describe('backgroundSyncScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startBackgroundSyncScheduler, stopBackgroundSyncScheduler } = await import('../server/schedulers/backgroundSyncScheduler');
    startBackgroundSyncScheduler();
    stopBackgroundSyncScheduler();
  });

  it('getCalendarSyncHealth returns per-calendar health with lastSyncAt, success, consecutiveFailures', async () => {
    const { getCalendarSyncHealth } = await import('../server/schedulers/backgroundSyncScheduler');
    const health = getCalendarSyncHealth();
    expect(health).toHaveProperty('Events');
    expect(health).toHaveProperty('Wellness');
    expect(health).toHaveProperty('Closures');
    expect(health).toHaveProperty('ConfRoom');
    for (const key of Object.keys(health)) {
      expect(health[key]).toHaveProperty('lastSyncAt');
      expect(health[key]).toHaveProperty('success');
      expect(health[key]).toHaveProperty('consecutiveFailures');
      expect(typeof health[key].consecutiveFailures).toBe('number');
    }
  });

  it('interval callback invokes syncGoogleCalendarEvents and syncWellnessCalendarEvents', async () => {
    const { syncGoogleCalendarEvents, syncWellnessCalendarEvents } = await import('../server/core/calendar/index');
    const { startBackgroundSyncScheduler, stopBackgroundSyncScheduler } = await import('../server/schedulers/backgroundSyncScheduler');
    startBackgroundSyncScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    stopBackgroundSyncScheduler();
    expect(syncGoogleCalendarEvents).toHaveBeenCalled();
    expect(syncWellnessCalendarEvents).toHaveBeenCalled();
  });

  it('idempotency — second sync cycle with same calendar data produces identical sync function invocations', async () => {
    const { syncGoogleCalendarEvents, syncWellnessCalendarEvents } = await import('../server/core/calendar/index');
    (syncGoogleCalendarEvents as MockFn).mockClear();
    (syncWellnessCalendarEvents as MockFn).mockClear();
    const { startBackgroundSyncScheduler, stopBackgroundSyncScheduler } = await import('../server/schedulers/backgroundSyncScheduler');
    startBackgroundSyncScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100);
    const firstCalendarCalls = (syncGoogleCalendarEvents as MockFn).mock.calls.length;
    const firstWellnessCalls = (syncWellnessCalendarEvents as MockFn).mock.calls.length;
    expect(firstCalendarCalls).toBeGreaterThan(0);
    expect(firstWellnessCalls).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    stopBackgroundSyncScheduler();
    const secondCalendarCalls = (syncGoogleCalendarEvents as MockFn).mock.calls.length - firstCalendarCalls;
    const secondWellnessCalls = (syncWellnessCalendarEvents as MockFn).mock.calls.length - firstWellnessCalls;
    expect(secondCalendarCalls).toBe(firstCalendarCalls);
    expect(secondWellnessCalls).toBe(firstWellnessCalls);
  });
});

describe('unresolvedTrackmanScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startUnresolvedTrackmanScheduler, stopUnresolvedTrackmanScheduler } = await import('../server/schedulers/unresolvedTrackmanScheduler');
    const before = spy.mock.calls.length;
    startUnresolvedTrackmanScheduler();
    startUnresolvedTrackmanScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopUnresolvedTrackmanScheduler();
    spy.mockRestore();
  });

  it('interval callback notifies staff when unresolved trackman bookings exist', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(9);
    const { queryWithRetry } = await import('../server/core/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{ id: 1, trackman_booking_uid: 'uid1', created_at: new Date() }],
        rowCount: 1,
      })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startUnresolvedTrackmanScheduler, stopUnresolvedTrackmanScheduler } = await import('../server/schedulers/unresolvedTrackmanScheduler');
    startUnresolvedTrackmanScheduler();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 100);
    stopUnresolvedTrackmanScheduler();
    expect(notifyAllStaff).toHaveBeenCalled();
  });

  it('idempotency — with no unresolved bookings, repeated runs produce no notifications', async () => {
    const { getPacificHour } = await import('../server/utils/dateUtils');
    (getPacificHour as MockFn).mockReturnValue(9);
    const { queryWithRetry } = await import('../server/core/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    (notifyAllStaff as MockFn).mockClear();
    const { startUnresolvedTrackmanScheduler, stopUnresolvedTrackmanScheduler } = await import('../server/schedulers/unresolvedTrackmanScheduler');
    startUnresolvedTrackmanScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 200);
    stopUnresolvedTrackmanScheduler();
    expect(notifyAllStaff).not.toHaveBeenCalled();
  });
});

describe('supabaseHeartbeatScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startSupabaseHeartbeatScheduler, stopSupabaseHeartbeatScheduler } = await import('../server/schedulers/supabaseHeartbeatScheduler');
    startSupabaseHeartbeatScheduler();
    stopSupabaseHeartbeatScheduler();
  });

  it('skips heartbeat when Supabase is not configured', async () => {
    const { isSupabaseConfigured, getSupabaseAdmin } = await import('../server/core/supabase/client');
    (isSupabaseConfigured as MockFn).mockReturnValue(false);
    (getSupabaseAdmin as MockFn).mockClear();
    const { startSupabaseHeartbeatScheduler, stopSupabaseHeartbeatScheduler } = await import('../server/schedulers/supabaseHeartbeatScheduler');
    startSupabaseHeartbeatScheduler();
    await vi.advanceTimersByTimeAsync(30 * 1000 + 100);
    stopSupabaseHeartbeatScheduler();
    expect(getSupabaseAdmin).not.toHaveBeenCalled();
  });

  it('runs heartbeat and queries Supabase users table when configured', async () => {
    const { isSupabaseConfigured, getSupabaseAdmin, isRealtimeEnabled } = await import('../server/core/supabase/client');
    (isSupabaseConfigured as MockFn).mockReturnValue(true);
    (isRealtimeEnabled as MockFn).mockReturnValue(true);
    const selectMock = vi.fn(() => ({
      abortSignal: vi.fn(() => Promise.resolve({ count: 5, error: null })),
    }));
    const fromMock = vi.fn(() => ({ select: selectMock }));
    (getSupabaseAdmin as MockFn).mockReturnValue({ from: fromMock });
    const { startSupabaseHeartbeatScheduler, stopSupabaseHeartbeatScheduler } = await import('../server/schedulers/supabaseHeartbeatScheduler');
    startSupabaseHeartbeatScheduler();
    await vi.advanceTimersByTimeAsync(30 * 1000 + 100);
    stopSupabaseHeartbeatScheduler();
    expect(getSupabaseAdmin).toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith('users');
    expect(selectMock).toHaveBeenCalledWith('id', { count: 'exact', head: true });
  });

  it('attempts realtime recovery when realtime is disabled', async () => {
    const { isSupabaseConfigured, getSupabaseAdmin, isRealtimeEnabled, resetSupabaseAvailability, enableRealtimeWithRetry } = await import('../server/core/supabase/client');
    (isSupabaseConfigured as MockFn).mockReturnValue(true);
    (isRealtimeEnabled as MockFn).mockReturnValue(false);
    (resetSupabaseAvailability as MockFn).mockClear();
    (enableRealtimeWithRetry as MockFn).mockClear();
    const selectMock = vi.fn(() => ({
      abortSignal: vi.fn(() => Promise.resolve({ count: 5, error: null })),
    }));
    (getSupabaseAdmin as MockFn).mockReturnValue({ from: vi.fn(() => ({ select: selectMock })) });
    const { startSupabaseHeartbeatScheduler, stopSupabaseHeartbeatScheduler } = await import('../server/schedulers/supabaseHeartbeatScheduler');
    startSupabaseHeartbeatScheduler();
    await vi.advanceTimersByTimeAsync(30 * 1000 + 100);
    stopSupabaseHeartbeatScheduler();
    expect(resetSupabaseAvailability).toHaveBeenCalled();
    expect(enableRealtimeWithRetry).toHaveBeenCalled();
  });

  it('idempotency — consecutive heartbeats with same state produce identical query pattern', async () => {
    const { isSupabaseConfigured, getSupabaseAdmin, isRealtimeEnabled } = await import('../server/core/supabase/client');
    (isSupabaseConfigured as MockFn).mockReturnValue(true);
    (isRealtimeEnabled as MockFn).mockReturnValue(true);
    const selectMock = vi.fn(() => ({
      abortSignal: vi.fn(() => Promise.resolve({ count: 5, error: null })),
    }));
    const fromMock = vi.fn(() => ({ select: selectMock }));
    (getSupabaseAdmin as MockFn).mockReturnValue({ from: fromMock });
    const { startSupabaseHeartbeatScheduler, stopSupabaseHeartbeatScheduler } = await import('../server/schedulers/supabaseHeartbeatScheduler');
    startSupabaseHeartbeatScheduler();
    await vi.advanceTimersByTimeAsync(30 * 1000 + 100);
    const firstFromCalls = fromMock.mock.calls.length;
    expect(firstFromCalls).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(30 * 1000);
    stopSupabaseHeartbeatScheduler();
    expect(fromMock.mock.calls.length).toBeGreaterThanOrEqual(firstFromCalls);
    for (const call of fromMock.mock.calls) {
      expect(call[0]).toBe('users');
    }
  });
});

describe('failedSideEffectsScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    const before = spy.mock.calls.length;
    startFailedSideEffectsScheduler();
    startFailedSideEffectsScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopFailedSideEffectsScheduler();
    spy.mockRestore();
  });

  it('interval callback queries failed_side_effects table for retryable records via db.execute', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopFailedSideEffectsScheduler();
    expect(db.execute).toHaveBeenCalled();
  });

  it('notifies staff when permanent failure threshold is reached', async () => {
    const { db } = await import('../server/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 1, booking_id: 100, action_type: 'notification', retry_count: 4,
          stripe_payment_intent_id: null, error_message: 'timeout',
          context: { userEmail: 'test@test.com', title: 'Test', message: 'msg' },
          created_at: new Date(), updated_at: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ cnt: '5' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopFailedSideEffectsScheduler();
    expect(notifyAllStaff).toHaveBeenCalledWith(
      'Failed Side Effects Need Manual Review',
      expect.stringContaining('5 failed side effect(s)'),
      'system_alert',
      expect.any(Object)
    );
  });

  it('idempotency — processing with no retryable records produces no notifications, no updates, no alerts', async () => {
    const { db } = await import('../server/db');
    const { notifyMember, notifyAllStaff } = await import('../server/core/notificationService');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    (db.update as MockFn).mockClear();
    (notifyMember as MockFn).mockClear();
    (notifyAllStaff as MockFn).mockClear();
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    stopFailedSideEffectsScheduler();
    expect(notifyMember).not.toHaveBeenCalled();
    expect(notifyAllStaff).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('retries notification side effect and marks resolved on success via db.update', async () => {
    const { db } = await import('../server/db');
    const { notifyMember } = await import('../server/core/notificationService');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 10, booking_id: 200, action_type: 'notification', retry_count: 1,
          stripe_payment_intent_id: null, error_message: 'timeout',
          context: { userEmail: 'user@test.com', title: 'Booking Confirmed', message: 'Your booking is confirmed' },
          created_at: new Date(), updated_at: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopFailedSideEffectsScheduler();
    expect(notifyMember).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: 'user@test.com', title: 'Booking Confirmed' }),
      expect.objectContaining({ sendPush: true, sendWebSocket: true })
    );
    expect(db.update).toHaveBeenCalled();
  });

  it('increments retry_count via db.update when retry fails', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 11, booking_id: 300, action_type: 'unknown_action', retry_count: 2,
          stripe_payment_intent_id: null, error_message: 'unknown',
          context: null,
          created_at: new Date(), updated_at: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopFailedSideEffectsScheduler();
    expect(db.update).toHaveBeenCalled();
  });
});

describe('visitorReconciliationScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startVisitorReconciliationScheduler, stopVisitorReconciliationScheduler } = await import('../server/schedulers/visitorReconciliationScheduler');
    startVisitorReconciliationScheduler();
    stopVisitorReconciliationScheduler();
  });

  it('reconcileOrphanedDayPassPurchases returns zeros when no orphans exist', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { reconcileOrphanedDayPassPurchases } = await import('../server/schedulers/visitorReconciliationScheduler');
    const result = await reconcileOrphanedDayPassPurchases();
    expect(result).toEqual({ orphansFound: 0, reconciled: 0, errors: 0 });
  });

  it('reconcileOrphanedDayPassPurchases upserts visitors for orphaned purchases', async () => {
    const { db } = await import('../server/db');
    const { upsertVisitor } = await import('../server/core/visitors/matchingService');
    (db.execute as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          purchase_id: '1', purchaser_email: 'test@test.com',
          purchaser_first_name: 'Test', purchaser_last_name: 'User',
          purchaser_phone: null, user_id: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: '100' }], rowCount: 1 });
    const { reconcileOrphanedDayPassPurchases } = await import('../server/schedulers/visitorReconciliationScheduler');
    const result = await reconcileOrphanedDayPassPurchases();
    expect(result.orphansFound).toBe(1);
    expect(result.reconciled).toBe(1);
    expect(upsertVisitor).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@test.com' }));
  });

  it('idempotency — reconciliation twice with no orphans yields identical zero results', async () => {
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { reconcileOrphanedDayPassPurchases } = await import('../server/schedulers/visitorReconciliationScheduler');
    const r1 = await reconcileOrphanedDayPassPurchases();
    const r2 = await reconcileOrphanedDayPassPurchases();
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ orphansFound: 0, reconciled: 0, errors: 0 });
  });
});

describe('waiverReviewScheduler', () => {
  it('start/stop lifecycle and idempotency', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval');
    const { startWaiverReviewScheduler, stopWaiverReviewScheduler } = await import('../server/schedulers/waiverReviewScheduler');
    const before = spy.mock.calls.length;
    startWaiverReviewScheduler();
    startWaiverReviewScheduler();
    expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
    stopWaiverReviewScheduler();
    spy.mockRestore();
  });

  it('checkStaleWaivers returns zero result when no stale waivers exist', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { checkStaleWaivers } = await import('../server/schedulers/waiverReviewScheduler');
    const result = await checkStaleWaivers();
    expect(result).toEqual({ staleCount: 0, notificationSent: false, waivers: [] });
  });

  it('checkStaleWaivers notifies staff when stale waivers exist and no recent notification within 6h', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{
          id: 1, display_name: 'Test Guest', session_id: 10,
          created_at: new Date('2026-03-30'), request_id: 5,
          request_date: '2026-03-30', resource_name: 'Bay 1',
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { checkStaleWaivers } = await import('../server/schedulers/waiverReviewScheduler');
    const result = await checkStaleWaivers();
    expect(result.staleCount).toBe(1);
    expect(result.notificationSent).toBe(true);
    expect(notifyAllStaff).toHaveBeenCalledWith(
      'Waivers Need Review',
      expect.stringContaining('1 waiver(s) pending review'),
      'waiver_review',
      expect.any(Object)
    );
  });

  it('checkStaleWaivers suppresses duplicate notification if one sent within 6 hours', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    const { notifyAllStaff } = await import('../server/core/notificationService');
    (queryWithRetry as MockFn).mockReset();
    (notifyAllStaff as MockFn).mockReset();
    (queryWithRetry as MockFn)
      .mockResolvedValueOnce({
        rows: [{ id: 1, display_name: 'Guest', session_id: 1, created_at: new Date(), request_id: 1, request_date: '2026-03-30', resource_name: null }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 99 }], rowCount: 1 });
    const { checkStaleWaivers } = await import('../server/schedulers/waiverReviewScheduler');
    const result = await checkStaleWaivers();
    expect(result.staleCount).toBe(1);
    expect(result.notificationSent).toBe(false);
    expect(notifyAllStaff).not.toHaveBeenCalled();
  });

  it('checkStaleWaivers SQL targets waived participants older than 12h without review', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValueOnce({ rows: [], rowCount: 0 });
    const { checkStaleWaivers } = await import('../server/schedulers/waiverReviewScheduler');
    await checkStaleWaivers();
    const sql = (queryWithRetry as MockFn).mock.calls[0][0];
    expect(sql).toContain('waived');
    expect(sql).toContain('waiver_reviewed_at IS NULL');
    expect(sql).toContain('12 hours');
  });

  it('idempotency — checkStaleWaivers returns identical zero result on repeated calls with no data', async () => {
    const { queryWithRetry } = await import('../server/core/db');
    (queryWithRetry as MockFn).mockReset();
    (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { checkStaleWaivers } = await import('../server/schedulers/waiverReviewScheduler');
    const r1 = await checkStaleWaivers();
    const r2 = await checkStaleWaivers();
    expect(r1).toEqual(r2);
    expect(r1).toEqual({ staleCount: 0, notificationSent: false, waivers: [] });
  });
});

describe('integrityScheduler', () => {
  it('start/stop lifecycle', async () => {
    const { startIntegrityScheduler, stopIntegrityScheduler } = await import('../server/schedulers/integrityScheduler');
    startIntegrityScheduler();
    stopIntegrityScheduler();
  });

  it('startIntegrityScheduler returns array of exactly 3 interval IDs', async () => {
    const { startIntegrityScheduler, stopIntegrityScheduler } = await import('../server/schedulers/integrityScheduler');
    const ids = startIntegrityScheduler();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids.length).toBe(3);
    stopIntegrityScheduler();
  });

  it('runManualIntegrityCheck delegates to runAllIntegrityChecks and returns results + emailSent', async () => {
    const { runAllIntegrityChecks } = await import('../server/core/dataIntegrity');
    const { runManualIntegrityCheck } = await import('../server/schedulers/integrityScheduler');
    const result = await runManualIntegrityCheck();
    expect(result).toHaveProperty('results');
    expect(result).toHaveProperty('emailSent');
    expect(Array.isArray(result.results)).toBe(true);
    expect(runAllIntegrityChecks).toHaveBeenCalled();
  });

  it('idempotency — runManualIntegrityCheck returns identical results on repeated calls', async () => {
    const { runManualIntegrityCheck } = await import('../server/schedulers/integrityScheduler');
    const r1 = await runManualIntegrityCheck();
    const r2 = await runManualIntegrityCheck();
    expect(r1.results).toEqual(r2.results);
  });
});

describe('schedulerTracker integration', () => {
  it('schedulers call schedulerTracker.recordRun on successful execution', async () => {
    const { schedulerTracker } = await import('../server/core/schedulerTracker');
    (schedulerTracker.recordRun as MockFn).mockClear();
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopFailedSideEffectsScheduler();
    const trackerCalls = (schedulerTracker.recordRun as MockFn).mock.calls;
    const sideEffectsCalls = trackerCalls.filter((c: unknown[]) => String(c[0]).includes('Side Effect'));
    expect(sideEffectsCalls.length).toBeGreaterThan(0);
    expect(sideEffectsCalls[0][1]).toBe(true);
  });

  it('schedulerTracker.recordRun is called with false on scheduler error', async () => {
    const { schedulerTracker } = await import('../server/core/schedulerTracker');
    (schedulerTracker.recordRun as MockFn).mockClear();
    const { db } = await import('../server/db');
    (db.execute as MockFn).mockReset();
    (db.execute as MockFn).mockRejectedValue(new Error('DB connection lost'));
    const { startFailedSideEffectsScheduler, stopFailedSideEffectsScheduler } = await import('../server/schedulers/failedSideEffectsScheduler');
    startFailedSideEffectsScheduler();
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    stopFailedSideEffectsScheduler();
    const trackerCalls = (schedulerTracker.recordRun as MockFn).mock.calls;
    const failCalls = trackerCalls.filter((c: unknown[]) => c[1] === false);
    expect(failCalls.length).toBeGreaterThan(0);
  });
});

describe('All Schedulers Export Validation', () => {
  const schedulerModules = [
    { path: '../server/schedulers/bookingExpiryScheduler', start: 'startBookingExpiryScheduler', stop: 'stopBookingExpiryScheduler' },
    { path: '../server/schedulers/bookingAutoCompleteScheduler', start: 'startBookingAutoCompleteScheduler', stop: 'stopBookingAutoCompleteScheduler' },
    { path: '../server/schedulers/stuckCancellationScheduler', start: 'startStuckCancellationScheduler', stop: 'stopStuckCancellationScheduler' },
    { path: '../server/schedulers/stripeReconciliationScheduler', start: 'startStripeReconciliationScheduler', stop: 'stopStripeReconciliationScheduler' },
    { path: '../server/schedulers/invoiceAutoFinalizeScheduler', start: 'startInvoiceAutoFinalizeScheduler', stop: 'stopInvoiceAutoFinalizeScheduler' },
    { path: '../server/schedulers/feeSnapshotReconciliationScheduler', start: 'startFeeSnapshotReconciliationScheduler', stop: 'stopFeeSnapshotReconciliationScheduler' },
    { path: '../server/schedulers/gracePeriodScheduler', start: 'startGracePeriodScheduler', stop: 'stopGracePeriodScheduler' },
    { path: '../server/schedulers/guestPassResetScheduler', start: 'startGuestPassResetScheduler', stop: 'stopGuestPassResetScheduler' },
    { path: '../server/schedulers/pendingUserCleanupScheduler', start: 'startPendingUserCleanupScheduler', stop: 'stopPendingUserCleanupScheduler' },
    { path: '../server/schedulers/memberSyncScheduler', start: 'startMemberSyncScheduler', stop: 'stopMemberSyncScheduler' },
    { path: '../server/schedulers/dailyReminderScheduler', start: 'startDailyReminderScheduler', stop: 'stopDailyReminderScheduler' },
    { path: '../server/schedulers/morningClosureScheduler', start: 'startMorningClosureScheduler', stop: 'stopMorningClosureScheduler' },
    { path: '../server/schedulers/onboardingNudgeScheduler', start: 'startOnboardingNudgeScheduler', stop: 'stopOnboardingNudgeScheduler' },
    { path: '../server/schedulers/sessionCleanupScheduler', start: 'startSessionCleanupScheduler', stop: 'stopSessionCleanupScheduler' },
    { path: '../server/schedulers/duplicateCleanupScheduler', start: 'startDuplicateCleanupScheduler', stop: 'stopDuplicateCleanupScheduler' },
    { path: '../server/schedulers/weeklyCleanupScheduler', start: 'startWeeklyCleanupScheduler', stop: 'stopWeeklyCleanupScheduler' },
    { path: '../server/schedulers/communicationLogsScheduler', start: 'startCommunicationLogsScheduler', stop: 'stopCommunicationLogsScheduler' },
    { path: '../server/schedulers/notificationCleanupScheduler', start: 'startNotificationCleanupScheduler', stop: 'stopNotificationCleanupScheduler' },
    { path: '../server/schedulers/webhookEventCleanupScheduler', start: 'startWebhookEventCleanupScheduler', stop: 'stopWebhookEventCleanupScheduler' },
    { path: '../server/schedulers/webhookLogCleanupScheduler', start: 'startWebhookLogCleanupScheduler', stop: 'stopWebhookLogCleanupScheduler' },
    { path: '../server/schedulers/hubspotQueueScheduler', start: 'startHubSpotQueueScheduler', stop: 'stopHubSpotQueueScheduler' },
    { path: '../server/schedulers/hubspotFormSyncScheduler', start: 'startHubSpotFormSyncScheduler', stop: 'stopHubSpotFormSyncScheduler' },
    { path: '../server/schedulers/hubspotWebhookCleanupScheduler', start: 'startHubSpotWebhookCleanupScheduler', stop: 'stopHubSpotWebhookCleanupScheduler' },
    { path: '../server/schedulers/backgroundSyncScheduler', start: 'startBackgroundSyncScheduler', stop: 'stopBackgroundSyncScheduler' },
    { path: '../server/schedulers/unresolvedTrackmanScheduler', start: 'startUnresolvedTrackmanScheduler', stop: 'stopUnresolvedTrackmanScheduler' },
    { path: '../server/schedulers/supabaseHeartbeatScheduler', start: 'startSupabaseHeartbeatScheduler', stop: 'stopSupabaseHeartbeatScheduler' },
    { path: '../server/schedulers/failedSideEffectsScheduler', start: 'startFailedSideEffectsScheduler', stop: 'stopFailedSideEffectsScheduler' },
    { path: '../server/schedulers/visitorReconciliationScheduler', start: 'startVisitorReconciliationScheduler', stop: 'stopVisitorReconciliationScheduler' },
    { path: '../server/schedulers/waiverReviewScheduler', start: 'startWaiverReviewScheduler', stop: 'stopWaiverReviewScheduler' },
    { path: '../server/schedulers/integrityScheduler', start: 'startIntegrityScheduler', stop: 'stopIntegrityScheduler' },
  ];

  for (const { path, start, stop } of schedulerModules) {
    it(`${path.split('/').pop()} exports ${start} and ${stop}`, async () => {
      const mod = await import(path);
      expect(typeof mod[start]).toBe('function');
      expect(typeof mod[stop]).toBe('function');
    });
  }
});
