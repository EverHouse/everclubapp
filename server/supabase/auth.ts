import type { Express, RequestHandler } from 'express';
import { createClient, type SupabaseClient, type User, type Provider } from '@supabase/supabase-js';
import { jwtVerify, errors as joseErrors } from 'jose';
import { authStorage } from '../replit_integrations/auth/storage';
import { logger } from '../core/logger';
import { getSupabaseAnon } from '../core/supabase/client';
import { getErrorMessage } from '../utils/errorUtils';
import { authRateLimiterByIp } from '../middleware/rateLimiting';

const SUPABASE_ROUTE_TIMEOUT = 10000;
const VALID_OAUTH_PROVIDERS = new Set(['google', 'apple', 'facebook', 'github', 'azure', 'twitter']);
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 256;
const MAX_TOKEN_LENGTH = 8192;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout>;

  promise.catch((err) => {
    if (timedOut) {
      logger.debug(`[Supabase] ${label} settled after timeout race`, { extra: { error: getErrorMessage(err) } });
    }
  });

  return Promise.race([
    promise.then(
      (val) => { clearTimeout(timer); return val; },
      (err) => { clearTimeout(timer); throw err; },
    ),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`${label} timed out after ${SUPABASE_ROUTE_TIMEOUT / 1000}s`));
      }, SUPABASE_ROUTE_TIMEOUT);
    })
  ]);
}

function validateEmail(email: unknown): email is string {
  return typeof email === 'string' && email.length > 0 && email.length <= MAX_EMAIL_LENGTH;
}

function validatePassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 6 && password.length <= MAX_PASSWORD_LENGTH;
}

let _cachedAnonClient: SupabaseClient | null = null;

function createPerRequestClient(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return null;

  if (!_cachedAnonClient) {
    _cachedAnonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
  }
  return _cachedAnonClient;
}

function getSupabaseClient(): SupabaseClient | null {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    return getSupabaseAnon();
  } catch {
    logger.debug('[Supabase] Failed to initialize Supabase client');
    return null;
  }
}

export { getSupabaseClient };

function getAppUrl(): string {
  const raw = process.env.FRONTEND_URL || 'https://everclub.app';
  const normalized = raw.replace(/\/+$/, '');
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && process.env.NODE_ENV === 'production') {
      logger.warn('[Supabase Auth] FRONTEND_URL is not HTTPS in production, falling back to https://everclub.app');
      return 'https://everclub.app';
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    logger.warn('[Supabase Auth] FRONTEND_URL is malformed, falling back to https://everclub.app', { extra: { value: raw } });
    return 'https://everclub.app';
  }
}

export function setupSupabaseAuthRoutes(app: Express) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    logger.info('Supabase auth routes disabled - credentials not configured');
    
    const supabaseNotConfigured: RequestHandler = (_req, res) => {
      res.status(503).json({ error: 'Supabase authentication is not configured' });
    };
    
    app.post('/api/supabase/signup', supabaseNotConfigured);
    app.post('/api/supabase/login', supabaseNotConfigured);
    app.post('/api/supabase/logout', supabaseNotConfigured);
    app.post('/api/supabase/forgot-password', supabaseNotConfigured);
    app.get('/api/supabase/user', supabaseNotConfigured);
    app.post('/api/supabase/oauth', supabaseNotConfigured);
    return;
  }

  logger.info('Supabase auth routes enabled');

  app.post('/api/supabase/signup', authRateLimiterByIp, async (req, res) => {
    const client = createPerRequestClient();
    if (!client) return res.status(503).json({ error: 'Supabase authentication is not configured' });

    try {
      const { email, password, firstName, lastName } = req.body;

      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Password must be between 6 and 256 characters' });
      }
      if (typeof firstName !== 'string' || firstName.length > 100 ||
          typeof lastName !== 'string' || lastName.length > 100) {
        return res.status(400).json({ error: 'Invalid name parameters' });
      }
      
      const { data, error } = await withTimeout(
        client.auth.signUp({
          email,
          password,
          options: {
            data: {
              first_name: firstName.trim().slice(0, 100),
              last_name: lastName.trim().slice(0, 100),
            }
          }
        }),
        'Supabase signUp'
      );
      
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      
      if (data.user) {
        try {
          await authStorage.upsertUser({
            id: data.user.id,
            email: data.user.email || email,
            firstName: firstName.trim().slice(0, 100),
            lastName: lastName.trim().slice(0, 100),
          });
        } catch (dbError: unknown) {
          logger.error('[Supabase Auth] Local DB sync failed after signup, Supabase user may be orphaned', {
            extra: { userId: data.user.id, email, error: getErrorMessage(dbError) }
          });
          return res.status(201).json({
            message: 'Account created, but we experienced a delay initializing your profile. Please try logging in.',
            user: data.user
          });
        }
      }
      
      res.json({ 
        message: 'Check your email for the confirmation link',
        user: data.user 
      });
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.includes('timed out')) {
        logger.warn('[Supabase Auth] Signup timed out');
        return res.status(504).json({ error: 'Authentication service timeout' });
      }
      logger.error('Supabase signup error:', { extra: { error: msg } });
      res.status(500).json({ error: 'Signup failed' });
    }
  });

  app.post('/api/supabase/login', async (req, res) => {
    const client = createPerRequestClient();
    if (!client) return res.status(503).json({ error: 'Supabase authentication is not configured' });

    try {
      const { email, password } = req.body;
      
      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      if (!validatePassword(password)) {
        return res.status(400).json({ error: 'Invalid password' });
      }

      const { data, error } = await withTimeout(
        client.auth.signInWithPassword({
          email,
          password,
        }),
        'Supabase signInWithPassword'
      );
      
      if (error) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      
      if (data.user) {
        try {
          await authStorage.upsertUser({
            id: data.user.id,
            email: data.user.email || email,
            firstName: String(data.user.user_metadata?.first_name || '').slice(0, 100),
            lastName: String(data.user.user_metadata?.last_name || '').slice(0, 100),
          });
        } catch (dbError: unknown) {
          logger.error('[Supabase Auth] Local DB sync failed during login', {
            extra: { userId: data.user.id, error: getErrorMessage(dbError) }
          });
        }
      }

      res.json({ 
        user: data.user,
        session: data.session
      });
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.includes('timed out')) {
        logger.warn('[Supabase Auth] Login timed out');
        return res.status(504).json({ error: 'Authentication service timeout' });
      }
      logger.error('Supabase login error:', { extra: { error: msg } });
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.post('/api/supabase/logout', async (_req, res) => {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
      return res.status(503).json({ error: 'Supabase authentication is not configured' });
    }

    try {
      const freshClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
      const { error } = await withTimeout(
        freshClient.auth.signOut(),
        'Supabase signOut'
      );
      
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      
      res.json({ message: 'Logged out successfully' });
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.includes('timed out')) {
        logger.warn('[Supabase Auth] Logout timed out');
        return res.status(504).json({ error: 'Authentication service timeout' });
      }
      logger.error('Supabase logout error:', { extra: { error: msg } });
      res.status(500).json({ error: 'Logout failed' });
    }
  });

  app.post('/api/supabase/forgot-password', async (req, res) => {
    const client = createPerRequestClient();
    if (!client) return res.status(503).json({ error: 'Supabase authentication is not configured' });

    try {
      const { email } = req.body;

      if (!validateEmail(email)) {
        return res.status(400).json({ error: 'Invalid email address' });
      }
      
      const { error } = await withTimeout(
        client.auth.resetPasswordForEmail(email, {
          redirectTo: `${getAppUrl()}/reset-password`,
        }),
        'Supabase resetPasswordForEmail'
      );
      
      if (error) {
        logger.warn('[Supabase Auth] Password reset error', { extra: { error: error.message } });
      }
      
      res.json({ message: 'If an account exists with that email, you will receive a password reset link' });
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.includes('timed out')) {
        logger.warn('[Supabase Auth] Forgot password timed out');
        return res.status(504).json({ error: 'Authentication service timeout' });
      }
      logger.error('Forgot password error:', { extra: { error: msg } });
      res.status(500).json({ error: 'Failed to send reset email' });
    }
  });

  app.get('/api/supabase/user', async (req, res) => {
    const client = createPerRequestClient();
    if (!client) return res.status(503).json({ error: 'Supabase authentication is not configured' });

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }
      
      const token = authHeader.substring(7);
      if (token.length > MAX_TOKEN_LENGTH) {
        return res.status(401).json({ error: 'Invalid token' });
      }
      const { data: { user }, error } = await withTimeout(
        client.auth.getUser(token),
        'Supabase getUser'
      );
      
      if (error || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      let dbUser = await authStorage.getUser(user.id);

      if (!dbUser) {
        try {
          await authStorage.upsertUser({
            id: user.id,
            email: user.email || '',
            firstName: String(user.user_metadata?.first_name || '').slice(0, 100),
            lastName: String(user.user_metadata?.last_name || '').slice(0, 100),
          });
          dbUser = await authStorage.getUser(user.id);
        } catch (syncError: unknown) {
          logger.error('[Supabase Auth] OAuth user local DB sync failed', {
            extra: { userId: user.id, error: getErrorMessage(syncError) }
          });
        }
      }

      res.json({
        id: user.id,
        email: user.email,
        firstName: dbUser?.firstName || user.user_metadata?.first_name || '',
        lastName: dbUser?.lastName || user.user_metadata?.last_name || '',
        role: dbUser?.role || 'member',
      });
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.includes('timed out')) {
        logger.warn('[Supabase Auth] Get user timed out');
        return res.status(504).json({ error: 'Authentication service timeout' });
      }
      logger.error('Get user error:', { extra: { error: msg } });
      res.status(500).json({ error: 'Failed to get user' });
    }
  });

  app.post('/api/supabase/oauth', authRateLimiterByIp, async (req, res) => {
    const client = createPerRequestClient();
    if (!client) return res.status(503).json({ error: 'Supabase authentication is not configured' });

    try {
      const { provider } = req.body;

      if (typeof provider !== 'string' || !VALID_OAUTH_PROVIDERS.has(provider)) {
        return res.status(400).json({ error: 'Invalid OAuth provider' });
      }
      
      const { data, error } = await withTimeout(
        client.auth.signInWithOAuth({
          provider: provider as Provider,
          options: {
            redirectTo: `${getAppUrl()}/auth/callback`,
          }
        }),
        'Supabase signInWithOAuth'
      );
      
      if (error) {
        return res.status(400).json({ error: error.message });
      }
      
      res.json({ url: data.url });
    } catch (error: unknown) {
      const msg = getErrorMessage(error);
      if (msg.includes('timed out')) {
        logger.warn('[Supabase Auth] OAuth timed out');
        return res.status(504).json({ error: 'Authentication service timeout' });
      }
      logger.error('OAuth error:', { extra: { error: msg } });
      res.status(500).json({ error: 'OAuth failed' });
    }
  });
}

let jwtSecretKey: Uint8Array | null = null;

function getJwtSecret(): Uint8Array | null {
  if (jwtSecretKey) return jwtSecretKey;
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;
  jwtSecretKey = new TextEncoder().encode(secret);
  return jwtSecretKey;
}

export const isSupabaseAuthenticated: RequestHandler = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    if (token.length > MAX_TOKEN_LENGTH) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    const secret = getJwtSecret();

    if (secret) {
      try {
        const { payload } = await jwtVerify(token, secret, {
          issuer: process.env.SUPABASE_URL ? `${process.env.SUPABASE_URL}/auth/v1` : undefined,
          audience: 'authenticated',
        });

        if (!payload.sub) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        req.supabaseUser = {
          id: payload.sub,
          email: payload.email as string | undefined,
          app_metadata: payload.app_metadata as Record<string, unknown> || {},
          user_metadata: payload.user_metadata as Record<string, unknown> || {},
          aud: payload.aud as string || 'authenticated',
          created_at: '',
        } as User;

        return next();
      } catch (err) {
        if (err instanceof joseErrors.JWTExpired) {
          return res.status(401).json({ error: 'Token expired' });
        }
        if (
          err instanceof joseErrors.JWSSignatureVerificationFailed ||
          err instanceof joseErrors.JWTInvalid ||
          err instanceof joseErrors.JWTClaimValidationFailed ||
          err instanceof joseErrors.JWSInvalid
        ) {
          logger.warn('[Supabase Auth] JWT verification rejected locally', {
            extra: { reason: err instanceof Error ? err.message : 'unknown' }
          });
          return res.status(401).json({ error: 'Invalid token' });
        }
        logger.debug('[Supabase Auth] Local JWT verification failed, falling back to remote', {
          extra: { error: err instanceof Error ? err.message : 'unknown' }
        });
      }
    }

    const client = getSupabaseClient();
    if (!client) {
      return res.status(503).json({ error: 'Supabase authentication is not configured' });
    }

    const { data: { user }, error } = await withTimeout(
      client.auth.getUser(token),
      'Supabase getUser (middleware)'
    );
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    req.supabaseUser = user;
    next();
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    if (msg.includes('timed out')) {
      logger.warn('[Supabase Auth] Middleware auth check timed out');
      return res.status(504).json({ error: 'Authentication service timeout' });
    }
    res.status(401).json({ error: 'Authentication failed' });
  }
};
