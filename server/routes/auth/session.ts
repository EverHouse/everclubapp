import { logger, logAndRespond } from '../../core/logger';
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { users, staffUsers } from '../../../shared/schema';
import { isProduction } from '../../core/db';
import { getHubSpotClient } from '../../core/integrations';
import { retryableHubSpotRequest } from '../../core/hubspot/request';
import { normalizeTierName } from '../../../shared/constants/tiers';
import { getSessionUser, SessionUser } from '../../types/session';
import { sendWelcomeEmail } from '../../emails/welcomeEmail';
import { normalizeEmail, getAlternateDomainEmail } from '../../core/utils/emailNormalization';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts';
import { getErrorMessage } from '../../utils/errorUtils';
import { authRateLimiterByIp } from '../../middleware/rateLimiting';
import {
  getStaffUserByEmail,
  getUserRole,
  upsertUserWithTier,
  createSupabaseToken,
  regenerateSession,
} from './helpers';

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'connect.sid';
const DUMMY_BCRYPT_HASH = '$2b$10$jicF9naWqBp2ywuM9.aTpeELpWMxKup2XIVnhexhlJN1Yk6EV.hVW';

export const sessionRouter = Router();

// PUBLIC ROUTE - destroy session (no auth check, harmless if called unauthenticated)
sessionRouter.post('/api/auth/logout', (req, res) => {
  if (!req.session) {
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    return res.json({ success: true, message: 'Already logged out' });
  }
  req.session.destroy((err) => {
    if (err) {
      return logAndRespond(req, res, 500, 'Failed to logout', err);
    }
    res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// PUBLIC ROUTE - get current session info (returns 401 if unauthenticated, no middleware required)
sessionRouter.get('/api/auth/session', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  const sessionUser = getSessionUser(req);
  
  if (!sessionUser?.email) {
    return logAndRespond(req, res, 401, 'No active session');
  }
  
  if (sessionUser.expires_at && Date.now() > sessionUser.expires_at) {
    return req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
      logAndRespond(req, res, 401, 'Session expired');
    });
  }
  
  const freshRole = await getUserRole(sessionUser.email);
  let sessionDirty = false;
  if (freshRole !== sessionUser.role) {
    sessionUser.role = freshRole;
    sessionDirty = true;
  }

  let lifetimeVisits = 0;
  let freshStatus = sessionUser.status || 'Active';
  try {
    const userResult = await db.execute(
      sql`SELECT lifetime_visits, membership_status FROM users WHERE LOWER(email) = LOWER(${sessionUser.email}) LIMIT 1`
    );
    const rows = userResult.rows as Record<string, unknown>[];
    if (rows.length > 0) {
      if (rows[0].lifetime_visits != null) {
        lifetimeVisits = Number(rows[0].lifetime_visits);
      }
      if (rows[0].membership_status != null) {
        const dbStatusStr = String(rows[0].membership_status).toLowerCase();
        const statusMap: { [key: string]: string } = {
          'active': 'Active',
          'trialing': 'Trialing',
          'past_due': 'Past Due',
          'suspended': 'Suspended',
          'terminated': 'Terminated',
          'expired': 'Expired',
          'cancelled': 'Cancelled',
          'frozen': 'Frozen',
          'paused': 'Paused',
          'pending': 'Pending'
        };
        freshStatus = statusMap[dbStatusStr] || (dbStatusStr ? dbStatusStr.charAt(0).toUpperCase() + dbStatusStr.slice(1) : 'Active');
        if (freshStatus !== sessionUser.status) {
          sessionUser.status = freshStatus;
          sessionDirty = true;
        }
      }
    } else {
      return req.session.destroy(() => {
        res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
        logAndRespond(req, res, 401, 'Account no longer exists');
      });
    }
  } catch {
    logger.debug('[Auth] Failed to fetch user data for session enrichment');
  }

  const sessionResponse = {
    authenticated: true,
    member: {
      id: sessionUser.id,
      firstName: sessionUser.firstName || '',
      lastName: sessionUser.lastName || '',
      email: sessionUser.email,
      phone: sessionUser.phone || '',
      tier: sessionUser.role === 'visitor' ? null : (sessionUser.tier || null),
      tags: sessionUser.tags || [],
      mindbodyClientId: sessionUser.mindbodyClientId || '',
      status: freshStatus,
      role: freshRole,
      dateOfBirth: sessionUser.dateOfBirth || null,
      lifetimeVisits
    }
  };

  if (sessionDirty) {
    req.session.save((err) => {
      if (err) logger.warn('[Auth] Failed to persist session update', { extra: { error: getErrorMessage(err) } });
      res.json(sessionResponse);
    });
  } else {
    res.json(sessionResponse);
  }
});

sessionRouter.post('/api/auth/ws-token', authRateLimiterByIp, async (req, res) => {
  const sessionUser = getSessionUser(req);
  if (!sessionUser?.email) {
    return logAndRespond(req, res, 401, 'Not authenticated');
  }
  try {
    const freshRole = await getUserRole(sessionUser.email);
    const { createWsAuthToken } = await import('../../core/websocket');
    const token = createWsAuthToken(sessionUser.email, freshRole || 'member');
    return res.json({ token });
  } catch (err) {
    return logAndRespond(req, res, 500, 'Failed to create token', err);
  }
});

// PUBLIC ROUTE - check if email is staff/admin (public query endpoint, rate-limited)
sessionRouter.get('/api/auth/check-staff-admin', authRateLimiterByIp, async (req, res) => {
  try {
    const { email } = req.query;
    
    if (!email || typeof email !== 'string') {
      return logAndRespond(req, res, 400, 'Email is required');
    }
    
    const normalizedEmail = normalizeEmail(email);
    
    const alternateEmail = getAlternateDomainEmail(normalizedEmail);
    const emailsToCheck = alternateEmail ? [normalizedEmail, alternateEmail] : [normalizedEmail];
    const staffResult = await db.select({
      id: staffUsers.id,
      role: staffUsers.role,
      hasPassword: sql<boolean>`${staffUsers.passwordHash} IS NOT NULL`
    })
      .from(staffUsers)
      .where(and(
        sql`LOWER(${staffUsers.email}) IN (${sql.join(emailsToCheck.map(e => sql`LOWER(${e})`), sql`, `)})`,
        eq(staffUsers.isActive, true)
      ));
    
    if (staffResult.length > 0) {
      return res.json({ 
        isStaffOrAdmin: true, 
        hasPassword: staffResult[0].hasPassword 
      });
    }
    
    res.json({ isStaffOrAdmin: false, hasPassword: false });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to check user status', error);
  }
});

// PUBLIC ROUTE - login with email and password (no auth required)
sessionRouter.post('/api/auth/password-login', authRateLimiterByIp, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password || typeof password !== 'string') {
      return logAndRespond(req, res, 400, 'Email and password are required');
    }

    if (password.length > 72) {
      return logAndRespond(req, res, 401, 'Invalid email or password');
    }
    
    const normalizedEmail = normalizeEmail(email);
    
    let userRecord: { id: number; email: string; name: string | null; passwordHash: string | null; role: string | null } | null = null;
    let userRole: 'admin' | 'staff' | 'member' = 'member';
    
    const altEmailPw = getAlternateDomainEmail(normalizedEmail);
    const emailsToCheckPw = altEmailPw ? [normalizedEmail, altEmailPw] : [normalizedEmail];
    const staffResult = await db.select({
      id: staffUsers.id,
      email: staffUsers.email,
      name: staffUsers.name,
      passwordHash: staffUsers.passwordHash,
      role: staffUsers.role
    })
      .from(staffUsers)
      .where(and(
        sql`LOWER(${staffUsers.email}) IN (${sql.join(emailsToCheckPw.map(e => sql`LOWER(${e})`), sql`, `)})`,
        eq(staffUsers.isActive, true)
      ));
    
    if (staffResult.length > 0) {
      userRecord = staffResult[0];
      userRole = staffResult[0].role === 'admin' ? 'admin' : 'staff';
    }
    
    if (!userRecord) {
      const memberResult = await db.select({ id: users.id })
        .from(users)
        .where(sql`LOWER(${users.email}) IN (${sql.join(emailsToCheckPw.map(e => sql`LOWER(${e})`), sql`, `)})`)
        .limit(1);

      if (memberResult.length > 0) {
        await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
        return logAndRespond(req, res, 400, 'Members sign in via email link or OTP. Password login is for staff only.');
      }

      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return logAndRespond(req, res, 401, 'Invalid email or password');
    }
    
    if (!userRecord.passwordHash) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return logAndRespond(req, res, 400, 'Password not set. Please use set-password first or ask an admin to set one for you.');
    }
    
    const isValid = await bcrypt.compare(password, userRecord.passwordHash);
    
    if (!isValid) {
      return logAndRespond(req, res, 401, 'Invalid email or password');
    }
    
    const hubspot = await getHubSpotClient();
    let memberData = null;
    
    try {
      const searchResponse = await retryableHubSpotRequest(() => hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: FilterOperatorEnum.Eq,
            value: normalizedEmail
          }]
        }],
        properties: ['firstname', 'lastname', 'email', 'phone', 'membership_tier', 'membership_status', 'membership_discount_reason', 'mindbody_client_id', 'membership_start_date', 'date_of_birth'],
        limit: 1
      }));
      
      if (searchResponse.results.length > 0) {
        const contact = searchResponse.results[0];
        memberData = {
          id: contact.id,
          firstName: contact.properties.firstname || userRecord.name?.split(' ')[0] || '',
          lastName: contact.properties.lastname || userRecord.name?.split(' ').slice(1).join(' ') || '',
          email: normalizedEmail,
          phone: contact.properties.phone || '',
          tier: normalizeTierName(contact.properties.membership_tier),
          tags: [],
          mindbodyClientId: contact.properties.mindbody_client_id || '',
          membershipStartDate: contact.properties.membership_start_date || '',
        };
      }
    } catch (hubspotError: unknown) {
      logger.error('HubSpot lookup failed', { extra: { error: getErrorMessage(hubspotError) } });
    }
    
    const sessionTtl = 30 * 24 * 60 * 60 * 1000;
    const member = {
      id: memberData?.id || userRecord.id.toString(),
      firstName: memberData?.firstName || userRecord.name?.split(' ')[0] || '',
      lastName: memberData?.lastName || userRecord.name?.split(' ').slice(1).join(' ') || '',
      email: userRecord.email,
      phone: memberData?.phone || '',
      tier: userRole === 'member' ? (memberData?.tier || null) : undefined,
      tags: memberData?.tags || [],
      mindbodyClientId: memberData?.mindbodyClientId || '',
      membershipStartDate: memberData?.membershipStartDate || '',
      status: 'Active',
      role: userRole,
      expires_at: Date.now() + sessionTtl
    };
    
    const dbUserId2 = await upsertUserWithTier({
      email: member.email,
      tierName: userRole === 'member' ? (member.tier ?? '') : undefined,
      firstName: member.firstName,
      lastName: member.lastName,
      phone: memberData?.phone || undefined,
      mindbodyClientId: memberData?.mindbodyClientId || undefined,
      tags: memberData?.tags && memberData.tags.length > 0 ? memberData.tags : undefined,
      membershipStartDate: memberData?.membershipStartDate || undefined,
      role: userRole
    });
    
    if (dbUserId2 && dbUserId2 !== member.id) {
      member.id = dbUserId2;
    }

    const supabaseToken = await createSupabaseToken(member);

    try {
      await db.execute(sql`UPDATE users SET first_login_at = NOW(), updated_at = NOW() WHERE LOWER(email) = LOWER(${member.email}) AND first_login_at IS NULL`);
    } catch (err) {
      logger.warn('[Auth] Non-critical first_login_at update failed:', { extra: { error: getErrorMessage(err) } });
    }

    await regenerateSession(req, member);

    req.session.save((err) => {
      if (err) {
        return logAndRespond(req, res, 500, 'Failed to create session', err);
      }
      res.json({ success: true, member, supabaseToken });
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Login failed. Please try again.', error);
  }
});

sessionRouter.post('/api/auth/set-password', authRateLimiterByIp, async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return logAndRespond(req, res, 401, 'You must be logged in to set a password');
    }

    if (sessionUser.role !== 'admin' && sessionUser.role !== 'staff') {
      return logAndRespond(req, res, 403, 'Only staff and admin accounts can set passwords');
    }
    
    const { password, currentPassword } = req.body;
    
    if (!password || typeof password !== 'string') {
      return logAndRespond(req, res, 400, 'Password is required');
    }
    
    if (password.length < 8) {
      return logAndRespond(req, res, 400, 'Password must be at least 8 characters');
    }

    if (password.length > 72) {
      return logAndRespond(req, res, 400, 'Password must be 72 characters or fewer');
    }

    if (currentPassword && typeof currentPassword !== 'string') {
      return logAndRespond(req, res, 400, 'Invalid password format');
    }
    
    const normalizedEmail = sessionUser.email.toLowerCase();
    
    const staffRecord = await db.select({ id: staffUsers.id, passwordHash: staffUsers.passwordHash, email: staffUsers.email })
      .from(staffUsers)
      .where(and(
        sql`LOWER(${staffUsers.email}) = LOWER(${normalizedEmail})`,
        eq(staffUsers.isActive, true)
      ))
      .limit(1);
    
    if (staffRecord.length > 0) {
      if (staffRecord[0].passwordHash) {
        if (!currentPassword) {
          return logAndRespond(req, res, 400, 'Current password is required');
        }
        const isValid = await bcrypt.compare(currentPassword, staffRecord[0].passwordHash);
        if (!isValid) {
          return logAndRespond(req, res, 400, 'Current password is incorrect');
        }
      }
      
      const passwordHash = await bcrypt.hash(password, 10);
      await db.update(staffUsers)
        .set({ passwordHash })
        .where(eq(staffUsers.id, staffRecord[0].id));
      
      return res.json({ success: true, message: 'Password set successfully' });
    }
    
    logAndRespond(req, res, 403, 'Password can only be set for staff or admin accounts');
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to set password', error);
  }
});

// DEV ROUTE - bypass login for development (blocked in production)
sessionRouter.post('/api/auth/dev-login', async (req, res) => {
  if (process.env.DEV_LOGIN_ENABLED !== 'true') {
    return logAndRespond(req, res, 403, 'Dev login not enabled');
  }

  if (isProduction) {
    return logAndRespond(req, res, 403, 'Dev login not available in production');
  }
  
  try {
    const devEmail = req.body.email || 'nick@everclub.co';
    
    const existingUser = await db.select()
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${devEmail})`);
    
    if (existingUser.length === 0) {
      return logAndRespond(req, res, 404, 'Dev user not found');
    }
    
    const user = existingUser[0];
    
    const sessionTtl = 30 * 24 * 60 * 60 * 1000;
    const member = {
      id: user.id,
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      email: user.email || devEmail,
      phone: user.phone || '',
      tier: user.tier || undefined,
      role: user.role || 'member',
      expires_at: Date.now() + sessionTtl
    };
    
    const supabaseToken = await createSupabaseToken({ ...member, email: member.email as string });

    try {
      await db.execute(sql`UPDATE users SET first_login_at = NOW(), updated_at = NOW() WHERE LOWER(email) = LOWER(${member.email}) AND first_login_at IS NULL`);
    } catch (err) {
      logger.warn('[Auth] Non-critical first_login_at update failed:', { extra: { error: getErrorMessage(err) } });
    }

    await regenerateSession(req, member as Record<string, unknown>);

    req.session.save((err) => {
      if (err) {
        return logAndRespond(req, res, 500, 'Failed to create session', err);
      }
      res.json({ success: true, member, supabaseToken });
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Dev login failed', error);
  }
});

// DEV ROUTE - send welcome email for testing (blocked in production, admin role required)
sessionRouter.post('/api/auth/test-welcome-email', async (req, res) => {
  if (isProduction) {
    return logAndRespond(req, res, 404, 'Not found');
  }
  const sessionUser = getSessionUser(req);
  if (!sessionUser || sessionUser.role !== 'admin') {
    return logAndRespond(req, res, 403, 'Admin access required');
  }
  
  try {
    const { email, firstName } = req.body;
    const targetEmail = email || sessionUser.email;
    const targetFirstName = firstName || sessionUser.firstName;
    
    const result = await sendWelcomeEmail(targetEmail, targetFirstName);
    
    if (result.success) {
      res.json({ success: true, message: `Welcome email sent to ${targetEmail}` });
    } else {
      logAndRespond(req, res, 500, result.error || 'Failed to send welcome email');
    }
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to send test email', error);
  }
});
