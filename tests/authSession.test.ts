// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbSelect = vi.fn();
const mockDbExecute = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

function mockSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

function setDefaultMocks() {
  mockDbSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([]),
      }),
    }),
  }));
  mockDbUpdate.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'user-1' }]),
      }),
    }),
  }));
  mockDbExecute.mockResolvedValue({ rows: [] });
}

vi.mock('../server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: vi.fn(),
  },
}));
vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAndRespond: vi.fn((_req: unknown, res: Pick<import('express').Response, 'status' | 'json'>, code: number, msg: string) => {
    res.status(code).json({ error: msg });
  }),
}));
vi.mock('../server/core/db', () => ({ isProduction: false }));
vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../server/middleware/rateLimiting', () => ({
  authRateLimiterByIp: (_req: unknown, _res: unknown, next: () => void) => next(),
  authRateLimiter: [],
  wsTokenRateLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../server/core/integrations', () => ({
  getHubSpotClient: vi.fn().mockResolvedValue({
    crm: { contacts: { searchApi: { doSearch: vi.fn().mockResolvedValue({ results: [] }) } } },
  }),
}));
vi.mock('../server/core/hubspot/request', () => ({
  retryableHubSpotRequest: vi.fn((fn: () => unknown) => fn()),
}));
vi.mock('../server/emails/welcomeEmail', () => ({
  sendWelcomeEmail: vi.fn().mockResolvedValue({ success: true }),
}));
vi.mock('../server/core/supabase/client', () => ({
  isSupabaseAvailable: vi.fn().mockResolvedValue(false),
  getSupabaseAdmin: vi.fn(),
}));
vi.mock('../server/core/utils/emailNormalization', () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
  getAlternateDomainEmail: vi.fn().mockReturnValue(null),
}));
vi.mock('../shared/constants/tiers', () => ({
  normalizeTierName: (t: string | null | undefined) => t || null,
}));

const mockGetUserRole = vi.fn().mockResolvedValue('member');
const mockGetStaffUserByEmail = vi.fn().mockResolvedValue(null);
const mockUpsertUserWithTier = vi.fn().mockResolvedValue('user-1');
const mockCreateSupabaseToken = vi.fn().mockResolvedValue(null);
const mockRegenerateSession = vi.fn().mockResolvedValue(undefined);

vi.mock('../server/routes/auth/helpers', () => ({
  getUserRole: (...args: unknown[]) => mockGetUserRole(...args),
  getStaffUserByEmail: (...args: unknown[]) => mockGetStaffUserByEmail(...args),
  upsertUserWithTier: (...args: unknown[]) => mockUpsertUserWithTier(...args),
  createSupabaseToken: (...args: unknown[]) => mockCreateSupabaseToken(...args),
  regenerateSession: (...args: unknown[]) => mockRegenerateSession(...args),
}));

function createApp(sessionUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const session: Record<string, unknown> = {
      user: sessionUser,
      cookie: { maxAge: 2592000000 },
      save: vi.fn((cb: (err: Error | null) => void) => cb(null)),
      regenerate: vi.fn((cb: (err: Error | null) => void) => cb(null)),
      destroy: vi.fn((cb: (err: Error | null) => void) => cb(null)),
    };
    (req as Record<string, unknown>).session = session;
    next();
  });
  return app;
}

describe('Session Route — POST /api/auth/logout', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = createApp({ id: 'user-1', email: 'test@example.com', role: 'member' });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);
  });

  it('destroys session and clears cookie on logout', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Logged out successfully');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('handles logout when no session exists', async () => {
    const noSessionApp = express();
    noSessionApp.use(express.json());
    noSessionApp.use((req, _res, next) => {
      (req as Record<string, unknown>).session = null;
      next();
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    noSessionApp.use(sessionRouter);

    const res = await request(noSessionApp).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Already logged out');
  });
});

describe('Session Route — GET /api/auth/session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when no session user', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('No active session');
  });

  it('sets no-cache headers on session endpoint', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).get('/api/auth/session');
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
    expect(res.headers['expires']).toBe('0');
  });

  it('returns 401 for expired session and destroys it', async () => {
    const app = createApp({
      id: 'user-1', email: 'test@example.com', role: 'member',
      expires_at: Date.now() - 1000,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });

  it('returns authenticated response with fresh role and status', async () => {
    const app = createApp({
      id: 'user-1', email: 'active@example.com', role: 'member',
      firstName: 'Test', lastName: 'User', phone: '555', tier: 'Gold',
      tags: ['vip'], mindbodyClientId: 'mb-1', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('member');
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ lifetime_visits: 42, membership_status: 'active' }],
    });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(true);
    expect(res.body.member.email).toBe('active@example.com');
    expect(res.body.member.lifetimeVisits).toBe(42);
    expect(res.body.member.status).toBe('Active');
    expect(res.body.member.role).toBe('member');
  });

  it('detects role change and updates session', async () => {
    const app = createApp({
      id: 'user-1', email: 'promoted@example.com', role: 'member',
      firstName: 'P', lastName: 'U', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('admin');
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ lifetime_visits: 0, membership_status: 'active' }],
    });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('admin');
  });

  it('destroys session when user no longer exists in DB', async () => {
    const app = createApp({
      id: 'user-deleted', email: 'deleted@example.com', role: 'member',
      firstName: 'D', lastName: 'U', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('member');
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('no longer exists');
  });

  it('sets visitor tier to null', async () => {
    const app = createApp({
      id: 'user-v', email: 'visitor@example.com', role: 'visitor',
      firstName: 'V', lastName: 'U', tier: 'Gold', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('visitor');
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ lifetime_visits: 0, membership_status: 'active' }],
    });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.member.tier).toBeNull();
  });
});

describe('Session Route — POST /api/auth/password-login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when email or password missing', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res1 = await request(app).post('/api/auth/password-login').send({});
    expect(res1.status).toBe(400);
    expect(res1.body.error).toContain('Email and password are required');

    const res2 = await request(app).post('/api/auth/password-login').send({ email: 'test@example.com' });
    expect(res2.status).toBe(400);
  });

  it('returns 401 for password exceeding 72 chars (bcrypt limit)', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/password-login').send({
      email: 'test@example.com',
      password: 'a'.repeat(73),
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid email or password');
  });

  it('blocks members from password login with specific message', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockSelectChain([]);
    const memberSelectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: 'user-m' }]),
    };
    const callCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      callCount.n++;
      if (callCount.n === 1) return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      return memberSelectChain;
    });

    const res = await request(app).post('/api/auth/password-login').send({
      email: 'member@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('email link or OTP');
  });

  it('returns 401 for non-existent user (timing-safe)', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const callCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      callCount.n++;
      if (callCount.n === 1) return { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });

    const res = await request(app).post('/api/auth/password-login').send({
      email: 'nobody@example.com',
      password: 'password123',
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid email or password');
  });

  it('returns 400 when staff user has no password set', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 1, email: 'staff@everclub.co', name: 'Staff', passwordHash: null, role: 'staff' },
      ]),
    });

    const res = await request(app).post('/api/auth/password-login').send({
      email: 'staff@everclub.co',
      password: 'password123',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Password not set');
  });
});

describe('Session Route — POST /api/auth/set-password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/set-password').send({ password: 'newpass123' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('logged in');
  });

  it('returns 403 for non-staff roles', async () => {
    const app = createApp({ id: 'user-1', email: 'member@test.com', role: 'member' });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/set-password').send({ password: 'newpass123' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Only staff and admin');
  });

  it('returns 400 for password shorter than 8 characters', async () => {
    const app = createApp({ id: 'staff-1', email: 'admin@everclub.co', role: 'admin' });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/set-password').send({ password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('at least 8 characters');
  });

  it('returns 400 for password longer than 72 characters', async () => {
    const app = createApp({ id: 'staff-1', email: 'admin@everclub.co', role: 'admin' });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/set-password').send({ password: 'a'.repeat(73) });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('72 characters or fewer');
  });

  it('requires current password when changing existing password', async () => {
    const app = createApp({ id: 'staff-1', email: 'admin@everclub.co', role: 'admin' });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockSelectChain([{ id: 1, passwordHash: '$2b$10$somehash', email: 'admin@everclub.co' }]);

    const res = await request(app).post('/api/auth/set-password').send({ password: 'newpassword123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Current password is required');
  });
});

describe('Session Route — POST /api/auth/dev-login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('blocks dev login when DEV_LOGIN_ENABLED is not true', async () => {
    delete process.env.DEV_LOGIN_ENABLED;
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/dev-login').send({ email: 'test@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not enabled');
  });
});

describe('Session Route — GET /api/auth/check-staff-admin', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when email query param is missing', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).get('/api/auth/check-staff-admin');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Email is required');
  });

  it('returns isStaffOrAdmin: true for staff user', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([{ id: 1, role: 'staff', hasPassword: true }]),
    });

    const res = await request(app).get('/api/auth/check-staff-admin?email=staff@everclub.co');
    expect(res.status).toBe(200);
    expect(res.body.isStaffOrAdmin).toBe(true);
    expect(res.body.hasPassword).toBe(true);
  });

  it('returns isStaffOrAdmin: false for non-staff user', async () => {
    const app = createApp();
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    });

    const res = await request(app).get('/api/auth/check-staff-admin?email=member@test.com');
    expect(res.status).toBe(200);
    expect(res.body.isStaffOrAdmin).toBe(false);
  });
});

describe('Session — getSessionUser helper', () => {
  it('returns session user when present', async () => {
    const { getSessionUser } = await import('../server/types/session');
    const user = { id: 'user-1', email: 'test@example.com', role: 'member' };
    const req = { session: { user } } as unknown as import('express').Request;
    const result = getSessionUser(req);
    expect(result).toEqual(user);
  });

  it('returns undefined when no session', async () => {
    const { getSessionUser } = await import('../server/types/session');
    expect(getSessionUser({} as unknown as import('express').Request)).toBeUndefined();
  });

  it('returns undefined when no user in session', async () => {
    const { getSessionUser } = await import('../server/types/session');
    expect(getSessionUser({ session: {} } as unknown as import('express').Request)).toBeUndefined();
  });
});

describe('Session — regenerateSession creates session with user data', () => {
  it('calls session.regenerate and sets user data on new session', async () => {
    const helpers = await vi.importActual<typeof import('../server/routes/auth/helpers')>('../server/routes/auth/helpers');
    const userData = { id: 'u-1', email: 'new@example.com', role: 'member' };
    const newSession: Record<string, unknown> = {
      cookie: { maxAge: 86400000 },
      save: vi.fn(),
    };
    const mockReq = {
      session: {
        cookie: { maxAge: 86400000 },
        regenerate: vi.fn((cb: (err: Error | null) => void) => {
          (mockReq as Record<string, unknown>).session = newSession;
          cb(null);
        }),
      },
    } as unknown as import('express').Request;

    await helpers.regenerateSession(mockReq, userData);
    expect(newSession.user).toEqual(userData);
    expect(newSession.cookie).toEqual({ maxAge: 86400000 });
  });

  it('rejects when session.regenerate fails', async () => {
    const helpers = await vi.importActual<typeof import('../server/routes/auth/helpers')>('../server/routes/auth/helpers');
    const mockReq = {
      session: {
        cookie: { maxAge: 86400000 },
        regenerate: vi.fn((cb: (err: Error | null) => void) => {
          cb(new Error('session store failure'));
        }),
      },
    } as unknown as import('express').Request;

    await expect(helpers.regenerateSession(mockReq, { id: '1' })).rejects.toThrow('session store failure');
  });
});

describe('Session — refresh and forced revocation via GET /api/auth/session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refreshes role from DB and saves session when role changed', async () => {
    const app = createApp({
      id: 'user-1', email: 'user@example.com', role: 'member',
      firstName: 'A', lastName: 'B', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('admin');
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ lifetime_visits: 5, membership_status: 'active' }],
    });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.member.role).toBe('admin');
    expect(mockGetUserRole).toHaveBeenCalledWith('user@example.com');
  });

  it('refreshes status from DB and saves session when status changed', async () => {
    const app = createApp({
      id: 'user-1', email: 'user@example.com', role: 'member',
      firstName: 'A', lastName: 'B', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('member');
    mockDbExecute.mockResolvedValueOnce({
      rows: [{ lifetime_visits: 10, membership_status: 'suspended' }],
    });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(200);
    expect(res.body.member.status).toBe('Suspended');
  });

  it('forces session revocation (destroy) when user deleted from DB', async () => {
    const app = createApp({
      id: 'user-gone', email: 'deleted@example.com', role: 'member',
      firstName: 'D', lastName: 'U', status: 'Active',
      expires_at: Date.now() + 999999999,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    mockGetUserRole.mockResolvedValueOnce('member');
    mockDbExecute.mockResolvedValueOnce({ rows: [] });

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('no longer exists');
  });

  it('forces session revocation on expiry and clears cookie', async () => {
    const app = createApp({
      id: 'user-exp', email: 'expired@example.com', role: 'member',
      firstName: 'E', lastName: 'U', status: 'Active',
      expires_at: Date.now() - 60000,
    });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).get('/api/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('logout destroys session and clears cookie (forced revocation)', async () => {
    const app = createApp({ id: 'user-1', email: 'test@example.com', role: 'member' });
    const { sessionRouter } = await import('../server/routes/auth/session');
    app.use(sessionRouter);

    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.headers['set-cookie']).toBeDefined();
  });
});
