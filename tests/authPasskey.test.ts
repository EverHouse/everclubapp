// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbExecute = vi.fn();
const mockDbDelete = vi.fn();

function mockSelectChain(result: unknown[]) {
  const chain = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  };
  mockDbSelect.mockReturnValue(chain);
  return chain;
}

vi.mock('../server/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    insert: (...args: unknown[]) => mockDbInsert(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
    delete: (...args: unknown[]) => mockDbDelete(...args),
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
vi.mock('../server/replit_integrations/auth', () => ({
  isAuthenticated: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('../server/core/db', () => ({ isProduction: false }));
vi.mock('../server/core/supabase/client', () => ({
  isSupabaseAvailable: vi.fn().mockResolvedValue(false),
  getSupabaseAdmin: vi.fn(),
}));
vi.mock('../server/core/utils/emailNormalization', () => ({
  normalizeEmail: (e: string) => e.toLowerCase().trim(),
}));
vi.mock('../shared/constants/tiers', () => ({
  normalizeTierName: (t: string | null | undefined) => t || null,
}));
vi.mock('../server/routes/auth/helpers', () => ({
  regenerateSession: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../server/routes/auth', () => ({
  createSupabaseToken: vi.fn().mockResolvedValue(null),
}));

const mockGenerateRegistrationOptions = vi.fn();
const mockVerifyRegistrationResponse = vi.fn();
const mockGenerateAuthenticationOptions = vi.fn();
const mockVerifyAuthenticationResponse = vi.fn();

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: (...args: unknown[]) => mockGenerateRegistrationOptions(...args),
  verifyRegistrationResponse: (...args: unknown[]) => mockVerifyRegistrationResponse(...args),
  generateAuthenticationOptions: (...args: unknown[]) => mockGenerateAuthenticationOptions(...args),
  verifyAuthenticationResponse: (...args: unknown[]) => mockVerifyAuthenticationResponse(...args),
}));

function createApp(sessionUser?: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Record<string, unknown>).session = {
      user: sessionUser,
      webauthnChallenge: undefined as string | undefined,
      save: vi.fn((cb: (err: Error | null) => void) => cb(null)),
      regenerate: vi.fn((cb: (err: Error | null) => void) => cb(null)),
      destroy: vi.fn((cb: (err: Error | null) => void) => cb(null)),
    };
    next();
  });
  return app;
}

describe('Passkey Route — POST /api/auth/passkey/register/options', () => {
  let app: express.Express;

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it('returns 401 when no session user', async () => {
    app = createApp();
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const res = await request(app).post('/api/auth/passkey/register/options').send({});
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('logged in');
  });

  it('returns 403 for staff users', async () => {
    app = createApp({ id: 'staff-42', email: 'admin@everclub.co', firstName: 'Admin' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const res = await request(app).post('/api/auth/passkey/register/options').send({});
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('only available for members');
  });

  it('generates registration options for valid member and stores challenge', async () => {
    app = createApp({ id: 'user-1', email: 'member@test.com', firstName: 'Member' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    });

    mockGenerateRegistrationOptions.mockResolvedValueOnce({
      challenge: 'test-challenge-base64url',
      rp: { name: 'Ever Club', id: 'localhost' },
      user: { id: 'hash', name: 'member@test.com' },
    });

    const res = await request(app).post('/api/auth/passkey/register/options').send({});
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe('test-challenge-base64url');
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        rpName: 'Ever Club',
        userName: 'member@test.com',
      })
    );
  });

  it('excludes existing passkeys from registration options', async () => {
    app = createApp({ id: 'user-1', email: 'member@test.com', firstName: 'Member' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { credentialId: 'cred-1', transports: ['internal'] },
        { credentialId: 'cred-2', transports: ['usb', 'ble'] },
      ]),
    });

    mockGenerateRegistrationOptions.mockResolvedValueOnce({
      challenge: 'test-challenge',
    });

    await request(app).post('/api/auth/passkey/register/options').send({});
    expect(mockGenerateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: [
          { id: 'cred-1', transports: ['internal'] },
          { id: 'cred-2', transports: ['usb', 'ble'] },
        ],
      })
    );
  });
});

describe('Passkey Route — POST /api/auth/passkey/register/verify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when no challenge in session (replay protection)', async () => {
    const app = createApp({ id: 'user-1', email: 'member@test.com', firstName: 'M' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const res = await request(app).post('/api/auth/passkey/register/verify').send({ id: 'cred-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No registration challenge found');
  });

  it('returns 400 when verification fails', async () => {
    const sessionUser = { id: 'user-1', email: 'member@test.com', firstName: 'M' };
    const app = createApp(sessionUser);
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'stored-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockVerifyRegistrationResponse.mockResolvedValueOnce({ verified: false });

    const res = await request(app).post('/api/auth/passkey/register/verify').send({ id: 'cred-1', response: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('failed verification');
  });

  it('stores passkey in DB and returns success on valid verification', async () => {
    const sessionUser = { id: 'user-1', email: 'member@test.com', firstName: 'M' };
    const app = createApp(sessionUser);
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'stored-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockVerifyRegistrationResponse.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: 'cred-new', publicKey: new Uint8Array([1, 2, 3]), counter: 0, transports: ['internal'] },
        credentialDeviceType: 'singleDevice',
        credentialBackedUp: false,
      },
    });
    mockDbInsert.mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    });

    const res = await request(app).post('/api/auth/passkey/register/verify').send({ id: 'cred-new', response: {} });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.credentialId).toBe('cred-new');
    expect(mockDbInsert).toHaveBeenCalled();
  });
});

describe('Passkey Route — POST /api/auth/passkey/authenticate/options', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generates authentication options and stores challenge in session', async () => {
    const app = createApp();
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockGenerateAuthenticationOptions.mockResolvedValueOnce({
      challenge: 'auth-challenge-base64url',
      rpId: 'localhost',
    });

    const res = await request(app).post('/api/auth/passkey/authenticate/options').send({});
    expect(res.status).toBe(200);
    expect(res.body.challenge).toBe('auth-challenge-base64url');
    expect(mockGenerateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ userVerification: 'preferred' })
    );
  });
});

describe('Passkey Route — POST /api/auth/passkey/authenticate/verify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when no challenge in session', async () => {
    const app = createApp();
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const res = await request(app).post('/api/auth/passkey/authenticate/verify').send({ id: 'cred-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('No authentication challenge found');
  });

  it('returns 404 when passkey credential not found in DB', async () => {
    const app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'auth-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    });

    const res = await request(app).post('/api/auth/passkey/authenticate/verify').send({ id: 'unknown-cred' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Passkey not found');
  });

  it('returns 400 when authentication verification fails', async () => {
    const app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'auth-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { id: 1, credentialId: 'cred-1', userId: 'user-1', publicKey: 'AQID', counter: 5, transports: ['internal'] },
      ]),
    });

    mockVerifyAuthenticationResponse.mockResolvedValueOnce({ verified: false });

    const res = await request(app).post('/api/auth/passkey/authenticate/verify').send({ id: 'cred-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('authentication failed');
  });

  it('authenticates successfully, updates counter, creates session', async () => {
    const app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'auth-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            { id: 1, credentialId: 'cred-1', userId: 'user-1', publicKey: 'AQID', counter: 5, transports: ['internal'] },
          ]),
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{
          id: 'user-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@test.com',
          phone: '555', tier: 'Gold', tags: [], membershipStatus: 'active',
          stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
          mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member',
        }]),
      };
    });

    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });

    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    });

    mockDbExecute.mockResolvedValue({ rows: [] });

    const res = await request(app).post('/api/auth/passkey/authenticate/verify').send({ id: 'cred-1' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.member.email).toBe('jane@test.com');
    expect(res.body.member.status).toBe('Active');

    expect(mockDbUpdate).toHaveBeenCalled();

    const { regenerateSession } = await import('../server/routes/auth/helpers');
    expect(regenerateSession).toHaveBeenCalled();
  });

  it('returns 403 for inactive member on passkey auth', async () => {
    const app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'auth-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            { id: 1, credentialId: 'cred-1', userId: 'user-1', publicKey: 'AQID', counter: 5, transports: ['internal'] },
          ]),
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([{
          id: 'user-1', firstName: 'Sus', lastName: 'Pend', email: 'sus@test.com',
          phone: '', tier: 'Gold', tags: [], membershipStatus: 'suspended',
          stripeSubscriptionId: 'sub-1', stripeCustomerId: 'cus-1',
          mindbodyClientId: '', joinDate: null, dateOfBirth: null, role: 'member',
        }]),
      };
    });

    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    });

    const res = await request(app).post('/api/auth/passkey/authenticate/verify').send({ id: 'cred-1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('not active');
  });

  it('returns 404 when user account not found after passkey match', async () => {
    const app = createApp();
    app.use((req, _res, next) => {
      (req as Record<string, unknown> & { session: Record<string, unknown> }).session.webauthnChallenge = 'auth-challenge';
      next();
    });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const selectCallCount = { n: 0 };
    mockDbSelect.mockImplementation(() => {
      selectCallCount.n++;
      if (selectCallCount.n === 1) {
        return {
          from: vi.fn().mockReturnThis(),
          where: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue([
            { id: 1, credentialId: 'cred-1', userId: 'user-deleted', publicKey: 'AQID', counter: 5, transports: [] },
          ]),
        };
      }
      return {
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      };
    });

    mockVerifyAuthenticationResponse.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 6 },
    });
    mockDbUpdate.mockReturnValue({
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(undefined),
    });

    const res = await request(app).post('/api/auth/passkey/authenticate/verify').send({ id: 'cred-1' });
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('User account not found');
  });
});

describe('Passkey Route — GET /api/auth/passkey/list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not logged in', async () => {
    const app = createApp();
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const res = await request(app).get('/api/auth/passkey/list');
    expect(res.status).toBe(401);
  });

  it('returns list of passkeys for authenticated user', async () => {
    const app = createApp({ id: 'user-1', email: 'member@test.com' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbSelect.mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([
        { id: 1, credentialId: 'cred-1', deviceName: 'iPhone', createdAt: new Date(), lastUsedAt: new Date() },
      ]),
    });

    const res = await request(app).get('/api/auth/passkey/list');
    expect(res.status).toBe(200);
    expect(res.body.passkeys).toHaveLength(1);
    expect(res.body.passkeys[0].deviceName).toBe('iPhone');
  });
});

describe('Passkey Route — DELETE /api/auth/passkey/:passkeyId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 for non-numeric passkey ID', async () => {
    const app = createApp({ id: 'user-1', email: 'member@test.com' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    const res = await request(app).delete('/api/auth/passkey/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Invalid passkey ID');
  });

  it('returns 404 when passkey not found or not owned by user', async () => {
    const app = createApp({ id: 'user-1', email: 'member@test.com' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    });

    const res = await request(app).delete('/api/auth/passkey/99');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Passkey not found');
  });

  it('successfully deletes owned passkey', async () => {
    const app = createApp({ id: 'user-1', email: 'member@test.com', firstName: 'M', lastName: 'U' });
    const passkeyRouter = (await import('../server/routes/auth-passkey')).default;
    app.use(passkeyRouter);

    mockDbDelete.mockReturnValue({
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([{ id: 42 }]),
    });

    const res = await request(app).delete('/api/auth/passkey/42');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { logMemberAction } = await import('../server/core/auditLog');
    expect(logMemberAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update_member', details: expect.objectContaining({ action: 'passkey_remove' }) })
    );
  });
});
