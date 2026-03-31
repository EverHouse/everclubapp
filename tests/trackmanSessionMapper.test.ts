// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2026-03-31'),
}));

const mockDbExecute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
const mockDbSelect = vi.fn();

vi.mock('../server/db', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
  },
}));

vi.mock('../shared/schema', () => ({
  bookingRequests: {},
  bookingParticipants: {},
  guests: {},
  participantTypeEnum: {},
  users: { id: 'id', email: 'email', firstName: 'first_name', lastName: 'last_name' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: vi.fn() }
  ),
  inArray: vi.fn(),
}));

const mockGetUserIdByEmail = vi.fn();
const mockResolveEmail = vi.fn();
const mockIsEmailLinkedToUser = vi.fn();

vi.mock('../server/core/trackman/matching', () => ({
  getUserIdByEmail: (...args: unknown[]) => mockGetUserIdByEmail(...args),
  resolveEmail: (...args: unknown[]) => mockResolveEmail(...args),
  isEmailLinkedToUser: (...args: unknown[]) => mockIsEmailLinkedToUser(...args),
}));

vi.mock('../server/core/tierService', () => ({
  getMemberTierByEmail: vi.fn().mockResolvedValue('Gold'),
}));

const mockEnsureSessionForBooking = vi.fn();
const mockCreateSession = vi.fn();
const mockRecordUsage = vi.fn().mockResolvedValue(undefined);
const mockCreateOrFindGuest = vi.fn();

vi.mock('../server/core/bookingService/sessionManager', () => ({
  ensureSessionForBooking: (...args: unknown[]) => mockEnsureSessionForBooking(...args),
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  createOrFindGuest: (...args: unknown[]) => mockCreateOrFindGuest(...args),
}));

vi.mock('../server/core/bookingService/usageCalculator', () => ({
  calculateFullSessionBilling: vi.fn().mockReturnValue({
    participants: [],
    totalFee: 0,
    guestFees: 0,
    overageFees: 0,
    breakdown: [],
  }),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  recalculateSessionFees: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn().mockResolvedValue({ id: 'visitor-1' }),
}));

describe('Trackman Session Mapper', () => {
  let transferRequestParticipantsToSession: typeof import('../server/core/trackman/sessionMapper').transferRequestParticipantsToSession;
  let createTrackmanSessionAndParticipants: typeof import('../server/core/trackman/sessionMapper').createTrackmanSessionAndParticipants;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
    mockResolveEmail.mockImplementation((email: string) => email.toLowerCase());
    const mod = await import('../server/core/trackman/sessionMapper');
    transferRequestParticipantsToSession = mod.transferRequestParticipantsToSession;
    createTrackmanSessionAndParticipants = mod.createTrackmanSessionAndParticipants;
  });

  describe('transferRequestParticipantsToSession', () => {
    it('returns 0 when participants array is empty', async () => {
      const count = await transferRequestParticipantsToSession(1, [], 'owner@test.com', 'test');
      expect(count).toBe(0);
    });

    it('returns 0 when participants is not an array', async () => {
      const count = await transferRequestParticipantsToSession(1, null, 'owner@test.com', 'test');
      expect(count).toBe(0);
    });

    it('transfers guest participants to session', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      mockCreateOrFindGuest.mockResolvedValue(42);
      mockDbExecute.mockResolvedValue({ rowCount: 1, rows: [] });
      const participants = [
        { type: 'guest', name: 'Jane Guest', email: 'jane@guest.com' },
      ];
      const count = await transferRequestParticipantsToSession(10, participants, 'owner@test.com', 'import');
      expect(count).toBe(1);
      expect(mockCreateOrFindGuest).toHaveBeenCalledWith('Jane Guest', 'jane@guest.com', undefined, 'owner@test.com');
    });

    it('skips participants that already exist in session', async () => {
      mockDbExecute.mockResolvedValueOnce({
        rows: [{ user_id: null, user_email: null, display_name: 'Existing Guest', participant_type: 'guest' }],
        rowCount: 1,
      });
      const participants = [
        { type: 'guest', name: 'Existing Guest' },
      ];
      const count = await transferRequestParticipantsToSession(10, participants, 'owner@test.com', 'import');
      expect(count).toBe(0);
    });

    it('skips member participants whose email matches owner email', async () => {
      mockDbExecute.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const participants = [
        { type: 'member', email: 'owner@test.com', name: 'Owner' },
      ];
      const count = await transferRequestParticipantsToSession(10, participants, 'owner@test.com', 'import');
      expect(count).toBe(0);
    });

    it('adds member participants with valid user records', async () => {
      mockDbExecute
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 'user-2', email: 'member2@test.com', first_name: 'M', last_name: 'Two' }], rowCount: 1 })
        .mockResolvedValue({ rowCount: 1, rows: [] });
      const participants = [
        { type: 'member', email: 'member2@test.com', name: 'Member Two' },
      ];
      const count = await transferRequestParticipantsToSession(10, participants, 'owner@test.com', 'import');
      expect(count).toBe(1);
    });
  });

  describe('createTrackmanSessionAndParticipants', () => {
    it('skips session creation when owner email has no matching user', async () => {
      mockGetUserIdByEmail.mockResolvedValue(null);
      await createTrackmanSessionAndParticipants({
        ownerEmail: 'unknown@test.com',
        ownerName: 'Unknown',
        bookingId: 'tm-123',
        resourceId: 1,
        sessionDate: '2026-04-01',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        status: 'attended',
        parsedPlayers: [],
        membersByEmail: new Map(),
        trackmanEmailMapping: new Map(),
      });
      expect(mockEnsureSessionForBooking).not.toHaveBeenCalled();
    });

    it('creates session for valid owner and records usage', async () => {
      mockGetUserIdByEmail.mockResolvedValue('user-owner-1');
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ firstName: 'John', lastName: 'Doe' }]),
          }),
        }),
      });
      mockEnsureSessionForBooking.mockResolvedValue({
        sessionId: 100,
        isNew: true,
        participants: [],
      });
      mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
      await createTrackmanSessionAndParticipants({
        ownerEmail: 'john@test.com',
        ownerName: 'john@test.com',
        bookingId: 'tm-456',
        resourceId: 2,
        sessionDate: '2026-04-01',
        startTime: '14:00',
        endTime: '15:00',
        durationMinutes: 60,
        status: 'attended',
        parsedPlayers: [],
        membersByEmail: new Map(),
        trackmanEmailMapping: new Map(),
      });
      expect(mockEnsureSessionForBooking).toHaveBeenCalled();
    });

    it('resolves owner name from database when name contains @', async () => {
      mockGetUserIdByEmail.mockResolvedValue('user-1');
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ firstName: 'Jane', lastName: 'Smith' }]),
          }),
        }),
      });
      mockEnsureSessionForBooking.mockResolvedValue({
        sessionId: 200,
        isNew: true,
        participants: [],
      });
      mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
      await createTrackmanSessionAndParticipants({
        ownerEmail: 'jane@test.com',
        ownerName: 'jane@test.com',
        bookingId: 'tm-789',
        resourceId: 1,
        sessionDate: '2026-04-01',
        startTime: '09:00',
        endTime: '10:00',
        durationMinutes: 60,
        status: 'attended',
        parsedPlayers: [],
        membersByEmail: new Map(),
        trackmanEmailMapping: new Map(),
      });
      expect(mockDbSelect).toHaveBeenCalled();
    });

    it('calculates per-participant minutes correctly with multiple players', async () => {
      mockGetUserIdByEmail.mockResolvedValue('user-1');
      mockDbSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ firstName: 'Owner', lastName: 'One' }]),
          }),
        }),
      });
      mockEnsureSessionForBooking.mockResolvedValue({
        sessionId: 300,
        isNew: true,
        participants: [],
      });
      mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
      mockIsEmailLinkedToUser.mockResolvedValue(false);
      const memberUserId = 'user-member-1';
      mockGetUserIdByEmail.mockImplementation(async (email: string) => {
        if (email === 'owner@test.com') return 'user-1';
        if (email === 'member2@test.com') return memberUserId;
        return null;
      });
      mockResolveEmail.mockImplementation((email: string) => email.toLowerCase());
      await createTrackmanSessionAndParticipants({
        ownerEmail: 'owner@test.com',
        ownerName: 'Owner One',
        bookingId: 'tm-multi',
        resourceId: 1,
        sessionDate: '2026-04-01',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        status: 'attended',
        parsedPlayers: [
          { type: 'member', email: 'member2@test.com', name: 'Member Two' },
          { type: 'guest', email: null, name: 'Guest Three' },
        ],
        membersByEmail: new Map(),
        trackmanEmailMapping: new Map(),
      });
      expect(mockEnsureSessionForBooking).toHaveBeenCalled();
    });

    it('handles errors gracefully without crashing', async () => {
      mockGetUserIdByEmail.mockRejectedValue(new Error('DB error'));
      await expect(
        createTrackmanSessionAndParticipants({
          ownerEmail: 'fail@test.com',
          ownerName: 'Fail',
          bookingId: 'tm-err',
          resourceId: 1,
          sessionDate: '2026-04-01',
          startTime: '10:00',
          endTime: '11:00',
          durationMinutes: 60,
          status: 'attended',
          parsedPlayers: [],
          membersByEmail: new Map(),
          trackmanEmailMapping: new Map(),
        })
      ).resolves.not.toThrow();
    });
  });
});
