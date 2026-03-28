import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../../core/middleware';
import { paymentRateLimiter } from '../../middleware/rateLimiting';
import { validateBody } from '../../middleware/validate';
import { z } from 'zod';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getSessionUser } from '../../types/session';
import { alertOnExternalServiceError } from '../../core/errorAlerts';
import { getErrorMessage } from '../../utils/errorUtils';
import { logger, logAndRespond } from '../../core/logger';
import { getStripeDeclineMessage } from '../../core/billing/paymentTypes';
import { processPayFees, processConfirmPayment } from '../../core/billing/paymentProcessingService';

const kioskPayFeesSchema = z.object({
  memberId: z.string().min(1),
  useAccountBalance: z.boolean().optional(),
});

const kioskConfirmPaymentSchema = z.object({
  memberId: z.string().min(1),
  paymentIntentId: z.string().min(1),
});

const kioskCancelPaymentSchema = z.object({
  memberId: z.string().min(1),
  paymentIntentId: z.string().min(1),
});

const router = Router();

async function resolveKioskMember(memberId: string): Promise<{ email: string; userId: string; name: string } | null> {
  const result = await db.execute(sql`
    SELECT id, email, first_name, last_name FROM users WHERE id = ${memberId} LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  const row = result.rows[0] as { id: string; email: string; first_name: string | null; last_name: string | null };
  return {
    email: row.email,
    userId: String(row.id),
    name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email.split('@')[0],
  };
}

router.post('/api/kiosk/bookings/:id/pay-fees', isStaffOrAdmin, paymentRateLimiter, validateBody(kioskPayFeesSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { memberId } = req.body;
    const member = await resolveKioskMember(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const bookingId = parseInt(req.params.id as string, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    const result = await processPayFees({
      bookingId,
      memberEmail: member.email,
      useAccountBalance: req.body?.useAccountBalance === true,
      source: 'kiosk',
      staffEmail: sessionUser.email,
    });

    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    const stripeCode = (error as { code?: string })?.code;
    const stripeType = (error as { type?: string })?.type;
    const stripeDeclineCode = (error as { decline_code?: string })?.decline_code;
    const bookingIdForLog = parseInt(req.params.id as string, 10);
    if (isNaN(bookingIdForLog)) return res.status(400).json({ error: 'Invalid booking ID' });
    logger.error('[Kiosk Stripe] Error creating kiosk payment intent', { 
      extra: {
        error: errMsg,
        stripeCode,
        stripeType,
        stripeDeclineCode,
        bookingId: isNaN(bookingIdForLog) ? req.params.id : bookingIdForLog,
        endpoint: 'kiosk-pay-fees',
      }
    });
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'create kiosk payment intent');
    const friendlyMessage = getStripeDeclineMessage(error);
    const statusCode = friendlyMessage ? 402 : 500;
    logAndRespond(req, res, statusCode, friendlyMessage || 'Payment processing failed. Please try again.', error);
  }
});

router.post('/api/kiosk/bookings/:id/confirm-payment', isStaffOrAdmin, validateBody(kioskConfirmPaymentSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { memberId, paymentIntentId } = req.body;
    const member = await resolveKioskMember(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const bookingId = parseInt(req.params.id as string, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    if (!paymentIntentId) {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const result = await processConfirmPayment({
      bookingId,
      memberEmail: member.email,
      paymentIntentId,
      source: 'kiosk',
      staffEmail: sessionUser.email,
    });

    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    const stripeCode = (error as { code?: string })?.code;
    const stripeType = (error as { type?: string })?.type;
    const stripeDeclineCode = (error as { decline_code?: string })?.decline_code;
    const bookingIdForLog = parseInt(req.params.id as string, 10);
    if (isNaN(bookingIdForLog)) return res.status(400).json({ error: 'Invalid booking ID' });
    logger.error('[Kiosk Stripe] Error confirming kiosk payment', {
      extra: {
        error: errMsg,
        stripeCode,
        stripeType,
        stripeDeclineCode,
        bookingId: isNaN(bookingIdForLog) ? req.params.id : bookingIdForLog,
        paymentIntentId: req.body?.paymentIntentId,
        endpoint: 'kiosk-confirm-payment',
      }
    });
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'confirm kiosk payment');
    const friendlyMessage = getStripeDeclineMessage(error);
    const statusCode = friendlyMessage ? 402 : 500;
    logAndRespond(req, res, statusCode, friendlyMessage || 'Payment confirmation failed. Please try again.', error);
  }
});

router.post('/api/kiosk/bookings/:bookingId/cancel-payment', isStaffOrAdmin, validateBody(kioskCancelPaymentSchema), async (req: Request, res: Response) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser?.email) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { memberId, paymentIntentId } = req.body;
    const member = await resolveKioskMember(memberId);
    if (!member) {
      return res.status(404).json({ error: 'Member not found' });
    }
    const memberEmail = member.email;

    const bookingId = parseInt(req.params.bookingId as string, 10);
    if (isNaN(bookingId)) {
      return res.status(400).json({ error: 'Invalid booking ID' });
    }

    if (!paymentIntentId || typeof paymentIntentId !== 'string') {
      return res.status(400).json({ error: 'Missing paymentIntentId' });
    }

    const verification = await db.execute(sql`
      SELECT spi.id FROM stripe_payment_intents spi
       JOIN booking_requests br ON spi.booking_id = br.id
       WHERE spi.stripe_payment_intent_id = ${paymentIntentId} 
       AND spi.booking_id = ${bookingId}
       AND LOWER(br.user_email) = LOWER(${memberEmail})
       AND spi.status IN ('pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture')
    `);

    if (verification.rows.length === 0) {
      return res.status(404).json({ error: 'Payment intent not found or already processed' });
    }

    const { cancelPaymentIntent, getStripeClient } = await import('../../core/stripe');
    const result = await cancelPaymentIntent(paymentIntentId);

    if (result.success) {
      logger.info('[Kiosk Payment] Cancelled abandoned PI for booking via kiosk', { extra: { staffEmail: sessionUser.email, memberEmail, paymentIntentId, bookingId } });

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
                description: `Refund of account credit — cancelled kiosk payment for Booking #${bookingId}`,
              });
              logger.info('[Kiosk Payment] Restored account credit after cancelled payment', { extra: { bookingId, refundAmount, balanceTxnId } });
            }
          }
        }
      } catch (creditErr: unknown) {
        logger.warn('[Kiosk Payment] Failed to restore credit after payment cancellation', { extra: { bookingId, error: getErrorMessage(creditErr) } });
      }

      try {
        const { voidBookingInvoice, recreateDraftInvoiceFromBooking } = await import('../../core/billing/bookingInvoiceService');
        await voidBookingInvoice(bookingId);
        await recreateDraftInvoiceFromBooking(bookingId);
        logger.info('[Kiosk Payment] Voided invoice and re-created draft after abandoned payment', { extra: { bookingId } });
      } catch (invoiceErr: unknown) {
        logger.warn('[Kiosk Payment] Failed to void/recreate invoice after payment cancellation', { extra: { bookingId, error: getErrorMessage(invoiceErr) } });
      }
    }

    res.json({ success: result.success });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to cancel payment', error);
  }
});

export default router;
