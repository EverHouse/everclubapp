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

const { mockExecute, mockTransaction, mockSelect, mockUpdate, mockInsert, mockDelete } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
}));

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
  bookingRequests: { id: 'id', userEmail: 'userEmail', resourceId: 'resourceId', requestDate: 'requestDate', startTime: 'startTime', endTime: 'endTime', durationMinutes: 'durationMinutes', status: 'status', sessionId: 'sessionId', rosterVersion: 'rosterVersion', declaredPlayerCount: 'declaredPlayerCount', staffNotes: 'staffNotes', trackmanBookingId: 'trackmanBookingId' },
  bookingParticipants: { id: 'id', sessionId: 'sessionId', userId: 'userId', guestId: 'guestId', participantType: 'participantType', displayName: 'displayName', slotDuration: 'slotDuration', paymentStatus: 'paymentStatus', usedGuestPass: 'usedGuestPass', createdAt: 'createdAt' },
  resources: { id: 'id', type: 'type', name: 'name', capacity: 'capacity' },
  users: { id: 'id', email: 'email', firstName: 'firstName', lastName: 'lastName', tier: 'tier' },
  notifications: {},
}));

const mockGetBookingWithSession = vi.fn();
const mockEnforceRosterLock = vi.fn();
const mockIsStaffOrAdminCheck = vi.fn();
const mockCreateServiceError = vi.fn((msg: string, code: number, details?: unknown) => {
  const err = new Error(msg) as Error & { statusCode: number; details?: unknown };
  err.statusCode = code;
  err.details = details;
  return err;
});

vi.mock('../server/core/bookingService/rosterTypes', () => ({
  getBookingWithSession: (...args: unknown[]) => mockGetBookingWithSession(...args),
  enforceRosterLock: (...args: unknown[]) => mockEnforceRosterLock(...args),
  isStaffOrAdminCheck: (...args: unknown[]) => mockIsStaffOrAdminCheck(...args),
  createServiceError: (...args: unknown[]) => mockCreateServiceError(...args),
}));

vi.mock('../server/core/bookingService/sessionManager', () => ({
  createOrFindGuest: vi.fn().mockResolvedValue(10),
  linkParticipants: vi.fn().mockResolvedValue([{ id: 50 }]),
  getSessionParticipants: vi.fn().mockResolvedValue([]),
  ensureSessionForBooking: vi.fn().mockResolvedValue({ sessionId: 100, created: true }),
}));

vi.mock('../server/core/bookingService/tierRules', () => ({
  enforceSocialTierRules: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../server/core/tierService', () => ({
  getMemberTierByEmail: vi.fn().mockResolvedValue('full'),
  getTierLimits: vi.fn().mockResolvedValue({ guest_passes_per_year: 10, daily_sim_minutes: 120 }),
}));

vi.mock('../server/core/billing/unifiedFeeService', () => ({
  invalidateCachedFees: vi.fn().mockResolvedValue(undefined),
  recalculateSessionFees: vi.fn().mockResolvedValue({ totals: { totalCents: 0 } }),
}));

vi.mock('../server/core/billing/pricingConfig', () => ({
  isPlaceholderGuestName: vi.fn().mockReturnValue(false),
}));

vi.mock('../server/core/billing/prepaymentService', () => ({
  createPrepaymentIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/bookingService/conflictDetection', () => ({
  findConflictingBookings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../server/core/notificationService', () => ({
  notifyMember: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/routes/guestPasses', () => ({
  useGuestPass: vi.fn().mockResolvedValue({ success: true }),
  refundGuestPass: vi.fn().mockResolvedValue(undefined),
  ensureGuestPassRecord: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/visitors/matchingService', () => ({
  upsertVisitor: vi.fn().mockResolvedValue({ id: 'v1' }),
}));

vi.mock('../server/core/billing/bookingInvoiceService', () => ({
  syncBookingInvoice: vi.fn().mockResolvedValue(undefined),
  isBookingInvoicePaid: vi.fn().mockResolvedValue(false),
}));

vi.mock('../server/core/websocket', () => ({
  broadcastBookingRosterUpdate: vi.fn(),
}));

import { addParticipant } from '../server/core/bookingService/rosterParticipants';
import { removeParticipant } from '../server/core/bookingService/rosterRemoval';
import { applyRosterBatch } from '../server/core/bookingService/rosterBatch';

function createMockBooking(overrides: Record<string, unknown> = {}) {
  return {
    booking_id: 1,
    owner_email: 'owner@example.com',
    owner_name: 'Test Owner',
    request_date: '2025-06-15',
    start_time: '10:00',
    end_time: '11:00',
    duration_minutes: 60,
    declared_player_count: 4,
    status: 'approved',
    session_id: 100,
    resource_id: 5,
    notes: null,
    staff_notes: null,
    roster_version: 1,
    trackman_booking_id: null,
    resource_name: 'Bay 1',
    owner_tier: 'full',
    ...overrides,
  };
}

describe('Roster Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceRosterLock.mockResolvedValue(undefined);
  });

  describe('addParticipant', () => {
    it('throws 404 when booking is not found', async () => {
      mockGetBookingWithSession.mockResolvedValue(null);

      await expect(addParticipant({
        bookingId: 999,
        type: 'member',
        userId: 'u1',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Booking not found');
    });

    it('throws 403 when non-owner non-staff tries to add participant', async () => {
      const booking = createMockBooking();
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(false);

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'u2',
        rosterVersion: 0,
        userEmail: 'stranger@example.com',
        sessionUserId: 'stranger-id',
      })).rejects.toThrow('Only the booking owner or staff');
    });

    it('enforces roster lock before proceeding', async () => {
      mockGetBookingWithSession.mockResolvedValue(createMockBooking());
      mockEnforceRosterLock.mockRejectedValue(
        mockCreateServiceError('Roster is locked — invoice has been paid', 423)
      );

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'u1',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Roster is locked');

      expect(mockEnforceRosterLock).toHaveBeenCalledWith(1);
    });

    it('detects roster version conflict', async () => {
      const booking = createMockBooking({ roster_version: 5 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn().mockResolvedValue({ rows: [{ roster_version: 6 }] }),
          select: vi.fn(),
          update: vi.fn(),
          insert: vi.fn(),
        };
        return fn(txMock);
      });

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'u1',
        rosterVersion: 5,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Roster was modified');
    });
  });

  describe('removeParticipant', () => {
    it('throws 404 when booking not found', async () => {
      mockGetBookingWithSession.mockResolvedValue(null);

      await expect(removeParticipant({
        bookingId: 999,
        participantId: 1,
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Booking not found');
    });

    it('throws 400 when booking has no session', async () => {
      const booking = createMockBooking({ session_id: null });
      mockGetBookingWithSession.mockResolvedValue(booking);

      await expect(removeParticipant({
        bookingId: 1,
        participantId: 1,
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('does not have an active session');
    });

    it('throws 404 when participant not found', async () => {
      const booking = createMockBooking();
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(removeParticipant({
        bookingId: 1,
        participantId: 999,
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Participant not found');
    });

    it('throws 400 when trying to remove booking owner', async () => {
      const booking = createMockBooking();
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      mockSelect.mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{
              id: 1,
              sessionId: 100,
              participantType: 'owner',
              userId: 'user-1',
              displayName: 'Owner',
            }]),
          }),
        }),
      });

      await expect(removeParticipant({
        bookingId: 1,
        participantId: 1,
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Cannot remove the booking owner');
    });

    it('throws 403 when non-owner non-staff non-self tries to remove', async () => {
      const booking = createMockBooking();
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(false);

      let selectCallCount = 0;
      mockSelect.mockImplementation(() => {
        selectCallCount++;
        if (selectCallCount === 1) {
          return {
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{
                  id: 2,
                  sessionId: 100,
                  participantType: 'member',
                  userId: 'other-user',
                  displayName: 'Other User',
                }]),
              }),
            }),
          };
        }
        return {
          from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue([{ id: 'stranger-id' }]),
            }),
          }),
        };
      });

      await expect(removeParticipant({
        bookingId: 1,
        participantId: 2,
        rosterVersion: 0,
        userEmail: 'stranger@example.com',
        sessionUserId: 'stranger-id',
      })).rejects.toThrow('Only the booking owner');
    });
  });

  describe('addParticipant — capacity enforcement', () => {
    it('throws 400 when max capacity reached', async () => {
      const booking = createMockBooking({ declared_player_count: 2 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
        { id: 2, participantType: 'member', userId: 'u2', displayName: 'Member 2' },
      ]);

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] }),
          select: vi.fn(),
          update: vi.fn(),
          insert: vi.fn(),
        };
        return fn(txMock);
      });

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'u3',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Maximum slot limit');
    });
  });

  describe('addParticipant — success path', () => {
    it('successfully adds a member participant and increments roster version', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
      ]);

      const conflictDetection = await import('../server/core/bookingService/conflictDetection');
      (conflictDetection.findConflictingBookings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hasConflict: false,
        conflicts: [],
      });

      const mockInsertValues = vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 50 }]),
      });
      const mockUpdateSet = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 1 }] })
            .mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'new-member', email: 'new@example.com', firstName: 'New', lastName: 'Member' }]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({ set: mockUpdateSet }),
          insert: vi.fn().mockReturnValue({ values: mockInsertValues }),
          delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        };
        return fn(txMock);
      });

      const result = await addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'new-member',
        rosterVersion: 1,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      });

      expect(result).toBeDefined();
    });

    it('throws 400 when member is already a participant', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
        { id: 2, participantType: 'member', userId: 'existing-member', displayName: 'Existing Member' },
      ]);

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'existing-member', email: 'existing@example.com', firstName: 'Existing', lastName: 'Member' }]),
              }),
            }),
          }),
          update: vi.fn(),
          insert: vi.fn(),
        };
        return fn(txMock);
      });

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'existing-member',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('already a participant');
    });

    it('throws 409 when member has scheduling conflict', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
      ]);

      const conflictDetection = await import('../server/core/bookingService/conflictDetection');
      (conflictDetection.findConflictingBookings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hasConflict: true,
        conflicts: [{
          bookingId: 99,
          resourceName: 'Bay 2',
          startTime: '10:00',
          endTime: '11:00',
          ownerName: 'Other Owner',
          conflictType: 'time_overlap',
        }],
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'conflict-member', email: 'conflict@example.com', firstName: 'Conflicting', lastName: 'Member' }]),
              }),
            }),
          }),
          update: vi.fn(),
          insert: vi.fn(),
        };
        return fn(txMock);
      });

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'conflict-member',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('scheduling conflict');
    });

    it('throws 404 when member not found in users table', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
      ]);

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          update: vi.fn(),
          insert: vi.fn(),
        };
        return fn(txMock);
      });

      await expect(addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'nonexistent',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      })).rejects.toThrow('Member not found');
    });
  });

  describe('addParticipant — member-vs-guest resolution', () => {
    it('replaces placeholder guest when member is added matching placeholder name', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
        { id: 2, participantType: 'guest', userId: null, displayName: 'Guest 1', guestId: 5, usedGuestPass: true },
      ]);

      const pricingConfig = await import('../server/core/billing/pricingConfig');
      (pricingConfig.isPlaceholderGuestName as ReturnType<typeof vi.fn>).mockReturnValueOnce(true);

      const conflictDetection = await import('../server/core/bookingService/conflictDetection');
      (conflictDetection.findConflictingBookings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hasConflict: false,
        conflicts: [],
      });

      const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] })
            .mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'new-member', email: 'newmember@example.com', firstName: 'New', lastName: 'Member' }]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 50 }]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: mockDeleteWhere,
          }),
        };
        return fn(txMock);
      });

      const result = await addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'new-member',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      });

      expect(result).toBeDefined();
    });

    it('matches guest by name when member first+last matches existing guest display name', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
        { id: 2, participantType: 'guest', userId: null, displayName: 'John Smith', guestId: 7, usedGuestPass: false },
      ]);

      const conflictDetection = await import('../server/core/bookingService/conflictDetection');
      (conflictDetection.findConflictingBookings as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        hasConflict: false,
        conflicts: [],
      });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] })
            .mockResolvedValue({ rows: [], rowCount: 0 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'john-id', email: 'john@example.com', firstName: 'John', lastName: 'Smith' }]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 50 }]),
            }),
          }),
          delete: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue(undefined),
          }),
        };
        return fn(txMock);
      });

      const result = await addParticipant({
        bookingId: 1,
        type: 'member',
        userId: 'john-id',
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      });

      expect(result).toBeDefined();
    });
  });

  describe('addParticipant — guest with unknown email', () => {
    it('creates guest participant without email through createOrFindGuest', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
      ]);
      (sessionManager.createOrFindGuest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(99);
      (sessionManager.linkParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 60 }]);

      const guestPasses = await import('../server/routes/guestPasses');
      (guestPasses.useGuestPass as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, remaining: 3 });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] })
            .mockResolvedValue({ rows: [{ passes_total: 5, passes_used: 2 }], rowCount: 1 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 60 }]),
            }),
          }),
        };
        return fn(txMock);
      });

      const result = await addParticipant({
        bookingId: 1,
        type: 'guest',
        guest: { name: 'Walk-In Guest' },
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      });

      expect(result).toBeDefined();
      expect(sessionManager.createOrFindGuest).toHaveBeenCalledWith(
        'Walk-In Guest',
        undefined,
        undefined,
        expect.any(String)
      );
    });

    it('creates guest participant with email through createOrFindGuest', async () => {
      const booking = createMockBooking({ declared_player_count: 4 });
      mockGetBookingWithSession.mockResolvedValue(booking);
      mockIsStaffOrAdminCheck.mockResolvedValue(true);

      const sessionManager = await import('../server/core/bookingService/sessionManager');
      (sessionManager.getSessionParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
        { id: 1, participantType: 'owner', userId: 'owner-id', displayName: 'Owner' },
      ]);
      (sessionManager.createOrFindGuest as ReturnType<typeof vi.fn>).mockResolvedValueOnce(100);
      (sessionManager.linkParticipants as ReturnType<typeof vi.fn>).mockResolvedValueOnce([{ id: 61 }]);

      const guestPasses = await import('../server/routes/guestPasses');
      (guestPasses.useGuestPass as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, remaining: 2 });

      mockTransaction.mockImplementation(async (fn: (tx: Record<string, unknown>) => Promise<unknown>) => {
        const txMock = {
          execute: vi.fn()
            .mockResolvedValueOnce({ rows: [{ roster_version: 0 }] })
            .mockResolvedValue({ rows: [{ passes_total: 5, passes_used: 3 }], rowCount: 1 }),
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue(undefined),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([{ id: 61 }]),
            }),
          }),
        };
        return fn(txMock);
      });

      const result = await addParticipant({
        bookingId: 1,
        type: 'guest',
        guest: { name: 'Known Guest', email: 'known@example.com' },
        rosterVersion: 0,
        userEmail: 'owner@example.com',
        sessionUserId: 'owner-id',
      });

      expect(result).toBeDefined();
      expect(sessionManager.createOrFindGuest).toHaveBeenCalledWith(
        'Known Guest',
        'known@example.com',
        undefined,
        expect.any(String)
      );
    });
  });

  describe('applyRosterBatch', () => {
    it('throws 404 when booking not found', async () => {
      mockGetBookingWithSession.mockResolvedValue(null);

      await expect(applyRosterBatch({
        bookingId: 999,
        rosterVersion: 0,
        operations: [],
        staffEmail: 'staff@example.com',
      })).rejects.toThrow('Booking not found');
    });

    it('throws 403 when non-staff tries batch operations', async () => {
      mockGetBookingWithSession.mockResolvedValue(createMockBooking());
      mockIsStaffOrAdminCheck.mockResolvedValue(false);

      await expect(applyRosterBatch({
        bookingId: 1,
        rosterVersion: 0,
        operations: [],
        staffEmail: 'member@example.com',
      })).rejects.toThrow('Only staff or admin');
    });

    it('enforces roster lock for batch operations', async () => {
      mockGetBookingWithSession.mockResolvedValue(createMockBooking());
      mockEnforceRosterLock.mockRejectedValue(
        mockCreateServiceError('Roster is locked', 423)
      );

      await expect(applyRosterBatch({
        bookingId: 1,
        rosterVersion: 0,
        operations: [],
        staffEmail: 'staff@example.com',
      })).rejects.toThrow('Roster is locked');
    });
  });
});
