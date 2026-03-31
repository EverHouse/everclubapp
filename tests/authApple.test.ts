// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbExecute = vi.fn();

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
    insert: vi.fn(),
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
}));
vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
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

const mockJwtVerify = vi.fn();
const mockCreateRemoteJWKSet = vi.fn().mockReturnValue('mock-jwks');
vi.mock('jose', () => ({
  jwtVerify: (...args: unknown[]) => mockJwtVerify(...args),
  createRemoteJWKSet: (...args: unknown[]) => mockCreateRemoteJWKSet(...args),
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

describe('Apple Sign-In Route — POST /api/auth/apple/verify', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.APPLE_SERVICE_ID = 'com.test.app';
    app = createApp();
    const appleRouter = (await import('../server/routes/auth-apple')).default;
    app.use(appleRouter);
  });

  it('returns 400 when identity token is missing', async () => {
    const res = await request(app).post('/api/auth/apple/verify').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Apple identity token is required');
  });

  it('returns 404 when no user found for Apple sub/email', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-123', email: 'nobody@test.com', email_verified: true },
    });
    mockSelectChain([]);

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No membership found');
  });

  it('returns 403 for inactive member', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-123', email: 'inactive@test.com', email_verified: true },
    });
    const userRow = {
      id: 'user-1', firstName: 'In', lastName: 'Active', email: 'inactive@test.com',
      phone: '', tier: 'Gold', tags: [], membershipStatus: 'cancelled',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', appleId: null,
    };
    mockSelectChain([userRow]);

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not active');
  });

  it('successfully authenticates active member via Apple', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-123', email: 'active@test.com', email_verified: true },
    });
    const userRow = {
      id: 'user-1', firstName: 'Active', lastName: 'Member', email: 'active@test.com',
      phone: '555', tier: 'Gold', tags: [], membershipStatus: 'active',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', appleId: null,
    };
    mockSelectChain([userRow]);
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.member.email).toBe('active@test.com');
    expect(res.body.member.status).toBe('Active');
    expect(res.body.member.role).toBe('member');
    expect(res.body.member.expires_at).toBeGreaterThan(Date.now());

    expect(mockJwtVerify).toHaveBeenCalledWith(
      'fake-jwt',
      expect.anything(),
      expect.objectContaining({ issuer: 'https://appleid.apple.com' })
    );

    const { regenerateSession } = await import('../server/routes/auth/helpers');
    expect(regenerateSession).toHaveBeenCalledWith(
      expect.objectContaining({}),
      expect.objectContaining({ email: 'active@test.com' })
    );
  });

  it('auto-links Apple account when user has no apple_id', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-new', email: 'member@test.com', email_verified: true },
    });
    const userRow = {
      id: 'user-1', firstName: 'M', lastName: 'U', email: 'member@test.com',
      phone: '', tier: 'Gold', tags: [], membershipStatus: 'active',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', appleId: null,
    };
    mockSelectChain([userRow]);
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it('backfills name from Apple user data when DB name is empty', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-123', email: 'noname@test.com', email_verified: true },
    });
    const userRow = {
      id: 'user-1', firstName: null, lastName: null, email: 'noname@test.com',
      phone: '', tier: 'Gold', tags: [], membershipStatus: 'active',
      stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
      mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member', appleId: null,
    };
    mockSelectChain([userRow]);
    mockUpdateChain([{ id: 'user-1' }]);

    const res = await request(app)
      .post('/api/auth/apple/verify')
      .send({ identityToken: 'fake-jwt', user: { name: { firstName: 'Apple', lastName: 'User' } } });
    expect(res.status).toBe(200);
    expect(res.body.member.firstName).toBe('Apple');
    expect(res.body.member.lastName).toBe('User');
  });

  it('returns 401 for expired Apple token', async () => {
    mockJwtVerify.mockRejectedValueOnce(new Error('JWT expired'));

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'expired-jwt' });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });
});

describe('Apple Sign-In Route — POST /api/auth/apple/link', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.APPLE_SERVICE_ID = 'com.test.app';
    app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.user = { id: 'user-1', email: 'me@test.com', firstName: 'Me' };
      next();
    });
    const appleRouter = (await import('../server/routes/auth-apple')).default;
    app.use(appleRouter);
  });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = createApp();
    const appleRouter = (await import('../server/routes/auth-apple')).default;
    unauthApp.use(appleRouter);
    const res = await request(unauthApp).post('/api/auth/apple/link').send({ identityToken: 'fake' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when identity token missing', async () => {
    const res = await request(app).post('/api/auth/apple/link').send({});
    expect(res.status).toBe(400);
  });

  it('returns 409 when Apple sub linked to another user', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-taken', email: 'taken@test.com' },
    });
    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'user-1' }]) };
      }
      return { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: 'user-other', email: 'other@test.com' }]) };
    });

    const res = await request(app).post('/api/auth/apple/link').send({ identityToken: 'fake' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already linked');
  });

  it('successfully links Apple account', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-new', email: 'new@test.com' },
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

    const res = await request(app).post('/api/auth/apple/link').send({ identityToken: 'fake' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.appleEmail).toBe('new@test.com');
  });

  it('handles PostgreSQL 23505 unique violation', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-dup', email: 'dup@test.com' },
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

    const res = await request(app).post('/api/auth/apple/link').send({ identityToken: 'fake' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already linked');
  });
});

describe('Apple Sign-In Route — POST /api/auth/apple/unlink', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.APPLE_SERVICE_ID = 'com.test.app';
    app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.user = { id: 'user-1', email: 'me@test.com', firstName: 'Me' };
      next();
    });
    const appleRouter = (await import('../server/routes/auth-apple')).default;
    app.use(appleRouter);
  });

  it('successfully unlinks Apple account', async () => {
    mockSelectChain([{ id: 'user-1' }]);
    mockUpdateChain([{ id: 'user-1' }]);
    const res = await request(app).post('/api/auth/apple/unlink').send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 when update affects 0 rows', async () => {
    mockSelectChain([{ id: 'user-1' }]);
    mockUpdateChain([]);
    const res = await request(app).post('/api/auth/apple/unlink').send({});
    expect(res.status).toBe(404);
  });
});

describe('Apple Sign-In — Account Creation Policy (membership-only, no self-registration)', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    app = createApp();
    const router = (await import('../server/routes/auth-apple')).default;
    app.use(router);
  });

  it('verifies token then rejects unknown user — no account creation (membership-only policy)', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-new-999', email: 'newuser@icloud.com', email_verified: true },
    });
    mockSelectChain([]);

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No membership found');

    expect(mockJwtVerify).toHaveBeenCalledWith(
      'fake-jwt',
      expect.anything(),
      expect.objectContaining({ issuer: 'https://appleid.apple.com' })
    );

    const { regenerateSession } = await import('../server/routes/auth/helpers');
    expect(regenerateSession).not.toHaveBeenCalled();
  });

  it('resolves user via Stripe email fallback when DB lookup fails', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-stripe', email: 'stripe@example.com', email_verified: true },
    });

    let selectCallCount = 0;
    mockDbSelect.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount <= 3) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            selectCallCount === 3 ? {
              id: 'user-stripe', firstName: 'S', lastName: 'U', email: 'stripe@example.com',
              phone: '', tier: 'Gold', tags: [], membershipStatus: 'active', role: 'member',
              appleId: null,
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

    const res = await request(app).post('/api/auth/apple/verify').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('Apple Sign-In — Cross-Provider Linking Edge Cases', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
    setDefaultMocks();
    process.env.APPLE_TEAM_ID = 'test-team';
    process.env.APPLE_SERVICE_ID = 'test-service';
    app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.user = { id: 'user-1', email: 'user@example.com', firstName: 'Test', lastName: 'User' };
      next();
    });
    const router = (await import('../server/routes/auth-apple')).default;
    app.use(router);
  });

  it('allows Apple link when user already has Google linked', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-cross', email: 'user@icloud.com', email_verified: true },
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

    const res = await request(app).post('/api/auth/apple/link').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('rejects Apple link when Apple sub is already linked to another user', async () => {
    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'apple-taken', email: 'other@icloud.com', email_verified: true },
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

    const res = await request(app).post('/api/auth/apple/link').send({ identityToken: 'fake-jwt' });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already linked');
  });
});

describe('Apple Sign-In — Schema Validation', () => {
  it('users table defines apple_id, apple_email, and apple_linked_at columns', async () => {
    const { users } = await import('../shared/models/auth-session');
    expect(users.appleId).toBeDefined();
    expect(users.appleEmail).toBeDefined();
    expect(users.appleLinkedAt).toBeDefined();
  });
});
