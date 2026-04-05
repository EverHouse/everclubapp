import { logger } from '../../core/logger';
import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { isStaffOrAdmin } from '../../core/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getStripeClient } from '../../core/stripe/client';
import {
  cancelPaymentIntent,
} from '../../core/stripe';
import {
  getPaymentByIntentId,
  updatePaymentStatus,
  updatePaymentStatusAndAmount
} from '../../core/stripe/paymentRepository';
import { logFromRequest, logBillingAudit } from '../../core/auditLog';
import { getStaffInfo, MAX_RETRY_ATTEMPTS } from './helpers';
import { broadcastBillingUpdate, sendNotificationToUser } from '../../core/websocket';
import { alertOnExternalServiceError } from '../../core/errorAlerts';
import { getErrorMessage, getErrorCode } from '../../utils/errorUtils';
import { validateBody } from '../../middleware/validate';
import {
  adjustGuestPassesSchema,
  addPaymentNoteSchema,
  retryPaymentSchema,
  cancelPaymentSchema,
  refundPaymentSchema,
  capturePaymentSchema,
  voidAuthorizationSchema,
} from '../../../shared/validators/paymentAdmin';
import { recalculateSessionFees } from '../../core/billing/unifiedFeeService';

interface DbLedgerRow {
  id: number;
  member_id: string;
  overage_fee: string;
  guest_fee: string;
  minutes_charged: number;
  stripe_payment_intent_id: string;
}

interface _StripeError extends Error {
  type?: string;
  decline_code?: string;
  code?: string;
}

const router = Router();

router.post('/api/stripe/cleanup-stale-intents', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const staleIntents = await db.execute(sql`SELECT spi.stripe_payment_intent_id, spi.id as local_id, br.status as booking_status
       FROM stripe_payment_intents spi
       LEFT JOIN booking_requests br ON spi.booking_id = br.id
       WHERE spi.status IN ('pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture')
       AND (br.status = 'cancelled' OR br.id IS NULL)`);
    
    const results: { id: string; success: boolean; error?: string }[] = [];
    
    const { staffEmail, staffName } = getStaffInfo(req);

    for (const row of staleIntents.rows as Array<{ stripe_payment_intent_id: string; local_id: number; booking_status: string }>) {
      try {
        await cancelPaymentIntent(row.stripe_payment_intent_id as string);
        results.push({ id: row.stripe_payment_intent_id as string, success: true });
        logger.info('[Cleanup] Cancelled stale payment intent', { extra: { rowStripe_payment_intent_id: row.stripe_payment_intent_id } });

        try {
          await logBillingAudit({
            memberEmail: 'system',
            actionType: 'cancel_stale_intent',
            actionDetails: {
              stripePaymentIntentId: row.stripe_payment_intent_id,
              localId: row.local_id,
              bookingStatus: row.booking_status,
            },
            previousValue: 'stale',
            newValue: 'cancelled',
            performedBy: staffEmail,
            performedByName: staffName,
          });
        } catch (auditErr: unknown) {
          logger.warn('[Cleanup] Failed to write audit log for cancelled intent', { extra: { stripe_payment_intent_id: row.stripe_payment_intent_id, error: getErrorMessage(auditErr) } });
        }
      } catch (err: unknown) {
        results.push({ id: row.stripe_payment_intent_id as string, success: false, error: getErrorMessage(err) });
        logger.error('[Cleanup] Failed to cancel', { extra: { stripe_payment_intent_id: row.stripe_payment_intent_id, error: getErrorMessage(err) } });
      }
    }

    const cancelledCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    try {
      await logFromRequest(req, 'cancel_orphaned_pi', 'payment_intent', undefined, undefined, {
        processed: results.length,
        cancelled: cancelledCount,
        failed: failedCount,
        intentIds: results.filter(r => r.success).map(r => r.id),
      });
    } catch (auditErr: unknown) {
      logger.warn('[Cleanup] Failed to write summary audit log', { extra: { error: getErrorMessage(auditErr) } });
    }
    
    res.json({ 
      success: true, 
      processed: results.length,
      cancelled: cancelledCount,
      failed: failedCount,
      details: results 
    });
  } catch (error: unknown) {
    logger.error('[Stripe] Error cleaning up stale intents', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to cleanup stale intents' });
  }
});

router.post('/api/payments/adjust-guest-passes', isStaffOrAdmin, validateBody(adjustGuestPassesSchema), async (req: Request, res: Response) => {
  try {
    const { memberId, memberEmail: rawEmail, memberName, adjustment, reason } = req.body;
    const memberEmail = rawEmail?.trim()?.toLowerCase();
    const { staffEmail, staffName } = getStaffInfo(req);

    const existingResult = await db.execute(sql`SELECT id, passes_used, passes_total FROM guest_passes WHERE LOWER(member_email) = ${memberEmail.toLowerCase()}`);

    let previousCount = 0;
    let newCount = 0;
    let passesUsed = 0;

    if (existingResult.rows.length === 0) {
      newCount = Math.max(0, adjustment);
      await db.execute(sql`INSERT INTO guest_passes (member_email, passes_used, passes_total) VALUES (${memberEmail.toLowerCase()}, 0, ${newCount})`);
      logger.info('[GuestPasses] Created new record for with passes', { extra: { memberEmail, newCount } });
    } else {
      const current = existingResult.rows[0] as { id: number; passes_used: number; passes_total: number };
      previousCount = (current.passes_total as number) || 0;
      passesUsed = (current.passes_used as number) || 0;
      newCount = Math.max(0, previousCount + adjustment);

      await db.execute(sql`UPDATE guest_passes SET passes_total = ${newCount} WHERE id = ${current.id}`);
      logger.info('[GuestPasses] Updated : -> ()', { extra: { memberEmail, previousCount, newCount, adjustment_0: adjustment > 0 ? '+' : '', adjustment } });
    }

    await logBillingAudit({
      memberEmail,
      actionType: 'guest_pass_adjustment',
      actionDetails: {
        adjustment,
        reason,
        previousCount,
        newCount,
        memberId: memberId || null,
        memberName: memberName || null
      },
      previousValue: previousCount.toString(),
      newValue: newCount.toString(),
      performedBy: staffEmail,
      performedByName: staffName
    });

    res.json({ 
      success: true, 
      previousCount,
      newCount,
      remaining: newCount - passesUsed
    });
  } catch (error: unknown) {
    logger.error('[GuestPasses] Error adjusting guest passes', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to adjust guest passes' });
  }
});

router.post('/api/payments/add-note', isStaffOrAdmin, validateBody(addPaymentNoteSchema), async (req: Request, res: Response) => {
  try {
    const { transactionId, note, performedBy, performedByName } = req.body;

    const { staffEmail, staffName } = getStaffInfo(req);
    const finalPerformedBy = performedBy || staffEmail;
    const finalPerformedByName = performedByName || staffName;

    const piResult = await db.execute(sql`SELECT u.email as member_email 
       FROM stripe_payment_intents spi
       LEFT JOIN users u ON (u.id = spi.user_id OR LOWER(u.email) = LOWER(spi.user_id))
       WHERE spi.stripe_payment_intent_id = ${transactionId}`);

    let memberEmail = 'unknown';
    if (piResult.rows.length > 0 && piResult.rows[0].member_email) {
      memberEmail = (piResult.rows[0] as { member_email: string }).member_email;
    }

    await logBillingAudit({
      memberEmail,
      actionType: 'payment_note_added',
      actionDetails: { paymentIntentId: transactionId, note },
      newValue: note,
      performedBy: finalPerformedBy,
      performedByName: finalPerformedByName
    });

    logger.info('[Payments] Note added to transaction by', { extra: { transactionId, finalPerformedByName } });
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('[Payments] Error adding note', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to add note' });
  }
});

router.get('/api/payments/:paymentIntentId/notes', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.params;

    const result = await db.execute(sql`SELECT id, details->>'note' as note, staff_name as performed_by_name, created_at
       FROM admin_audit_log
       WHERE resource_type = 'billing'
         AND action = 'payment_note_added'
         AND details->>'paymentIntentId' = ${paymentIntentId}
       ORDER BY created_at DESC`);

    const notes = (result.rows as Array<{ id: number; note: string; performed_by_name: string; created_at: string }>).map((row) => ({
      id: row.id,
      note: row.note,
      performedByName: row.performed_by_name,
      createdAt: row.created_at
    }));

    res.json({ notes });
  } catch (error: unknown) {
    logger.error('[Payments] Error fetching notes', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

router.post('/api/payments/retry', isStaffOrAdmin, validateBody(retryPaymentSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;
    const { staffEmail, staffName } = getStaffInfo(req);

    const payment = await getPaymentByIntentId(paymentIntentId);

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    const retryResult = await db.execute(sql`SELECT retry_count, requires_card_update FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${paymentIntentId}`);
    
    const currentRetryCount = (retryResult.rows[0] as { retry_count: number; requires_card_update: boolean })?.retry_count || 0;
    const requiresCardUpdate = (retryResult.rows[0] as { retry_count: number; requires_card_update: boolean })?.requires_card_update || false;

    if (requiresCardUpdate) {
      return res.status(400).json({ 
        error: 'This payment has reached the maximum retry limit. The member needs to update their payment method.',
        requiresCardUpdate: true,
        retryCount: currentRetryCount
      });
    }

    if (currentRetryCount >= MAX_RETRY_ATTEMPTS) {
      return res.status(400).json({ 
        error: `Maximum retry limit (${MAX_RETRY_ATTEMPTS}) reached. Member must update their card.`,
        requiresCardUpdate: true,
        retryCount: currentRetryCount
      });
    }

    if (!paymentIntentId.startsWith('pi_')) {
      logger.warn('[Payments] Retry called with synthetic PI — marking as canceled', { extra: { paymentIntentId } });
      await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${paymentIntentId}`);
      return res.status(400).json({ error: 'This payment record has an invalid payment ID and cannot be retried. Please create a new charge.' });
    }

    const stripe = await getStripeClient();

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, { expand: ['invoice'] });
    
    if (paymentIntent.status === 'succeeded') {
      await updatePaymentStatus(paymentIntentId, 'succeeded');
      return res.json({ 
        success: true, 
        message: 'Payment was already successful',
        status: 'succeeded'
      });
    }

    if (!['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(paymentIntent.status)) {
      return res.status(400).json({ 
        error: `Cannot retry payment with status: ${paymentIntent.status}` 
      });
    }

    const piInvoice = (paymentIntent as unknown as Record<string, unknown>).invoice;
    let invoiceId: string | null = null;
    if (piInvoice) {
      invoiceId = typeof piInvoice === 'string' ? piInvoice : (piInvoice as { id?: string })?.id || null;
    }
    if (!invoiceId && payment.bookingId) {
      const { getBookingInvoiceId } = await import('../../core/billing/bookingInvoiceService');
      invoiceId = await getBookingInvoiceId(payment.bookingId);
    }

    let retrySucceeded = false;
    let retryStatus = '';
    let retryFailureReason = '';

    if (invoiceId) {
      logger.info('[Payments] Retrying invoice-generated PI via invoices.pay()', { extra: { paymentIntentId, invoiceId } });
      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.status === 'paid') {
        await updatePaymentStatus(paymentIntentId, 'succeeded');
        return res.json({ success: true, message: 'Invoice already paid', status: 'succeeded' });
      }
      if (invoice.status !== 'open') {
        return res.status(400).json({ error: `Invoice is ${invoice.status}, cannot retry payment` });
      }
      const paidInvoice = await stripe.invoices.pay(invoiceId);
      retrySucceeded = paidInvoice.status === 'paid';
      if (retrySucceeded) {
        retryStatus = 'succeeded';
        retryFailureReason = '';
      } else {
        retryStatus = 'requires_payment_method';
        retryFailureReason = `Invoice retry failed (invoice status: ${paidInvoice.status})`;
      }
    } else {
      const confirmedIntent = await stripe.paymentIntents.confirm(paymentIntentId);
      retrySucceeded = confirmedIntent.status === 'succeeded';
      retryStatus = confirmedIntent.status;
      retryFailureReason = confirmedIntent.last_payment_error?.message || `Status: ${confirmedIntent.status}`;
    }

    const newRetryCount = currentRetryCount + 1;
    const nowReachesLimit = newRetryCount >= MAX_RETRY_ATTEMPTS;

    if (retrySucceeded) {
      await db.execute(sql`UPDATE stripe_payment_intents 
         SET status = 'succeeded', 
             updated_at = NOW(),
             retry_count = ${newRetryCount},
             last_retry_at = NOW(),
             requires_card_update = FALSE
         WHERE stripe_payment_intent_id = ${paymentIntentId}`);

      await logBillingAudit({
        memberEmail: payment.member_email || 'unknown',
        actionType: 'payment_retry_succeeded',
        actionDetails: {
          paymentIntentId,
          retryAttempt: newRetryCount,
          amount: payment.amount_cents,
          viaInvoice: !!invoiceId
        },
        newValue: `Retry #${newRetryCount} succeeded: $${(payment.amount_cents / 100).toFixed(2)}`,
        performedBy: staffEmail,
        performedByName: staffName
      });

      await logFromRequest(req, {
        action: 'payment_retry',
        resourceType: 'payment',
        resourceId: paymentIntentId,
        resourceName: payment.member_email || undefined,
        details: {
          paymentIntentId,
          retryAttempt: newRetryCount,
          amountCents: payment.amount_cents,
          result: 'succeeded',
          viaInvoice: !!invoiceId,
        }
      });

      logger.info('[Payments] Retry # succeeded for', { extra: { newRetryCount, paymentIntentId, viaInvoice: !!invoiceId } });

      res.json({
        success: true,
        status: 'succeeded',
        retryCount: newRetryCount,
        message: 'Payment retry successful'
      });
    } else {
      await db.execute(sql`UPDATE stripe_payment_intents 
         SET status = ${retryStatus}, 
             updated_at = NOW(),
             retry_count = ${newRetryCount},
             last_retry_at = NOW(),
             failure_reason = ${retryFailureReason},
             requires_card_update = ${nowReachesLimit}
         WHERE stripe_payment_intent_id = ${paymentIntentId}`);

      await logBillingAudit({
        memberEmail: payment.member_email || 'unknown',
        actionType: 'payment_retry_failed',
        actionDetails: {
          paymentIntentId,
          retryAttempt: newRetryCount,
          newStatus: retryStatus,
          reachedLimit: nowReachesLimit,
          viaInvoice: !!invoiceId
        },
        newValue: `Retry #${newRetryCount} failed: ${retryStatus}${nowReachesLimit ? ' (limit reached)' : ''}`,
        performedBy: staffEmail,
        performedByName: staffName
      });

      await logFromRequest(req, {
        action: 'payment_retry',
        resourceType: 'payment',
        resourceId: paymentIntentId,
        resourceName: payment.member_email || undefined,
        details: {
          paymentIntentId,
          retryAttempt: newRetryCount,
          amountCents: payment.amount_cents,
          result: 'failed',
          newStatus: retryStatus,
          reachedLimit: nowReachesLimit,
          viaInvoice: !!invoiceId,
        }
      });

      logger.info('[Payments] Retry # failed for', { extra: { newRetryCount, paymentIntentId, retryStatus } });

      res.status(422).json({
        success: false,
        status: retryStatus,
        retryCount: newRetryCount,
        requiresCardUpdate: nowReachesLimit,
        message: nowReachesLimit 
          ? 'Maximum retry attempts reached. Member must update their payment method.'
          : `Payment requires further action: ${retryStatus}`
      });
    }
  } catch (error: unknown) {
    logger.error('[Payments] Error retrying payment', { extra: { error: getErrorMessage(error) } });
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'retry payment');
    res.status(500).json({ 
      error: 'Payment retry failed. Please try again.',
      retryable: true
    });
  }
});

router.post('/api/payments/cancel', isStaffOrAdmin, validateBody(cancelPaymentSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;
    const { staffEmail, staffName } = getStaffInfo(req);

    const payment = await getPaymentByIntentId(paymentIntentId);

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    if (payment.status === 'succeeded') {
      return res.status(400).json({ error: 'Cannot cancel a succeeded payment. Use refund instead.' });
    }

    if (payment.status === 'canceled') {
      return res.json({ success: true, message: 'Payment was already canceled' });
    }

    const cancelResult = await cancelPaymentIntent(paymentIntentId);
    if (!cancelResult.success && cancelResult.error) {
      logger.warn('[Payments] cancelPaymentIntent returned error during staff cancel', { extra: { paymentIntentId, error: cancelResult.error } });
    }

    await logBillingAudit({
      memberEmail: payment.member_email || 'unknown',
      actionType: 'payment_canceled',
      actionDetails: {
        paymentIntentId,
        amount: payment.amountCents,
        description: payment.description
      },
      newValue: `Canceled payment: $${(payment.amountCents / 100).toFixed(2)}`,
      performedBy: staffEmail,
      performedByName: staffName
    });

    await logFromRequest(req, {
      action: 'cancel_payment',
      resourceType: 'billing',
      resourceId: paymentIntentId,
      resourceName: `$${(payment.amountCents / 100).toFixed(2)} - ${payment.description || 'Payment'}`,
      details: { memberEmail: payment.member_email }
    });

    logger.info('[Payments] Payment canceled by', { extra: { paymentIntentId, staffEmail } });

    res.json({ success: true, message: 'Payment canceled successfully' });
  } catch (error: unknown) {
    logger.error('[Payments] Error canceling payment', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to cancel payment' });
  }
});

router.get('/api/payments/:paymentIntentId/details', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.params;

    const payment = await getPaymentByIntentId(paymentIntentId);

    if (!payment) {
      const cacheResult = await db.execute(sql`
        SELECT stc.stripe_id, stc.payment_intent_id, stc.amount_cents, stc.status,
               COALESCE(stc.description, 'Stripe payment') as description,
               COALESCE(stc.customer_email, 'Unknown') as customer_email,
               COALESCE(stc.customer_name,
                 NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
                 stc.customer_email, 'Unknown') as customer_name,
               stc.created_at, stc.object_type
        FROM stripe_transaction_cache stc
        LEFT JOIN users u ON LOWER(u.email) = LOWER(stc.customer_email)
        WHERE stc.stripe_id = ${paymentIntentId}
           OR stc.payment_intent_id = ${paymentIntentId}
        LIMIT 1
      `);

      if (cacheResult.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }

      const cached = cacheResult.rows[0] as {
        stripe_id: string; payment_intent_id: string | null; amount_cents: number;
        status: string; description: string; customer_email: string; customer_name: string;
        created_at: string; object_type: string;
      };

      const resolvedPiId = cached.payment_intent_id || cached.stripe_id;
      let paymentMethodLabel = 'Unknown';
      let paymentMethodBrand = '';
      let paymentMethodLast4 = '';
      let receiptUrl: string | null = null;
      let chargeSource = cached.object_type === 'invoice' ? 'Invoice' : 'Stripe Payment';
      const refundHistory: Array<{ id: string; amount: number; reason: string | null; status: string; createdAt: number; processedBy: string | null }> = [];
      let totalRefunded = 0;

      const stripe = await getStripeClient();

      if (resolvedPiId.startsWith('pi_')) {
        try {
          const stripePI = await stripe.paymentIntents.retrieve(resolvedPiId, {
            expand: ['latest_charge', 'latest_charge.refunds']
          });
          const charge = stripePI.latest_charge as Stripe.Charge | null;
          if (charge) {
            receiptUrl = charge.receipt_url || null;
            const pm = charge.payment_method_details;
            if (pm?.card) {
              paymentMethodBrand = pm.card.brand || '';
              paymentMethodLast4 = pm.card.last4 || '';
              const wallet = pm.card.wallet?.type;
              if (wallet === 'apple_pay') paymentMethodLabel = 'Apple Pay';
              else if (wallet === 'google_pay') paymentMethodLabel = 'Google Pay';
              else paymentMethodLabel = `${paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1)} ending in ${paymentMethodLast4}`;
            } else if (pm?.card_present) {
              paymentMethodBrand = pm.card_present.brand || '';
              paymentMethodLast4 = pm.card_present.last4 || '';
              paymentMethodLabel = `Terminal — ${paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1)} ending in ${paymentMethodLast4}`;
            } else if (pm?.type) {
              paymentMethodLabel = pm.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
            if (charge.refunds?.data) {
              for (const r of charge.refunds.data) {
                refundHistory.push({ id: r.id, amount: r.amount, reason: r.reason, status: r.status || 'unknown', createdAt: r.created, processedBy: null });
              }
            }
          }
          const metadata = stripePI.metadata || {};
          if (metadata.source) {
            chargeSource = metadata.source.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
        } catch (stripeErr: unknown) {
          logger.warn('[Payments] Could not retrieve Stripe details for cached transaction', { extra: { resolvedPiId, error: getErrorMessage(stripeErr) } });
        }
      } else if (resolvedPiId.startsWith('ch_')) {
        try {
          const charge = await stripe.charges.retrieve(resolvedPiId, { expand: ['refunds'] });
          receiptUrl = charge.receipt_url || null;
          const pm = charge.payment_method_details;
          if (pm?.card) {
            paymentMethodBrand = pm.card.brand || '';
            paymentMethodLast4 = pm.card.last4 || '';
            paymentMethodLabel = `${paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1)} ending in ${paymentMethodLast4}`;
          } else if (pm?.type) {
            paymentMethodLabel = pm.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }
          if (charge.refunds?.data) {
            for (const r of charge.refunds.data) {
              refundHistory.push({ id: r.id, amount: r.amount, reason: r.reason, status: r.status || 'unknown', createdAt: r.created, processedBy: null });
            }
          }
        } catch (stripeErr: unknown) {
          logger.warn('[Payments] Could not retrieve Stripe charge details for cached transaction', { extra: { resolvedPiId, error: getErrorMessage(stripeErr) } });
        }
      } else if (resolvedPiId.startsWith('in_')) {
        try {
          const invoice = await stripe.invoices.retrieve(resolvedPiId);
          chargeSource = 'Invoice';
          if (invoice.charge && typeof invoice.charge === 'string') {
            const charge = await stripe.charges.retrieve(invoice.charge, { expand: ['refunds'] });
            receiptUrl = charge.receipt_url || null;
            const pm = charge.payment_method_details;
            if (pm?.card) {
              paymentMethodBrand = pm.card.brand || '';
              paymentMethodLast4 = pm.card.last4 || '';
              paymentMethodLabel = `${paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1)} ending in ${paymentMethodLast4}`;
            }
            if (charge.refunds?.data) {
              for (const r of charge.refunds.data) {
                refundHistory.push({ id: r.id, amount: r.amount, reason: r.reason, status: r.status || 'unknown', createdAt: r.created, processedBy: null });
              }
            }
          }
        } catch (stripeErr: unknown) {
          logger.warn('[Payments] Could not retrieve Stripe invoice details for cached transaction', { extra: { resolvedPiId, error: getErrorMessage(stripeErr) } });
        }
      }

      totalRefunded = refundHistory.reduce((sum, r) => sum + r.amount, 0);
      const refundableAmount = Math.max(0, cached.amount_cents - totalRefunded);

      return res.json({
        id: cached.stripe_id,
        amount: cached.amount_cents,
        status: cached.status,
        description: cached.description,
        purpose: cached.object_type,
        createdAt: cached.created_at,
        memberEmail: cached.customer_email,
        memberName: cached.customer_name,
        paymentMethod: paymentMethodLabel,
        paymentMethodBrand,
        paymentMethodLast4,
        chargeSource,
        receiptUrl,
        stripeUrl: resolvedPiId.startsWith('in_')
          ? `https://dashboard.stripe.com/invoices/${resolvedPiId}`
          : `https://dashboard.stripe.com/payments/${resolvedPiId}`,
        bookingInfo: null,
        refundHistory,
        totalRefunded,
        refundableAmount,
        sourceType: 'cache',
      });
    }

    const stripe = await getStripeClient();

    let stripePI: Stripe.PaymentIntent | null = null;
    let paymentMethodLabel = 'Unknown';
    let paymentMethodBrand = '';
    let paymentMethodLast4 = '';
    let receiptUrl: string | null = null;
    let chargeSource = 'Unknown';

    try {
      stripePI = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge', 'latest_charge.refunds']
      });

      const charge = stripePI.latest_charge as Stripe.Charge | null;
      if (charge) {
        receiptUrl = charge.receipt_url || null;

        const pm = charge.payment_method_details;
        if (pm?.card) {
          paymentMethodBrand = pm.card.brand || '';
          paymentMethodLast4 = pm.card.last4 || '';
          const wallet = pm.card.wallet?.type;
          if (wallet === 'apple_pay') {
            paymentMethodLabel = 'Apple Pay';
          } else if (wallet === 'google_pay') {
            paymentMethodLabel = 'Google Pay';
          } else {
            const brandName = paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1);
            paymentMethodLabel = `${brandName} ending in ${paymentMethodLast4}`;
          }
        } else if (pm?.card_present) {
          paymentMethodBrand = pm.card_present.brand || '';
          paymentMethodLast4 = pm.card_present.last4 || '';
          const brandName = paymentMethodBrand.charAt(0).toUpperCase() + paymentMethodBrand.slice(1);
          paymentMethodLabel = `Terminal — ${brandName} ending in ${paymentMethodLast4}`;
        } else if (pm?.type === 'us_bank_account') {
          paymentMethodLabel = 'Bank Transfer';
        } else if (pm?.type) {
          paymentMethodLabel = pm.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        }
      }

      const metadata = stripePI.metadata || {};
      if (metadata.source === 'pos_register' || metadata.source === 'pos') {
        chargeSource = 'POS Register';
      } else if (metadata.source === 'online_checkout' || metadata.source === 'online') {
        chargeSource = 'Online Checkout';
      } else if (metadata.source === 'staff_charge' || metadata.source === 'staff') {
        chargeSource = 'Staff Charge';
      } else if (metadata.source === 'terminal') {
        chargeSource = 'Terminal';
      } else if (metadata.source === 'kiosk') {
        chargeSource = 'Kiosk';
      } else {
        const purpose = payment.purpose;
        if (purpose === 'subscription' || purpose === 'membership') {
          chargeSource = 'Subscription';
        } else if (purpose === 'booking_fee' || purpose === 'overage' || purpose === 'guest_fee') {
          chargeSource = 'Booking Fee';
        } else if (purpose === 'merch' || purpose === 'merchandise') {
          chargeSource = 'Merchandise';
        } else {
          chargeSource = purpose ? purpose.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : 'Unknown';
        }
      }
    } catch (stripeErr: unknown) {
      logger.warn('[Payments] Could not retrieve Stripe PaymentIntent details', { extra: { paymentIntentId, error: getErrorMessage(stripeErr) } });
    }

    let bookingInfo: { bookingId: number; date: string; resourceName: string; startTime: string; endTime: string } | null = null;
    if (payment.bookingId) {
      try {
        const bookingResult = await db.execute(sql`
          SELECT br.id, br.booking_date, r.name as resource_name, br.start_time, br.end_time
          FROM booking_requests br
          LEFT JOIN resources r ON r.id = br.resource_id
          WHERE br.id = ${payment.bookingId}
          LIMIT 1
        `);
        if (bookingResult.rows.length > 0) {
          const row = bookingResult.rows[0] as { id: number; booking_date: string; resource_name: string; start_time: string; end_time: string };
          bookingInfo = {
            bookingId: row.id,
            date: row.booking_date,
            resourceName: row.resource_name || 'Unknown',
            startTime: row.start_time,
            endTime: row.end_time,
          };
        }
      } catch (bookingErr: unknown) {
        logger.warn('[Payments] Could not retrieve linked booking info', { extra: { bookingId: payment.bookingId, error: getErrorMessage(bookingErr) } });
      }
    }

    const refundHistory: Array<{ id: string; amount: number; reason: string | null; status: string; createdAt: number; processedBy: string | null }> = [];
    try {
      const charge = stripePI?.latest_charge as Stripe.Charge | null;
      if (charge?.refunds?.data) {
        for (const r of charge.refunds.data) {
          refundHistory.push({
            id: r.id,
            amount: r.amount,
            reason: r.reason,
            status: r.status || 'unknown',
            createdAt: r.created,
            processedBy: null,
          });
        }
      }

      if (refundHistory.length > 0) {
        const auditResult = await db.execute(sql`
          SELECT details->>'refundId' as refund_id, staff_name as performed_by_name
          FROM admin_audit_log
          WHERE resource_type = 'billing'
            AND action = 'payment_refunded'
            AND details->>'paymentIntentId' = ${paymentIntentId}
          ORDER BY created_at DESC
        `);
        const auditMap = new Map<string, string>();
        for (const row of auditResult.rows as Array<{ refund_id: string; performed_by_name: string }>) {
          if (row.refund_id) auditMap.set(row.refund_id, row.performed_by_name);
        }
        for (const r of refundHistory) {
          r.processedBy = auditMap.get(r.id) || null;
        }
      }
    } catch (auditErr: unknown) {
      logger.warn('[Payments] Could not retrieve refund audit history', { extra: { paymentIntentId, error: getErrorMessage(auditErr) } });
    }

    const totalRefunded = refundHistory.reduce((sum, r) => sum + r.amount, 0);
    const refundableAmount = payment.amountCents - totalRefunded;

    res.json({
      id: payment.stripePaymentIntentId,
      amount: payment.amountCents,
      status: payment.status,
      description: payment.description,
      purpose: payment.purpose,
      createdAt: payment.createdAt,
      memberEmail: payment.memberEmail || payment.member_email,
      memberName: payment.member_name,
      paymentMethod: paymentMethodLabel,
      paymentMethodBrand,
      paymentMethodLast4,
      chargeSource,
      receiptUrl,
      stripeUrl: `https://dashboard.stripe.com/payments/${paymentIntentId}`,
      bookingInfo,
      refundHistory,
      totalRefunded,
      refundableAmount,
    });
  } catch (error: unknown) {
    logger.error('[Payments] Error fetching transaction details', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch transaction details' });
  }
});

router.post('/api/payments/refund', isStaffOrAdmin, validateBody(refundPaymentSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId, amountCents, reason } = req.body;
    const { staffEmail, staffName } = getStaffInfo(req);

    const payment = await getPaymentByIntentId(paymentIntentId);

    if (!payment) {
      const cacheResult = await db.execute(sql`
        SELECT stc.stripe_id, stc.payment_intent_id, stc.amount_cents, stc.status,
               COALESCE(stc.customer_email, 'Unknown') as customer_email,
               COALESCE(stc.customer_name, stc.customer_email, 'Unknown') as customer_name,
               stc.object_type
        FROM stripe_transaction_cache stc
        WHERE stc.stripe_id = ${paymentIntentId}
           OR stc.payment_intent_id = ${paymentIntentId}
        LIMIT 1
      `);

      if (cacheResult.rows.length === 0) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      const cached = cacheResult.rows[0] as {
        stripe_id: string; payment_intent_id: string | null; amount_cents: number;
        status: string; customer_email: string; customer_name: string; object_type: string;
      };

      if (cached.status !== 'succeeded' && cached.status !== 'partially_refunded') {
        return res.status(400).json({ error: `Cannot refund payment with status: ${cached.status}` });
      }

      const stripe = await getStripeClient();
      const resolvedPiId = cached.payment_intent_id || cached.stripe_id;

      const refundParams: Stripe.RefundCreateParams = {};
      if (resolvedPiId.startsWith('pi_')) {
        refundParams.payment_intent = resolvedPiId;
      } else if (resolvedPiId.startsWith('ch_')) {
        refundParams.charge = resolvedPiId;
      } else if (resolvedPiId.startsWith('in_')) {
        const invoice = await stripe.invoices.retrieve(resolvedPiId);
        if (invoice.charge && typeof invoice.charge === 'string') {
          refundParams.charge = invoice.charge;
        } else {
          return res.status(400).json({ error: 'This invoice has no associated charge and cannot be refunded.' });
        }
      } else {
        return res.status(400).json({ error: 'This transaction type cannot be refunded from this interface. Please use the Stripe dashboard.' });
      }

      if (amountCents && amountCents > 0 && amountCents < cached.amount_cents) {
        refundParams.amount = amountCents;
      }

      const refund = await stripe.refunds.create(refundParams, {
        idempotencyKey: `refund_cache_${cached.stripe_id}_${amountCents || 'full'}_${staffEmail}`
      });

      const refundedAmount = refund.amount;
      const isPartialRefund = refundedAmount < cached.amount_cents;
      const newStatus = isPartialRefund ? 'partially_refunded' : 'refunded';

      await db.execute(sql`
        UPDATE stripe_transaction_cache
        SET status = ${newStatus}, updated_at = NOW()
        WHERE stripe_id = ${cached.stripe_id}
      `);

      await logBillingAudit({
        memberEmail: cached.customer_email,
        actionType: 'payment_refunded',
        actionDetails: {
          paymentIntentId: cached.stripe_id,
          refundId: refund.id,
          refundAmount: refundedAmount,
          reason: reason || 'No reason provided',
          originalAmount: cached.amount_cents,
          isPartialRefund,
          sourceType: 'cache',
        },
        newValue: `Refunded $${(refundedAmount / 100).toFixed(2)} of $${(cached.amount_cents / 100).toFixed(2)} (historical transaction)`,
        performedBy: staffEmail,
        performedByName: staffName
      });

      logger.info('[Payments] Refund created for cached/historical transaction', {
        extra: { refundId: refund.id, stripeId: cached.stripe_id, resolvedPiId, refundedAmount: (refundedAmount / 100).toFixed(2) }
      });

      if (cached.customer_email && cached.customer_email !== 'Unknown') {
        sendNotificationToUser(cached.customer_email, {
          type: 'billing_update',
          title: 'Refund Processed',
          message: `A refund of $${(refundedAmount / 100).toFixed(2)} has been processed to your payment method.`,
          data: { paymentIntentId: cached.stripe_id, refundId: refund.id, amount: refundedAmount }
        });
      }

      broadcastBillingUpdate({
        action: 'payment_refunded',
        memberEmail: cached.customer_email,
        amount: refundedAmount,
        status: newStatus
      });

      return res.json({
        success: true,
        refundId: refund.id,
        refundedAmount,
        newStatus
      });
    }

    if (payment.status !== 'succeeded' && payment.status !== 'refunding' && payment.status !== 'partially_refunded') {
      return res.status(400).json({ error: `Cannot refund payment with status: ${payment.status}` });
    }

    const stripe = await getStripeClient();

    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId
    };

    if (amountCents && amountCents > 0 && amountCents < payment.amountCents) {
      refundParams.amount = amountCents;
    }

    const refund = await stripe.refunds.create(refundParams, {
      idempotencyKey: `refund_${paymentIntentId}_${amountCents || 'full'}_${staffEmail}`
    });

    const refundedAmount = refund.amount;
    const isPartialRefund = refundedAmount < payment.amountCents;
    const newStatus = isPartialRefund ? 'partially_refunded' : 'refunded';

    try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE stripe_payment_intents SET status = ${newStatus}, updated_at = NOW() WHERE stripe_payment_intent_id = ${paymentIntentId}`);

      const existingReversal = await tx.execute(sql`SELECT id FROM usage_ledger WHERE session_id = ${payment.sessionId ?? null} AND stripe_payment_intent_id = ${paymentIntentId} AND source = 'staff_manual' AND COALESCE(overage_fee, 0) < 0 LIMIT 1`);
      if (existingReversal.rows.length > 0) {
        logger.info('[Payments] Refund ledger reversal already exists (idempotency catch), skipping duplicate', { extra: { refundId: refund.id, paymentIntentId } });
        return;
      }

      if (payment.sessionId) {
        await tx.execute(sql`UPDATE booking_participants 
           SET payment_status = 'refunded', updated_at = NOW() 
           WHERE session_id = ${payment.sessionId} AND stripe_payment_intent_id = ${paymentIntentId}`);

        let ledgerResult = await tx.execute(sql`SELECT id, member_id, overage_fee, guest_fee, minutes_charged, stripe_payment_intent_id
           FROM usage_ledger 
           WHERE session_id = ${payment.sessionId} 
             AND stripe_payment_intent_id = ${paymentIntentId}
             AND (COALESCE(overage_fee, 0) > 0 OR COALESCE(guest_fee, 0) > 0)
           ORDER BY created_at ASC`);

        if (ledgerResult.rows.length === 0) {
          logger.warn('[Payments] [OPS_REVIEW_REQUIRED] No ledger entries found with payment_intent_id , falling back to session-wide entries for session .', { extra: { paymentIntentId, paymentSessionId: payment.sessionId } });
          ledgerResult = await tx.execute(sql`SELECT id, member_id, overage_fee, guest_fee, minutes_charged, stripe_payment_intent_id
             FROM usage_ledger 
             WHERE session_id = ${payment.sessionId} 
               AND (COALESCE(overage_fee, 0) > 0 OR COALESCE(guest_fee, 0) > 0)
             ORDER BY created_at ASC`);
        }

        if (ledgerResult.rows.length > 0) {
          const totalLedgerFeeCents = (ledgerResult.rows as Array<{ overage_fee: string; guest_fee: string }>).reduce((sum: number, entry) => {
            return sum + Math.round((parseFloat(entry.overage_fee) || 0) * 100) + Math.round((parseFloat(entry.guest_fee) || 0) * 100);
          }, 0);

          const refundCents = refundedAmount;
          const refundProportion = totalLedgerFeeCents > 0 
            ? Math.min(1, refundCents / totalLedgerFeeCents)
            : 1;

          let totalReversedOverageCents = 0;
          let totalReversedGuestCents = 0;
          const targetReversalCents = refundCents;

          const reversalAmounts: Array<{
            memberId: string;
            reversedOverageCents: number;
            reversedGuestCents: number;
          }> = [];

          for (const entry of ledgerResult.rows as unknown as DbLedgerRow[]) {
            const originalOverageCents = Math.round((parseFloat(entry.overage_fee) || 0) * 100);
            const originalGuestCents = Math.round((parseFloat(entry.guest_fee) || 0) * 100);

            const reversedOverageCents = isPartialRefund 
              ? Math.round(originalOverageCents * refundProportion)
              : originalOverageCents;
            const reversedGuestCents = isPartialRefund 
              ? Math.round(originalGuestCents * refundProportion)
              : originalGuestCents;

            reversalAmounts.push({
              memberId: entry.member_id,
              reversedOverageCents,
              reversedGuestCents
            });

            totalReversedOverageCents += reversedOverageCents;
            totalReversedGuestCents += reversedGuestCents;
          }

          if (isPartialRefund && reversalAmounts.length > 0) {
            const actualReversalCents = totalReversedOverageCents + totalReversedGuestCents;
            const remainderCents = targetReversalCents - actualReversalCents;

            if (remainderCents !== 0) {
              if (reversalAmounts[0].reversedOverageCents > 0 || reversalAmounts[0].reversedGuestCents === 0) {
                reversalAmounts[0].reversedOverageCents += remainderCents;
              } else {
                reversalAmounts[0].reversedGuestCents += remainderCents;
              }
              logger.info('[Payments] Applied rounding remainder of $ to first reversal entry', { extra: { remainderCents_100_ToFixed_2: (remainderCents / 100).toFixed(2) } });
            }
          }

          let reversalCount = 0;
          for (let i = 0; i < ledgerResult.rows.length; i++) {
            const amounts = reversalAmounts[i];

            if (amounts.reversedOverageCents !== 0 || amounts.reversedGuestCents !== 0) {
              await tx.execute(sql`INSERT INTO usage_ledger 
                 (session_id, member_id, minutes_charged, overage_fee, guest_fee, payment_method, source, stripe_payment_intent_id)
                 VALUES (${payment.sessionId}, ${amounts.memberId}, 0, ${(-amounts.reversedOverageCents / 100).toFixed(2)}, ${(-amounts.reversedGuestCents / 100).toFixed(2)}, 'waived', 'staff_manual', ${paymentIntentId})`);
              reversalCount++;
            }
          }

          const reversalType = isPartialRefund 
            ? `partial (${(refundProportion * 100).toFixed(1)}%)`
            : 'full';
          logger.info('[Payments] Created ledger reversal(s) for session , refund: $, linked to payment', { extra: { reversalCount, reversalType, paymentSessionId: payment.sessionId, refundCents_100_ToFixed_2: (refundCents / 100).toFixed(2), paymentIntentId } });
        }

        logger.info('[Payments] Updated ledger and participants for session', { extra: { paymentSessionId: payment.sessionId } });
      }

      await logBillingAudit({
        memberEmail: payment.memberEmail || 'unknown',
        actionType: 'payment_refunded',
        actionDetails: {
          paymentIntentId,
          refundId: refund.id,
          refundAmount: refundedAmount,
          reason: reason || 'No reason provided',
          originalAmount: payment.amountCents,
          isPartialRefund,
          sessionId: payment.sessionId
        },
        newValue: `Refunded $${(refundedAmount / 100).toFixed(2)} of $${(payment.amountCents / 100).toFixed(2)}`,
        performedBy: staffEmail,
        performedByName: staffName
      });
    });
    } catch (dbError: unknown) {
      logger.error('[Payments] Stripe refund succeeded but DB sync failed — marking refund_succeeded_sync_failed', {
        extra: { paymentIntentId, refundId: refund.id, error: getErrorMessage(dbError) }
      });
      try {
        await db.execute(sql`UPDATE stripe_payment_intents SET status = 'refund_succeeded_sync_failed', updated_at = NOW() WHERE stripe_payment_intent_id = ${paymentIntentId}`);
      } catch {
      }
      try {
        await db.execute(sql`INSERT INTO failed_side_effects (booking_id, action_type, stripe_payment_intent_id, error_message, context, resolved, retry_count, created_at, updated_at) VALUES (0, 'stripe_refund', ${paymentIntentId}, ${getErrorMessage(dbError)}, ${JSON.stringify({ source: 'payment_admin_refund' })}, false, 0, NOW(), NOW())`);
      } catch { /* best effort */ }
      return res.status(207).json({
        success: true,
        warning: 'Stripe refund succeeded but local records could not be updated. This will be auto-retried.',
        refundId: refund.id,
        amount: refundedAmount,
        syncFailed: true,
      });
    }

    if (payment.sessionId) {
      try {
        await recalculateSessionFees(payment.sessionId, 'staff_action');
        logger.info('[Payments] Recalculated session fees after refund', { extra: { sessionId: payment.sessionId, paymentIntentId } });
      } catch (recalcErr: unknown) {
        logger.error('[Payments] Fee recalculation after refund failed', { extra: { sessionId: payment.sessionId, error: getErrorMessage(recalcErr) } });
      }
    }

    logger.info('[Payments] Refund created for : $', { extra: { refundId: refund.id, paymentIntentId, refundedAmount_100_ToFixed_2: (refundedAmount / 100).toFixed(2) } });

    const memberEmail = payment.memberEmail || payment.member_email;
    
    if (memberEmail) {
      sendNotificationToUser(memberEmail, {
        type: 'billing_update',
        title: 'Refund Processed',
        message: `A refund of $${(refundedAmount / 100).toFixed(2)} has been processed to your payment method.`,
        data: { paymentIntentId, refundId: refund.id, amount: refundedAmount }
      });
    }
    
    broadcastBillingUpdate({
      action: 'payment_refunded',
      memberEmail,
      amount: refundedAmount,
      status: newStatus
    });

    res.json({
      success: true,
      refundId: refund.id,
      refundedAmount,
      newStatus
    });
  } catch (error: unknown) {
    logger.error('[Payments] Error creating refund', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to create refund' });
  }
});

router.post('/api/payments/capture', isStaffOrAdmin, validateBody(capturePaymentSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId, amountCents } = req.body;
    const { staffEmail, staffName } = getStaffInfo(req);

    const payment = await getPaymentByIntentId(paymentIntentId);

    if (!payment) {
      return res.status(404).json({ error: 'Payment authorization not found' });
    }

    if (payment.status !== 'requires_capture') {
      return res.status(400).json({ error: `Cannot capture payment with status: ${payment.status}` });
    }

    const stripe = await getStripeClient();

    const captureParams: Stripe.PaymentIntentCaptureParams = {};
    if (amountCents && amountCents > 0 && amountCents <= payment.amount_cents) {
      captureParams.amount_to_capture = amountCents;
    }

    const capturedPaymentIntent = await stripe.paymentIntents.capture(paymentIntentId, captureParams);

    const capturedAmount = capturedPaymentIntent.amount_received || amountCents || payment.amount_cents;

    await updatePaymentStatusAndAmount(paymentIntentId, 'succeeded', capturedAmount);

    await logBillingAudit({
      memberEmail: payment.member_email || 'unknown',
      actionType: 'payment_captured',
      actionDetails: {
        paymentIntentId,
        originalAmount: payment.amount_cents,
        capturedAmount,
        isPartialCapture: amountCents && amountCents < payment.amount_cents
      },
      previousValue: `Pre-authorized: $${(payment.amount_cents / 100).toFixed(2)}`,
      newValue: `Captured: $${(capturedAmount / 100).toFixed(2)}`,
      performedBy: staffEmail,
      performedByName: staffName
    });

    logger.info('[Payments] Captured : $', { extra: { paymentIntentId, capturedAmount_100_ToFixed_2: (capturedAmount / 100).toFixed(2) } });

    res.json({
      success: true,
      capturedAmount,
      paymentIntentId
    });
  } catch (error: unknown) {
    logger.error('[Payments] Error capturing payment', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to capture payment' });
  }
});

router.post('/api/payments/void-authorization', isStaffOrAdmin, validateBody(voidAuthorizationSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId, reason } = req.body;
    const { staffEmail, staffName } = getStaffInfo(req);

    const payment = await getPaymentByIntentId(paymentIntentId);

    if (!payment) {
      return res.status(404).json({ error: 'Payment authorization not found' });
    }

    if (payment.status !== 'requires_capture') {
      return res.status(400).json({ error: `Cannot void payment with status: ${payment.status}` });
    }

    const cancelResult = await cancelPaymentIntent(paymentIntentId);
    if (!cancelResult.success && cancelResult.error) {
      return res.status(400).json({ error: cancelResult.error });
    }

    await logBillingAudit({
      memberEmail: payment.member_email || 'unknown',
      actionType: 'authorization_voided',
      actionDetails: {
        paymentIntentId,
        amount: payment.amount_cents,
        reason: reason || 'No reason provided'
      },
      previousValue: `Pre-authorized: $${(payment.amount_cents / 100).toFixed(2)}`,
      newValue: 'Voided',
      performedBy: staffEmail,
      performedByName: staffName
    });

    logger.info('[Payments] Voided authorization : $ -', { extra: { paymentIntentId, paymentAmount_cents_100_ToFixed_2: (payment.amount_cents / 100).toFixed(2), reason_No_reason: reason || 'No reason' } });

    res.json({
      success: true,
      paymentIntentId
    });
  } catch (error: unknown) {
    logger.error('[Payments] Error voiding authorization', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to void authorization' });
  }
});

export default router;
