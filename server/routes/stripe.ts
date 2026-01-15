import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { pool } from '../core/db';
import {
  getStripePublishableKey,
  createPaymentIntent,
  confirmPaymentSuccess,
  getPaymentIntentStatus,
  cancelPaymentIntent,
  getOrCreateStripeCustomer
} from '../core/stripe';

const router = Router();

router.get('/api/stripe/config', async (req: Request, res: Response) => {
  try {
    const publishableKey = await getStripePublishableKey();
    res.json({ publishableKey });
  } catch (error: any) {
    console.error('[Stripe] Error getting config:', error);
    res.status(500).json({ error: 'Failed to get Stripe configuration' });
  }
});

router.post('/api/stripe/create-payment-intent', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { 
      userId, 
      email, 
      memberName, 
      amountCents, 
      purpose, 
      bookingId, 
      sessionId, 
      description,
      participantId
    } = req.body;

    if (!userId || !email || !amountCents || !purpose || !description) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId, email, amountCents, purpose, description' 
      });
    }

    if (amountCents < 50) {
      return res.status(400).json({ error: 'Amount must be at least $0.50' });
    }

    const validPurposes = ['guest_fee', 'overage_fee', 'one_time_purchase'];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ 
        error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` 
      });
    }

    const result = await createPaymentIntent({
      userId,
      email,
      memberName: memberName || email.split('@')[0],
      amountCents: Math.round(amountCents),
      purpose,
      bookingId,
      sessionId,
      description,
      metadata: {
        participantId: participantId?.toString() || ''
      }
    });

    res.json({
      paymentIntentId: result.paymentIntentId,
      clientSecret: result.clientSecret,
      customerId: result.customerId
    });
  } catch (error: any) {
    console.error('[Stripe] Error creating payment intent:', error);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

router.post('/api/stripe/confirm-payment', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;
    const staffUser = (req as any).staffUser;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const result = await confirmPaymentSuccess(
      paymentIntentId,
      staffUser?.email || 'staff',
      staffUser?.name || 'Staff Member'
    );

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Stripe] Error confirming payment:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

router.get('/api/stripe/payment-intent/:id', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const status = await getPaymentIntentStatus(id);

    if (!status) {
      return res.status(404).json({ error: 'Payment intent not found' });
    }

    res.json(status);
  } catch (error: any) {
    console.error('[Stripe] Error getting payment intent:', error);
    res.status(500).json({ error: 'Failed to get payment intent status' });
  }
});

router.post('/api/stripe/cancel-payment', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const result = await cancelPaymentIntent(paymentIntentId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Stripe] Error canceling payment:', error);
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

router.post('/api/stripe/create-customer', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { userId, email, name } = req.body;

    if (!userId || !email) {
      return res.status(400).json({ error: 'Missing required fields: userId, email' });
    }

    const result = await getOrCreateStripeCustomer(userId, email, name);

    res.json({
      customerId: result.customerId,
      isNew: result.isNew
    });
  } catch (error: any) {
    console.error('[Stripe] Error creating customer:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

router.get('/api/stripe/payments/:email', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const email = decodeURIComponent(req.params.email);

    const result = await pool.query(
      `SELECT 
        spi.id,
        spi.stripe_payment_intent_id,
        spi.amount_cents,
        spi.purpose,
        spi.booking_id,
        spi.description,
        spi.status,
        spi.created_at
       FROM stripe_payment_intents spi
       JOIN users u ON u.id = spi.user_id
       WHERE LOWER(u.email) = $1
       ORDER BY spi.created_at DESC
       LIMIT 50`,
      [email.toLowerCase()]
    );

    res.json({ payments: result.rows });
  } catch (error: any) {
    console.error('[Stripe] Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

export default router;
