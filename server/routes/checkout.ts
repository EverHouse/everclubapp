import { logger } from '../core/logger';
import { Router } from 'express';
import { db } from '../db';
import { membershipTiers, users } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { getStripeClient } from '../core/stripe/client';
import { getCorporateVolumePrice } from '../core/stripe/groupBilling';
import { logSystemAction } from '../core/auditLog';
import { checkoutRateLimiter } from '../middleware/rateLimiting';
import { getAppBaseUrl } from '../utils/urlUtils';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';

const router = Router();

const CORPORATE_MIN_SEATS = 5;

const checkoutSessionSchema = z.object({
  tier: z.string().min(1, 'Tier slug is required').max(100),
  email: z.string().email('Invalid email format').optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  companyName: z.string().max(200).optional(),
  jobTitle: z.string().max(100).optional(),
  quantity: z.number().int().min(1).max(100).optional(),
});

// PUBLIC ROUTE - membership checkout session creation (rate-limited, no auth required)
router.post('/api/checkout/sessions', checkoutRateLimiter, async (req, res) => {
  try {
    const parseResult = checkoutSessionSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      const firstError = parseResult.error.issues?.[0];
      return res.status(400).json({ error: firstError.message || 'Invalid input' });
    }
    
    const { tier: tierSlug, email, firstName, lastName, phone, companyName, jobTitle, quantity } = parseResult.data;

    const [tierData] = await db
      .select()
      .from(membershipTiers)
      .where(eq(membershipTiers.slug, tierSlug))
      .limit(1);

    if (!tierData) {
      return res.status(404).json({ error: 'Membership tier not found' });
    }

    const stripe = await getStripeClient();

    const baseUrl = getAppBaseUrl();

    const isCorporate = tierData.tierType === 'corporate' || tierSlug === 'corporate';
    
    if (isCorporate) {
      if (!firstName?.trim()) {
        return res.status(400).json({ error: 'First name is required for corporate checkout' });
      }
      if (!lastName?.trim()) {
        return res.status(400).json({ error: 'Last name is required for corporate checkout' });
      }
      if (!email?.trim()) {
        return res.status(400).json({ error: 'Email is required for corporate checkout' });
      }
      if (!phone?.trim()) {
        return res.status(400).json({ error: 'Phone number is required for corporate checkout' });
      }
      if (!companyName?.trim()) {
        return res.status(400).json({ error: 'Company name is required for corporate checkout' });
      }
    }
    
    const seatCount = isCorporate ? Math.max(quantity || CORPORATE_MIN_SEATS, CORPORATE_MIN_SEATS) : 1;

    const sessionParams: Record<string, unknown> = {
      mode: 'subscription',
      ui_mode: 'embedded',
      return_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        first_name: firstName || '',
        last_name: lastName || '',
        phone: phone || '',
        company_name: companyName || '',
        job_title: jobTitle || '',
        quantity: String(seatCount),
        tier_type: tierData.tierType || 'individual',
        tier_slug: tierSlug,
      },
      subscription_data: {
        metadata: {
          tier_slug: tierSlug,
          tier_name: tierData.name,
          tier_type: tierData.tierType || 'individual',
          purchaser_email: email || '',
          first_name: firstName || '',
          last_name: lastName || '',
          phone: phone || '',
          company_name: companyName || '',
          quantity: String(seatCount),
        },
      },
    };

    if (isCorporate) {
      const corporatePricePerSeat = getCorporateVolumePrice(seatCount);
      
      await logSystemAction({
        action: 'checkout_pricing_calculated',
        resourceType: 'checkout',
        resourceId: email || 'unknown',
        details: {
          tier: tierSlug,
          tierType: 'corporate',
          seatCount,
          pricePerSeatCents: corporatePricePerSeat,
          totalMonthlyCents: corporatePricePerSeat * seatCount,
          firstName: firstName || null,
          lastName: lastName || null,
          phone: phone || null,
          companyName: companyName || null,
          serverControlled: true,
        },
      });
      
      if (!tierData.stripeProductId) {
        return res.status(400).json({ error: 'Corporate membership product is not configured in Stripe yet. An admin needs to run "Sync to Stripe" from Products & Pricing.' });
      }
      sessionParams.line_items = [
        {
          price_data: {
            currency: 'usd',
            product: tierData.stripeProductId,
            unit_amount: corporatePricePerSeat,
            recurring: {
              interval: 'month',
            },
          },
          quantity: seatCount,
        },
      ];
    } else {
      if (!tierData.stripePriceId) {
        return res.status(400).json({ error: 'This membership tier is not set up in Stripe yet. An admin needs to run "Sync to Stripe" from Products & Pricing before signups can be processed.' });
      }
      sessionParams.line_items = [
        {
          price: tierData.stripePriceId,
          quantity: 1,
        },
      ];
    }

    if (email) {
      const [existingUser] = await db.select({
        stripeCustomerId: users.stripeCustomerId,
        migrationStatus: users.migrationStatus,
      })
        .from(users)
        .where(sql`LOWER(${users.email}) = ${email.toLowerCase()}`)
        .limit(1);

      if (existingUser?.migrationStatus === 'pending') {
        return res.status(400).json({ error: 'Your billing is being migrated — a subscription will be created automatically. No action needed.' });
      }

      if (existingUser?.stripeCustomerId) {
        return res.status(409).json({ error: 'An account with this email already exists. Please log in to manage your membership.' });
      }
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({
      sessionId: session.id,
      clientSecret: session.client_secret,
    });
  } catch (error: unknown) {
    logger.error('[Checkout] Session creation error', { extra: { error: getErrorMessage(error) } });
    const stripeErr = error as { type?: string; code?: string; raw?: { code?: string }; message?: string };
    const isStalePrice =
      stripeErr.type === 'StripeInvalidRequestError' && (
        stripeErr.code === 'resource_missing' ||
        stripeErr.raw?.code === 'resource_missing' ||
        stripeErr.code === 'price_inactive' ||
        (stripeErr.message && (stripeErr.message.includes('No such price') || stripeErr.message.includes('price_inactive')))
      );
    if (isStalePrice) {
      res.status(400).json({ error: 'This membership tier\'s pricing is temporarily unavailable. Please try again shortly — an admin has been notified.' });
    } else {
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  }
});

const sessionIdSchema = z.string().min(1).regex(/^cs_/, 'Invalid session ID format');

// PUBLIC ROUTE - retrieve checkout session status for thank-you page (rate-limited)
router.get('/api/checkout/session/:sessionId', checkoutRateLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const parseResult = sessionIdSchema.safeParse(sessionId);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    const stripe = await getStripeClient();
    
    const session = await stripe.checkout.sessions.retrieve(sessionId as string, { expand: ['customer'] });
    
    const customerEmail = session.customer_details?.email || (typeof session.customer === 'object' && session.customer !== null && 'email' in session.customer ? (session.customer as { email?: string }).email || null : null) || null;
    const metadata = session.metadata || {};
    
    let tierName: string | null = null;
    if (metadata.tier_slug) {
      const [tierData] = await db
        .select({ name: membershipTiers.name })
        .from(membershipTiers)
        .where(eq(membershipTiers.slug, metadata.tier_slug))
        .limit(1);
      tierName = tierData?.name || null;
    }

    let accountReady = false;
    if (customerEmail) {
      const [existingUser] = await db
        .select({ membershipStatus: users.membershipStatus })
        .from(users)
        .where(sql`LOWER(${users.email}) = ${customerEmail.toLowerCase()}`)
        .limit(1);
      accountReady = !!existingUser && existingUser.membershipStatus !== 'pending';
    }

    res.json({
      status: session.status,
      paymentStatus: session.payment_status,
      customerEmail,
      metadata,
      tierName,
      accountReady,
    });
  } catch (error: unknown) {
    logger.error('[Checkout] Session retrieval error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

export default router;
