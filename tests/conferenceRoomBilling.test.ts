// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreateSession = vi.fn();
vi.mock('../server/core/bookingService/sessionManager', () => ({
  createSessionWithUsageTracking: (...args: unknown[]) => mockCreateSession(...args),
}));

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
}));

vi.mock('drizzle-orm', () => ({
  sql: new Proxy(() => {}, {
    apply: (_target: unknown, _thisArg: unknown, args: unknown[]) => ({ __sql: true, values: args }),
    get: (_target: unknown, prop: string) => {
      if (prop === 'raw') return (v: unknown) => ({ __raw: v });
      return undefined;
    },
  }),
}));

import { tryConferenceAutoConfirm } from '../server/core/bookingService/conferenceAutoConfirm';

const BASE_INPUT = {
  bookingId: 100,
  resourceId: 5,
  sessionDate: '2025-06-15',
  startTime: '10:00',
  endTime: '11:00',
  ownerEmail: 'member@test.com',
  durationMinutes: 60,
  displayName: 'Test Member',
  userId: 'user-1',
};

function makeMockTx(sessionIdValue: number | null = null) {
  const executeCalls: unknown[] = [];
  const tx = {
    execute: vi.fn(async (query: unknown) => {
      executeCalls.push(query);
      const sqlStr = JSON.stringify(query);
      if (sqlStr.includes('session_id')) {
        return { rows: [{ session_id: sessionIdValue }] };
      }
      return { rows: [] };
    }),
  };
  return { tx, executeCalls };
}

describe('Conference room billing integrity — tryConferenceAutoConfirm (production code)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not confirm booking when sessionResult.success is false', async () => {
    mockCreateSession.mockResolvedValue({ success: false, error: 'Usage tracking failed' });
    const { tx } = makeMockTx();

    const result = await tryConferenceAutoConfirm(BASE_INPUT, tx);

    expect(result.confirmed).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.staffNote).toContain('usage tracking error');
    expect(tx.execute).toHaveBeenCalled();
    const updateCalls = tx.execute.mock.calls.map(c => JSON.stringify(c[0]));
    const hasConfirmedUpdate = updateCalls.some(s => s.includes('confirmed'));
    expect(hasConfirmedUpdate).toBe(false);
  });

  it('confirms booking only when success is true AND session_id exists', async () => {
    mockCreateSession.mockResolvedValue({ success: true, sessionId: 42 });
    const { tx } = makeMockTx(42);

    const result = await tryConferenceAutoConfirm(BASE_INPUT, tx);

    expect(result.confirmed).toBe(true);
    expect(result.sessionId).toBe(42);
    expect(result.staffNote).toBeUndefined();
  });

  it('stays pending when success is true but session_id is null', async () => {
    mockCreateSession.mockResolvedValue({ success: true });
    const { tx } = makeMockTx(null);

    const result = await tryConferenceAutoConfirm(BASE_INPUT, tx);

    expect(result.confirmed).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.staffNote).toContain('session could not be created');
    const updateCalls = tx.execute.mock.calls.map(c => JSON.stringify(c[0]));
    const hasConfirmedUpdate = updateCalls.some(s => s.includes('confirmed'));
    expect(hasConfirmedUpdate).toBe(false);
  });

  it('stays pending when createSessionWithUsageTracking throws an error', async () => {
    mockCreateSession.mockRejectedValue(new Error('Database connection lost'));
    const { tx } = makeMockTx();

    const result = await tryConferenceAutoConfirm(BASE_INPUT, tx);

    expect(result.confirmed).toBe(false);
    expect(result.sessionId).toBeNull();
    expect(result.staffNote).toContain('Database connection lost');
    const updateCalls = tx.execute.mock.calls.map(c => JSON.stringify(c[0]));
    const hasConfirmedUpdate = updateCalls.some(s => s.includes('confirmed'));
    expect(hasConfirmedUpdate).toBe(false);
  });
});
