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
  getErrorCode: vi.fn((e: unknown) => {
    if (e && typeof e === 'object' && 'code' in e) return (e as { code: string }).code;
    return undefined;
  }),
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toIntArrayLiteral: vi.fn((arr: number[]) => `{${arr.join(',')}}`),
}));

const { mockExecute, mockTransaction, mockSelect, mockInsert } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
    select: mockSelect,
    insert: mockInsert,
  },
}));

vi.mock('../server/core/db', () => ({
  pool: {
    connect: vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }], rowCount: 1 }),
      release: vi.fn(),
    }),
  },
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
    isNull: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  bookingSessions: { id: 'id', resourceId: 'resourceId', sessionDate: 'sessionDate', startTime: 'startTime', endTime: 'endTime', trackmanBookingId: 'trackmanBookingId', source: 'source', createdBy: 'createdBy' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId', userId: 'userId', guestId: 'guestId', participantType: 'participantType', displayName: 'displayName', slotDuration: 'slotDuration', trackmanPlayerRowId: 'trackmanPlayerRowId', invitedAt: 'invitedAt' },
  bookingRequests: { id: 'id', staffNotes: 'staffNotes', sessionId: 'sessionId' },
  usageLedger: { id: 'id', sessionId: 'sessionId', memberId: 'memberId', source: 'source' },
  guests: { id: 'id', email: 'email', name: 'name' },
  users: { id: 'id', email: 'email', firstName: 'firstName', lastName: 'lastName' },
  InsertBookingSession: {},
  InsertBookingParticipant: {},
  InsertUsageLedger: {},
  BookingSession: {},
  BookingParticipant: {},
  bookingSourceEnum: { enumValues: ['member_request', 'staff_manual', 'trackman_import', 'trackman_webhook', 'trackman', 'auto-complete', 'manual-auto-complete'] },
}));

vi.mock('../server/core/tierService', () => ({
  getMemberTierByEmail: vi.fn().mockResolvedValue('full'),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2025-06-15'),
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/monitoring', () => ({
  logAlert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/tierRules', () => ({
  enforceSocialTierRules: vi.fn().mockResolvedValue({ allowed: true }),
  getMemberTier: vi.fn().mockResolvedValue('full'),
}));

vi.mock('../server/core/bookingService/usageCalculator', () => ({
  calculateFullSessionBilling: vi.fn().mockResolvedValue({
    allocations: [],
    overageMinutes: 0,
    overageFeeTotal: 0,
  }),
}));

import {
  createSession,
  linkParticipants,
  recordUsage,
  getSessionById,
  getSessionParticipants,
  createOrFindGuest,
  ensureSessionForBooking,
} from '../server/core/bookingService/sessionManager';

describe('Session Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('creates a session and links participants within a transaction', async () => {
      const mockSession = { id: 1, resourceId: 5, sessionDate: '2025-06-15', startTime: '10:00', endTime: '11:00' };
      const mockParticipants = [
        { id: 1, sessionId: 1, userId: 'user-1', participantType: 'owner', displayName: 'Test Owner' },
      ];

      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn(),
          }),
        }),
      };

      txMock.insert.mockReturnValueOnce({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([mockSession]),
        }),
      }).mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(mockParticipants),
        }),
      });

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      const result = await createSession(
        { resourceId: 5, sessionDate: '2025-06-15', startTime: '10:00', endTime: '11:00' },
        [{ userId: 'user-1', participantType: 'owner', displayName: 'Test Owner' }],
        'member_request'
      );

      expect(result.session).toEqual(mockSession);
      expect(result.participants).toEqual(mockParticipants);
    });

    it('uses advisory lock to prevent concurrent session creation', async () => {
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      };

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await createSession(
        { resourceId: 5, sessionDate: '2025-06-15', startTime: '10:00', endTime: '11:00' },
        [{ userId: 'user-1', participantType: 'owner', displayName: 'Owner' }]
      );

      expect(txMock.execute).toHaveBeenCalled();
    });

    it('propagates errors from session insert', async () => {
      const txMock = {
        execute: vi.fn().mockResolvedValue({ rows: [] }),
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      };

      mockTransaction.mockImplementation(async (fn: (tx: typeof txMock) => Promise<unknown>) => fn(txMock));

      await expect(createSession(
        { resourceId: 5, sessionDate: '2025-06-15', startTime: '10:00', endTime: '11:00' },
        [{ userId: 'user-1', participantType: 'owner', displayName: 'Owner' }]
      )).rejects.toThrow('DB error');
    });
  });

  describe('linkParticipants', () => {
    it('inserts all participants and returns records', async () => {
      const mockResult = [
        { id: 1, sessionId: 10, userId: 'u1', participantType: 'owner', displayName: 'Owner' },
        { id: 2, sessionId: 10, userId: 'u2', participantType: 'member', displayName: 'Member 1' },
      ];

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(mockResult),
        }),
      });

      const result = await linkParticipants(10, [
        { userId: 'u1', participantType: 'owner', displayName: 'Owner' },
        { userId: 'u2', participantType: 'member', displayName: 'Member 1' },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].participantType).toBe('owner');
    });

    it('returns empty array when no participants provided', async () => {
      const result = await linkParticipants(10, []);
      expect(result).toEqual([]);
    });

    it('deduplicates participants matching owner by userId', async () => {
      const mockResult = [
        { id: 1, sessionId: 10, userId: 'u1', participantType: 'owner', displayName: 'Owner' },
      ];

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(mockResult),
        }),
      });

      const result = await linkParticipants(10, [
        { userId: 'u1', participantType: 'owner', displayName: 'Owner' },
        { userId: 'u1', participantType: 'member', displayName: 'Owner Duplicate' },
      ]);

      const insertValues = mockInsert.mock.results[0]?.value?.values;
      expect(insertValues).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ participantType: 'owner' }),
        ])
      );
    });

    it('deduplicates participants matching owner by displayName', async () => {
      const mockResult = [
        { id: 1, sessionId: 10, userId: 'u1', participantType: 'owner', displayName: 'John Smith' },
      ];

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(mockResult),
        }),
      });

      await linkParticipants(10, [
        { userId: 'u1', participantType: 'owner', displayName: 'John Smith' },
        { userId: 'u2', participantType: 'member', displayName: 'John Smith' },
      ]);

      const insertValues = mockInsert.mock.results[0]?.value?.values;
      expect(insertValues).toHaveBeenCalledWith(
        expect.not.arrayContaining([
          expect.objectContaining({ displayName: 'John Smith', participantType: 'member' }),
        ])
      );
    });
  });

  describe('recordUsage', () => {
    it('records usage entry when none exists', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      mockInsert.mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      });

      const result = await recordUsage(10, {
        memberId: 'user-1',
        minutesCharged: 60,
        overageFee: 0,
        guestFee: 0,
      });

      expect(result.success).toBe(true);
      expect(result.alreadyRecorded).toBe(false);
    });

    it('skips duplicate usage entry (idempotency)', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 1 }]),
          }),
        }),
      });

      const result = await recordUsage(10, {
        memberId: 'user-1',
        minutesCharged: 60,
      });

      expect(result.success).toBe(true);
      expect(result.alreadyRecorded).toBe(true);
    });

    it('handles PostgreSQL unique constraint violation as duplicate', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const constraintError = new Error('duplicate key value violates unique constraint') as Error & { code: string };
      constraintError.code = '23505';
      const { getErrorCode } = await import('../server/utils/errorUtils');
      vi.mocked(getErrorCode).mockReturnValueOnce('23505');

      mockInsert.mockReturnValue({
        values: vi.fn().mockRejectedValue(constraintError),
      });

      const result = await recordUsage(10, { memberId: 'user-1', minutesCharged: 60 });
      expect(result.success).toBe(true);
      expect(result.alreadyRecorded).toBe(true);
    });
  });

  describe('getSessionById', () => {
    it('returns session when found', async () => {
      const mockSession = { id: 5, resourceId: 1, sessionDate: '2025-06-15' };
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockSession]),
          }),
        }),
      });

      const result = await getSessionById(5);
      expect(result).toEqual(mockSession);
    });

    it('returns null when session not found', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getSessionById(999);
      expect(result).toBeNull();
    });
  });

  describe('getSessionParticipants', () => {
    it('returns all participants for a session', async () => {
      const mockParticipants = [
        { id: 1, sessionId: 10, userId: 'u1', participantType: 'owner' },
        { id: 2, sessionId: 10, userId: 'u2', participantType: 'member' },
      ];
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockParticipants),
        }),
      });

      const result = await getSessionParticipants(10);
      expect(result).toHaveLength(2);
    });
  });

  describe('createOrFindGuest', () => {
    it('upserts guest with email and returns id', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 42 }]),
          }),
        }),
      });
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await createOrFindGuest('Guest One', 'guest@example.com');
      expect(result).toBe(42);
    });

    it('creates guest without email', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 43 }]),
        }),
      });

      const result = await createOrFindGuest('Anonymous Guest');
      expect(result).toBe(43);
    });
  });

  describe('ensureSessionForBooking', () => {
    it('returns error for missing start_time', async () => {
      const result = await ensureSessionForBooking({
        bookingId: 1,
        resourceId: 5,
        sessionDate: '2025-06-15',
        startTime: '',
        endTime: '11:00',
        ownerEmail: 'test@example.com',
        source: 'staff_manual',
        createdBy: 'test',
      });

      expect(result.sessionId).toBe(0);
      expect(result.created).toBe(false);
      expect(result.error).toContain('Missing');
    });

    it('returns error for zero-duration booking', async () => {
      const result = await ensureSessionForBooking({
        bookingId: 1,
        resourceId: 5,
        sessionDate: '2025-06-15',
        startTime: '10:00',
        endTime: '10:00',
        ownerEmail: 'test@example.com',
        source: 'staff_manual',
        createdBy: 'test',
      });

      expect(result.sessionId).toBe(0);
      expect(result.error).toContain('Zero-duration');
    });

    it('returns error for invalid time format', async () => {
      const result = await ensureSessionForBooking({
        bookingId: 1,
        resourceId: 5,
        sessionDate: '2025-06-15',
        startTime: 'invalid',
        endTime: '11:00',
        ownerEmail: 'test@example.com',
        source: 'staff_manual',
        createdBy: 'test',
      });

      expect(result.sessionId).toBe(0);
      expect(result.error).toContain('Invalid time format');
    });

    it('returns error for missing endTime', async () => {
      const result = await ensureSessionForBooking({
        bookingId: 1,
        resourceId: 5,
        sessionDate: '2025-06-15',
        startTime: '10:00',
        endTime: '',
        ownerEmail: 'test@example.com',
        source: 'staff_manual',
        createdBy: 'test',
      });

      expect(result.sessionId).toBe(0);
      expect(result.created).toBe(false);
      expect(result.error).toContain('Missing');
    });
  });

  describe('linkParticipants — duration tracking', () => {
    it('calculates slot duration per participant from session times', async () => {
      const mockResult = [
        { id: 1, sessionId: 10, userId: 'u1', participantType: 'owner', displayName: 'Owner', slotDuration: 60 },
        { id: 2, sessionId: 10, userId: 'u2', participantType: 'member', displayName: 'Member', slotDuration: 60 },
      ];

      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue(mockResult),
        }),
      });

      const result = await linkParticipants(10, [
        { userId: 'u1', participantType: 'owner', displayName: 'Owner', slotDuration: 60 },
        { userId: 'u2', participantType: 'member', displayName: 'Member', slotDuration: 60 },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0].slotDuration).toBe(60);
      expect(result[1].slotDuration).toBe(60);
    });
  });

  describe('createOrFindGuest — guest resolution', () => {
    it('creates guest with email using upsert and returns ID', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 42 }]),
          }),
        }),
      });
      mockExecute.mockResolvedValue({ rows: [] });

      const result = await createOrFindGuest('Jane Doe', 'jane@example.com', undefined, 'member-1');

      expect(result).toBe(42);
      expect(mockInsert).toHaveBeenCalled();
    });

    it('creates guest without email (no dedup merge)', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([{ id: 55 }]),
        }),
      });

      const result = await createOrFindGuest('Unknown Guest');

      expect(result).toBe(55);
    });

    it('merges fragmented guest records when duplicates found with email', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 10 }]),
          }),
        }),
      });

      mockExecute.mockResolvedValue({
        rows: [{ id: 20 }, { id: 21 }],
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [] }),
        };
        return fn(txMock);
      });

      const result = await createOrFindGuest('John Smith', 'john@example.com', undefined, 'member-1');

      expect(result).toBe(10);
      expect(mockTransaction).toHaveBeenCalled();
    });

    it('skips merge when too many duplicates (>3)', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 10 }]),
          }),
        }),
      });

      mockExecute.mockResolvedValue({
        rows: [{ id: 20 }, { id: 21 }, { id: 22 }, { id: 23 }],
      });

      const result = await createOrFindGuest('Common Name', 'common@example.com');

      expect(result).toBe(10);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('handles merge failure gracefully (non-blocking)', async () => {
      mockInsert.mockReturnValue({
        values: vi.fn().mockReturnValue({
          onConflictDoUpdate: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([{ id: 10 }]),
          }),
        }),
      });

      mockExecute.mockRejectedValue(new Error('DB error'));

      const result = await createOrFindGuest('Bad Guest', 'bad@example.com');

      expect(result).toBe(10);
    });
  });

  describe('getSessionById', () => {
    it('returns session when found', async () => {
      const mockSession = { id: 100, resourceId: 5, sessionDate: '2025-06-15' };
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([mockSession]),
          }),
        }),
      });

      const result = await getSessionById(100);

      expect(result).toEqual(mockSession);
    });

    it('returns null when session not found', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const result = await getSessionById(999);

      expect(result).toBeNull();
    });
  });

  describe('getSessionParticipants', () => {
    it('returns participants for a session', async () => {
      const mockParticipants = [
        { id: 1, sessionId: 100, userId: 'u1', participantType: 'owner', displayName: 'Owner' },
        { id: 2, sessionId: 100, userId: 'u2', participantType: 'member', displayName: 'Member' },
      ];
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(mockParticipants),
        }),
      });

      const result = await getSessionParticipants(100);

      expect(result).toHaveLength(2);
      expect(result[0].participantType).toBe('owner');
    });

    it('returns empty array when no participants', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      });

      const result = await getSessionParticipants(999);

      expect(result).toHaveLength(0);
    });
  });

  describe('recordUsage — duration and fee assertions', () => {
    it('records correct minutes and fee amounts', async () => {
      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      const insertValuesFn = vi.fn().mockResolvedValue(undefined);
      mockInsert.mockReturnValue({
        values: insertValuesFn,
      });

      const result = await recordUsage(10, {
        memberId: 'user-1',
        minutesCharged: 120,
        overageFee: 1500,
        guestFee: 750,
      });

      expect(result.success).toBe(true);
      expect(result.alreadyRecorded).toBe(false);
      expect(insertValuesFn).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 10,
          memberId: 'user-1',
          minutesCharged: 120,
        })
      );
    });
  });
});
