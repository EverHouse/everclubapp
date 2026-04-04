// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn(), select: vi.fn(), transaction: vi.fn() },
}));

vi.mock('../server/utils/dateUtils', () => ({
  formatTime12Hour: vi.fn((t: string) => t),
  getTodayPacific: vi.fn(() => '2025-01-01'),
}));

vi.mock('../server/core/stripe/customers', () => ({
  resolveUserByEmail: vi.fn(),
}));

vi.mock('../server/core/tierService', () => ({
  checkDailyBookingLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock('../server/core/bookingValidation', () => ({
  checkClosureConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
  checkAvailabilityBlockConflict: vi.fn().mockResolvedValue({ hasConflict: false }),
}));

vi.mock('../server/core/bookingService/bookingCreationGuard', () => ({
  acquireBookingLocks: vi.fn().mockResolvedValue(undefined),
  checkResourceOverlap: vi.fn().mockResolvedValue(undefined),
  BookingConflictError: class extends Error {
    statusCode = 409;
    errorBody = {};
  },
}));

const { sqlCalls } = vi.hoisted(() => {
  const sqlCalls: unknown[] = [];
  return { sqlCalls };
});

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      sqlCalls.push({ strings: Array.from(strings), values });
      return { __sqlStrings: Array.from(strings), __sqlValues: values };
    }),
    {
      raw: vi.fn((s: string) => s),
      join: vi.fn((...args: unknown[]) => args),
    }
  ),
  eq: vi.fn(),
  and: vi.fn(),
  or: vi.fn(),
  inArray: vi.fn(),
}));

vi.mock('../../shared/schema', () => ({
  users: { id: 'id', email: 'email', firstName: 'first_name', lastName: 'last_name', membershipStatus: 'membership_status' },
  resources: { id: 'id', type: 'type', name: 'name' },
}));

import { sanitizeAndResolveParticipants } from '../server/core/bookingService/createBooking';

describe('Linked-email participant resolution regression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlCalls.length = 0;
  });

  it('resolves participant via user_linked_emails to primary user record', async () => {
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      execute: vi.fn(),
    };

    let executeCallCount = 0;
    mockTx.execute.mockImplementation(async () => {
      executeCallCount++;
      if (executeCallCount === 1) {
        return {
          rows: [{
            id: 'user-primary-1',
            email: 'primary@example.com',
            firstName: 'John',
            lastName: 'Doe',
            membershipStatus: 'active',
          }],
        };
      }
      if (executeCallCount === 2) {
        return {
          rows: [{
            linked: 'secondary@example.com',
            primary_email: 'primary@example.com',
          }],
        };
      }
      return { rows: [] };
    });

    const participants = await sanitizeAndResolveParticipants(
      [{ email: 'secondary@example.com', type: 'guest' }],
      'owner@example.com',
      mockTx as any,
    );

    expect(participants.length).toBe(1);
    expect(participants[0].userId).toBe('user-primary-1');
    expect(participants[0].type).toBe('member');
  });

  it('resets isGuestPassParticipant to false when participant is resolved as member', async () => {
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      execute: vi.fn(),
    };

    let executeCallCount = 0;
    mockTx.execute.mockImplementation(async () => {
      executeCallCount++;
      if (executeCallCount === 1) {
        return {
          rows: [{
            id: 'user-member-1',
            email: 'member@example.com',
            firstName: 'Jane',
            lastName: 'Smith',
            membershipStatus: 'active',
          }],
        };
      }
      if (executeCallCount === 2) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const participants = await sanitizeAndResolveParticipants(
      [{ email: 'member@example.com', type: 'guest' }],
      'owner@example.com',
      mockTx as any,
    );

    expect(participants.length).toBe(1);
    expect(participants[0].isGuestPassParticipant).toBe(false);
    expect(participants[0].type).toBe('member');
  });

  it('keeps isGuestPassParticipant true for unresolved guest participants', async () => {
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      execute: vi.fn(),
    };

    mockTx.execute.mockImplementation(async () => {
      return { rows: [] };
    });

    const participants = await sanitizeAndResolveParticipants(
      [{ email: 'guest@example.com', type: 'guest' }],
      'owner@example.com',
      mockTx as any,
    );

    expect(participants.length).toBe(1);
    expect(participants[0].isGuestPassParticipant).toBe(true);
    expect(participants[0].type).toBe('guest');
  });

  it('resolves secondary email via linked_email table and maps to primary user', async () => {
    const mockTx = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      execute: vi.fn(),
    };

    let executeCallCount = 0;
    mockTx.execute.mockImplementation(async () => {
      executeCallCount++;
      if (executeCallCount === 1) {
        return {
          rows: [{
            id: 'user-primary-2',
            email: 'primary@corp.com',
            firstName: 'Bob',
            lastName: 'Jones',
            membershipStatus: 'active',
          }],
        };
      }
      if (executeCallCount === 2) {
        return {
          rows: [{
            linked: 'personal@gmail.com',
            primary_email: 'primary@corp.com',
          }],
        };
      }
      return { rows: [] };
    });

    const participants = await sanitizeAndResolveParticipants(
      [{ email: 'personal@gmail.com', type: 'guest' }],
      'owner@example.com',
      mockTx as any,
    );

    expect(participants.length).toBe(1);
    expect(participants[0].userId).toBe('user-primary-2');
    expect(participants[0].type).toBe('member');
    expect(participants[0].isGuestPassParticipant).toBe(false);
  });
});
