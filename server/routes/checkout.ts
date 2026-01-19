import { Router } from 'express';
import { db } from '../db';
import { membershipTiers } from '../../shared/schema';
import { eq } from 'drizzle-orm';
import { getStripeClient } from '../core/stripe/client';

const router = Router();

router.post('/api/checkout/sessions', async (req, res) => {
  try {
    const { tier: tierSlug, email } = req.body;

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

    if (!tierData.stripePriceId) {
      return res.status(400).json({ error: 'This tier does not have a configured Stripe price' });
    }

    const stripe = await getStripeClient();

    const replitDomains = process.env.REPLIT_DOMAINS?.split(',')[0];
    const baseUrl = replitDomains ? `https://${replitDomains}` : 'http://localhost:5000';

    const sessionParams: any = {
      mode: 'subscription',
      ui_mode: 'embedded',
      line_items: [
        {
          price: tierData.stripePriceId,
          quantity: 1,
        },
      ],
      return_url: `${baseUrl}/#/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    };

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
