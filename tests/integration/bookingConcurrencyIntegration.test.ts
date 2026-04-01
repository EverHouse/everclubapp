// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn((e: unknown) => {
    if (e && typeof e === 'object' && 'code' in e) return (e as { code: string }).code;
    return undefined;
  }),
  getErrorStatusCode: vi.fn(() => 500),
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

vi.mock('../../server/db', () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    transaction: vi.fn(),
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../shared/constants/statuses', () => ({
  ACTIVE_BOOKING_STATUSES: ['pending', 'pending_approval', 'approved', 'confirmed'],
}));

vi.mock('../../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../../server/utils/dateUtils', () => ({
  formatTime12Hour: vi.fn((t: string) => t),
}));

import { acquireBookingLocks, checkResourceOverlap, BookingConflictError } from '../../server/core/bookingService/bookingCreationGuard';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Booking Concurrency Integration — Simultaneous Request Simulation', () => {
  describe('Advisory Lock Prevents Double-Booking', () => {
    it('two concurrent requests for same resource: second sees pending limit and gets rejected', async () => {
      let lockAcquiredByFirst = false;
      let firstCompleted = false;

      const txMock1 = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const sqlQuery = query as { __sqlStrings?: string[] };
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pg_advisory_xact_lock'))) {
            lockAcquiredByFirst = true;
            await new Promise(r => setTimeout(r, 50));
          }
          return { rows: [{ cnt: 0 }] };
        }),
      };

      const txMock2 = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const sqlQuery = query as { __sqlStrings?: string[] };
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pg_advisory_xact_lock'))) {
            while (!lockAcquiredByFirst) {
              await new Promise(r => setTimeout(r, 10));
            }
          }
          return { rows: [{ cnt: 1 }] };
        }),
      };

      const params = {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'member-a@test.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      };

      const results = await Promise.allSettled([
        acquireBookingLocks(txMock1, params).then(() => { firstCompleted = true; }),
        acquireBookingLocks(txMock2, {
          ...params,
          requestEmail: 'member-b@test.com',
        }),
      ]);

      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('rejected');
      const rejection = results[1] as PromiseRejectedResult;
      expect(rejection.reason).toBeInstanceOf(BookingConflictError);
      expect((rejection.reason as BookingConflictError).statusCode).toBe(409);
    });

    it('same member cannot create two pending requests for same resource type', async () => {
      const txMock = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const sqlQuery = query as { __sqlStrings?: string[] };
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pending'))) {
            return { rows: [{ cnt: 1 }] };
          }
          return { rows: [{ cnt: 0 }] };
        }),
      };

      const error = await acquireBookingLocks(txMock, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'member@test.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      }).catch((e: Error) => e);

      expect(error).toBeInstanceOf(BookingConflictError);
      expect((error as BookingConflictError).statusCode).toBe(409);
    });

    it('staff requests bypass pending limit but still acquire advisory locks', async () => {
      const executeCalls: string[] = [];
      const txMock = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const sqlQuery = query as { __sqlStrings?: string[] };
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pg_advisory_xact_lock'))) {
            executeCalls.push('lock');
          }
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pending'))) {
            executeCalls.push('pending_check');
          }
          return { rows: [{ cnt: 0 }] };
        }),
      };

      await acquireBookingLocks(txMock, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'member@test.com',
        isStaffRequest: true,
        isViewAsMode: false,
        resourceType: 'simulator',
      });

      expect(executeCalls.filter(c => c === 'lock').length).toBe(2);
      expect(executeCalls.filter(c => c === 'pending_check').length).toBe(0);
    });
  });

  describe('Resource Overlap Detection with FOR UPDATE', () => {
    it('detects overlapping booking with FOR UPDATE row lock', async () => {
      const txMock = {
        execute: vi.fn().mockResolvedValue({
          rows: [{ id: 42, start_time: '14:00', end_time: '15:00' }],
        }),
      };

      const error = await checkResourceOverlap(txMock, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:30',
        endTime: '15:30',
      }).catch((e: Error) => e);

      expect(error).toBeInstanceOf(BookingConflictError);
      expect((error as BookingConflictError).statusCode).toBe(409);
    });

    it('allows non-overlapping time slot on same resource and date', async () => {
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
      };

      await expect(checkResourceOverlap(txMock, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '16:00',
        endTime: '17:00',
      })).resolves.toBeUndefined();
    });

    it('skips overlap check when resourceId is null (unassigned booking)', async () => {
      const txMock = {
        execute: vi.fn(),
      };

      await checkResourceOverlap(txMock, {
        resourceId: null,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
      });

      expect(txMock.execute).not.toHaveBeenCalled();
    });

    it('conference room allows higher pending limit (5 vs 1 for simulators)', async () => {
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [{ cnt: 4 }] }),
      };

      await expect(acquireBookingLocks(txMock, {
        resourceId: 5,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'member@test.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'conference_room',
      })).resolves.toBeUndefined();

      const txMockSim = {
        execute: vi.fn().mockResolvedValue({ rows: [{ cnt: 1 }] }),
      };

      const error = await acquireBookingLocks(txMockSim, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'member@test.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
      }).catch((e: Error) => e);

      expect(error).toBeInstanceOf(BookingConflictError);
    });
  });

  describe('Lock Ordering — Deadlock Prevention', () => {
    it('locks are acquired in sorted order to prevent deadlocks', async () => {
      const lockOrder: string[] = [];
      const txMock = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const sqlQuery = query as { __sqlStrings?: string[]; __sqlValues?: unknown[] };
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pg_advisory_xact_lock'))) {
            const lockTarget = String(sqlQuery.__sqlValues?.[0] || '');
            lockOrder.push(lockTarget);
          }
          return { rows: [{ cnt: 0 }] };
        }),
      };

      await acquireBookingLocks(txMock, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'zebra@test.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
        participantEmails: ['alpha@test.com', 'middle@test.com'],
      });

      const emailLocks = lockOrder.slice(1);
      const sorted = [...emailLocks].sort();
      expect(emailLocks).toEqual(sorted);
    });

    it('duplicate participant emails are deduplicated for locking', async () => {
      const lockCount = { user: 0 };
      const txMock = {
        execute: vi.fn().mockImplementation(async (query: unknown) => {
          const sqlQuery = query as { __sqlStrings?: string[] };
          if (sqlQuery?.__sqlStrings?.some(s => s.includes('pg_advisory_xact_lock(1'))) {
            lockCount.user++;
          }
          return { rows: [{ cnt: 0 }] };
        }),
      };

      await acquireBookingLocks(txMock, {
        resourceId: 1,
        requestDate: '2025-07-01',
        startTime: '14:00',
        endTime: '15:00',
        requestEmail: 'member@test.com',
        isStaffRequest: false,
        isViewAsMode: false,
        resourceType: 'simulator',
        participantEmails: ['member@test.com', 'other@test.com', 'other@test.com'],
      });

      expect(lockCount.user).toBe(2);
    });
  });
});
