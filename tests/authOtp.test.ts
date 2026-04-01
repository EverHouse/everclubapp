// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbExecute = vi.fn();
const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbDelete = vi.fn();

function defaultSelectChain() {
  return {
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  };
}

function setDefaultMocks() {
  mockDbSelect.mockImplementation(() => defaultSelectChain());
  mockDbInsert.mockImplementation(() => ({
    values: vi.fn().mockReturnValue({
      onConflictDoUpdate: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
      returning: vi.fn().mockResolvedValue([]),
    }),
  }));
  mockDbUpdate.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }),
  }));
  mockDbDelete.mockImplementation(() => ({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue([]),
    }),
  }));
  mockDbExecute.mockResolvedValue({ rows: [] });
}

vi.mock('../server/db', () => {
  const txProxy = {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
  };
  return {
    db: {
      ...txProxy,
      transaction: async (fn: (tx: typeof txProxy) => Promise<unknown>) => fn(txProxy),
    },
  };
});
vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAndRespond: vi.fn((_req: unknown, res: Pick<import('express').Response, 'status' | 'json'>, code: number, msg: string) => res.status(code).json({ error: msg })),
}));
vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({ results: [] }) } } },
  }),
}));
vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock('../server/utils/resend', () => ({
  safeSendEmail: vi.fn().mockResolvedValue({ success: true, suppressed: false }),
}));
vi.mock('../server/emails/otpEmail', () => ({
  getOtpEmailHtml: vi.fn().mockReturnValue('<html>OTP</html>'),
  getOtpEmailText: vi.fn().mockReturnValue('Your code'),
}));
vi.mock('../server/emails/welcomeEmail', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../server/middleware/rateLimiting', () => ({
  authRateLimiter: [],
  authRateLimiterByIp: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../server/core/db', () => ({ isProduction: false }));
vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../server/core/supabase/client', () => ({
  isSupabaseAvailable: vi.fn().mockResolvedValue(false),
  getSupabaseAdmin: vi.fn(),
}));

const mockCheckOtpRequestLimit = vi.fn().mockResolvedValue({ allowed: true });
const mockCheckOtpVerifyAttempts = vi.fn().mockResolvedValue({ allowed: true });
const mockRecordOtpVerifyFailure = vi.fn().mockResolvedValue(undefined);
const mockClearOtpVerifyAttempts = vi.fn().mockResolvedValue(undefined);

vi.mock('../server/routes/auth/rateLimiting', () => ({
  checkOtpRequestLimit: (...args: unknown[]) => mockCheckOtpRequestLimit(...args),
  checkOtpVerifyAttempts: (...args: unknown[]) => mockCheckOtpVerifyAttempts(...args),
  recordOtpVerifyFailure: (...args: unknown[]) => mockRecordOtpVerifyFailure(...args),
  clearOtpVerifyAttempts: (...args: unknown[]) => mockClearOtpVerifyAttempts(...args),
}));

const mockGetUserRole = vi.fn().mockResolvedValue('member');
const mockGetStaffUserByEmail = vi.fn().mockResolvedValue(null);
const mockIsStaffOrAdminEmail = vi.fn().mockResolvedValue(false);
const mockUpsertUserWithTier = vi.fn().mockResolvedValue('user-1');
const mockCreateSupabaseToken = vi.fn().mockResolvedValue(null);
const mockRegenerateSession = vi.fn().mockResolvedValue(undefined);

vi.mock('../server/routes/auth/helpers', () => ({
  getStaffUserByEmail: (...args: unknown[]) => mockGetStaffUserByEmail(...args),
  getUserRole: (...args: unknown[]) => mockGetUserRole(...args),
  isStaffOrAdminEmail: (...args: unknown[]) => mockIsStaffOrAdminEmail(...args),
  upsertUserWithTier: (...args: unknown[]) => mockUpsertUserWithTier(...args),
  createSupabaseToken: (...args: unknown[]) => mockCreateSupabaseToken(...args),
  regenerateSession: (...args: unknown[]) => mockRegenerateSession(...args),
}));
vi.mock('../server/core/utils/emailNormalization', () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
  getAlternateDomainEmail: vi.fn().mockReturnValue(null),
}));
vi.mock('../shared/constants/tiers', () => ({
  normalizeTierName: (t: string | null | undefined) => t || null,
}));
vi.mock('../server/core/stripe/customers', () => ({
  resolveUserByEmail: vi.fn().mockResolvedValue(null),
}));

function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).session = {
      user: undefined,
      save: (cb: (err: Error | null) => void) => cb(null),
      regenerate: (cb: (err: Error | null) => void) => cb(null),
      destroy: (cb: (err: Error | null) => void) => cb(null),
    };
    req.headers['x-forwarded-for'] = '127.0.0.1';
    next();
  });
  return app;
}

describe('OTP Route — POST /api/auth/request-otp', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    app = createApp();
    const { otpRouter } = await import('../server/routes/auth/otp');
    app.use(otpRouter);
  });

  it('returns 400 when email is missing', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email is required');
  });

  it('returns 429 when OTP request rate limit exceeded', async () => {
    mockCheckOtpRequestLimit.mockResolvedValueOnce({ allowed: false, retryAfter: 600 });
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'test@example.com' });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many code requests');
  });

  it('returns 404 when member not found in HubSpot and not stripe-billed', async () => {
    const res = await request(app).post('/api/auth/request-otp').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No member found');
  });

  it('sends OTP email and returns success for valid member', async () => {
    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { firstname: 'Test', membership_status: 'active', email: 'test@example.com' } }],
      }) } } },
    });

    const res = await request(app).post('/api/auth/request-otp').send({ email: 'test@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Login code sent');

    const { safeSendEmail } = await import('../server/utils/resend');
    expect(safeSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'test@example.com' })
    );
  });

  it('returns 403 for inactive HubSpot member', async () => {
    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { membership_status: 'cancelled', email: 'inactive@example.com' } }],
      }) } } },
    });

    const res = await request(app).post('/api/auth/request-otp').send({ email: 'inactive@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not active');
  });

  it('returns 400 for suppressed email', async () => {
    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { membership_status: 'active', email: 'bounced@example.com' } }],
      }) } } },
    });
    const { safeSendEmail } = await import('../server/utils/resend');
    (safeSendEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: true, suppressed: true });

    const res = await request(app).post('/api/auth/request-otp').send({ email: 'bounced@example.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unable to deliver');
  });

  it('returns 500 when email send fails', async () => {
    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { membership_status: 'active', email: 'fail@example.com' } }],
      }) } } },
    });
    const { safeSendEmail } = await import('../server/utils/resend');
    (safeSendEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ success: false });

    const res = await request(app).post('/api/auth/request-otp').send({ email: 'fail@example.com' });
    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Unable to send login code');
  });
});

describe('OTP Route — POST /api/auth/verify-otp', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    app = createApp();
    const { otpRouter } = await import('../server/routes/auth/otp');
    app.use(otpRouter);
  });

  it('returns 400 when email or code is missing', async () => {
    const res1 = await request(app).post('/api/auth/verify-otp').send({ email: 'test@example.com' });
    expect(res1.status).toBe(400);
    expect(res1.body.error).toContain('Email and code are required');

    const res2 = await request(app).post('/api/auth/verify-otp').send({ code: '123456' });
    expect(res2.status).toBe(400);
  });

  it('returns 429 when verify attempts are rate-limited', async () => {
    mockCheckOtpVerifyAttempts.mockResolvedValueOnce({ allowed: false, retryAfter: 900 });

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain('Too many failed attempts');
  });

  it('returns 400 for invalid/expired code and records failure', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'test@example.com', code: '000000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or expired code');
    expect(mockRecordOtpVerifyFailure).toHaveBeenCalledWith('test@example.com', '127.0.0.1');
  });

  it('verifies valid code, clears rate limits, creates session, returns member', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'member@example.com', token: '123456', used: true }] })
      .mockResolvedValueOnce({ rows: [] });

    mockGetUserRole.mockResolvedValueOnce('member');

    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { firstname: 'Member', lastname: 'User', email: 'member@example.com', membership_status: 'active', membership_tier: 'Gold' } }],
      }) } } },
    });

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'member@example.com', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.member).toBeDefined();
    expect(res.body.member.email).toBe('member@example.com');
    expect(res.body.member.expires_at).toBeGreaterThan(Date.now());
    expect(mockClearOtpVerifyAttempts).toHaveBeenCalledWith('member@example.com', '127.0.0.1');
    expect(mockRegenerateSession).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({ email: 'member@example.com' })
    );
  });

  it('returns 404 for staff user not found after valid OTP', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'staff@everclub.co', token: '123456', used: true }] });
    mockGetUserRole.mockResolvedValueOnce('admin');
    mockGetStaffUserByEmail.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'staff@everclub.co', code: '123456' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Staff user not found');
  });

  it('creates staff session for admin/staff with valid OTP', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'admin@everclub.co', token: '123456', used: true }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetUserRole.mockResolvedValueOnce('admin');
    mockGetStaffUserByEmail.mockResolvedValueOnce({
      id: 1, firstName: 'Admin', lastName: 'User', email: 'admin@everclub.co', phone: '555',
    });
    mockDbSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ passwordHash: 'somehash' }]),
        }),
      }),
    }));

    mockUpsertUserWithTier.mockResolvedValueOnce(null);

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'admin@everclub.co', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.member.role).toBe('admin');
    expect(res.body.member.id).toContain('staff-');
  });
});

describe('OTP Route — Replay Protection and Expiry', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    mockCheckOtpRequestLimit.mockResolvedValue({ allowed: true });
    mockCheckOtpVerifyAttempts.mockResolvedValue({ allowed: true });
    app = createApp();
    const { otpRouter } = await import('../server/routes/auth/otp');
    app.use(otpRouter);
  });

  it('rejects replay of already-used OTP code (atomic CTE returns 0 rows)', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'test@example.com', code: '123456' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or expired code');
    expect(mockRecordOtpVerifyFailure).toHaveBeenCalledWith('test@example.com', '127.0.0.1');
  });

  it('rejects expired OTP code (atomic CTE filters expires_at > NOW)', async () => {
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'test@example.com', code: '999999' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid or expired code');
    expect(mockRecordOtpVerifyFailure).toHaveBeenCalled();
  });

  it('valid OTP marks code as used and clears rate limits (successful path)', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'user@example.com', token: '123456', used: true }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetUserRole.mockResolvedValueOnce('member');

    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { firstname: 'A', lastname: 'B', email: 'user@example.com', membership_status: 'active', membership_tier: 'Gold' } }],
      }) } } },
    });

    const res = await request(app).post('/api/auth/verify-otp').send({ email: 'user@example.com', code: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockClearOtpVerifyAttempts).toHaveBeenCalledWith('user@example.com', '127.0.0.1');
    expect(mockRegenerateSession).toHaveBeenCalled();
  });

  it('second use of same code after successful verify returns 400 (replay blocked)', async () => {
    mockDbExecute
      .mockResolvedValueOnce({ rows: [{ id: 1, email: 'user@example.com', token: '123456', used: true }] })
      .mockResolvedValueOnce({ rows: [] });
    mockGetUserRole.mockResolvedValueOnce('member');

    const { getHubSpotClient } = await import('../server/core/integrations');
    (getHubSpotClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({
        results: [{ id: 'hs-1', properties: { firstname: 'A', lastname: 'B', email: 'user@example.com', membership_status: 'active', membership_tier: 'Gold' } }],
      }) } } },
    });

    const res1 = await request(app).post('/api/auth/verify-otp').send({ email: 'user@example.com', code: '123456' });
    expect(res1.status).toBe(200);

    mockDbExecute.mockResolvedValueOnce({ rows: [] });
    const res2 = await request(app).post('/api/auth/verify-otp').send({ email: 'user@example.com', code: '123456' });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain('Invalid or expired code');
  });
});

describe('OTP Flow — Auth Helpers (Unit)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSessionUser returns session user when present', async () => {
    const { getSessionUser } = await import('../server/types/session');
    const user = { id: 'user-1', email: 'test@example.com', role: 'member' };
    expect(getSessionUser({ session: { user } } as unknown as import('express').Request)).toEqual(user);
    expect(getSessionUser({} as unknown as import('express').Request)).toBeUndefined();
    expect(getSessionUser({ session: {} } as unknown as import('express').Request)).toBeUndefined();
  });
});
