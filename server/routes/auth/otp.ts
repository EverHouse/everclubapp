import { logger } from '../../core/logger';
import { Router } from 'express';
import { eq, and, sql } from 'drizzle-orm';
import { db } from '../../db';
import { users, magicLinks, staffUsers } from '../../../shared/schema';
import { isProduction } from '../../core/db';
import { getHubSpotClient } from '../../core/integrations';
import { retryableHubSpotRequest } from '../../core/hubspot/request';
import { normalizeTierName } from '../../../shared/constants/tiers';
import type { MembershipStatus } from '../../../shared/constants/statuses';
import { safeSendEmail, checkEmailSuppression } from '../../utils/resend';
import { getSessionUser, SessionUser } from '../../types/session';
import { sendWelcomeEmail } from '../../emails/welcomeEmail';
import { normalizeEmail, getAlternateDomainEmail } from '../../core/utils/emailNormalization';
import { FilterOperatorEnum } from '@hubspot/api-client/lib/codegen/crm/contacts';
import { getErrorMessage } from '../../utils/errorUtils';
import { getOtpEmailHtml, getOtpEmailText } from '../../emails/otpEmail';
import { authRateLimiter } from '../../middleware/rateLimiting';
import {
  getStaffUserByEmail,
  getUserRole,
  isStaffOrAdminEmail,
  upsertUserWithTier,
  createSupabaseToken,
  regenerateSession,
} from './helpers';
import {
  checkOtpRequestLimit,
  checkOtpVerifyAttempts,
  recordOtpVerifyFailure,
  clearOtpVerifyAttempts,
} from './rateLimiting';

export const otpRouter = Router();

// PUBLIC ROUTE - verify if email is a member (used before login to route user)
otpRouter.post('/api/auth/verify-member', ...authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const normalizedEmail = normalizeEmail(email);
    
    const staffUserData = await getStaffUserByEmail(normalizedEmail);
    const isStaffOrAdmin = staffUserData !== null;
    
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
      hubspotId: users.hubspotId,
      role: users.role,
    })
      .from(users)
      .where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
      .limit(1);
    
    const hasDbUser = dbUser.length > 0;
    const isVisitorUser = hasDbUser && dbUser[0].role === 'visitor';
    const isStripeBilled = hasDbUser && (dbUser[0].stripeSubscriptionId || dbUser[0].stripeCustomerId);
    
    if (hasDbUser && isStripeBilled && !isStaffOrAdmin) {
      let dbMemberStatus = (dbUser[0].membershipStatus || '').toLowerCase();
      const activeStatuses = ['active', 'trialing', 'past_due'];
      let statusFixValue: MembershipStatus | null = null;
      
      if (!activeStatuses.includes(dbMemberStatus) && dbUser[0].stripeSubscriptionId) {
        try {
          const { getStripeClient } = await import('../../core/stripe/client');
          const stripe = await getStripeClient();
          const subscription = await stripe.subscriptions.retrieve(dbUser[0].stripeSubscriptionId);
          
          const stripeActiveStatuses = ['active', 'trialing', 'past_due'];
          if (stripeActiveStatuses.includes(subscription.status)) {
            statusFixValue = subscription.status as MembershipStatus;
            dbMemberStatus = subscription.status;
          } else {
            return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
          }
        } catch (stripeError: unknown) {
          logger.error('[Auth] Failed to verify Stripe subscription', { extra: { error: getErrorMessage(stripeError), email: normalizedEmail } });
          return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
        }
      } else if (!activeStatuses.includes(dbMemberStatus)) {
        return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
      }
      
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
      let memberFirstName = dbUser[0].firstName || '';
      let memberLastName = dbUser[0].lastName || '';
      let nameBackfill: { firstName: string; lastName: string } | null = null;

      if (!memberFirstName) {
        try {
          const hubspotClient = await getHubSpotClient();
          const hsSearch = await hubspotClient.crm.contacts.searchApi.doSearch({
            filterGroups: [{ filters: [{ propertyName: 'email', operator: FilterOperatorEnum.Eq, value: normalizedEmail }] }],
            properties: ['firstname', 'lastname'],
            limit: 1
          });
          const hsContact = hsSearch.results[0];
          if (hsContact?.properties?.firstname) {
            memberFirstName = hsContact.properties.firstname;
            memberLastName = memberLastName || hsContact.properties.lastname || '';
            nameBackfill = { firstName: memberFirstName, lastName: memberLastName };
          }
        } catch (hsErr: unknown) {
          logger.warn('[Auth] HubSpot name backfill failed during verify-member', { extra: { error: getErrorMessage(hsErr) } });
        }
      }

      if (statusFixValue || nameBackfill) {
        await db.transaction(async (tx) => {
          if (statusFixValue) {
            await tx.update(users).set({ membershipStatus: statusFixValue, updatedAt: new Date() }).where(eq(users.id, dbUser[0].id));
            logger.info('[Auth] Auto-fixed membership_status for : ->', { extra: { normalizedEmail, dbMemberStatus: (dbUser[0].membershipStatus || '').toLowerCase(), subscriptionStatus: statusFixValue } });
          }
          if (nameBackfill) {
            await tx.update(users).set({
              firstName: nameBackfill.firstName,
              lastName: nameBackfill.lastName || undefined,
              updatedAt: new Date()
            }).where(eq(users.id, dbUser[0].id));
          }
        });

        if (statusFixValue) {
          try {
            const { syncMemberToHubSpot } = await import('../../core/hubspot/stages');
            await syncMemberToHubSpot({ email: normalizedEmail, status: statusFixValue, billingProvider: 'stripe' });
            logger.info('[Auth] Synced auto-fixed status to HubSpot for', { extra: { normalizedEmail } });
          } catch (hubspotError: unknown) {
            logger.error('[Auth] HubSpot sync failed for auto-fix', { extra: { error: getErrorMessage(hubspotError) } });
          }
        }
      }

      const member = {
        id: dbUser[0].id,
        firstName: memberFirstName,
        lastName: memberLastName,
        email: dbUser[0].email || normalizedEmail,
        phone: dbUser[0].phone || '',
        jobTitle: '',
        tier: isVisitorUser ? null : (normalizeTierName(dbUser[0].tier) || null),
        tags: dbUser[0].tags || [],
        mindbodyClientId: dbUser[0].mindbodyClientId || '',
        status: statusMap[dbMemberStatus] || (dbMemberStatus ? dbMemberStatus.charAt(0).toUpperCase() + dbMemberStatus.slice(1) : 'Active'),
        role: (isVisitorUser ? 'visitor' : 'member') as 'member' | 'visitor'
      };
      
      return res.json({ success: true, member });
    }
    
    const hubspot = await getHubSpotClient();
    
    const searchResponse = await retryableHubSpotRequest(() => hubspot.crm.contacts.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: 'email',
          operator: FilterOperatorEnum.Eq,
          value: normalizedEmail
        }]
      }],
      properties: [
        'firstname',
        'lastname',
        'email',
        'phone',
        'membership_tier',
        'membership_status',
        'membership_discount_reason',
        'mindbody_client_id'
      ],
      limit: 1
    }));
    
    const contact = searchResponse.results[0];
    
    if (!contact && !isStaffOrAdmin) {
      if (!isStripeBilled) {
        return res.status(404).json({ error: 'No member found with this email address' });
      }
    }
    
    if (!isStaffOrAdmin && !isStripeBilled && contact) {
      const status = (contact.properties.membership_status || '').toLowerCase();
      const activeStatuses = ['active', 'trialing', 'past_due'];
      if (!activeStatuses.includes(status) && status !== '') {
        return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
      }
    }
    
    const role = isStaffOrAdmin ? staffUserData!.role : (isVisitorUser ? 'visitor' : 'member');

    let firstName = dbUser[0]?.firstName || contact?.properties?.firstname || '';
    let lastName = dbUser[0]?.lastName || contact?.properties?.lastname || '';
    let phone = dbUser[0]?.phone || contact?.properties?.phone || '';
    let jobTitle = '';

    if (hasDbUser && !dbUser[0]?.firstName && firstName) {
      try {
        await db.update(users).set({
          firstName: firstName,
          lastName: lastName || undefined,
          updatedAt: new Date()
        }).where(eq(users.id, dbUser[0].id));
      } catch (backfillErr: unknown) {
        logger.warn('[Auth] Name backfill from HubSpot failed during verify-member', { extra: { error: getErrorMessage(backfillErr) } });
      }
    }

    if (isStaffOrAdmin && staffUserData) {
      firstName = staffUserData.firstName || firstName;
      lastName = staffUserData.lastName || lastName;
      phone = staffUserData.phone || phone;
      jobTitle = staffUserData.jobTitle || '';
    }

    const memberId = dbUser[0]?.id 
      || contact?.id 
      || (isStaffOrAdmin && staffUserData ? `staff-${staffUserData.id}` : crypto.randomUUID());
    
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
    const memberStatusStr = isStaffOrAdmin ? 'active' : ((dbUser[0]?.membershipStatus || contact?.properties?.membership_status || '').toLowerCase());
    
    const member = {
      id: memberId,
      firstName,
      lastName,
      email: dbUser[0]?.email || contact?.properties?.email || normalizedEmail,
      phone,
      jobTitle,
      tier: isVisitorUser ? null : (isStaffOrAdmin ? 'VIP' : (normalizeTierName(dbUser[0]?.tier || contact?.properties?.membership_tier) || null)),
      tags: dbUser[0]?.tags || [],
      mindbodyClientId: dbUser[0]?.mindbodyClientId || contact?.properties?.mindbody_client_id || '',
      status: statusMap[memberStatusStr] || (memberStatusStr ? memberStatusStr.charAt(0).toUpperCase() + memberStatusStr.slice(1) : 'Active'),
      role
    };
    
    res.json({ success: true, member });
  } catch (error: unknown) {
    logger.error('Member verification error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to verify membership' });
  }
});

import crypto from 'crypto';

// PUBLIC ROUTE - send one-time password to email (no auth required)
otpRouter.post('/api/auth/request-otp', ...authRateLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const normalizedEmail = normalizeEmail(email);
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    
    const rateCheck = await checkOtpRequestLimit(normalizedEmail, clientIp);
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        error: `Too many code requests. Please try again in ${Math.ceil((rateCheck.retryAfter || 0) / 60)} minutes.` 
      });
    }
    
    const [staffOrAdminFlag, dbUserResult] = await Promise.all([
      isStaffOrAdminEmail(normalizedEmail),
      db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1)
    ]);
    const isStaffOrAdminUser = staffOrAdminFlag;
    const hasDbUser = dbUserResult.length > 0;
    const isStripeBilled = hasDbUser && (dbUserResult[0].stripeSubscriptionId || dbUserResult[0].stripeCustomerId);
    
    let firstName = isStaffOrAdminUser ? 'Team Member' : 'Member';
    let pendingStatusFix: { userId: string; status: MembershipStatus; dbMemberStatus: string } | null = null;
    
    if (hasDbUser && isStripeBilled && !isStaffOrAdminUser) {
      const dbMemberStatus = (dbUserResult[0].membershipStatus || '').toLowerCase();
      const activeStatuses = ['active', 'trialing', 'past_due'];
      
      if (!activeStatuses.includes(dbMemberStatus) && dbUserResult[0].stripeSubscriptionId) {
        try {
          const { getStripeClient } = await import('../../core/stripe/client');
          const stripe = await getStripeClient();
          const subscription = await stripe.subscriptions.retrieve(dbUserResult[0].stripeSubscriptionId);
          
          const stripeActiveStatuses = ['active', 'trialing', 'past_due'];
          if (stripeActiveStatuses.includes(subscription.status)) {
            pendingStatusFix = { userId: dbUserResult[0].id, status: subscription.status as MembershipStatus, dbMemberStatus };
          } else {
            return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
          }
        } catch (stripeError: unknown) {
          logger.error('[Auth] Failed to verify Stripe subscription status', { extra: { error: getErrorMessage(stripeError), email: normalizedEmail } });
          return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
        }
      } else if (!activeStatuses.includes(dbMemberStatus)) {
        return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
      }
      
      if (dbUserResult[0].firstName) {
        firstName = dbUserResult[0].firstName;
      }
    } else if (!isStaffOrAdminUser) {
      const hubspot = await getHubSpotClient();
      
      const searchResponse = await retryableHubSpotRequest(() => hubspot.crm.contacts.searchApi.doSearch({
        filterGroups: [{
          filters: [{
            propertyName: 'email',
            operator: FilterOperatorEnum.Eq,
            value: normalizedEmail
          }]
        }],
        properties: ['firstname', 'membership_status', 'email'],
        limit: 1
      }));
      
      const contact = searchResponse.results[0];
      
      if (!contact && !isStripeBilled) {
        return res.status(404).json({ error: 'No member found with this email address' });
      }
      
      if (!isStripeBilled && contact) {
        const status = (contact.properties.membership_status || '').toLowerCase();
        const activeStatuses = ['active', 'trialing', 'past_due'];
        if (!activeStatuses.includes(status) && status !== '') {
          return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
        }
      }
      
      if (contact?.properties?.firstname) {
        firstName = contact.properties.firstname;
      } else if (hasDbUser && dbUserResult[0].firstName) {
        firstName = dbUserResult[0].firstName;
      }
    } else if (isStaffOrAdminUser) {
      const staffUser = await getStaffUserByEmail(normalizedEmail);
      if (staffUser?.firstName) {
        firstName = staffUser.firstName;
      }
    }
    
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    await db.transaction(async (tx) => {
      if (pendingStatusFix) {
        await tx.update(users).set({ membershipStatus: pendingStatusFix.status, updatedAt: new Date() }).where(eq(users.id, pendingStatusFix.userId));
        logger.info('[Auth] Auto-fixed membership_status for : ->', { extra: { normalizedEmail, dbMemberStatus: pendingStatusFix.dbMemberStatus, subscriptionStatus: pendingStatusFix.status } });
      }
      await tx.insert(magicLinks).values({
        email: normalizedEmail,
        token: otpCode,
        expiresAt,
        used: false
      });
    });

    if (pendingStatusFix) {
      void import('../../core/hubspot/stages').then(({ syncMemberToHubSpot }) =>
        syncMemberToHubSpot({ email: normalizedEmail, status: pendingStatusFix!.status, billingProvider: 'stripe' })
          .then(() => logger.info('[Auth] Synced auto-fixed status to HubSpot for', { extra: { normalizedEmail } }))
          .catch((hubspotError: unknown) => logger.error('[Auth] HubSpot sync failed for auto-fix', { extra: { error: getErrorMessage(hubspotError) } }))
      ).catch((importErr: unknown) => logger.error('[Auth] Failed to import HubSpot stages module', { extra: { error: getErrorMessage(importErr) } }));
    }
    
    try {
      const suppressed = await checkEmailSuppression([normalizedEmail]);
      if (suppressed.length > 0) {
        logger.warn('[Auth] OTP email suppressed (bounced/complained recipient)', { extra: { normalizedEmail } });
        return res.status(400).json({ error: 'We are unable to deliver emails to this address. Please contact us for assistance.' });
      }
    } catch (suppressErr: unknown) {
      logger.warn('[Auth] OTP suppression check failed, proceeding with send', { extra: { normalizedEmail, error: getErrorMessage(suppressErr) } });
    }

    const emailHtml = getOtpEmailHtml({ code: otpCode, firstName, logoUrl: 'https://everclub.app/images/everclub-logo-dark.png' });
    const emailText = getOtpEmailText({ code: otpCode, firstName });

    res.json({ success: true, message: 'Login code sent' });

    void safeSendEmail({
      to: normalizedEmail,
      subject: `${otpCode} - Your Ever Club Login Code`,
      html: emailHtml,
      text: emailText,
      skipSuppressionCheck: true
    }).then((sendResult) => {
      if (!sendResult.success) {
        logger.error('[Auth] OTP email send failed (async)', { extra: { normalizedEmail } });
      } else {
        logger.info('[Auth] OTP sent to', { extra: { normalizedEmail } });
      }
    }).catch((err: unknown) => {
      logger.error('[Auth] OTP email send error (async)', { extra: { normalizedEmail, error: getErrorMessage(err) } });
    });
  } catch (error: unknown) {
    const errorMsg = getErrorMessage(error);
    logger.error('OTP request error', { extra: { error: errorMsg } });
    
    if (errorMsg.includes('HubSpot') || errorMsg.includes('hubspot')) {
      return res.status(500).json({ error: 'Unable to verify membership. Please try again later.' });
    }
    if (errorMsg.includes('Resend') || errorMsg.includes('email')) {
      return res.status(500).json({ error: 'Unable to send email. Please try again later.' });
    }
    
    res.status(500).json({ error: 'Failed to send login code. Please try again.' });
  }
});

// PUBLIC ROUTE - verify OTP and create session (no auth required)
otpRouter.post('/api/auth/verify-otp', ...authRateLimiter, async (req, res) => {
  try {
    const { email, code } = req.body;
    
    if (!email || !code) {
      return res.status(400).json({ error: 'Email and code are required' });
    }
    
    let normalizedEmail = normalizeEmail(email);
    const normalizedCode = code.toString().trim();
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    
    const attemptCheck = await checkOtpVerifyAttempts(normalizedEmail, clientIp);
    if (!attemptCheck.allowed) {
      return res.status(429).json({ 
        error: `Too many failed attempts. Please try again in ${Math.ceil((attemptCheck.retryAfter || 0) / 60)} minutes.` 
      });
    }
    
    const atomicResult = await db.execute(sql`WITH latest_token AS (
        SELECT id FROM magic_links
        WHERE email = ${normalizedEmail}
        AND token = ${normalizedCode}
        AND used = false
        AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 1
      )
      UPDATE magic_links
      SET used = true
      WHERE id = (SELECT id FROM latest_token)
      RETURNING *`);
    
    if (atomicResult.rows.length === 0) {
      await recordOtpVerifyFailure(normalizedEmail, clientIp);
      return res.status(400).json({ 
        error: 'Invalid or expired code. Please try again or request a new code.'
      });
    }
    
    await clearOtpVerifyAttempts(normalizedEmail, clientIp);
    
    const _otpRecord = atomicResult.rows[0];
    
    const role = await getUserRole(normalizedEmail);
    const sessionTtl = 30 * 24 * 60 * 60 * 1000;
    
    let member: SessionUser | undefined;
    let shouldSetupPassword = false;
    
    if (role === 'admin' || role === 'staff') {
      const staffUserData = await getStaffUserByEmail(normalizedEmail);
      
      if (!staffUserData) {
        return res.status(404).json({ error: 'Staff user not found' });
      }
      
      const alternateStaffEmail = getAlternateDomainEmail(normalizedEmail);
      const staffEmailsToCheck = alternateStaffEmail ? [normalizedEmail, alternateStaffEmail] : [normalizedEmail];
      const pwCheck = await db.select({ passwordHash: staffUsers.passwordHash })
        .from(staffUsers)
        .where(and(
          sql`LOWER(${staffUsers.email}) IN (${sql.join(staffEmailsToCheck.map(e => sql`LOWER(${e})`), sql`, `)})`,
          eq(staffUsers.isActive, true)
        ))
        .limit(1);
      
      shouldSetupPassword = pwCheck.length > 0 && !pwCheck[0].passwordHash;
      
      member = {
        id: `staff-${staffUserData.id}`,
        firstName: staffUserData.firstName,
        lastName: staffUserData.lastName,
        email: staffUserData.email,
        phone: staffUserData.phone,
        tier: 'VIP',
        tags: [],
        mindbodyClientId: '',
        status: 'Active',
        role,
        expires_at: Date.now() + sessionTtl
      };
    } else {
      const { resolveUserByEmail } = await import('../../core/stripe/customers');
      const resolvedLogin = await resolveUserByEmail(normalizedEmail);
      if (resolvedLogin && resolvedLogin.matchType !== 'direct') {
        logger.info('[Auth] Login email resolved to existing user via', { extra: { normalizedEmail, resolvedLoginPrimaryEmail: resolvedLogin.primaryEmail, resolvedLoginMatchType: resolvedLogin.matchType } });
        normalizedEmail = resolvedLogin.primaryEmail.toLowerCase();
      }

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
      })
        .from(users)
        .where(sql`LOWER(${users.email}) = LOWER(${normalizedEmail})`)
        .limit(1);
      
      const hasDbUser = dbUser.length > 0;
      const isStripeBilled = hasDbUser && (dbUser[0].stripeSubscriptionId || dbUser[0].stripeCustomerId);
      
      if (hasDbUser && isStripeBilled) {
        const dbMemberStatus = (dbUser[0].membershipStatus || '').toLowerCase();
        const activeStatuses = ['active', 'trialing', 'past_due'];
        
        if (!activeStatuses.includes(dbMemberStatus)) {
          return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
        }
        
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
        member = {
          id: dbUser[0].id,
          firstName: dbUser[0].firstName || '',
          lastName: dbUser[0].lastName || '',
          email: dbUser[0].email || normalizedEmail,
          phone: dbUser[0].phone || '',
          tier: role === 'visitor' ? undefined : (normalizeTierName(dbUser[0].tier) || undefined),
          tags: (dbUser[0].tags || []) as string[],
          mindbodyClientId: dbUser[0].mindbodyClientId || '',
          status: statusMap[dbMemberStatus] || (dbMemberStatus ? dbMemberStatus.charAt(0).toUpperCase() + dbMemberStatus.slice(1) : 'Active'),
          role,
          expires_at: Date.now() + sessionTtl,
          dateOfBirth: dbUser[0].dateOfBirth || null
        };
      } else {
        const hubspot = await getHubSpotClient();
        
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
        
        const contact = searchResponse.results[0];
        
        if (!contact) {
          if (!isStripeBilled) {
            return res.status(404).json({ error: 'Member not found' });
          }
        }
        
        if (!isStripeBilled && contact) {
          const hubspotStatus = (contact.properties.membership_status || '').toLowerCase();
          const activeStatuses = ['active', 'trialing', 'past_due'];
          if (!activeStatuses.includes(hubspotStatus) && hubspotStatus !== '') {
            return res.status(403).json({ error: 'Your membership is not active. Please contact us for assistance.' });
          }
        }
        
        const tags = hasDbUser ? (dbUser[0].tags || []) : [];
        
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
        const memberStatusStr = (hasDbUser ? dbUser[0].membershipStatus : contact?.properties?.membership_status || '' as string | null)?.toLowerCase() || '';
        
        member = {
          id: hasDbUser ? dbUser[0].id : (contact?.id || crypto.randomUUID()),
          firstName: (hasDbUser ? dbUser[0].firstName : contact?.properties?.firstname) || '',
          lastName: (hasDbUser ? dbUser[0].lastName : contact?.properties?.lastname) || '',
          email: (hasDbUser ? dbUser[0].email : contact?.properties?.email) || normalizedEmail,
          phone: (hasDbUser ? dbUser[0].phone : contact?.properties?.phone) || '',
          tier: role === 'visitor' ? undefined : (normalizeTierName(hasDbUser ? dbUser[0].tier : contact?.properties?.membership_tier) || undefined),
          tags: tags as string[],
          mindbodyClientId: (hasDbUser ? dbUser[0].mindbodyClientId : contact?.properties?.mindbody_client_id) || '',
          status: statusMap[memberStatusStr] || (memberStatusStr ? memberStatusStr.charAt(0).toUpperCase() + memberStatusStr.slice(1) : 'Active'),
          role,
          expires_at: Date.now() + sessionTtl,
          dateOfBirth: (hasDbUser ? dbUser[0].dateOfBirth : contact?.properties?.date_of_birth) || null,
          membershipStartDate: (hasDbUser ? dbUser[0].joinDate : contact?.properties?.membership_start_date) || ''
        };
      }
    }
    
    if (!member) {
      return res.status(500).json({ error: 'Failed to resolve member identity' });
    }

    const dbUserId = await upsertUserWithTier({
      email: member.email,
      tierName: (role === 'admin' || role === 'staff') ? undefined : (member.tier ?? ''),
      firstName: member.firstName,
      lastName: member.lastName,
      phone: member.phone || undefined,
      mindbodyClientId: member.mindbodyClientId || undefined,
      tags: member.tags && member.tags.length > 0 ? member.tags : undefined,
      membershipStartDate: member.membershipStartDate || undefined,
      role
    });
    
    if (dbUserId && dbUserId !== member.id) {
      member.id = dbUserId;
    }

    const supabaseToken = await createSupabaseToken(member as unknown as { id: string; email: string; role: string; firstName?: string; lastName?: string });

    try {
      await db.execute(sql`UPDATE users SET first_login_at = NOW(), updated_at = NOW() WHERE LOWER(email) = LOWER(${member.email}) AND first_login_at IS NULL`);
    } catch (err) {
      logger.warn('[Auth] Non-critical first_login_at update failed:', { extra: { error: getErrorMessage(err) } });
    }

    await regenerateSession(req, member as unknown as Record<string, unknown>);

    (async () => {
      try {
        if (member.role === 'member') {
          const claimed = await db.execute(sql`
            UPDATE users
            SET welcome_email_sent = true, welcome_email_sent_at = NOW(), updated_at = NOW()
            WHERE LOWER(email) = LOWER(${member.email})
              AND (welcome_email_sent IS NULL OR welcome_email_sent = false)
            RETURNING id
          `);
          if (claimed.rows.length > 0) {
            const result = await sendWelcomeEmail(member.email, member.firstName);
            if (!result.success) {
              await db.execute(sql`
                UPDATE users SET welcome_email_sent = false, welcome_email_sent_at = NULL, updated_at = NOW()
                WHERE LOWER(email) = LOWER(${member.email})
              `);
              logger.warn('[Welcome Email] Send failed, reset flag for retry', { extra: { email: member.email } });
            }
          }
        }
      } catch (error: unknown) {
        logger.error('[Welcome Email] Error checking/sending', { extra: { error: getErrorMessage(error) } });
      }
    })().catch(err => logger.error('[Welcome Email] Unhandled async error', { extra: { error: getErrorMessage(err) } }));
    
    req.session.save((err) => {
      if (err) {
        logger.error('Session save error', { extra: { error: getErrorMessage(err) } });
        return res.status(500).json({ error: 'Failed to create session' });
      }
      res.json({ success: true, member, shouldSetupPassword, supabaseToken });
    });
  } catch (error: unknown) {
    logger.error('OTP verification error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to verify code' });
  }
});
