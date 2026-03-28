import { Router, Request, Response } from 'express';
import { isAuthenticated } from '../../../core/middleware';
import { paymentRateLimiter } from '../../../middleware/rateLimiting';
import { validateBody } from '../../../middleware/validate';
import { z } from 'zod';
import { db } from '../../../db';
import { sql } from 'drizzle-orm';
import { getSessionUser } from '../../../types/session';
import { cancelPaymentIntent } from '../../../core/stripe';
import { alertOnExternalServiceError } from '../../../core/errorAlerts';
import { getErrorMessage } from '../../../utils/errorUtils';
import { logger, logAndRespond } from '../../../core/logger';
import { getStripeDeclineMessage } from '../../../core/billing/paymentTypes';
import { processPayFees, processConfirmPayment } from '../../../core/billing/paymentProcessingService';

const payFeesSchema = z.object({
  useAccountBalance: z.boolean().optional(),
});

const confirmPaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
});

const cancelPaymentSchema = z.object({
  paymentIntentId: z.string().min(1),
});

const router = Router();

router.post('/api/member/bookings/:id/pay-fees', isAuthenticated, paymentRateLimiter, validateBody(payFeesSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    const sessionEmail = sessionUser?.email;
    if (!sessionEmail) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const bookingId = parseInt(req.params.id as string, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const result = await processPayFees({
      bookingId,
      memberEmail: sessionEmail,
      useAccountBalance: req.body?.useAccountBalance === true,
      source: 'member',
    });

    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    const stripeCode = (error as { code?: string })?.code;
    const stripeType = (error as { type?: string })?.type;
    const stripeDeclineCode = (error as { decline_code?: string })?.decline_code;
    const bookingIdForLog = parseInt(req.params.id as string, 10);
    if (isNaN(bookingIdForLog)) return res.status(400).json({ error: 'Invalid booking ID' });
    logger.error('[Stripe] Error creating member payment intent', { 
      error: errMsg,
      extra: {
        stripeCode,
        stripeType,
        stripeDeclineCode,
        message: errMsg,
        bookingId: isNaN(bookingIdForLog) ? req.params.id : bookingIdForLog,
        endpoint: 'pay-fees',
      }
    });
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(String(error)), 'create member payment intent');
    const friendlyMessage = getStripeDeclineMessage(error);
    const statusCode = friendlyMessage ? 402 : 500;
    logAndRespond(req, res, statusCode, friendlyMessage || 'Payment processing failed. Please try again.', error);
  }
});

router.post('/api/member/bookings/:id/confirm-payment', isAuthenticated, validateBody(confirmPaymentSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    const sessionEmail = sessionUser?.email;
    if (!sessionEmail) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const bookingId = parseInt(req.params.id as string, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const { paymentIntentId } = req.body;
    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const result = await processConfirmPayment({
      bookingId,
      memberEmail: sessionEmail,
      paymentIntentId,
      source: 'member',
    });

    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    const stripeCode = (error as { code?: string })?.code;
    const stripeType = (error as { type?: string })?.type;
    const stripeDeclineCode = (error as { decline_code?: string })?.decline_code;
    const bookingIdForLog = parseInt(req.params.id as string, 10);
    if (isNaN(bookingIdForLog)) return res.status(400).json({ error: 'Invalid booking ID' });
    logger.error('[Stripe] Error confirming member payment', {
      error: errMsg,
      extra: {
        stripeCode,
        stripeType,
        stripeDeclineCode,
        message: errMsg,
        bookingId: isNaN(bookingIdForLog) ? req.params.id : bookingIdForLog,
        paymentIntentId: req.body?.paymentIntentId,
        endpoint: 'confirm-payment',
      }
    });
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(String(error)), 'confirm member payment');
    const friendlyMessage = getStripeDeclineMessage(error);
    const statusCode = friendlyMessage ? 402 : 500;
    logAndRespond(req, res, statusCode, friendlyMessage || 'Payment confirmation failed. Please try again.', error);
  }
});

router.post('/api/member/bookings/:bookingId/cancel-payment', isAuthenticated, validateBody(cancelPaymentSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const bookingId = parseInt(req.params.bookingId as string, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }
    const { paymentIntentId } = req.body;

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const verification = await db.execute(sql`
      SELECT spi.id FROM stripe_payment_intents spi
       JOIN booking_requests br ON spi.booking_id = br.id
       WHERE spi.stripe_payment_intent_id = ${paymentIntentId} 
       AND spi.booking_id = ${bookingId}
       AND br.user_email = ${sessionUser.email.toLowerCase()}
       AND spi.status IN ('pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture')
    `);

    if (verification.rows.length === 0) {
      return res.status(404).json({ error: 'Payment intent not found or already processed' });
    }

    const { getStripeClient } = await import('../../../core/stripe');
    const result = await cancelPaymentIntent(paymentIntentId);

    if (result.success) {
      logger.info('[Member Payment] User cancelled abandoned PI for booking', { extra: { sessionUserEmail: sessionUser.email, paymentIntentId, bookingId } });

      try {
        const stripe = await getStripeClient();
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
        const balanceTxnId = pi.metadata?.balanceTransactionId;
        if (balanceTxnId) {
          const custId = pi.customer as string;
          if (custId) {
            const balanceTxn = await stripe.customers.retrieveBalanceTransaction(custId, balanceTxnId);
            const refundAmount = balanceTxn.amount;
            if (refundAmount > 0) {
              await stripe.customers.createBalanceTransaction(custId, {
                amount: -refundAmount,
                currency: 'usd',
                description: `Refund of account credit — cancelled payment for Booking #${bookingId}`,
              });
              logger.info('[Member Payment] Restored account credit after cancelled payment', { extra: { bookingId, refundAmount, balanceTxnId } });
            }
          }
        }
      } catch (creditErr: unknown) {
        logger.warn('[Member Payment] Failed to restore credit after payment cancellation', { extra: { bookingId, error: String(creditErr) } });
      }

      try {
        const { voidBookingInvoice, recreateDraftInvoiceFromBooking } = await import('../../../core/billing/bookingInvoiceService');
        await voidBookingInvoice(bookingId);
        await recreateDraftInvoiceFromBooking(bookingId);
        logger.info('[Member Payment] Voided invoice and re-created draft after abandoned payment', { extra: { bookingId } });
      } catch (invoiceErr: unknown) {
        logger.warn('[Member Payment] Failed to void/recreate invoice after payment cancellation', { extra: { bookingId, error: String(invoiceErr) } });
      }
    }

    res.json({ success: result.success });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to cancel payment', error);
  }
});

export default router;
