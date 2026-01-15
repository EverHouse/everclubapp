import { Router, Request, Response } from 'express';
import { isStaffOrAdmin, isAdmin } from '../core/middleware';
import { pool } from '../core/db';
import {
  getStripePublishableKey,
  createPaymentIntent,
  confirmPaymentSuccess,
  getPaymentIntentStatus,
  cancelPaymentIntent,
  getOrCreateStripeCustomer,
  getStripeProducts,
  getProductSyncStatus,
  syncHubSpotProductToStripe,
  syncAllHubSpotProductsToStripe,
  fetchHubSpotProducts,
  createSubscription,
  cancelSubscription,
  listCustomerSubscriptions,
  getSubscription,
  createInvoice,
  previewInvoice,
  finalizeAndSendInvoice,
  listCustomerInvoices,
  getInvoice,
  voidInvoice
} from '../core/stripe';
import { calculateAndCacheParticipantFees } from '../core/billing/feeCalculator';
import { checkExpiringCards } from '../core/billing/cardExpiryChecker';
import { checkStaleWaivers } from '../schedulers/waiverReviewScheduler';

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
      participantFees
    } = req.body;

    if (!userId || !email || !amountCents || !purpose || !description) {
      return res.status(400).json({ 
        error: 'Missing required fields: userId, email, amountCents, purpose, description' 
      });
    }

    const validPurposes = ['guest_fee', 'overage_fee', 'one_time_purchase'];
    if (!validPurposes.includes(purpose)) {
      return res.status(400).json({ 
        error: `Invalid purpose. Must be one of: ${validPurposes.join(', ')}` 
      });
    }

    let snapshotId: number | null = null;
    let serverFees: Array<{id: number; amountCents: number}> = [];
    let serverTotal = Math.round(amountCents);
    const isBookingPayment = bookingId && sessionId && participantFees && Array.isArray(participantFees) && participantFees.length > 0;

    if (isBookingPayment) {
      const sessionCheck = await pool.query(
        `SELECT bs.id FROM booking_sessions bs
         JOIN booking_requests br ON br.session_id = bs.id
         WHERE bs.id = $1 AND br.id = $2`,
        [sessionId, bookingId]
      );
      if (sessionCheck.rows.length === 0) {
        return res.status(400).json({ error: 'Invalid session/booking combination' });
      }

      const requestedIds: number[] = participantFees.map((pf: any) => pf.id);

      const feeResult = await calculateAndCacheParticipantFees(sessionId, requestedIds);
      
      if (!feeResult.success) {
        return res.status(500).json({ error: feeResult.error || 'Failed to calculate fees' });
      }
      
      if (feeResult.fees.length === 0) {
        return res.status(400).json({ error: 'No valid pending participants with fees to charge' });
      }
      
      for (const fee of feeResult.fees) {
        serverFees.push({ id: fee.participantId, amountCents: fee.amountCents });
      }
      
      console.log(`[Stripe] Calculated ${feeResult.fees.length} authoritative fees using fee calculator`);

      serverTotal = serverFees.reduce((sum, f) => sum + f.amountCents, 0);
      
      if (serverTotal < 50) {
        return res.status(400).json({ error: 'Total amount must be at least $0.50' });
      }

      console.log(`[Stripe] Using authoritative cached fees from DB, total: $${(serverTotal/100).toFixed(2)}`);
      if (Math.abs(serverTotal - amountCents) > 1) {
        console.warn(`[Stripe] Client total mismatch: client=${amountCents}, server=${serverTotal} - using server total`);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        
        const snapshotResult = await client.query(
          `INSERT INTO booking_fee_snapshots (booking_id, session_id, participant_fees, total_cents, status)
           VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
          [bookingId, sessionId, JSON.stringify(serverFees), serverTotal]
        );
        snapshotId = snapshotResult.rows[0].id;
        
        await client.query('COMMIT');
        console.log(`[Stripe] Created fee snapshot ${snapshotId} for booking ${bookingId}: $${(serverTotal/100).toFixed(2)} with ${serverFees.length} participants`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } else {
      if (serverTotal < 50) {
        return res.status(400).json({ error: 'Amount must be at least $0.50' });
      }
      console.log(`[Stripe] Non-booking payment: $${(serverTotal/100).toFixed(2)} for ${purpose}`);
    }

    const metadata: Record<string, string> = {};
    if (snapshotId) {
      metadata.feeSnapshotId = snapshotId.toString();
    }
    if (serverFees.length > 0) {
      metadata.participantFees = JSON.stringify(serverFees);
    }
    
    let result;
    try {
      result = await createPaymentIntent({
        userId,
        email,
        memberName: memberName || email.split('@')[0],
        amountCents: serverTotal,
        purpose,
        bookingId,
        sessionId,
        description,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined
      });
    } catch (stripeErr) {
      if (snapshotId) {
        await pool.query(`DELETE FROM booking_fee_snapshots WHERE id = $1`, [snapshotId]);
        console.log(`[Stripe] Deleted orphaned snapshot ${snapshotId} after PaymentIntent creation failed`);
      }
      throw stripeErr;
    }

    if (snapshotId) {
      await pool.query(
        `UPDATE booking_fee_snapshots SET stripe_payment_intent_id = $1 WHERE id = $2`,
        [result.paymentIntentId, snapshotId]
      );
    }

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

router.post('/api/admin/check-expiring-cards', isAdmin, async (req: Request, res: Response) => {
  try {
    const result = await checkExpiringCards();
    res.json(result);
  } catch (error: any) {
    console.error('[Stripe] Error checking expiring cards:', error);
    res.status(500).json({ error: 'Failed to check expiring cards', details: error.message });
  }
});

router.post('/api/admin/check-stale-waivers', isAdmin, async (req: Request, res: Response) => {
  try {
    const result = await checkStaleWaivers();
    res.json(result);
  } catch (error: any) {
    console.error('[Admin] Error checking stale waivers:', error);
    res.status(500).json({ error: 'Failed to check stale waivers', details: error.message });
  }
});

router.get('/api/stripe/products', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const syncStatus = await getProductSyncStatus();
    const stripeProducts = await getStripeProducts();
    
    res.json({
      products: stripeProducts,
      syncStatus,
      count: stripeProducts.length
    });
  } catch (error: any) {
    console.error('[Stripe] Error getting products:', error);
    res.status(500).json({ error: 'Failed to get Stripe products' });
  }
});

router.post('/api/stripe/products/sync', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { hubspotProductId } = req.body;
    
    if (!hubspotProductId) {
      return res.status(400).json({ error: 'Missing required field: hubspotProductId' });
    }
    
    const hubspotProducts = await fetchHubSpotProducts();
    const product = hubspotProducts.find(p => p.id === hubspotProductId);
    
    if (!product) {
      return res.status(404).json({ error: 'HubSpot product not found' });
    }
    
    const result = await syncHubSpotProductToStripe(product);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to sync product' });
    }
    
    res.json({
      success: true,
      stripeProductId: result.stripeProductId,
      stripePriceId: result.stripePriceId
    });
  } catch (error: any) {
    console.error('[Stripe] Error syncing product:', error);
    res.status(500).json({ error: 'Failed to sync product to Stripe' });
  }
});

router.post('/api/stripe/products/sync-all', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const result = await syncAllHubSpotProductsToStripe();
    
    res.json({
      success: result.success,
      synced: result.synced,
      failed: result.failed,
      errors: result.errors
    });
  } catch (error: any) {
    console.error('[Stripe] Error syncing all products:', error);
    res.status(500).json({ error: 'Failed to sync products to Stripe' });
  }
});

router.get('/api/stripe/subscriptions/:customerId', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    
    const result = await listCustomerSubscriptions(customerId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to list subscriptions' });
    }
    
    res.json({
      subscriptions: result.subscriptions,
      count: result.subscriptions?.length || 0
    });
  } catch (error: any) {
    console.error('[Stripe] Error listing subscriptions:', error);
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

router.post('/api/stripe/subscriptions', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId, priceId, memberEmail } = req.body;
    
    if (!customerId || !priceId) {
      return res.status(400).json({ error: 'Missing required fields: customerId, priceId' });
    }
    
    const result = await createSubscription({
      customerId,
      priceId,
      metadata: memberEmail ? { memberEmail } : undefined
    });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to create subscription' });
    }
    
    res.json({
      success: true,
      subscription: result.subscription
    });
  } catch (error: any) {
    console.error('[Stripe] Error creating subscription:', error);
    res.status(500).json({ error: 'Failed to create subscription' });
  }
});

router.delete('/api/stripe/subscriptions/:subscriptionId', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    
    const result = await cancelSubscription(subscriptionId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to cancel subscription' });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Stripe] Error canceling subscription:', error);
    res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

router.get('/api/stripe/invoices/preview', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId, priceId } = req.query;
    
    if (!customerId || !priceId) {
      return res.status(400).json({ error: 'Missing required query params: customerId, priceId' });
    }
    
    const result = await previewInvoice({
      customerId: customerId as string,
      priceId: priceId as string,
    });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to preview invoice' });
    }
    
    res.json({ preview: result.preview });
  } catch (error: any) {
    console.error('[Stripe] Error previewing invoice:', error);
    res.status(500).json({ error: 'Failed to preview invoice' });
  }
});

router.get('/api/stripe/invoices/:customerId', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId } = req.params;
    
    const result = await listCustomerInvoices(customerId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to list invoices' });
    }
    
    res.json({
      invoices: result.invoices,
      count: result.invoices?.length || 0
    });
  } catch (error: any) {
    console.error('[Stripe] Error listing invoices:', error);
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

router.post('/api/stripe/invoices', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { customerId, items, description } = req.body;
    
    if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Missing required fields: customerId, items (array)' });
    }
    
    const result = await createInvoice({
      customerId,
      items,
      description,
    });
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to create invoice' });
    }
    
    res.json({
      success: true,
      invoice: result.invoice
    });
  } catch (error: any) {
    console.error('[Stripe] Error creating invoice:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
});

router.post('/api/stripe/invoices/:invoiceId/finalize', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    const result = await finalizeAndSendInvoice(invoiceId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to finalize invoice' });
    }
    
    res.json({
      success: true,
      invoice: result.invoice
    });
  } catch (error: any) {
    console.error('[Stripe] Error finalizing invoice:', error);
    res.status(500).json({ error: 'Failed to finalize invoice' });
  }
});

router.get('/api/stripe/invoice/:invoiceId', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    const result = await getInvoice(invoiceId);
    
    if (!result.success) {
      return res.status(404).json({ error: result.error || 'Invoice not found' });
    }
    
    res.json({ invoice: result.invoice });
  } catch (error: any) {
    console.error('[Stripe] Error getting invoice:', error);
    res.status(500).json({ error: 'Failed to get invoice' });
  }
});

router.post('/api/stripe/invoices/:invoiceId/void', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { invoiceId } = req.params;
    
    const result = await voidInvoice(invoiceId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to void invoice' });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('[Stripe] Error voiding invoice:', error);
    res.status(500).json({ error: 'Failed to void invoice' });
  }
});

// Member-accessible endpoint to view their own invoices
router.get('/api/my-invoices', async (req: Request, res: Response) => {
  try {
    const sessionEmail = (req as any).user?.email;
    if (!sessionEmail) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    
    // Support "View As" feature: staff can pass user_email param to view as another member
    const requestedEmail = req.query.user_email as string | undefined;
    let targetEmail = sessionEmail;
    
    if (requestedEmail && requestedEmail.toLowerCase() !== sessionEmail.toLowerCase()) {
      const userRole = (req as any).user?.role;
      if (userRole === 'admin' || userRole === 'staff') {
        targetEmail = decodeURIComponent(requestedEmail);
      }
    }
    
    // Look up user's stripe customer ID
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE LOWER(email) = $1',
      [targetEmail.toLowerCase()]
    );
    
    const stripeCustomerId = userResult.rows[0]?.stripe_customer_id;
    
    if (!stripeCustomerId) {
      // No Stripe customer - return empty array
      return res.json({ invoices: [], count: 0 });
    }
    
    const result = await listCustomerInvoices(stripeCustomerId);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Failed to list invoices' });
    }
    
    console.log(`[Stripe] my-invoices for ${targetEmail}: found ${result.invoices?.length || 0} invoices`);
    
    res.json({
      invoices: result.invoices,
      count: result.invoices?.length || 0
    });
  } catch (error: any) {
    console.error('[Stripe] Error listing member invoices:', error);
    res.status(500).json({ error: 'Failed to list invoices' });
  }
});

router.post('/api/member/bookings/:id/pay-fees', async (req: Request, res: Response) => {
  try {
    const sessionEmail = (req as any).user?.email;
    if (!sessionEmail) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const bookingId = parseInt(req.params.id);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const bookingResult = await pool.query(
      `SELECT br.id, br.session_id, br.user_email, br.user_name, u.id as user_id
       FROM booking_requests br
       LEFT JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
       WHERE br.id = $1`,
      [bookingId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    if (booking.user_email?.toLowerCase() !== sessionEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the booking owner can pay fees' });
    }

    if (!booking.session_id) {
      return res.status(400).json({ error: 'Booking has no session' });
    }

    const pendingParticipants = await pool.query(
      `SELECT id, participant_type, display_name, cached_fee_cents
       FROM booking_participants
       WHERE session_id = $1 
         AND participant_type = 'guest'
         AND (payment_status = 'pending' OR payment_status IS NULL)`,
      [booking.session_id]
    );

    if (pendingParticipants.rows.length === 0) {
      return res.status(400).json({ error: 'No unpaid guest fees found' });
    }

    const participantIds = pendingParticipants.rows.map(r => r.id);
    const feeResult = await calculateAndCacheParticipantFees(booking.session_id, participantIds);

    if (!feeResult.success) {
      return res.status(500).json({ error: feeResult.error || 'Failed to calculate fees' });
    }

    if (feeResult.fees.length === 0) {
      return res.status(400).json({ error: 'No fees to charge' });
    }

    const serverTotal = feeResult.totalCents;

    if (serverTotal < 50) {
      return res.status(400).json({ error: 'Total amount must be at least $0.50' });
    }

    const serverFees = feeResult.fees.map(f => ({ id: f.participantId, amountCents: f.amountCents }));

    const client = await pool.connect();
    let snapshotId: number | null = null;
    try {
      await client.query('BEGIN');

      const snapshotResult = await client.query(
        `INSERT INTO booking_fee_snapshots (booking_id, session_id, participant_fees, total_cents, status)
         VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
        [bookingId, booking.session_id, JSON.stringify(serverFees), serverTotal]
      );
      snapshotId = snapshotResult.rows[0].id;

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const guestNames = pendingParticipants.rows.map(r => r.display_name).join(', ');
    const description = `Guest fees for: ${guestNames}`;

    const metadata: Record<string, string> = {
      feeSnapshotId: snapshotId!.toString(),
      participantFees: JSON.stringify(serverFees),
      memberPayment: 'true'
    };

    let result;
    try {
      result = await createPaymentIntent({
        userId: booking.user_id || booking.user_email,
        email: booking.user_email,
        memberName: booking.user_name || booking.user_email.split('@')[0],
        amountCents: serverTotal,
        purpose: 'guest_fee',
        bookingId,
        sessionId: booking.session_id,
        description,
        metadata
      });
    } catch (stripeErr) {
      if (snapshotId) {
        await pool.query(`DELETE FROM booking_fee_snapshots WHERE id = $1`, [snapshotId]);
      }
      throw stripeErr;
    }

    await pool.query(
      `UPDATE booking_fee_snapshots SET stripe_payment_intent_id = $1 WHERE id = $2`,
      [result.paymentIntentId, snapshotId]
    );

    console.log(`[Stripe] Member payment intent created for booking ${bookingId}: $${(serverTotal / 100).toFixed(2)}`);

    const participantFeesList = feeResult.fees.map(f => {
      const participant = pendingParticipants.rows.find(p => p.id === f.participantId);
      return {
        id: f.participantId,
        displayName: participant?.display_name || 'Guest',
        amount: f.amountCents / 100
      };
    });

    res.json({
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      totalAmount: serverTotal / 100,
      participantFees: participantFeesList
    });
  } catch (error: any) {
    console.error('[Stripe] Error creating member payment intent:', error);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

router.post('/api/member/bookings/:id/confirm-payment', async (req: Request, res: Response) => {
  try {
    const sessionEmail = (req as any).user?.email;
    if (!sessionEmail) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const bookingId = parseInt(req.params.id);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const { paymentIntentId } = req.body;
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const bookingResult = await pool.query(
      `SELECT br.id, br.session_id, br.user_email
       FROM booking_requests br
       WHERE br.id = $1`,
      [bookingId]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }

    const booking = bookingResult.rows[0];

    if (booking.user_email?.toLowerCase() !== sessionEmail.toLowerCase()) {
      return res.status(403).json({ error: 'Only the booking owner can confirm payment' });
    }

    const snapshotResult = await pool.query(
      `SELECT id, participant_fees, status
       FROM booking_fee_snapshots
       WHERE booking_id = $1 AND stripe_payment_intent_id = $2`,
      [bookingId, paymentIntentId]
    );

    if (snapshotResult.rows.length === 0) {
      return res.status(404).json({ error: 'Payment record not found' });
    }

    const snapshot = snapshotResult.rows[0];

    if (snapshot.status === 'completed') {
      return res.json({ success: true, message: 'Payment already confirmed' });
    }

    const confirmResult = await confirmPaymentSuccess(
      paymentIntentId,
      sessionEmail,
      booking.user_name || 'Member'
    );

    if (!confirmResult.success) {
      return res.status(400).json({ error: confirmResult.error || 'Payment verification failed' });
    }

    const participantFees = JSON.parse(snapshot.participant_fees || '[]');
    const participantIds = participantFees.map((pf: any) => pf.id);

    if (participantIds.length > 0) {
      await pool.query(
        `UPDATE booking_participants 
         SET payment_status = 'paid', updated_at = NOW()
         WHERE id = ANY($1::int[])`,
        [participantIds]
      );
    }

    await pool.query(
      `UPDATE booking_fee_snapshots SET status = 'completed' WHERE id = $1`,
      [snapshot.id]
    );

    console.log(`[Stripe] Member payment confirmed for booking ${bookingId}, ${participantIds.length} participants marked as paid`);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Stripe] Error confirming member payment:', error);
    res.status(500).json({ error: 'Failed to confirm payment' });
  }
});

router.get('/api/billing/members/search', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { query, includeInactive } = req.query;
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.json({ members: [] });
    }
    
    const searchTerm = query.trim().toLowerCase();
    
    let sql = `
      SELECT 
        id, email, first_name, last_name, 
        membership_tier, membership_status, 
        stripe_customer_id, hubspot_id
      FROM users 
      WHERE (
        LOWER(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE $1
        OR LOWER(COALESCE(first_name, '')) LIKE $1
        OR LOWER(COALESCE(last_name, '')) LIKE $1
        OR LOWER(COALESCE(email, '')) LIKE $1
      )
    `;
    
    if (includeInactive !== 'true') {
      sql += ` AND (membership_status = 'active' OR membership_status IS NULL)`;
    }
    
    sql += ` AND archived_at IS NULL ORDER BY first_name, last_name LIMIT 10`;
    
    const result = await pool.query(sql, [`%${searchTerm}%`]);
    
    const members = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      firstName: row.first_name,
      lastName: row.last_name,
      name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email?.split('@')[0] || 'Unknown',
      membershipTier: row.membership_tier,
      membershipStatus: row.membership_status,
      stripeCustomerId: row.stripe_customer_id,
      hubspotId: row.hubspot_id,
    }));
    
    res.json({ members });
  } catch (error: any) {
    console.error('[Billing] Error searching members:', error);
    res.status(500).json({ error: 'Failed to search members' });
  }
});

export default router;
