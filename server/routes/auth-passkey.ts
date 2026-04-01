import { Router } from 'express';
import crypto from 'crypto';
import { eq, sql } from 'drizzle-orm';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';
import { db } from '../db';
import { users, passkeys } from '../../shared/schema';
import { normalizeEmail } from '../core/utils/emailNormalization';
import { normalizeTierName } from '../../shared/constants/tiers';
import { getSessionUser } from '../types/session';
import { logger, logAndRespond } from '../core/logger';
import { regenerateSession } from './auth/helpers';
import { isProduction } from '../core/db';
import { isAuthenticated } from '../replit_integrations/auth';
import { authRateLimiterByIp } from '../middleware/rateLimiting';
import { logMemberAction } from '../core/auditLog';
import { getErrorMessage } from '../utils/errorUtils';
import { createSupabaseToken } from './auth';
import { z } from 'zod';
import { validateBody } from '../middleware/validate';

const passkeyRegisterVerifySchema = z.object({
  deviceName: z.string().max(100).optional(),
}).passthrough();

const passkeyAuthenticateVerifySchema = z.object({
  id: z.string().min(1),
}).passthrough();

const router = Router();

function getRpId(): string {
  if (isProduction) {
    return 'everclub.app';
  }
  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  if (devDomain) {
    return devDomain;
  }
  return 'localhost';
}

function getRpName(): string {
  return 'Ever Club';
}

function getOrigin(): string {
  const rpId = getRpId();
  if (rpId === 'localhost') {
    return 'http://localhost:5000';
  }
  return `https://${rpId}`;
}

router.post('/api/auth/passkey/register/options', isAuthenticated, async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.id || !sessionUser?.email) {
      return logAndRespond(req, res, 401, 'You must be logged in to register a passkey');
    }

    if (String(sessionUser.id).startsWith('staff-')) {
      return logAndRespond(req, res, 403, 'Passkey registration is only available for members');
    }

    const normalizedEmail = normalizeEmail(sessionUser.email);

    const existingPasskeys = await db.select({
      credentialId: passkeys.credentialId,
      transports: passkeys.transports,
    })
      .from(passkeys)
      .where(eq(passkeys.userId, sessionUser.id));

    const userIdHash = crypto.createHash('sha256').update(String(sessionUser.id)).digest();

    const options = await generateRegistrationOptions({
      rpName: getRpName(),
      rpID: getRpId(),
      userID: userIdHash,
      userName: normalizedEmail,
      userDisplayName: [sessionUser.firstName, sessionUser.lastName].filter(Boolean).join(' ') || normalizedEmail,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
        authenticatorAttachment: 'platform',
      },
      excludeCredentials: existingPasskeys.map((pk) => ({
        id: pk.credentialId,
        transports: (pk.transports || []) as AuthenticatorTransportFuture[],
      })),
    });

    req.session.webauthnChallenge = options.challenge;
    req.session.save((err) => {
      if (err) {
        return logAndRespond(req, res, 500, 'Failed to save challenge', err);
      }
      res.json(options);
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to generate registration options', error);
  }
});

router.post('/api/auth/passkey/register/verify', isAuthenticated, validateBody(passkeyRegisterVerifySchema), async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.id || !sessionUser?.email) {
      return logAndRespond(req, res, 401, 'You must be logged in to register a passkey');
    }

    if (String(sessionUser.id).startsWith('staff-')) {
      return logAndRespond(req, res, 403, 'Passkey registration is only available for members');
    }

    const challenge = req.session.webauthnChallenge;
    if (!challenge) {
      return logAndRespond(req, res, 400, 'No registration challenge found. Please try again.');
    }

    const body = req.body as RegistrationResponseJSON;
    const rawDeviceName = typeof req.body.deviceName === 'string' ? req.body.deviceName.trim().slice(0, 100) : '';

    delete req.session.webauthnChallenge;

    const verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
    });

    if (!verification.verified || !verification.registrationInfo) {
      req.session.save((err) => {
        if (err) logger.warn('[Passkey] Session save error after failed registration verify', { extra: { error: getErrorMessage(err) } });
      });
      return logAndRespond(req, res, 400, 'Passkey registration failed verification');
    }

    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

    await db.insert(passkeys).values({
      userId: sessionUser.id,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: credential.transports || [],
      deviceName: rawDeviceName || `${credentialDeviceType}${credentialBackedUp ? ' (synced)' : ''}`,
    });

    req.session.save((err) => {
      if (err) {
        logger.warn('[Passkey] Non-critical session save error after registration', { extra: { error: getErrorMessage(err) } });
      }
    });

    logMemberAction({
      memberEmail: sessionUser.email,
      memberName: `${sessionUser.firstName || ''} ${sessionUser.lastName || ''}`.trim(),
      action: 'update_member',
      resourceType: 'user',
      resourceId: sessionUser.id,
      details: { action: 'passkey_register', credentialId: credential.id.substring(0, 16) + '...' },
      req,
    }).catch(err => logger.error('[Passkey] Failed to log passkey_register action', { extra: { error: getErrorMessage(err) } }));

    logger.info('[Passkey] Registered new passkey', { extra: { userId: sessionUser.id, email: sessionUser.email } });

    res.json({ success: true, credentialId: credential.id });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to verify passkey registration', error);
  }
});

// PUBLIC ROUTE - get passkey authentication challenge (login flow, no auth required)
router.post('/api/auth/passkey/authenticate/options', authRateLimiterByIp, async (req, res) => {
  try {
    const options = await generateAuthenticationOptions({
      rpID: getRpId(),
      userVerification: 'preferred',
    });

    req.session.webauthnChallenge = options.challenge;
    req.session.save((err) => {
      if (err) {
        return logAndRespond(req, res, 500, 'Failed to save challenge', err);
      }
      res.json(options);
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to generate authentication options', error);
  }
});

// PUBLIC ROUTE - verify passkey authentication response and create session (login flow)
router.post('/api/auth/passkey/authenticate/verify', authRateLimiterByIp, validateBody(passkeyAuthenticateVerifySchema), async (req, res) => {
  try {
    const challenge = req.session.webauthnChallenge;
    if (!challenge) {
      return logAndRespond(req, res, 400, 'No authentication challenge found. Please try again.');
    }

    const body = req.body as AuthenticationResponseJSON;

    delete req.session.webauthnChallenge;

    const passkeyRecord = await db.select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, body.id))
      .limit(1);

    if (passkeyRecord.length === 0) {
      req.session.save((err) => {
        if (err) logger.warn('[Passkey] Session save error after passkey not found', { extra: { error: getErrorMessage(err) } });
      });
      return logAndRespond(req, res, 404, 'Passkey not found. It may have been removed.');
    }

    const storedPasskey = passkeyRecord[0];

    const verification = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: getOrigin(),
      expectedRPID: getRpId(),
      credential: {
        id: storedPasskey.credentialId,
        publicKey: Buffer.from(storedPasskey.publicKey, 'base64url'),
        counter: storedPasskey.counter,
        transports: (storedPasskey.transports || []) as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      req.session.save((err) => {
        if (err) logger.warn('[Passkey] Session save error after failed authentication verify', { extra: { error: getErrorMessage(err) } });
      });
      return logAndRespond(req, res, 400, 'Passkey authentication failed');
    }

    await db.update(passkeys)
      .set({
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      })
      .where(eq(passkeys.id, storedPasskey.id));

    const dbUser = await db.select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      phone: users.phone,
      tier: users.tier,
      tags: users.tags,
      membershipStatus: users.membershipStatus,
      stripeSubscriptionId: users.stripeSubscriptionId,
      stripeCustomerId: users.stripeCustomerId,
      mindbodyClientId: users.mindbodyClientId,
      joinDate: users.joinDate,
      dateOfBirth: users.dateOfBirth,
      role: users.role,
    })
      .from(users)
      .where(sql`${users.id} = ${storedPasskey.userId} AND ${users.archivedAt} IS NULL`)
      .limit(1);

    if (dbUser.length === 0) {
      return logAndRespond(req, res, 404, 'User account not found');
    }

    const user = dbUser[0];
    const dbMemberStatus = (user.membershipStatus || '').toLowerCase();
    const rawRole = (user.role || 'member').toLowerCase();
    const role: 'admin' | 'staff' | 'member' | 'visitor' = rawRole === 'admin' || rawRole === 'staff' ? rawRole : (rawRole === 'visitor' ? 'visitor' : 'member');
    const activeStatuses = ['active', 'trialing', 'past_due'];

    if (role === 'member' && !activeStatuses.includes(dbMemberStatus)) {
      return logAndRespond(req, res, 403, 'Your membership is not active. Please contact us for assistance.');
    }

    const statusMap: Record<string, string> = {
      'active': 'Active', 'trialing': 'Trialing', 'past_due': 'Past Due',
      'suspended': 'Suspended', 'terminated': 'Terminated', 'expired': 'Expired',
      'cancelled': 'Cancelled', 'frozen': 'Frozen', 'paused': 'Paused', 'pending': 'Pending'
    };

    const sessionTtl = 30 * 24 * 60 * 60 * 1000;
    const member = {
      id: user.id,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || '',
      phone: user.phone || '',
      tier: role === 'visitor' ? undefined : (normalizeTierName(user.tier) || null),
      tags: (user.tags || []) as string[],
      mindbodyClientId: user.mindbodyClientId || '',
      status: statusMap[dbMemberStatus] || (dbMemberStatus ? dbMemberStatus.charAt(0).toUpperCase() + dbMemberStatus.slice(1) : 'Active'),
      role,
      expires_at: Date.now() + sessionTtl,
      dateOfBirth: user.dateOfBirth ?? null,
    };

    try {
      await db.execute(sql`UPDATE users SET first_login_at = NOW(), updated_at = NOW() WHERE id = ${user.id} AND first_login_at IS NULL`);
    } catch (err) {
      logger.warn('[Passkey] Non-critical first_login_at update failed:', { extra: { error: getErrorMessage(err) } });
    }

    await regenerateSession(req, member as Record<string, unknown>);

    const supabaseToken = await createSupabaseToken(member as unknown as { id: string; email: string; role: string; firstName?: string; lastName?: string });

    req.session.save((err) => {
      if (err) {
        return logAndRespond(req, res, 500, 'Failed to create session', err);
      }
      logger.info('[Passkey] Authenticated successfully', { extra: { userId: user.id, email: user.email } });
      res.json({ success: true, member, supabaseToken });
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to verify passkey authentication', error);
  }
});

router.get('/api/auth/passkey/list', async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.id) {
      return logAndRespond(req, res, 401, 'You must be logged in');
    }

    const userPasskeys = await db.select({
      id: passkeys.id,
      credentialId: passkeys.credentialId,
      deviceName: passkeys.deviceName,
      createdAt: passkeys.createdAt,
      lastUsedAt: passkeys.lastUsedAt,
    })
      .from(passkeys)
      .where(eq(passkeys.userId, sessionUser.id));

    res.json({ passkeys: userPasskeys });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to list passkeys', error);
  }
});

router.delete('/api/auth/passkey/:passkeyId', isAuthenticated, async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return logAndRespond(req, res, 401, 'Session expired');
    }

    const passkeyId = parseInt(req.params.passkeyId as string, 10);
    if (isNaN(passkeyId)) {
      return logAndRespond(req, res, 400, 'Invalid passkey ID');
    }

    const deleted = await db.delete(passkeys)
      .where(sql`${passkeys.id} = ${passkeyId} AND ${passkeys.userId} = ${sessionUser.id}`)
      .returning({ id: passkeys.id });

    if (deleted.length === 0) {
      return logAndRespond(req, res, 404, 'Passkey not found');
    }

    logMemberAction({
      memberEmail: sessionUser.email,
      memberName: `${sessionUser.firstName || ''} ${sessionUser.lastName || ''}`.trim(),
      action: 'update_member',
      resourceType: 'user',
      resourceId: sessionUser.id,
      details: { action: 'passkey_remove', passkeyId },
      req,
    }).catch(err => logger.error('[Passkey] Failed to log passkey_remove action', { extra: { error: getErrorMessage(err) } }));

    res.json({ success: true });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to remove passkey', error);
  }
});

router.get('/.well-known/webauthn', (_req, res) => {
  res.json({
    origins: [getOrigin()],
  });
});

export default router;
