import { Router } from 'express';
import { db } from '../db';
import { membershipTiers } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { getStripeClient } from '../core/stripe/client';

const router = Router();

function getCorporatePrice(count: number): number {
  if (count >= 50) return 24900;
  if (count >= 20) return 27500;
  if (count >= 10) return 29900;
  if (count >= 5) return 32500;
  return 35000;
}

router.post('/api/checkout/sessions', async (req, res) => {
  try {
    const { 
      tier: tierSlug, 
      email, 
      quantity = 1, 
      companyName, 
      jobTitle 
    } = req.body;

    if (!tierSlug) {
      return res.status(400).json({ error: 'Tier slug is required' });
    }

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
    const minQuantity = 5;
    const actualQuantity = isCorporate ? Math.max(quantity, minQuantity) : 1;

    if (isCorporate && quantity < minQuantity) {
      return res.status(400).json({ 
        error: `Corporate memberships require a minimum of ${minQuantity} employees` 
      });
    }

    let sessionParams: any = {
      mode: 'subscription',
      ui_mode: 'embedded',
      return_url: `${baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      metadata: {
        company_name: companyName || '',
        job_title: jobTitle || '',
        quantity: String(actualQuantity),
        tier_type: tierData.tierType || 'individual',
        tier_slug: tierSlug,
      },
    };

    if (isCorporate) {
      const unitAmount = getCorporatePrice(actualQuantity);
      sessionParams.line_items = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${tierData.name} - Corporate Membership`,
              description: `${actualQuantity} employee seats at $${(unitAmount / 100).toFixed(2)}/seat/month`,
            },
            unit_amount: unitAmount,
            recurring: {
              interval: 'month',
            },
          },
          quantity: actualQuantity,
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
    res.status(500).json({ error: error.message || 'Failed to create checkout session' });
  }
});

router.get('/api/checkout/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const stripe = await getStripeClient();
    
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    res.json({
      status: session.status,
      customerEmail: session.customer_details?.email || session.customer_email,
      paymentStatus: session.payment_status,
    });
  } catch (error: any) {
    console.error('[Checkout] Session retrieval error:', error);
    res.status(500).json({ error: error.message || 'Failed to retrieve session' });
  }
});

export default router;
