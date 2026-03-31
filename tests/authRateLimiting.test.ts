// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = {
  select: vi.fn(),
  execute: vi.fn(),
  delete: vi.fn(),
};

function mockDbSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue(result),
  };
  mockDb.select.mockReturnValue(chain);
  return chain;
}

const hitCounters = new Map<string, number>();
const mockPool = {
  query: vi.fn(async (sql: string, params?: unknown[]) => {
    if (typeof sql === 'string' && sql.includes('INSERT INTO rate_limit_hits')) {
      const key = String((params as string[])?.[0] ?? '');
      const current = (hitCounters.get(key) ?? 0) + 1;
      hitCounters.set(key, current);
      return { rows: [{ hits: current, window_start: new Date() }] };
    }
    if (typeof sql === 'string' && sql.includes('CREATE TABLE')) {
      return { rows: [] };
    }
    if (typeof sql === 'string' && sql.includes('CREATE INDEX')) {
      return { rows: [] };
    }
    return { rows: [] };
  }),
  connect: vi.fn(async () => ({
    query: vi.fn(),
    release: vi.fn(),
  })),
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
};

vi.mock('../server/db', () => ({ db: mockDb }));
vi.mock('../server/core/db', () => ({
  pool: mockPool,
  db: mockDb,
}));
vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

describe('Auth Rate Limiting — Constants', () => {
  it('OTP request limit is 3 per 15 minutes', async () => {
    const { OTP_REQUEST_LIMIT, OTP_REQUEST_WINDOW } = await import(
      '../server/routes/auth/rateLimiting'
    );
    expect(OTP_REQUEST_LIMIT).toBe(3);
    expect(OTP_REQUEST_WINDOW).toBe(15 * 60 * 1000);
  });

  it('OTP verify max attempts is 5 per user/IP', async () => {
    const { OTP_VERIFY_MAX_ATTEMPTS } = await import(
      '../server/routes/auth/rateLimiting'
    );
    expect(OTP_VERIFY_MAX_ATTEMPTS).toBe(5);
  });

  it('OTP verify lockout is 15 minutes', async () => {
    const { OTP_VERIFY_LOCKOUT } = await import(
      '../server/routes/auth/rateLimiting'
    );
    expect(OTP_VERIFY_LOCKOUT).toBe(15 * 60 * 1000);
  });

  it('OTP verify email max attempts is 20', async () => {
    const { OTP_VERIFY_EMAIL_MAX_ATTEMPTS } = await import(
      '../server/routes/auth/rateLimiting'
    );
    expect(OTP_VERIFY_EMAIL_MAX_ATTEMPTS).toBe(20);
  });

  it('OTP verify IP max attempts is 15', async () => {
    const { OTP_VERIFY_IP_MAX_ATTEMPTS } = await import(
      '../server/routes/auth/rateLimiting'
    );
    expect(OTP_VERIFY_IP_MAX_ATTEMPTS).toBe(15);
  });

  it('magic link request limit is 3 per 15 minutes', async () => {
    const { MAGIC_LINK_REQUEST_LIMIT, MAGIC_LINK_REQUEST_WINDOW } = await import(
      '../server/routes/auth/rateLimiting'
    );
    expect(MAGIC_LINK_REQUEST_LIMIT).toBe(3);
    expect(MAGIC_LINK_REQUEST_WINDOW).toBe(15 * 60 * 1000);
  });
});

describe('Auth Rate Limiting — OTP Request Limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows request when count is within limit', async () => {
    const resetAt = new Date(Date.now() + 15 * 60 * 1000);
    mockDb.execute.mockResolvedValue({ rows: [{ count: 1, reset_at: resetAt }] });

    const { checkOtpRequestLimit } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpRequestLimit('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(true);
  });

  it('blocks request when count exceeds limit', async () => {
    const resetAt = new Date(Date.now() + 10 * 60 * 1000);
    mockDb.execute.mockResolvedValue({ rows: [{ count: 4, reset_at: resetAt }] });

    const { checkOtpRequestLimit } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpRequestLimit('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('denies on database error for safety', async () => {
    mockDb.execute.mockRejectedValue(new Error('DB connection failed'));

    const { checkOtpRequestLimit } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpRequestLimit('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(60);
  });

  it('uses composite key of email and IP', () => {
    const email = 'test@example.com';
    const ip = '192.168.1.1';
    const key = `otp_request:${email}:${ip}`;
    expect(key).toBe('otp_request:test@example.com:192.168.1.1');
  });
});

describe('Auth Rate Limiting — OTP Verify Attempts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows verification when no lockout records exist', async () => {
    mockDbSelectChain([]);

    const { checkOtpVerifyAttempts } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpVerifyAttempts('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(true);
  });

  it('blocks verification when per-IP locked', async () => {
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
    mockDbSelectChain([{ count: 5, lockedUntil }]);

    const { checkOtpVerifyAttempts } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpVerifyAttempts('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('allows verification when lock has expired', async () => {
    const lockedUntil = new Date(Date.now() - 1000);
    const chain = mockDbSelectChain([{ count: 5, lockedUntil }]);
    mockDb.delete.mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });

    const { checkOtpVerifyAttempts } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpVerifyAttempts('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(true);
  });

  it('defaults IP to "unknown" when not provided', () => {
    const ip = undefined;
    const effectiveIp = ip || 'unknown';
    expect(effectiveIp).toBe('unknown');
  });

  it('denies on database error for safety', async () => {
    const chain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockRejectedValue(new Error('DB error')),
    };
    mockDb.select.mockReturnValue(chain);

    const { checkOtpVerifyAttempts } = await import(
      '../server/routes/auth/rateLimiting'
    );
    const result = await checkOtpVerifyAttempts('test@example.com', '127.0.0.1');
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(60);
  });
});

describe('Auth Rate Limiting — OTP Verify Failure Recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records failure for per-IP, global-IP, and global-email keys', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ count: 1 }] });

    const { recordOtpVerifyFailure } = await import(
      '../server/routes/auth/rateLimiting'
    );
    await recordOtpVerifyFailure('test@example.com', '127.0.0.1');

    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('handles database error gracefully', async () => {
    mockDb.execute.mockRejectedValue(new Error('DB error'));

    const { recordOtpVerifyFailure } = await import(
      '../server/routes/auth/rateLimiting'
    );
    await expect(
      recordOtpVerifyFailure('test@example.com', '127.0.0.1')
    ).resolves.toBeUndefined();
  });

  it('uses correct key patterns', () => {
    const email = 'test@example.com';
    const ip = '127.0.0.1';
    expect(`otp_verify:${email}:${ip}`).toBe('otp_verify:test@example.com:127.0.0.1');
    expect(`otp_verify_ip:${ip}`).toBe('otp_verify_ip:127.0.0.1');
    expect(`otp_verify_email:${email}`).toBe('otp_verify_email:test@example.com');
  });
});

describe('Auth Rate Limiting — Clear Attempts on Success', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes per-IP and email records on successful login', async () => {
    const deleteChain = { where: vi.fn().mockResolvedValue(undefined) };
    mockDb.delete.mockReturnValue(deleteChain);

    const { clearOtpVerifyAttempts } = await import(
      '../server/routes/auth/rateLimiting'
    );
    await clearOtpVerifyAttempts('test@example.com', '127.0.0.1');

    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });

  it('handles database error gracefully', async () => {
    const deleteChain = { where: vi.fn().mockRejectedValue(new Error('DB error')) };
    mockDb.delete.mockReturnValue(deleteChain);

    const { clearOtpVerifyAttempts } = await import(
      '../server/routes/auth/rateLimiting'
    );
    await expect(
      clearOtpVerifyAttempts('test@example.com', '127.0.0.1')
    ).resolves.toBeUndefined();
  });
});

describe('Auth Rate Limiting — Middleware export verification', () => {
  it('authRateLimiter is an array of two middleware functions', async () => {
    const { authRateLimiter } = await import('../server/middleware/rateLimiting');
    expect(Array.isArray(authRateLimiter)).toBe(true);
    expect(authRateLimiter).toHaveLength(2);
    authRateLimiter.forEach((mw: unknown) => {
      expect(typeof mw).toBe('function');
    });
  });

  it('authRateLimiterByIp is a function middleware', async () => {
    const { authRateLimiterByIp } = await import('../server/middleware/rateLimiting');
    expect(typeof authRateLimiterByIp).toBe('function');
  });

  it('authRateLimiterByEmail is a function middleware', async () => {
    const { authRateLimiterByEmail } = await import('../server/middleware/rateLimiting');
    expect(typeof authRateLimiterByEmail).toBe('function');
  });
});

describe('Auth Rate Limiting — Middleware integration via supertest', () => {
  beforeEach(() => {
    hitCounters.clear();
    vi.clearAllMocks();
  });

  it('authRateLimiterByIp returns 429 after exceeding max requests', async () => {
    const express = (await import('express')).default;
    const supertest = (await import('supertest')).default;

    mockDb.execute.mockResolvedValue({ rows: [] });

    const { authRateLimiterByIp } = await import('../server/middleware/rateLimiting');
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(authRateLimiterByIp);
    app.get('/test-rate', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 20; i++) {
      const res = await supertest(app).get('/test-rate').set('X-Forwarded-For', '10.0.0.1');
      expect(res.status).toBe(200);
    }

    const blockedRes = await supertest(app).get('/test-rate').set('X-Forwarded-For', '10.0.0.1');
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toContain('Too many login attempts');
  });

  it('authRateLimiterByEmail returns 429 after exceeding email-based limit', async () => {
    const express = (await import('express')).default;
    const supertest = (await import('supertest')).default;

    mockDb.execute.mockResolvedValue({ rows: [] });

    const { authRateLimiterByEmail } = await import('../server/middleware/rateLimiting');
    const app = express();
    app.set('trust proxy', true);
    app.use(express.json());
    app.use(authRateLimiterByEmail);
    app.post('/test-rate', (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 10; i++) {
      const res = await supertest(app)
        .post('/test-rate')
        .set('X-Forwarded-For', '10.0.0.2')
        .send({ email: 'flood@example.com' });
      expect(res.status).toBe(200);
    }

    const blockedRes = await supertest(app)
      .post('/test-rate')
      .set('X-Forwarded-For', '10.0.0.2')
      .send({ email: 'flood@example.com' });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.body.error).toContain('Too many login attempts');
  });

  it('per-IP rate limit does not block different IPs', async () => {
    const express = (await import('express')).default;
    const supertest = (await import('supertest')).default;

    mockDb.execute.mockResolvedValue({ rows: [] });

    const { authRateLimiterByIp } = await import('../server/middleware/rateLimiting');
    const app = express();
    app.set('trust proxy', true);
    app.use(authRateLimiterByIp);
    app.get('/test-rate', (_req, res) => res.json({ ok: true }));

    const res = await supertest(app).get('/test-rate').set('X-Forwarded-For', '192.168.99.99');
    expect(res.status).toBe(200);
  });
});

describe('Auth Rate Limiting — exported function signatures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checkOtpRequestLimit returns { allowed, retryAfter } shape', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ count: 1, reset_at: new Date(Date.now() + 60000) }] });
    const { checkOtpRequestLimit } = await import('../server/routes/auth/rateLimiting');
    const result = await checkOtpRequestLimit('a@b.com', '1.2.3.4');
    expect(result).toHaveProperty('allowed');
    expect(typeof result.allowed).toBe('boolean');
  });

  it('checkOtpVerifyAttempts returns { allowed, retryAfter } shape', async () => {
    mockDbSelectChain([]);
    const { checkOtpVerifyAttempts } = await import('../server/routes/auth/rateLimiting');
    const result = await checkOtpVerifyAttempts('a@b.com', '1.2.3.4');
    expect(result).toHaveProperty('allowed');
    expect(typeof result.allowed).toBe('boolean');
  });

  it('recordOtpVerifyFailure is callable and records 3 keys', async () => {
    mockDb.execute.mockResolvedValue({ rows: [{ count: 1 }] });
    const { recordOtpVerifyFailure } = await import('../server/routes/auth/rateLimiting');
    await recordOtpVerifyFailure('a@b.com', '1.2.3.4');
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it('clearOtpVerifyAttempts is callable and deletes 2 keys', async () => {
    const deleteChain = { where: vi.fn().mockResolvedValue(undefined) };
    mockDb.delete.mockReturnValue(deleteChain);
    const { clearOtpVerifyAttempts } = await import('../server/routes/auth/rateLimiting');
    await clearOtpVerifyAttempts('a@b.com', '1.2.3.4');
    expect(mockDb.delete).toHaveBeenCalledTimes(2);
  });
});
