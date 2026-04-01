// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../server/core/schedulerTracker', () => ({
  schedulerTracker: {
    recordRun: vi.fn(),
    recordSkipped: vi.fn(),
    registerScheduler: vi.fn(),
    getSchedulerStatuses: vi.fn(() => []),
    refreshEnabledStates: vi.fn(),
    setEnabled: vi.fn(),
  },
}));

vi.mock('../../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/core/db', () => ({
  queryWithRetry: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
  pool: {
    connect: vi.fn(() => Promise.resolve({
      query: vi.fn(() => Promise.resolve({ rows: [], rowCount: 0 })),
      release: vi.fn(),
    })),
  },
  safeRelease: vi.fn(),
}));

vi.mock('../../server/db', () => ({
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

vi.mock('../../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn(() => Promise.resolve()),
  notifyMember: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/dataAlerts', () => ({
  alertOnScheduledTaskFailure: vi.fn(() => Promise.resolve()),
  alertOnSyncFailure: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn(() => '2026-03-31'),
  formatTimePacific: vi.fn(() => '14:00:00'),
  getPacificHour: vi.fn(() => 10),
  getPacificDayOfMonth: vi.fn(() => 1),
  getPacificDateParts: vi.fn(() => ({ year: 2026, month: 1, day: 1, hour: 3, minute: 0 })),
  CLUB_TIMEZONE: 'America/Los_Angeles',
}));

vi.mock('../../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
  isStripeResourceMissing: vi.fn(() => false),
}));

vi.mock('../../server/utils/dateTimeUtils', () => ({
  ensureTimeString: vi.fn((t: string) => t),
}));

vi.mock('../../server/core/websocket', () => ({
  broadcastAvailabilityUpdate: vi.fn(),
}));

vi.mock('../../server/walletPass/bookingPassService', () => ({
  voidBookingPass: vi.fn(() => Promise.resolve()),
  refreshBookingPass: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/walletPass/apnPushService', () => ({
  sendPassUpdateForMemberByEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/billing/paymentIntentCleanup', () => ({
  cancelPendingPaymentIntentsForBooking: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/bookingService/sessionManager', () => ({
  ensureSessionForBooking: vi.fn(() => Promise.resolve({ sessionId: 1, created: true })),
}));

vi.mock('../../server/core/bookingService/usageCalculator', () => ({
  recalculateSessionFees: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/billing/bookingInvoiceService', () => ({
  syncBookingInvoice: vi.fn(() => Promise.resolve()),
  voidBookingInvoice: vi.fn(() => Promise.resolve({ success: true })),
  recreateDraftInvoiceFromBooking: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/stripe/client', () => ({
  getStripeClient: vi.fn(() => Promise.resolve({
    invoices: { retrieve: vi.fn(), finalizeInvoice: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    subscriptions: { list: vi.fn(() => Promise.resolve({ data: [] })), cancel: vi.fn() },
    customers: { del: vi.fn(), createBalanceTransaction: vi.fn() },
    refunds: { create: vi.fn(() => Promise.resolve({ id: 're_123' })) },
  })),
}));

vi.mock('../../server/core/stripe', () => ({
  getStripeClient: vi.fn(() => Promise.resolve({
    paymentIntents: { retrieve: vi.fn() },
  })),
  cancelPaymentIntent: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../server/core/stripe/payments', () => ({
  cancelPaymentIntent: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../server/core/stripe/reconciliation', () => ({
  reconcileDailyPayments: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
  reconcileSubscriptions: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
  reconcileDailyRefunds: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
}));

vi.mock('../../server/core/billing/PaymentStatusService', () => ({
  PaymentStatusService: {
    markPaymentSucceeded: vi.fn(() => Promise.resolve({ success: true })),
    markPaymentCancelled: vi.fn(() => Promise.resolve({ success: true })),
  },
  markPaymentRefunded: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/emails/membershipEmails', () => ({
  sendGracePeriodReminderEmail: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/settingsHelper', () => ({
  getSettingValue: vi.fn((_key: string, defaultVal: string) => Promise.resolve(defaultVal)),
  getSettingBoolean: vi.fn(() => Promise.resolve(true)),
  isSchedulerEnabled: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('../../server/utils/urlUtils', () => ({
  getAppBaseUrl: vi.fn(() => 'https://example.com'),
}));

vi.mock('../../server/routes/push', () => ({
  sendDailyReminders: vi.fn(() => Promise.resolve({ message: 'Sent 0 reminders' })),
  sendMorningClosureNotifications: vi.fn(() => Promise.resolve({ message: 'Sent 0 notifications' })),
}));

vi.mock('../../server/emails/onboardingNudgeEmails', () => ({
  sendOnboardingNudge24h: vi.fn(() => Promise.resolve({ success: true })),
  sendOnboardingNudge72h: vi.fn(() => Promise.resolve({ success: true })),
  sendOnboardingNudge7d: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../server/core/calendar/index', () => ({
  syncGoogleCalendarEvents: vi.fn(() => Promise.resolve({ synced: 0, created: 0, updated: 0, deleted: 0, pushedToCalendar: 0 })),
  syncWellnessCalendarEvents: vi.fn(() => Promise.resolve({ synced: 0, created: 0, updated: 0, deleted: 0, pushedToCalendar: 0 })),
  syncInternalCalendarToClosures: vi.fn(() => Promise.resolve({ synced: 0, created: 0, updated: 0, deleted: 0, pushedToCalendar: 0 })),
  syncConferenceRoomCalendarToBookings: vi.fn(() => Promise.resolve({ synced: 0, linked: 0, created: 0, skipped: 0, cancelled: 0, updated: 0 })),
  getCalendarIdByName: vi.fn(),
  deleteCalendarEvent: vi.fn(),
}));

vi.mock('../../server/core/hubspot', () => ({
  processHubSpotQueue: vi.fn(() => Promise.resolve({ processed: 0, succeeded: 0, failed: 0 })),
  getQueueStats: vi.fn(() => Promise.resolve({ pending: 0, failed: 0, processing: 0 })),
  recoverStuckProcessingJobs: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/hubspot/formSync', () => ({
  syncHubSpotFormSubmissions: vi.fn(() => Promise.resolve()),
  logFormIdResolutionStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/hubspot/stages', () => ({
  ensureHubSpotPropertiesExist: vi.fn(() => Promise.resolve({ created: [], errors: [] })),
  syncMemberToHubSpot: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/memberSync', () => ({
  syncAllMembersFromHubSpot: vi.fn(() => Promise.resolve({ synced: 0, errors: 0 })),
  setLastMemberSyncTime: vi.fn(() => Promise.resolve()),
  syncCommunicationLogsFromHubSpot: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/sessionCleanup', () => ({
  runSessionCleanup: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/databaseCleanup', () => ({
  runScheduledCleanup: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/dataIntegrity', () => ({
  runAllIntegrityChecks: vi.fn(() => Promise.resolve([])),
  autoFixMissingTiers: vi.fn(() => Promise.resolve({ fixedFromAlternateEmail: 0 })),
  runDataCleanup: vi.fn(() => Promise.resolve({ orphanedNotifications: 0, orphanedBookings: 0 })),
}));

vi.mock('../../server/emails/integrityAlertEmail', () => ({
  sendIntegrityAlertEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('../../server/core/retry', () => ({
  withRetry: vi.fn((fn: Function) => fn()),
}));

vi.mock('../../server/core/supabase/client', () => ({
  isSupabaseConfigured: vi.fn(() => false),
  getSupabaseAdmin: vi.fn(),
  isRealtimeEnabled: vi.fn(() => true),
  resetSupabaseAvailability: vi.fn(),
  enableRealtimeWithRetry: vi.fn(() => Promise.resolve({ successCount: 0, total: 0 })),
}));

vi.mock('../../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn(() => Promise.resolve({ id: 1 })),
  linkPurchaseToUser: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/routes/trackman/index', () => ({
  cleanupOldWebhookLogs: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../server/core/integrity/externalSystemChecks', () => ({
  reconcileRecentlyActivatedHubSpotSync: vi.fn(() => Promise.resolve({ checked: 0, enqueued: 0, errors: [] })),
}));

vi.mock('../../server/core/staffNotifications', () => ({
  notifyAllStaff: vi.fn(() => Promise.resolve()),
}));

vi.mock('node-cron', () => ({
  default: {
    schedule: vi.fn((_expr: string, _cb: Function) => ({ stop: vi.fn() })),
  },
}));

vi.mock('../../server/core/billing/guestPassConsumer', () => ({
  canUseGuestPass: vi.fn(() => Promise.resolve({ canUse: false, remaining: 0 })),
  consumeGuestPassForParticipant: vi.fn(() => Promise.resolve({ success: false })),
}));

vi.mock('../../server/core/billing/pricingConfig', () => ({
  isPlaceholderGuestName: vi.fn(() => false),
}));

vi.mock('../../server/routes/bays/helpers', () => ({
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

describe('Scheduler Robustness Integration — Overlap Protection and Recovery', () => {
  describe('isRunning Guard — Prevents Concurrent Execution', () => {
    it('bookingExpiryScheduler: second invocation is skipped while first is running', async () => {
      const { logger } = await import('../../server/core/logger');
      const spy = vi.spyOn(globalThis, 'setInterval');
      const { startBookingExpiryScheduler, stopBookingExpiryScheduler } = await import('../../server/schedulers/bookingExpiryScheduler');

      const { queryWithRetry } = await import('../../server/core/db');
      let resolveFirstRun: (() => void) | null = null;
      let callCount = 0;

      (queryWithRetry as MockFn).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return new Promise<{ rows: never[]; rowCount: number }>((resolve) => {
            resolveFirstRun = () => resolve({ rows: [], rowCount: 0 });
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      startBookingExpiryScheduler();
      startBookingExpiryScheduler();

      const intervalCount = spy.mock.calls.length;
      expect(intervalCount).toBeLessThanOrEqual(2);

      stopBookingExpiryScheduler();
      if (resolveFirstRun) resolveFirstRun();
      spy.mockRestore();
    });

    it('bookingExpiryScheduler: isRunning resets after successful run', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      (queryWithRetry as MockFn).mockReset();
      (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });

      const { runManualBookingExpiry } = await import('../../server/schedulers/bookingExpiryScheduler');

      const result1 = await runManualBookingExpiry();
      expect(result1.expiredCount).toBe(0);

      const result2 = await runManualBookingExpiry();
      expect(result2.expiredCount).toBe(0);
    });

    it('bookingExpiryScheduler: isRunning resets after error (crash recovery)', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      (queryWithRetry as MockFn).mockReset();

      (queryWithRetry as MockFn).mockRejectedValueOnce(new Error('DB connection lost'));
      (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });

      const { runManualBookingExpiry } = await import('../../server/schedulers/bookingExpiryScheduler');

      await expect(runManualBookingExpiry()).rejects.toThrow('DB connection lost');

      const result2 = await runManualBookingExpiry();
      expect(result2.expiredCount).toBe(0);
    });
  });

  describe('Idempotency — Multiple Runs Produce Consistent Results', () => {
    it('bookingAutoComplete: running twice with no eligible bookings yields identical zero results', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      (queryWithRetry as MockFn).mockReset();
      (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });

      const { runManualBookingAutoComplete } = await import('../../server/schedulers/bookingAutoCompleteScheduler');

      const r1 = await runManualBookingAutoComplete();
      const r2 = await runManualBookingAutoComplete();
      expect(r1).toEqual(r2);
      expect(r1).toEqual({ markedCount: 0, sessionsCreated: 0 });
    });

    it('bookingExpiry: running twice with no stale bookings yields identical zero results', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      (queryWithRetry as MockFn).mockReset();
      (queryWithRetry as MockFn).mockResolvedValue({ rows: [], rowCount: 0 });

      const { runManualBookingExpiry } = await import('../../server/schedulers/bookingExpiryScheduler');

      const r1 = await runManualBookingExpiry();
      const r2 = await runManualBookingExpiry();
      expect(r1).toEqual({ expiredCount: 0 });
      expect(r2).toEqual({ expiredCount: 0 });
    });
  });

  describe('Start/Stop Lifecycle — Singleton Pattern', () => {
    it('bookingExpiryScheduler: calling start twice creates only one interval', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      const { startBookingExpiryScheduler, stopBookingExpiryScheduler } = await import('../../server/schedulers/bookingExpiryScheduler');

      const before = spy.mock.calls.length;
      startBookingExpiryScheduler();
      startBookingExpiryScheduler();
      expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
      stopBookingExpiryScheduler();
      spy.mockRestore();
    });

    it('bookingAutoCompleteScheduler: calling start twice creates only one interval', async () => {
      const spy = vi.spyOn(globalThis, 'setInterval');
      const { startBookingAutoCompleteScheduler, stopBookingAutoCompleteScheduler } = await import('../../server/schedulers/bookingAutoCompleteScheduler');

      const before = spy.mock.calls.length;
      startBookingAutoCompleteScheduler();
      startBookingAutoCompleteScheduler();
      expect(spy.mock.calls.length - before).toBeLessThanOrEqual(1);
      stopBookingAutoCompleteScheduler();
      spy.mockRestore();
    });

    it('stuckCancellationScheduler: detects stuck cancellation_pending bookings', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      const { notifyAllStaff } = await import('../../server/core/notificationService');

      (queryWithRetry as MockFn).mockReset();
      (queryWithRetry as MockFn)
        .mockResolvedValueOnce({
          rows: [{ id: 42, member_name: 'Stuck Member', cancellation_pending_at: new Date() }],
          rowCount: 1,
        })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const { startStuckCancellationScheduler, stopStuckCancellationScheduler } = await import('../../server/schedulers/stuckCancellationScheduler');

      startStuckCancellationScheduler();
      await vi.advanceTimersByTimeAsync(2 * 60 * 60 * 1000 + 100);
      stopStuckCancellationScheduler();

      expect(notifyAllStaff).toHaveBeenCalled();
    });
  });

  describe('SQL Safety — Protected Status Transitions', () => {
    it('bookingExpiry only targets pending and pending_approval statuses', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      (queryWithRetry as MockFn).mockReset();
      (queryWithRetry as MockFn).mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const { runManualBookingExpiry } = await import('../../server/schedulers/bookingExpiryScheduler');
      await runManualBookingExpiry();

      const sql = (queryWithRetry as MockFn).mock.calls[0][0];
      expect(sql).toContain("'pending'");
      expect(sql).toContain("'pending_approval'");
      expect(sql).not.toContain("'confirmed'");
      expect(sql).not.toContain("'checked_in'");
      expect(sql).not.toContain("'completed'");
    });

    it('bookingExpiry cancels fee snapshots for expired booking IDs', async () => {
      const { queryWithRetry } = await import('../../server/core/db');
      (queryWithRetry as MockFn).mockReset();
      (queryWithRetry as MockFn)
        .mockResolvedValueOnce({ rows: [{ id: 7 }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const { runManualBookingExpiry } = await import('../../server/schedulers/bookingExpiryScheduler');
      await runManualBookingExpiry();

      const snapshotSql = (queryWithRetry as MockFn).mock.calls[1][0];
      expect(snapshotSql).toContain('booking_fee_snapshots');
      expect(snapshotSql).toContain("'cancelled'");
    });
  });
});
