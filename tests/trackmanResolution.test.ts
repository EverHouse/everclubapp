// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn(),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn().mockReturnValue('2026-03-31'),
  getPacificDateParts: vi.fn().mockReturnValue({ hour: 12, minute: 0 }),
  formatDateFromDb: vi.fn((d: unknown) => String(d)),
}));

const mockDbExecute = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });

function createChainMock(finalValue: unknown = []) {
  const thenFn = (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    if (resolve) return Promise.resolve(resolve(finalValue));
    return Promise.resolve(finalValue);
  };
  const chain: Record<string, unknown> = {};
  const makeChain = () => vi.fn().mockReturnValue(chain);
  chain.from = makeChain();
  chain.where = makeChain();
  chain.orderBy = makeChain();
  chain.limit = makeChain();
  chain.offset = makeChain();
  chain.values = makeChain();
  chain.returning = makeChain();
  chain.set = makeChain();
  chain.onConflictDoUpdate = makeChain();
  chain.then = vi.fn().mockImplementation(thenFn);
  chain.catch = vi.fn().mockReturnValue(chain);
  return chain;
}

const mockDbSelect = vi.fn().mockReturnValue(createChainMock([]));
const mockDbInsert = vi.fn().mockReturnValue(createChainMock([]));
const mockDbUpdate = vi.fn().mockReturnValue(createChainMock({ rowCount: 1 }));

vi.mock('../server/db', () => ({
  db: {
    execute: (...args: unknown[]) => mockDbExecute(...args),
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}));

vi.mock('../shared/schema', () => ({
  bookingRequests: { id: 'id', status: 'status', trackmanBookingId: 'trackman_booking_id' },
  trackmanUnmatchedBookings: {},
  trackmanImportRuns: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  or: vi.fn(),
  ilike: vi.fn(),
  and: vi.fn(),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: vi.fn() }
  ),
}));

vi.mock('../server/core/bookingEvents', () => ({
  bookingEvents: { emit: vi.fn() },
}));

vi.mock('../server/utils/sqlArrayLiteral', () => ({
  toTextArrayLiteral: vi.fn((arr: string[]) => `{${arr.join(',')}}`),
}));

vi.mock('../server/core/stripe/payments', () => ({
  cancelPaymentIntent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/billing/guestPassService', () => ({
  useGuestPass: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/trackman/constants', () => ({
  isPlaceholderEmail: vi.fn().mockReturnValue(false),
  isFutureBooking: vi.fn().mockReturnValue(false),
  SessionCheckRow: undefined,
  PaymentIntentRow: undefined,
}));

vi.mock('../server/core/trackman/parser', () => ({
  parseNotesForPlayers: vi.fn().mockReturnValue([]),
}));

vi.mock('../server/core/trackman/matching', () => ({
  getGolfInstructorEmails: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock('../server/core/trackman/sessionMapper', () => ({
  createTrackmanSessionAndParticipants: vi.fn().mockResolvedValue(undefined),
}));

describe('Trackman Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbExecute.mockResolvedValue({ rows: [], rowCount: 0 });
    mockDbSelect.mockReturnValue(createChainMock([]));
    mockDbInsert.mockReturnValue(createChainMock([]));
    mockDbUpdate.mockReturnValue(createChainMock({ rowCount: 1 }));
  });

  describe('resolveUnmatchedBooking', () => {
    it('returns success false when booking is not found', async () => {
      mockDbSelect.mockReturnValue(createChainMock([]));
      const { resolveUnmatchedBooking } = await import('../server/core/trackman/resolution');
      const result = await resolveUnmatchedBooking(999, 'member@test.com', 'admin');
      expect(result.success).toBe(false);
      expect(result.resolved).toBe(0);
      expect(result.autoResolved).toBe(0);
    });

    it('resolves booking and updates unmatched record', async () => {
      const booking = {
        id: 5,
        status: 'unmatched',
        resolvedEmail: null,
        trackmanBookingId: 'tm-5',
        originalEmail: 'unknown@trackman.com',
        bookingDate: '2026-04-01',
        startTime: '10:00',
        endTime: '11:00',
        durationMinutes: 60,
        bayNumber: '3',
        notes: '',
        playerCount: 1,
        userName: 'John Doe',
        createdAt: new Date(),
      };

      mockDbSelect
        .mockReturnValueOnce(createChainMock([booking]))
        .mockReturnValueOnce(createChainMock([]));
      mockDbInsert.mockReturnValue(createChainMock([{ id: 100 }]));
      mockDbUpdate.mockReturnValue(createChainMock({ rowCount: 1 }));
      mockDbExecute
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{ id: 'user-123' }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const { resolveUnmatchedBooking } = await import('../server/core/trackman/resolution');
      const result = await resolveUnmatchedBooking(5, 'john@test.com', 'admin');
      expect(result.success).toBe(true);
    });

    it('handles insertBookingIfNotExists returning not inserted (duplicate)', async () => {
      const booking = {
        id: 3,
        status: 'unmatched',
        resolvedEmail: null,
        trackmanBookingId: 'tm-3',
        originalEmail: 'dup@trackman.com',
        bookingDate: '2026-04-01',
        startTime: '09:00',
        endTime: '10:00',
        durationMinutes: 60,
        bayNumber: '1',
        notes: '',
        playerCount: 1,
        userName: 'Dup User',
        createdAt: new Date(),
      };

      mockDbSelect
        .mockReturnValueOnce(createChainMock([booking]))
        .mockReturnValueOnce(createChainMock([]));
      mockDbInsert.mockReturnValue(createChainMock([]));
      mockDbUpdate.mockReturnValue(createChainMock({ rowCount: 1 }));
      mockDbExecute
        .mockResolvedValueOnce({ rows: [{ id: booking.id }], rowCount: 1 })
        .mockResolvedValue({ rows: [], rowCount: 0 });

      const { resolveUnmatchedBooking } = await import('../server/core/trackman/resolution');
      const result = await resolveUnmatchedBooking(3, 'member@test.com', 'admin');
      expect(result.success).toBe(true);
    });
  });

  describe('getUnmatchedBookings', () => {
    it('returns data and totalCount from database', async () => {
      const bookings = [
        { id: 1, originalEmail: 'unknown@test.com', status: 'unmatched', bookingDate: '2026-04-01' },
        { id: 2, originalEmail: 'another@test.com', status: 'unmatched', bookingDate: '2026-04-02' },
      ];
      mockDbSelect
        .mockReturnValueOnce(createChainMock(bookings))
        .mockReturnValueOnce(createChainMock([{ count: 2 }]));
      const { getUnmatchedBookings } = await import('../server/core/trackman/resolution');
      const result = await getUnmatchedBookings();
      expect(result.data.length).toBe(2);
      expect(result.totalCount).toBe(2);
    });

    it('returns empty data when no unmatched bookings exist', async () => {
      mockDbSelect
        .mockReturnValueOnce(createChainMock([]))
        .mockReturnValueOnce(createChainMock([{ count: 0 }]));
      const { getUnmatchedBookings } = await import('../server/core/trackman/resolution');
      const result = await getUnmatchedBookings();
      expect(result.data.length).toBe(0);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('getImportRuns', () => {
    it('returns import run records from database', async () => {
      const runs = [
        { id: 1, filename: 'import1.csv', createdAt: new Date(), status: 'completed', totalRows: 50 },
      ];
      mockDbSelect.mockReturnValue(createChainMock(runs));
      const { getImportRuns } = await import('../server/core/trackman/resolution');
      const result = await getImportRuns();
      expect(result.length).toBe(1);
    });
  });
});
