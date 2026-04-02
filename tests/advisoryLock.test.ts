// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorCode: vi.fn((e: unknown) => (e && typeof e === 'object' && 'code' in e ? (e as { code: string }).code : undefined)),
}));

const mockRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('../server/core/db', () => ({
  pool: {
    connect: (...args: unknown[]) => mockConnect(...args),
  },
  safeRelease: (...args: unknown[]) => mockRelease(...args),
}));

import { withMemberDayLock } from '../server/core/billing/advisoryLock';

function createMockClient() {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  return { query, release: vi.fn() };
}

describe('withMemberDayLock — unit tests', () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    mockConnect.mockResolvedValue(mockClient);
  });

  it('acquires pg_advisory_xact_lock within a transaction and runs callback', async () => {
    const callback = vi.fn().mockResolvedValue('result-value');

    const result = await withMemberDayLock('user@test.com', '2025-06-15', callback);

    expect(result).toEqual({ success: true, result: 'result-value' });
    expect(callback).toHaveBeenCalledOnce();

    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).toBe('BEGIN');
    expect(calls[1]).toMatch(/SET LOCAL lock_timeout/);
    expect(calls[2]).toMatch(/pg_advisory_xact_lock/);
    expect(calls[3]).toBe('COMMIT');
  });

  it('normalizes email to lowercase in lock key', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);

    await withMemberDayLock('User@Test.COM', '2025-06-15', callback);

    const lockCall = mockClient.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    );
    expect(lockCall).toBeDefined();
    expect(lockCall![1]).toEqual(['fee_cascade::user@test.com::2025-06-15']);
  });

  it('rolls back and returns timeout on SQLSTATE 55P03', async () => {
    const lockError = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(lockError);

    const callback = vi.fn();
    const result = await withMemberDayLock('user@test.com', '2025-06-15', callback);

    expect(result).toEqual({ success: false, reason: 'timeout' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('rolls back and re-throws non-lock errors', async () => {
    const dbError = new Error('connection lost');
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(dbError);

    await expect(
      withMemberDayLock('user@test.com', '2025-06-15', vi.fn())
    ).rejects.toThrow('connection lost');
  });

  it('rolls back when callback throws', async () => {
    const callbackError = new Error('cascade failed');
    const callback = vi.fn().mockRejectedValue(callbackError);

    await expect(
      withMemberDayLock('user@test.com', '2025-06-15', callback)
    ).rejects.toThrow('cascade failed');

    const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain('BEGIN');
    expect(calls.some((c: unknown) => typeof c === 'string' && (c as string).includes('ROLLBACK'))).toBe(true);
  });

  it('always releases client in finally', async () => {
    const callback = vi.fn().mockResolvedValue('ok');
    await withMemberDayLock('user@test.com', '2025-06-15', callback);
    expect(mockRelease).toHaveBeenCalledWith(mockClient);
  });

  it('releases client even when lock acquisition fails', async () => {
    const lockError = Object.assign(new Error('lock timeout'), { code: '55P03' });
    mockClient.query
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(lockError);

    await withMemberDayLock('user@test.com', '2025-06-15', vi.fn());
    expect(mockRelease).toHaveBeenCalledWith(mockClient);
  });

  it('uses different lock keys for different members on the same day', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);

    await withMemberDayLock('alice@test.com', '2025-06-15', callback);
    const aliceLockCall = mockClient.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    );

    const mockClient2 = createMockClient();
    mockConnect.mockResolvedValue(mockClient2);

    await withMemberDayLock('bob@test.com', '2025-06-15', callback);
    const bobLockCall = mockClient2.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    );

    expect(aliceLockCall![1]).not.toEqual(bobLockCall![1]);
  });

  it('uses different lock keys for the same member on different days', async () => {
    const callback = vi.fn().mockResolvedValue(undefined);

    await withMemberDayLock('alice@test.com', '2025-06-15', callback);
    const day1LockCall = mockClient.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    );

    const mockClient2 = createMockClient();
    mockConnect.mockResolvedValue(mockClient2);

    await withMemberDayLock('alice@test.com', '2025-06-16', callback);
    const day2LockCall = mockClient2.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    );

    expect(day1LockCall![1]).not.toEqual(day2LockCall![1]);
  });
});

describe('withMemberDayLock — concurrent behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('serializes two concurrent calls for the same member-day (second waits for first)', async () => {
    const executionOrder: string[] = [];

    let resolveCallback1: (() => void) | undefined;
    const callback1Promise = new Promise<void>(r => { resolveCallback1 = r; });

    const client1 = createMockClient();
    const client2 = createMockClient();

    let connectCount = 0;
    mockConnect.mockImplementation(() => {
      connectCount++;
      return Promise.resolve(connectCount === 1 ? client1 : client2);
    });

    client2.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')) {
        executionOrder.push('call2-lock-wait');
        return callback1Promise.then(() => {
          executionOrder.push('call2-lock-acquired');
          return { rows: [] };
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const call1 = withMemberDayLock('user@test.com', '2025-06-15', async () => {
      executionOrder.push('callback1-start');
      await new Promise(r => setTimeout(r, 10));
      executionOrder.push('callback1-end');
      resolveCallback1!();
      return 'first';
    });

    const call2 = withMemberDayLock('user@test.com', '2025-06-15', async () => {
      executionOrder.push('callback2-start');
      return 'second';
    });

    const [result1, result2] = await Promise.all([call1, call2]);

    expect(result1).toEqual({ success: true, result: 'first' });
    expect(result2).toEqual({ success: true, result: 'second' });

    expect(executionOrder.indexOf('callback1-start')).toBeLessThan(
      executionOrder.indexOf('callback1-end')
    );
    expect(executionOrder.indexOf('call2-lock-wait')).toBeGreaterThanOrEqual(0);
    expect(executionOrder.indexOf('call2-lock-acquired')).toBeGreaterThan(
      executionOrder.indexOf('callback1-end')
    );
  });

  it('allows concurrent calls for different member-days to proceed independently', async () => {
    const client1 = createMockClient();
    const client2 = createMockClient();

    let connectCount = 0;
    mockConnect.mockImplementation(() => {
      connectCount++;
      return Promise.resolve(connectCount === 1 ? client1 : client2);
    });

    const callback1 = vi.fn().mockResolvedValue('alice-result');
    const callback2 = vi.fn().mockResolvedValue('bob-result');

    const [result1, result2] = await Promise.all([
      withMemberDayLock('alice@test.com', '2025-06-15', callback1),
      withMemberDayLock('bob@test.com', '2025-06-15', callback2),
    ]);

    expect(result1).toEqual({ success: true, result: 'alice-result' });
    expect(result2).toEqual({ success: true, result: 'bob-result' });
    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).toHaveBeenCalledOnce();

    const aliceLockKey = client1.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    )?.[1]?.[0];
    const bobLockKey = client2.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    )?.[1]?.[0];

    expect(aliceLockKey).not.toEqual(bobLockKey);
  });

  it('second call times out and skips when first holds lock', async () => {
    const client1 = createMockClient();
    const client2 = createMockClient();

    let connectCount = 0;
    mockConnect.mockImplementation(() => {
      connectCount++;
      return Promise.resolve(connectCount === 1 ? client1 : client2);
    });

    client2.query.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('pg_advisory_xact_lock')) {
        const err = Object.assign(
          new Error('canceling statement due to lock timeout'),
          { code: '55P03' }
        );
        return Promise.reject(err);
      }
      return Promise.resolve({ rows: [] });
    });

    const callback1 = vi.fn(async () => {
      await new Promise(r => setTimeout(r, 10));
      return 'first-result';
    });
    const callback2 = vi.fn();

    const [result1, result2] = await Promise.all([
      withMemberDayLock('user@test.com', '2025-06-15', callback1),
      withMemberDayLock('user@test.com', '2025-06-15', callback2),
    ]);

    expect(result1).toEqual({ success: true, result: 'first-result' });
    expect(result2).toEqual({ success: false, reason: 'timeout' });
    expect(callback1).toHaveBeenCalledOnce();
    expect(callback2).not.toHaveBeenCalled();
  });

  it('concurrent calls for same member different days use distinct lock keys', async () => {
    const client1 = createMockClient();
    const client2 = createMockClient();

    let connectCount = 0;
    mockConnect.mockImplementation(() => {
      connectCount++;
      return Promise.resolve(connectCount === 1 ? client1 : client2);
    });

    await Promise.all([
      withMemberDayLock('user@test.com', '2025-06-15', async () => 'day1'),
      withMemberDayLock('user@test.com', '2025-06-16', async () => 'day2'),
    ]);

    const day1Key = client1.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    )?.[1]?.[0];
    const day2Key = client2.query.mock.calls.find((c: unknown[]) =>
      typeof c[0] === 'string' && (c[0] as string).includes('pg_advisory_xact_lock')
    )?.[1]?.[0];

    expect(day1Key).toContain('2025-06-15');
    expect(day2Key).toContain('2025-06-16');
    expect(day1Key).not.toEqual(day2Key);
  });
});
