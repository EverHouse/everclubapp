// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbExecute = vi.fn();
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

function mockUpdateChain(result: unknown[] = [{ id: 'user-1' }]) {
  const chain = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
  };
  mockDbUpdate.mockReturnValue(chain);
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
    update: (...args: unknown[]) => mockDbUpdate(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    delete: vi.fn(),
  },
}));
vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  logAndRespond: vi.fn((_req: unknown, res: Pick<import('express').Response, 'status' | 'json'>, code: number, msg: string) => res.status(code).json({ error: msg })),
}));
vi.mock('../server/core/auditLog', () => ({
  logMemberAction: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../server/middleware/rateLimiting', () => ({
  authRateLimiterByIp: (_req: unknown, _res: unknown, next: () => void) => next(),
  authRateLimiter: [],
}));
vi.mock('../server/replit_integrations/auth', () => ({
  isStaffOrAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../server/core/supabase/client', () => ({
  isSupabaseAvailable: vi.fn().mockResolvedValue(false),
  getSupabaseAdmin: vi.fn(),
}));

const mockVerifyIdToken = vi.fn();
vi.mock('google-auth-library', () => {
  return {
    OAuth2Client: class MockOAuth2Client {
      verifyIdToken = mockVerifyIdToken;
    },
  };
});

vi.mock('../server/routes/auth/helpers', () => ({
  regenerateSession: vi.fn().mockResolvedValue(undefined),
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
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).session = {
      user: undefined,
      save: (cb: (err: Error | null) => void) => cb(null),
      regenerate: (cb: (err: Error | null) => void) => cb(null),
      destroy: (cb: (err: Error | null) => void) => cb(null),
    };
    next();
  });
  return app;
}

describe('Google OAuth Route — POST /api/auth/google/verify', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    app = createApp();
    const googleRouter = (await import('../server/routes/auth-google')).default;
    app.use(googleRouter);
  });

  it('returns 400 when credential is missing', async () => {
    const res = await request(app).post('/api/auth/google/verify').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Google credential is required');
  });

  it('returns 404 when no user found for Google email', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-123', email: 'nobody@test.com', given_name: 'No', family_name: 'Body' }),
    });
    mockSelectChain([]);

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No membership found');
  });

  it('returns 403 for inactive member with Google login', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-123', email: 'inactive@test.com', given_name: 'In', family_name: 'Active' }),
    });
    const userRow = {
      id: 'user-1', firstName: 'In', lastName: 'Active', email: 'inactive@test.com',
      phone: '', tier: 'Gold', tags: [], membershipStatus: 'cancelled',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', googleId: null,
    };
    mockSelectChain([userRow]);

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not active');
  });

  it('successfully authenticates active member and creates session', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-123', email: 'active@test.com', given_name: 'Active', family_name: 'Member' }),
    });
    const userRow = {
      id: 'user-1', firstName: 'Active', lastName: 'Member', email: 'active@test.com',
      phone: '555', tier: 'Gold', tags: [], membershipStatus: 'active',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', googleId: null,
    };
    mockSelectChain([userRow]);
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.member.email).toBe('active@test.com');
    expect(res.body.member.status).toBe('Active');
    expect(res.body.member.role).toBe('member');
    expect(res.body.member.expires_at).toBeGreaterThan(Date.now());

    expect(mockVerifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: 'fake-jwt' })
    );

    const { regenerateSession } = await import('../server/routes/auth/helpers');
    expect(regenerateSession).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({ email: 'active@test.com' })
    );
  });

  it('auto-links Google account on first login', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-new', email: 'member@test.com', given_name: 'M', family_name: 'U' }),
    });
    const userRow = {
      id: 'user-1', firstName: 'M', lastName: 'U', email: 'member@test.com',
      phone: '', tier: 'Gold', tags: [], membershipStatus: 'active',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', googleId: null,
    };
    mockSelectChain([userRow]);
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it('returns 401 for expired/invalid Google token', async () => {
    mockVerifyIdToken.mockRejectedValueOnce(new Error('Token used too late'));

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'expired-jwt' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });
});

describe('Google OAuth Route — POST /api/auth/google/link', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.user = { id: 'user-1', email: 'me@test.com', firstName: 'Me' };
      next();
    });
    const googleRouter = (await import('../server/routes/auth-google')).default;
    app.use(googleRouter);
  });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = createApp();
    const googleRouter = (await import('../server/routes/auth-google')).default;
    unauthApp.use(googleRouter);

    const res = await request(unauthApp).post('/api/auth/google/link').send({ credential: 'fake' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when credential missing', async () => {
    const res = await request(app).post('/api/auth/google/link').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Google credential is required');
  });

  it('returns 409 when Google sub linked to another user', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-taken', email: 'taken@test.com' }),
    });
    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'user-1' }]) };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'user-other', email: 'other@test.com' }]) };
    });

    const res = await request(app).post('/api/auth/google/link').send({ credential: 'fake' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already linked');
  });

  it('successfully links Google account', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-new', email: 'new@test.com' }),
    });
    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'user-1' }]) };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/google/link').send({ credential: 'fake' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.googleEmail).toBe('new@test.com');
  });

  it('handles PostgreSQL 23505 unique violation', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-dup', email: 'dup@test.com' }),
    });
    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'user-1' }]) };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([]) };
    });
    const error = Object.assign(new Error('unique violation'), { code: '23505' });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockRejectedValue(error),
    });

    const res = await request(app).post('/api/auth/google/link').send({ credential: 'fake' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already linked');
  });
});

describe('Google OAuth Route — POST /api/auth/google/unlink', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.user = { id: 'user-1', email: 'me@test.com', firstName: 'Me' };
      next();
    });
    const googleRouter = (await import('../server/routes/auth-google')).default;
    app.use(googleRouter);
  });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = createApp();
    const googleRouter = (await import('../server/routes/auth-google')).default;
    unauthApp.use(googleRouter);

    const res = await request(unauthApp).post('/api/auth/google/unlink').send({});
    expect(res.status).toBe(401);
  });

  it('successfully unlinks Google account', async () => {
    mockSelectChain([{ id: 'user-1' }]);
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/google/unlink').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when update affects 0 rows', async () => {
    mockSelectChain([{ id: 'user-1' }]);
    mockUpdateChain([]);

    const res = await request(app).post('/api/auth/google/unlink').send({});
    expect(res.status).toBe(404);
  });
});

describe('Google OAuth — Account Creation Policy (membership-only, no self-registration)', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    app = createApp();
    const router = (await import('../server/routes/auth-google')).default;
    app.use(router);
  });

  it('rejects unknown user with 404 — no account creation (membership-only policy)', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'new-g-999', email: 'newuser@gmail.com', given_name: 'New', family_name: 'User' }),
    });
    mockSelectChain([]);

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No membership found');

    expect(mockVerifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ idToken: 'fake-jwt' })
    );

    const { regenerateSession } = await import('../server/routes/auth/helpers');
    expect(regenerateSession).not.toHaveBeenCalled();
  });

  it('resolves user via Stripe email fallback when DB lookup fails', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-fallback', email: 'stripe@example.com', given_name: 'S', family_name: 'U' }),
    });

    let selectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount <= 4) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            selectCallCount === 4 ? {
              id: 'user-stripe', firstName: 'S', lastName: 'U', email: 'stripe@example.com',
              phone: '', tier: 'Gold', tags: [], membershipStatus: 'active', role: 'member',
              googleId: null,
            } : undefined,
          ].filter(Boolean)),
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    });

    const { resolveUserByEmail } = await import('../server/core/stripe/customers');
    (resolveUserByEmail as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      primaryEmail: 'stripe@example.com',
    });

    const res = await request(app).post('/api/auth/google/verify').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Google OAuth — Cross-Provider Linking Edge Cases', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.user = { id: 'user-1', email: 'user@example.com', firstName: 'Test', lastName: 'User' };
      next();
    });
    const router = (await import('../server/routes/auth-google')).default;
    app.use(router);
  });

  it('allows Google link when user already has Apple linked', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-cross', email: 'user@gmail.com', given_name: 'T', family_name: 'U' }),
    });
    let selectCall = 0;
    mockDbSelect.mockImplementation(() => {
      selectCall++;
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(selectCall === 1 ? [{ id: 'user-1' }] : []),
      };
    });
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/google/link').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.googleEmail).toBe('user@gmail.com');
  });

  it('rejects Google link when Google sub is already linked to another user', async () => {
    mockVerifyIdToken.mockResolvedValueOnce({
      getPayload: () => ({ sub: 'g-taken', email: 'other@gmail.com', given_name: 'O', family_name: 'U' }),
    });
    let selectCall = 0;
    mockDbSelect.mockImplementation(() => {
      selectCall++;
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue(
          selectCall === 1 ? [{ id: 'user-1' }] : [{ id: 'user-other', email: 'other@example.com' }]
        ),
      };
    });

    const res = await request(app).post('/api/auth/google/link').send({ credential: 'fake-jwt' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already linked');
  });
});
