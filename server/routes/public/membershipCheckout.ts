import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../../db';
import { users, membershipTiers } from '../../../shared/schema';
import { eq, sql } from 'drizzle-orm';
import { logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { getOrCreateStripeCustomer } from '../../core/stripe/customers';
import { resolveUserByEmail } from '../../core/stripe/customers';
import { getStripeClient } from '../../core/stripe/client';
import { getAppBaseUrl } from '../../utils/urlUtils';
import { validateBody } from '../../middleware/validate';
import { selfServeCheckoutSchema } from '../../../shared/validators/membershipCheckout';
import { checkoutRateLimiter, acquireSubscriptionLock, releaseSubscriptionLock } from '../../middleware/rateLimiting';
import rateLimit from 'express-rate-limit';

const selfServeRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = req.body?.email;
    if (email) {
      return `self-serve:${String(email).toLowerCase()}:${String(req.ip || 'unknown')}`;
    }
    return `self-serve:${String(req.ip || 'unknown')}`;
  },
  validate: false,
  handler: (_req: Request, res: Response) => {
    res.status(429).json({ error: 'Too many checkout attempts. Please wait a minute before trying again.' });
  }
});

const router = Router();

router.post(
  '/api/public/membership-checkout',
  selfServeRateLimiter,
  checkoutRateLimiter,
  validateBody(selfServeCheckoutSchema),
  async (req: Request, res: Response) => {
    try {
      const { email: rawEmail, firstName, lastName, tierSlug, promoCode: rawPromoCode } = req.body;
      const email = rawEmail?.trim()?.toLowerCase();
      const promoCode = rawPromoCode?.trim()?.toUpperCase() || undefined;

      const lockAcquired = await acquireSubscriptionLock(email, 'self_serve_checkout');
      if (!lockAcquired) {
        return res.status(409).json({ error: 'A checkout is already in progress for this email. Please wait a moment.' });
      }

      try {
        const resolved = await resolveUserByEmail(email);

        const existingUser = resolved
          ? await db.select({
              id: users.id, firstName: users.firstName, lastName: users.lastName,
              membershipStatus: users.membershipStatus, createdAt: users.createdAt,
              archivedAt: users.archivedAt, stripeSubscriptionId: users.stripeSubscriptionId, tier: users.tier,
            }).from(users).where(eq(users.id, resolved.userId))
          : await db.select({
              id: users.id, firstName: users.firstName, lastName: users.lastName,
              membershipStatus: users.membershipStatus, createdAt: users.createdAt,
              archivedAt: users.archivedAt, stripeSubscriptionId: users.stripeSubscriptionId, tier: users.tier,
            }).from(users).where(sql`LOWER(${users.email}) = ${email.toLowerCase()}`);

        let existingUserId: string | null = null;

        if (existingUser.length > 0) {
          const existing = existingUser[0];
          if (existing.membershipStatus === 'active' && existing.stripeSubscriptionId) {
            return res.status(400).json({
              error: 'This email is already associated with an active membership.',
              isAlreadyActive: true,
            });
          } else if (existing.archivedAt && ['non-member', 'visitor', null].includes(existing.membershipStatus)) {
            existingUserId = existing.id;
            logger.info('[Self-Serve Checkout] Unarchiving user for new membership', { extra: { email } });
          } else {
            existingUserId = existing.id;
            logger.info('[Self-Serve Checkout] Reusing existing user', { extra: { email, status: existing.membershipStatus } });
          }
        }

        const tierResult = await db.select()
          .from(membershipTiers)
          .where(eq(membershipTiers.slug, tierSlug))
          .limit(1);

        if (tierResult.length === 0) {
          return res.status(400).json({ error: `Tier "${tierSlug}" not found` });
        }

        const tier = tierResult[0];

        if (!tier.stripePriceId) {
          return res.status(400).json({ error: `This membership tier is not available for self-serve checkout yet.` });
        }

        if (tier.tierType === 'corporate') {
          return res.status(400).json({ error: 'Corporate memberships require contacting the club directly.' });
        }

        const userId = existingUserId || randomUUID();
        const memberName = `${firstName} ${lastName}`.trim();

        if (existingUserId) {
          await db.execute(sql`UPDATE users SET
            archived_at = NULL, archived_by = NULL,
            first_name = COALESCE(${firstName || null}, first_name),
            last_name = COALESCE(${lastName || null}, last_name),
            tier = ${tier.name},
            membership_status = 'pending',
            membership_status_changed_at = CASE WHEN membership_status IS DISTINCT FROM 'pending' THEN NOW() ELSE membership_status_changed_at END,
            billing_provider = 'stripe',
            updated_at = NOW()
          WHERE id = ${existingUserId}`);
        } else {
          const exclusionCheck = await db.execute(sql`SELECT 1 FROM sync_exclusions WHERE email = ${email.toLowerCase()}`);
          if (exclusionCheck.rows.length > 0) {
            logger.warn('[Self-Serve Checkout] Blocked checkout for permanently deleted member', { extra: { email } });
            return res.status(400).json({ error: 'This email cannot be used for a new membership. Please contact the club.' });
          }
          await db.insert(users).values({
            id: userId,
            email: email.toLowerCase(),
            firstName: firstName || null,
            lastName: lastName || null,
            tier: tier.name,
            membershipStatus: 'pending',
            billingProvider: 'stripe',
            createdAt: new Date(),
          });
          logger.info('[Self-Serve Checkout] Created pending user', { extra: { email, tierName: tier.name } });
        }

        let customerId: string;
        let checkoutSession;

        try {
          const customerResult = await getOrCreateStripeCustomer(userId, email, memberName, tier.name);
          customerId = customerResult.customerId;

          await db.update(users).set({ stripeCustomerId: customerId }).where(eq(users.id, userId));

          const stripe = await getStripeClient();
          const baseUrl = getAppBaseUrl();

          const successUrl = `${baseUrl}/welcome?session_id={CHECKOUT_SESSION_ID}`;
          const cancelUrl = `${baseUrl}/join`;

          const sessionParams: import('stripe').default.Checkout.SessionCreateParams = {
            customer: customerId,
            mode: 'subscription',
            line_items: [{
              price: tier.stripePriceId,
              quantity: 1,
            }],
            success_url: successUrl,
            cancel_url: cancelUrl,
            metadata: {
              userId,
              memberEmail: email,
              tier: tier.name,
              tierSlug: tier.slug,
              createdBy: 'self_serve',
              isNewMember: 'true',
              source: 'self_serve',
            },
            subscription_data: {
              metadata: {
                userId,
                memberEmail: email,
                tier: tier.name,
                tierSlug: tier.slug,
                isNewMember: 'true',
              },
            },
            expires_at: Math.floor(Date.now() / 1000) + (23 * 60 * 60),
          };

          if (promoCode) {
            try {
              const promoCodes = await stripe.promotionCodes.list({
                code: promoCode,
                active: true,
                limit: 1,
              });

              if (promoCodes.data.length > 0) {
                const promoCodeObj = promoCodes.data[0];
                sessionParams.discounts = [{ promotion_code: promoCodeObj.id }];
                if (sessionParams.metadata) {
                  sessionParams.metadata.promoCodeApplied = promoCode;
                }
                logger.info('[Self-Serve Checkout] Applied promo code', { extra: { promoCode, promoCodeId: promoCodeObj.id } });
              } else {
                return res.status(400).json({ error: `Promo code "${promoCode}" is not valid or has expired.` });
              }
            } catch (promoErr: unknown) {
              logger.warn('[Self-Serve Checkout] Error looking up promo code', { extra: { promoCode, error: getErrorMessage(promoErr) } });
              return res.status(400).json({ error: `Could not validate promo code. Please try again.` });
            }
          }

          checkoutSession = await stripe.checkout.sessions.create(sessionParams);

          if (!checkoutSession.url) {
            throw new Error('Failed to create checkout session - no URL returned');
          }
        } catch (stripeErr: unknown) {
          logger.error('[Self-Serve Checkout] Stripe call failed, rolling back pending user', { extra: { email, userId, error: getErrorMessage(stripeErr) } });
          if (!existingUserId) {
            try {
              await db.delete(users).where(eq(users.id, userId));
            } catch (cleanupErr: unknown) {
              logger.error('[Self-Serve Checkout] Failed to clean up pending user', { extra: { userId, email, error: getErrorMessage(cleanupErr) } });
            }
          }
          if ((stripeErr as Error)?.message?.includes('Promo code') || (stripeErr as Error)?.message?.includes('promo code')) {
            return res.status(400).json({ error: (stripeErr as Error).message });
          }
          return res.status(500).json({ error: 'Failed to create checkout session. Please try again.' });
        }

        logger.info('[Self-Serve Checkout] Created checkout session', { extra: { checkoutSessionId: checkoutSession.id, email } });

        res.json({
          checkoutUrl: checkoutSession.url,
          sessionId: checkoutSession.id,
        });
      } finally {
        await releaseSubscriptionLock(email);
      }
    } catch (error: unknown) {
      logger.error('[Self-Serve Checkout] Unexpected error', { extra: { error: getErrorMessage(error) } });
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  }
);

router.get('/api/public/membership-tiers', async (_req: Request, res: Response) => {
  try {
    const tiers = await db.select({
      id: membershipTiers.id,
      name: membershipTiers.name,
      slug: membershipTiers.slug,
      priceString: membershipTiers.priceString,
      description: membershipTiers.description,
      buttonText: membershipTiers.buttonText,
      sortOrder: membershipTiers.sortOrder,
      isActive: membershipTiers.isActive,
      isPopular: membershipTiers.isPopular,
      highlightedFeatures: membershipTiers.highlightedFeatures,
      productType: membershipTiers.productType,
      tierType: membershipTiers.tierType,
      showOnMembershipPage: membershipTiers.showOnMembershipPage,
      priceCents: membershipTiers.priceCents,
      billingInterval: membershipTiers.billingInterval,
    })
    .from(membershipTiers)
    .where(eq(membershipTiers.isActive, true))
    .orderBy(membershipTiers.sortOrder, membershipTiers.id);

    const filteredTiers = tiers.filter(
      t => t.productType === 'subscription' && t.tierType !== 'corporate'
    );

    res.json(filteredTiers);
  } catch (error: unknown) {
    logger.error('[Self-Serve] Error fetching tiers', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to load membership tiers.' });
  }
});

export default router;
