import { Router } from 'express';
import { db } from '../db';
import { membershipTiers } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { getStripeClient } from '../core/stripe/client';
import { getCorporateVolumePrice } from '../core/stripe/groupBilling';
import { logSystemAction } from '../core/auditLog';
import { checkoutRateLimiter } from '../middleware/rateLimiting';
import { z } from 'zod';

const router = Router();

const CORPORATE_MIN_SEATS = 5;

const checkoutSessionSchema = z.object({
  tier: z.string().min(1, 'Tier slug is required').max(100),
  email: z.string().email('Invalid email format').optional(),
  companyName: z.string().max(200).optional(),
  jobTitle: z.string().max(100).optional(),
});

router.post('/api/checkout/sessions', checkoutRateLimiter, async (req, res) => {
  try {
    const parseResult = checkoutSessionSchema.safeParse(req.body);
    
    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0];
      return res.status(400).json({ error: firstError.message || 'Invalid input' });
    }
    
    const { tier: tierSlug, email, companyName, jobTitle } = parseResult.data;

    const [tierData] = await db
      .select()
      .from(membershipTiers)
      .where(eq(membershipTiers.slug, tierSlug))
      .limit(1);

    if (!tierData) {
      return res.status(404).json({ error: 'Membership tier not found' });
    }

    const stripe = await getStripeClient();

    const replitDomains = process.env.REPLIT_DOMAINS?.split(',')[0];
    const baseUrl = replitDomains ? `https://${replitDomains}` : 'http://localhost:5000';

    const isCorporate = tierData.tierType === 'corporate' || tierSlug === 'corporate';

    let sessionParams: any = {
      mode: 'subscription',
      ui_mode: 'embedded',
      return_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        company_name: companyName || '',
        job_title: jobTitle || '',
        quantity: String(CORPORATE_MIN_SEATS),
        tier_type: tierData.tierType || 'individual',
        tier_slug: tierSlug,
      },
    };

    if (isCorporate) {
      const corporatePricePerSeat = getCorporateVolumePrice(CORPORATE_MIN_SEATS);
      
      await logSystemAction({
        action: 'checkout_pricing_calculated',
        resourceType: 'checkout',
        resourceId: email || 'unknown',
        details: {
          tier: tierSlug,
          tierType: 'corporate',
          seatCount: CORPORATE_MIN_SEATS,
          pricePerSeatCents: corporatePricePerSeat,
          totalMonthlyCents: corporatePricePerSeat * CORPORATE_MIN_SEATS,
          companyName: companyName || null,
          serverControlled: true,
        },
      });
      
      sessionParams.line_items = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${tierData.name} - Corporate Membership`,
              description: `${CORPORATE_MIN_SEATS} employee seats at $${(corporatePricePerSeat / 100).toFixed(2)}/seat/month. Volume discounts applied as employees are added.`,
            },
            unit_amount: corporatePricePerSeat,
            recurring: {
              interval: 'month',
            },
          },
          quantity: CORPORATE_MIN_SEATS,
        },
      ];
    } else {
      if (!tierData.stripePriceId) {
        return res.status(400).json({ error: 'This tier does not have a configured Stripe price' });
      }
      sessionParams.line_items = [
        {
          price: tierData.stripePriceId,
          quantity: 1,
        },
      ];
    }

    if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    res.json({
      sessionId: session.id,
      clientSecret: session.client_secret,
    });
  } catch (error: any) {
    console.error('[Checkout] Session creation error:', error);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

const sessionIdSchema = z.string().min(1).regex(/^cs_/, 'Invalid session ID format');

router.get('/api/checkout/session/:sessionId', checkoutRateLimiter, async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const parseResult = sessionIdSchema.safeParse(sessionId);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid session ID' });
    }
    
    const stripe = await getStripeClient();
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    res.json({
      status: session.status,
      paymentStatus: session.payment_status,
    });
  } catch (error: any) {
    console.error('[Checkout] Session retrieval error:', error);
    res.status(500).json({ error: 'Failed to retrieve session' });
  }
});

export default router;
