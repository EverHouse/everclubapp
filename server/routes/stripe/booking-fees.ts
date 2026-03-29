import { logger } from '../../core/logger';
import { PRICING } from '../../core/billing/pricingConfig';
import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../../core/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { isExpandedProduct } from '../../types/stripe-helpers';
import { getStripeClient } from '../../core/stripe/client';
import { listCustomerPaymentMethods } from '../../core/stripe/customers';
import {
  getPaymentIntentStatus,
  cancelPaymentIntent,
  getOrCreateStripeCustomer,
  type BookingFeeLineItem
} from '../../core/stripe';
import { logFromRequest } from '../../core/auditLog';
import { getStaffInfo, SAVED_CARD_APPROVAL_THRESHOLD_CENTS } from './helpers';
import { broadcastBillingUpdate, broadcastBookingInvoiceUpdate } from '../../core/websocket';
import { alertOnExternalServiceError } from '../../core/errorAlerts';
import { getErrorMessage, getErrorCode } from '../../utils/errorUtils';
import { logAndRespond } from '../../core/logger';
import { toIntArrayLiteral } from '../../utils/sqlArrayLiteral';
import { getBookingInvoiceId, finalizeAndPayInvoice, createDraftInvoiceForBooking, finalizeInvoicePaidOutOfBand, buildInvoiceDescription } from '../../core/billing/bookingInvoiceService';
import { recalculateSessionFees } from '../../core/billing/unifiedFeeService';
import { validateBody } from '../../middleware/validate';
import { createPaymentIntentSchema, markBookingPaidSchema, confirmPaymentSchema, cancelPaymentIntentSchema, createCustomerSchema, chargeSavedCardSchema } from '../../../shared/validators/payments';

interface DbMemberRow {
  id: string;
  email: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  stripe_customer_id?: string;
  hubspot_id?: string;
  membership_tier?: string;
  membership_status?: string;
  tier?: string;
  membership_minutes?: number;
  billing_provider?: string;
}

interface DbParticipantRow {
  id: number;
  session_id: number;
  cached_fee_cents: number;
  payment_status: string;
  participant_type: string;
  display_name: string;
  booking_id: number;
  trackman_booking_id?: string;
}

interface StripeError extends Error {
  type?: string;
  decline_code?: string;
  code?: string;
}

const router = Router();

router.get('/api/stripe/prices/recurring', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { getStripeClient } = await import('../../core/stripe/client');
    const stripe = await getStripeClient();
    
    const prices = await stripe.prices.list({
      active: true,
      type: 'recurring',
      expand: ['data.product'],
      limit: 100
    });
    
    const formattedPrices = prices.data.map(price => {
      const product = price.product;
      const productName = isExpandedProduct(product) ? product.name : 'Unknown Product';
      const amountDollars = (price.unit_amount || 0) / 100;
      const interval = price.recurring?.interval || 'month';
      
      return {
        id: price.id,
        productId: isExpandedProduct(product) ? product.id : (typeof product === 'string' ? product : 'unknown'),
        productName,
        nickname: price.nickname || null,
        amount: amountDollars,
        amountCents: price.unit_amount || 0,
        currency: price.currency,
        interval,
        displayString: `$${amountDollars}/${interval} - ${price.nickname || productName}`
      };
    });
    
    res.json({ prices: formattedPrices });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch Stripe prices', error);
  }
});

router.post('/api/stripe/create-payment-intent', isStaffOrAdmin, validateBody(createPaymentIntentSchema), async (req: Request, res: Response) => {
  try {
    const { userId, email, memberName, amountCents, purpose, bookingId, sessionId, description, participantFees } = req.body;

    const { processStaffPayFees } = await import('../../core/billing/paymentProcessingService');
    const result = await processStaffPayFees({
      userId,
      email,
      memberName,
      amountCents,
      purpose,
      bookingId,
      sessionId,
      description,
      participantFees,
      auditLogFn: (paymentIntentId, meta) => {
        logFromRequest(req, 'record_charge', 'payment', paymentIntentId, email, meta);
      }
    });

    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'create payment intent');
    logAndRespond(req, res, 500, 'Payment processing failed. Please try again.', error);
  }
});

router.post('/api/stripe/confirm-payment', isStaffOrAdmin, validateBody(confirmPaymentSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;
    const { staffEmail, staffName } = getStaffInfo(req);

    const { processStaffConfirmPayment } = await import('../../core/billing/paymentProcessingService');
    const result = await processStaffConfirmPayment(paymentIntentId, staffEmail, staffName);

    res.status(result.status).json(result.body);
  } catch (error: unknown) {
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'confirm payment');
    logAndRespond(req, res, 500, 'Payment confirmation failed. Please try again.', error);
  }
});

router.get('/api/stripe/payment-intent/:id', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const status = await getPaymentIntentStatus(id as string);

    if (!status) {
      return res.status(404).json({ error: 'Payment intent not found' });
    }

    res.json(status);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to get payment intent status', error);
  }
});

router.post('/api/stripe/cancel-payment', isStaffOrAdmin, validateBody(cancelPaymentIntentSchema), async (req: Request, res: Response) => {
  try {
    const { paymentIntentId } = req.body;

    const result = await cancelPaymentIntent(paymentIntentId);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    try {
      const piBookingResult = await db.execute(sql`SELECT booking_id FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${paymentIntentId} AND booking_id IS NOT NULL LIMIT 1`);
      if (piBookingResult.rows.length > 0) {
        const piBookingId = (piBookingResult.rows[0] as { booking_id: number }).booking_id;
        const { voidBookingInvoice, recreateDraftInvoiceFromBooking } = await import('../../core/billing/bookingInvoiceService');
        await voidBookingInvoice(piBookingId);
        await recreateDraftInvoiceFromBooking(piBookingId);
        logger.info('[Stripe] Voided invoice and re-created draft after staff cancelled payment', { extra: { bookingId: piBookingId, paymentIntentId } });
      }
    } catch (invoiceErr: unknown) {
      logger.warn('[Stripe] Failed to void/recreate invoice after payment cancellation', { extra: { paymentIntentId, error: String(invoiceErr) } });
    }

    res.json({ success: true });
  } catch (error: unknown) {
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'cancel payment');
    logAndRespond(req, res, 500, 'Payment cancellation failed. Please try again.', error);
  }
});

router.post('/api/stripe/create-customer', isStaffOrAdmin, validateBody(createCustomerSchema), async (req: Request, res: Response) => {
  try {
    const { userId, email: rawEmail, name } = req.body;
    const email = rawEmail?.trim()?.toLowerCase();

    const result = await getOrCreateStripeCustomer(userId, email, name);

    res.json({
      customerId: result.customerId,
      isNew: result.isNew
    });
  } catch (error: unknown) {
    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'create customer');
    logAndRespond(req, res, 500, 'Customer creation failed. Please try again.', error);
  }
});

router.get('/api/billing/members/search', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { query, includeInactive } = req.query;
    
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return res.json({ members: [] });
    }
    
    const searchTerm = query.trim().toLowerCase();
    const searchPattern = `%${searchTerm}%`;
    
    const inactiveFilter = includeInactive !== 'true'
      ? sql` AND (membership_status IN ('active', 'trialing', 'past_due') OR membership_status IS NULL OR stripe_subscription_id IS NOT NULL)`
      : sql``;
    
    const result = await db.execute(sql`
      SELECT 
        id, email, first_name, last_name, 
        membership_tier, membership_status, 
        stripe_customer_id, hubspot_id
      FROM users 
      WHERE (
        LOWER(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(first_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(last_name, '')) LIKE ${searchPattern}
        OR LOWER(COALESCE(email, '')) LIKE ${searchPattern}
      )${inactiveFilter} AND archived_at IS NULL ORDER BY first_name, last_name LIMIT 10
    `);
    
    const members = (result.rows as unknown as DbMemberRow[]).map((row) => ({
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
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to search members', error);
  }
});

router.post('/api/stripe/staff/charge-saved-card', isStaffOrAdmin, validateBody(chargeSavedCardSchema), async (req: Request, res: Response) => {
  try {
    const { memberEmail: rawMemberEmail, bookingId, sessionId: _sessionId, participantIds } = req.body;
    const memberEmail = rawMemberEmail?.trim()?.toLowerCase();
    const { staffEmail, staffName, sessionUser } = getStaffInfo(req);

    const memberResult = await db.execute(sql`SELECT id, email, first_name, last_name, stripe_customer_id 
       FROM users WHERE LOWER(email) = LOWER(${memberEmail})`);

    if (memberResult.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }

    const member = memberResult.rows[0] as unknown as DbMemberRow;
    const _memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email;

    const sessionLookup = await db.execute(sql`SELECT DISTINCT bs.id as session_id
       FROM booking_participants bp
       JOIN booking_sessions bs ON bp.session_id = bs.id
       WHERE bp.id IN (${sql.join(participantIds.map((id: number) => sql`${id}`), sql`, `)})
       LIMIT 1`);
    if (sessionLookup.rows.length > 0) {
      const sid = (sessionLookup.rows[0] as { session_id: number }).session_id;
      try {
        await recalculateSessionFees(sid, 'stripe');
        logger.info('[Stripe] Staff charge: recalculated session fees before charging', { extra: { sessionId: sid } });
      } catch (recalcErr: unknown) {
        logger.warn('[Stripe] Staff charge: fee recalculation failed, proceeding with cached values', { extra: { sessionId: sid, error: getErrorMessage(recalcErr) } });
      }
    }

    const participantResult = await db.execute(sql`SELECT bp.id, bp.session_id, bp.cached_fee_cents, bp.payment_status, bp.participant_type, bp.display_name,
       br.id as booking_id, bs.trackman_booking_id
       FROM booking_participants bp
       JOIN booking_sessions bs ON bp.session_id = bs.id
       LEFT JOIN booking_requests br ON br.session_id = bs.id
       WHERE bp.id IN (${sql.join(participantIds.map((id: number) => sql`${id}`), sql`, `)}) AND bp.payment_status = 'pending'`);

    if (participantResult.rows.length === 0) {
      return res.status(400).json({ error: 'No pending participants found for the provided IDs' });
    }

    const foundIds = new Set((participantResult.rows as unknown as DbParticipantRow[]).map((r) => r.id));
    const missingIds = participantIds.filter((id: number) => !foundIds.has(id));
    if (missingIds.length > 0) {
      logger.info('[Stripe] Some participant IDs already paid or not found, skipping', { extra: { missingIds, providedIds: participantIds } });
    }

    if (bookingId) {
      const wrongBooking = (participantResult.rows as unknown as DbParticipantRow[]).filter((r) => r.booking_id !== bookingId);
      if (wrongBooking.length > 0) {
        return res.status(400).json({ error: 'Participant IDs do not belong to the specified booking' });
      }
    }

    const authoritativeAmountCents = (participantResult.rows as Array<{ cached_fee_cents: number }>).reduce(
      (sum: number, r) => sum + (r.cached_fee_cents || 0), 0
    );

    if (authoritativeAmountCents < 50) {
      return res.status(400).json({ error: 'Total amount too small to charge (minimum $0.50)' });
    }

    if (authoritativeAmountCents >= SAVED_CARD_APPROVAL_THRESHOLD_CENTS) {
      if (sessionUser?.role !== 'admin') {
        return res.status(403).json({
          error: 'Charges above $500 require manager approval. Please ask an admin to process this charge.',
          requiresApproval: true,
          thresholdCents: SAVED_CARD_APPROVAL_THRESHOLD_CENTS
        });
      }
      logFromRequest(req, 'large_charge_approved', 'payment', null, memberEmail, {
        amountCents: authoritativeAmountCents,
        approvedBy: staffEmail,
        role: 'admin',
        chargeType: 'saved_card'
      });
    }

    const resolvedSessionId = participantResult.rows[0].session_id;
    const resolvedBookingId = participantResult.rows[0].booking_id;

    if (resolvedBookingId) {
      const existingPaymentResult = await db.execute(sql`
        SELECT stripe_payment_intent_id, status, amount_cents 
        FROM stripe_payment_intents 
        WHERE booking_id = ${resolvedBookingId} 
        AND status = 'succeeded'
        AND purpose IN ('prepayment', 'booking_fee')
        LIMIT 1`);

      if (existingPaymentResult.rows.length > 0) {
        const existingPayment = existingPaymentResult.rows[0] as { stripe_payment_intent_id: string; status: string; amount_cents: number };
        return res.status(409).json({ 
          error: 'Payment already collected for this booking',
          existingPaymentId: existingPayment.stripe_payment_intent_id
        });
      }
    }

    if (!member.stripe_customer_id) {
      return res.status(400).json({ 
        error: 'Member does not have a Stripe account. They need to make a payment first to save their card.',
        noStripeCustomer: true
      });
    }

    const _stripe = await getStripeClient();

    const paymentMethods = await listCustomerPaymentMethods(member.stripe_customer_id);

    if (paymentMethods.length === 0) {
      return res.status(400).json({ 
        error: 'Member has no saved card on file. They need to make a payment first to save their card.',
        noSavedCard: true
      });
    }

    const paymentMethod = paymentMethods[0];
    const cardLast4 = paymentMethod.last4 || '****';
    const cardBrand = paymentMethod.brand || 'card';

    const trackmanBookingId = (participantResult.rows[0] as unknown as DbParticipantRow)?.trackman_booking_id || null;

    const feeLineItems: BookingFeeLineItem[] = [];
    for (const r of participantResult.rows as unknown as DbParticipantRow[]) {
      if ((r.cached_fee_cents || 0) <= 0) continue;
      const isGuest = r.participant_type === 'guest';
      feeLineItems.push({
        participantId: r.id,
        displayName: r.display_name || (isGuest ? 'Guest' : 'Member'),
        participantType: r.participant_type as 'owner' | 'member' | 'guest',
        overageCents: isGuest ? 0 : r.cached_fee_cents,
        guestCents: isGuest ? r.cached_fee_cents : 0,
        totalCents: r.cached_fee_cents,
      });
    }

    if (resolvedBookingId) {
      const existingIntents = await db.execute(sql`SELECT stripe_payment_intent_id, status FROM stripe_payment_intents 
         WHERE booking_id = ${resolvedBookingId} AND status NOT IN ('succeeded', 'canceled', 'refunded')`);

      for (const row of existingIntents.rows as Array<{ stripe_payment_intent_id: string; status: string }>) {
        try {
          const stripeClient = await getStripeClient();
          const livePi = await stripeClient.paymentIntents.retrieve(row.stripe_payment_intent_id);
          if (livePi.status === 'succeeded' || livePi.status === 'processing' || livePi.status === 'requires_capture') {
            logger.warn('[Stripe] Existing PI is already processing/succeeded — cannot charge again', {
              extra: { bookingId: resolvedBookingId, piId: row.stripe_payment_intent_id, liveStatus: livePi.status }
            });
            return res.status(409).json({ error: 'A payment is already being processed for this booking. Please wait or check payment history.' });
          }
          if (livePi.status !== 'canceled') {
            const livePiInvoice = (livePi as unknown as { invoice: string | { id: string } | null }).invoice;
            if (livePiInvoice) {
              logger.info('[Stripe] Stale PI is invoice-generated — skipping cancel, invoice flow will handle it', {
                extra: { bookingId: resolvedBookingId, piId: row.stripe_payment_intent_id, invoiceId: typeof livePiInvoice === 'string' ? livePiInvoice : livePiInvoice.id }
              });
            } else {
              const { cancelPaymentIntent } = await import('../../core/stripe');
              const cancelResult = await cancelPaymentIntent(row.stripe_payment_intent_id);
              if (!cancelResult.success) {
                logger.warn('[Stripe] Could not cancel stale PI — checking if booking has invoice to fall through', {
                  extra: { bookingId: resolvedBookingId, piId: row.stripe_payment_intent_id, error: cancelResult.error }
                });
                const bookingInvoice = resolvedBookingId ? await getBookingInvoiceId(Number(resolvedBookingId)) : null;
                if (!bookingInvoice) {
                  throw new Error(cancelResult.error || 'Failed to cancel stale PI');
                }
              }
            }
          } else {
            await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${row.stripe_payment_intent_id}`);
          }
          logger.info('[Stripe] Staff charge stale PI check complete', {
            extra: { bookingId: resolvedBookingId, piId: row.stripe_payment_intent_id, oldStatus: row.status }
          });
        } catch (cancelErr: unknown) {
          logger.error('[Stripe] Could not verify/cancel stale PI — blocking charge to prevent duplicate', {
            extra: { piId: row.stripe_payment_intent_id, error: getErrorMessage(cancelErr) }
          });
          return logAndRespond(req, res, 503, 'Could not verify existing payment status. Please try again or use a different payment method.', cancelErr);
        }
      }
    }

    let invoiceResult;
    let existingInvoiceId = resolvedBookingId ? await getBookingInvoiceId(Number(resolvedBookingId)) : null;

    if (existingInvoiceId) {
      try {
        const stripeClient = await getStripeClient();
        const existingInvoice = await stripeClient.invoices.retrieve(existingInvoiceId);
        if (existingInvoice.status === 'draft' && existingInvoice.amount_due !== authoritativeAmountCents) {
          logger.warn('[Stripe] Staff charge: existing draft invoice amount mismatch — voiding stale draft', {
            extra: { bookingId: resolvedBookingId, invoiceId: existingInvoiceId, invoiceAmount: existingInvoice.amount_due, authoritativeAmount: authoritativeAmountCents }
          });
          await stripeClient.invoices.del(existingInvoiceId);
          await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${Number(resolvedBookingId)}`);
          existingInvoiceId = null;
        } else if (existingInvoice.status === 'draft') {
          invoiceResult = await finalizeAndPayInvoice({
            bookingId: Number(resolvedBookingId),
            paymentMethodId: paymentMethod.id,
            offSession: true,
          });
          logger.info('[Stripe] Staff charge using existing draft invoice', {
            extra: { bookingId: resolvedBookingId, invoiceId: existingInvoiceId, paymentIntentId: invoiceResult.paymentIntentId }
          });
        } else {
          logger.info('[Stripe] Staff charge: existing invoice is not draft, will create new one', {
            extra: { bookingId: resolvedBookingId, invoiceId: existingInvoiceId, status: existingInvoice.status }
          });
          existingInvoiceId = null;
        }
      } catch (draftErr: unknown) {
        logger.warn('[Stripe] Failed to use existing draft invoice, falling back to new invoice', {
          extra: { bookingId: resolvedBookingId, existingInvoiceId, error: getErrorMessage(draftErr) }
        });
        invoiceResult = null;
        existingInvoiceId = null;
      }
    }
    
    if (!invoiceResult) {
      if (existingInvoiceId) {
        try {
          const stripeClient = await getStripeClient();
          const oldInvoice = await stripeClient.invoices.retrieve(existingInvoiceId);
          if (oldInvoice.status === 'open') {
            logger.info('[Stripe] Staff charge: voiding broken open invoice before fresh draft', {
              extra: { bookingId: resolvedBookingId, invoiceId: existingInvoiceId }
            });
            await stripeClient.invoices.voidInvoice(existingInvoiceId);
          }
          await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${Number(resolvedBookingId)}`);
          await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW()
            WHERE booking_id = ${Number(resolvedBookingId)} AND status NOT IN ('succeeded', 'canceled', 'refunded')`);
        } catch (voidErr: unknown) {
          logger.warn('[Stripe] Staff charge: could not void existing invoice, proceeding with fresh draft', {
            extra: { bookingId: resolvedBookingId, invoiceId: existingInvoiceId, error: getErrorMessage(voidErr) }
          });
          await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${Number(resolvedBookingId)}`);
        }
      }
      await createDraftInvoiceForBooking({
        customerId: member.stripe_customer_id,
        bookingId: Number(resolvedBookingId),
        sessionId: Number(resolvedSessionId),
        trackmanBookingId,
        feeLineItems,
        metadata: {
          type: 'staff_saved_card_charge',
          staffEmail,
          staffName: staffName || '',
          memberEmail: member.email,
          memberId: member.id,
          participantIds: JSON.stringify(participantIds),
        },
        purpose: 'booking_fee',
      });
      invoiceResult = await finalizeAndPayInvoice({
        bookingId: Number(resolvedBookingId),
        paymentMethodId: paymentMethod.id,
        offSession: true,
      });
    }

    let successMessage: string;

    if (invoiceResult.status === 'succeeded') {
      const chargeDescription = await buildInvoiceDescription(Number(resolvedBookingId), trackmanBookingId);

      await db.transaction(async (tx) => {
        const safeParticipantIds = (participantIds || []).filter((id: unknown) => typeof id === 'number' && Number.isFinite(id) && id > 0).map((id: number) => Math.floor(id));
        if (safeParticipantIds.length > 0) {
          await tx.execute(sql`UPDATE booking_participants 
             SET payment_status = 'paid', 
                 stripe_payment_intent_id = ${invoiceResult.paymentIntentId},
                 paid_at = NOW()
             WHERE id IN (${sql.join(safeParticipantIds.map((id: number) => sql`${id}`), sql`, `)})`);
          logger.info('[Stripe] Staff charged via invoice: $ for', { extra: { totalDollars: (authoritativeAmountCents / 100).toFixed(2), memberEmail: member.email, participantIdsLength: participantIds.length, invoiceId: invoiceResult.invoiceId } });
        }

        await tx.execute(sql`INSERT INTO stripe_payment_intents 
            (user_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, status, purpose, description, booking_id, session_id)
           VALUES (${member.id}, ${invoiceResult.paymentIntentId}, ${member.stripe_customer_id}, ${authoritativeAmountCents}, 'succeeded', 'booking_fee', ${chargeDescription}, ${resolvedBookingId}, ${resolvedSessionId})
           ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET status = 'succeeded', updated_at = NOW()`);

      });

      logFromRequest(req, 'charge_saved_card', 'payment', invoiceResult.paymentIntentId, member.email, {
        amountCents: authoritativeAmountCents,
        cardCharged: invoiceResult.amountCharged || authoritativeAmountCents,
        balanceApplied: invoiceResult.amountFromBalance || 0,
        cardLast4,
        cardBrand,
        invoiceId: invoiceResult.invoiceId,
        bookingId: resolvedBookingId,
        sessionId: resolvedSessionId,
      });

      broadcastBillingUpdate({
        action: 'payment_succeeded',
        memberEmail: member.email,
        amount: authoritativeAmountCents
      });

      const balanceApplied = invoiceResult.amountFromBalance || 0;
      const amountCharged = invoiceResult.amountCharged || authoritativeAmountCents;
      successMessage = balanceApplied > 0
        ? `Charged ${cardBrand} ending in ${cardLast4}: $${(amountCharged / 100).toFixed(2)} (credit applied: $${(balanceApplied / 100).toFixed(2)})`
        : `Charged ${cardBrand} ending in ${cardLast4}: $${(authoritativeAmountCents / 100).toFixed(2)}`;

      res.json({ 
        success: true, 
        message: successMessage,
        paymentIntentId: invoiceResult.paymentIntentId,
        invoiceId: invoiceResult.invoiceId,
        cardLast4,
        cardBrand,
        amountCharged,
        balanceApplied,
        totalAmount: authoritativeAmountCents,
        hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl || null,
        invoicePdf: invoiceResult.invoicePdf || null,
        feeLineItems: feeLineItems.map(li => ({
          participantId: li.participantId,
          displayName: li.displayName,
          participantType: li.participantType,
          overageCents: li.overageCents,
          guestCents: li.guestCents,
          totalCents: li.totalCents,
        })),
      });
    } else {
      logger.warn('[Stripe] Invoice charge requires action', { extra: { invoiceStatus: invoiceResult.status, memberEmail: member.email } });
      res.status(400).json({ 
        error: `Payment requires additional verification. Please use the standard payment flow.`,
        requiresAction: true,
        status: invoiceResult.status
      });
    }
  } catch (error: unknown) {
    logger.error('[Stripe] Error charging saved card', { extra: { error: getErrorMessage(error) } });
    
    if ((error as StripeError).type === 'StripeCardError') {
      return logAndRespond(req, res, 400, `Card declined: ${getErrorMessage(error)}`, error);
    }
    
    if (getErrorCode(error) === 'authentication_required') {
      return logAndRespond(req, res, 400, 'Card requires authentication. Please use the standard payment flow.', error);
    }

    await alertOnExternalServiceError('Stripe', error instanceof Error ? error : new Error(getErrorMessage(error)), 'charge saved card');
    logAndRespond(req, res, 500, 'Failed to charge card. Please try again or use another payment method.', error);
  }
});

router.post('/api/stripe/staff/mark-booking-paid', isStaffOrAdmin, validateBody(markBookingPaidSchema), async (req: Request, res: Response) => {
  try {
    const { bookingId, sessionId, participantIds, paymentMethod: paidVia } = req.body;
    const { staffEmail, staffName: _staffName } = getStaffInfo(req);

    const oobResult = await finalizeInvoicePaidOutOfBand({
      bookingId,
      paidVia: paidVia || 'cash',
    });

    if (!oobResult.success) {
      logger.warn('[Stripe] No draft invoice to mark paid, proceeding with participant updates only', {
        extra: { bookingId, error: oobResult.error }
      });
    }

    const safeParticipantIds = (participantIds || []).filter((id: unknown) => typeof id === 'number' && Number.isFinite(id) && id > 0).map((id: number) => Math.floor(id));
    if (safeParticipantIds.length > 0) {
      await db.execute(sql`UPDATE booking_participants 
         SET payment_status = 'paid', 
             paid_at = NOW(),
             updated_at = NOW(),
             cached_fee_cents = 0
         WHERE id IN (${sql.join(safeParticipantIds.map((id: number) => sql`${id}`), sql`, `)})`);
    }

    if (sessionId) {
      await db.execute(sql`UPDATE usage_ledger 
         SET payment_method = ${paidVia || 'cash'}, updated_at = NOW()
         WHERE session_id = ${sessionId}
           AND payment_method IS DISTINCT FROM 'cash'
           AND payment_method IS DISTINCT FROM 'waived'`);
      logger.info('[Stripe] Updated usage_ledger payment_method for mark-booking-paid', {
        extra: { sessionId, paidVia: paidVia || 'cash' }
      });
    }

    logFromRequest(req, 'mark_booking_paid', 'payment', oobResult.invoiceId || null, null, {
      bookingId,
      participantIds: JSON.stringify(participantIds),
      paidVia: paidVia || 'cash',
      invoiceId: oobResult.invoiceId || null,
      staffEmail,
    });

    broadcastBillingUpdate({
      action: 'payment_confirmed',
      bookingId,
      status: 'paid'
    });

    broadcastBookingInvoiceUpdate({
      bookingId,
      action: 'payment_confirmed',
      sessionId,
    });

    logger.info('[Stripe] Staff marked booking as paid', {
      extra: { bookingId, paidVia: paidVia || 'cash', participantCount: safeParticipantIds.length, invoiceId: oobResult.invoiceId }
    });

    res.json({
      success: true,
      invoiceId: oobResult.invoiceId || null,
      hostedInvoiceUrl: oobResult.hostedInvoiceUrl || null,
      invoicePdf: oobResult.invoicePdf || null,
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to mark booking as paid', error);
  }
});

router.get('/api/payments/future-bookings-with-fees', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    interface DbFutureBookingRow {
      booking_id: number;
      user_email: string;
      user_name: string;
      request_date: string;
      start_time: string;
      end_time: string;
      session_id: number;
      status: string;
      player_count: number;
      resource_name: string;
      resource_type: string;
      tier: string;
      first_name: string;
      last_name: string;
      pending_fee_cents: string;
      pending_intent_count: string;
      guest_count: string;
      participant_count: string;
    }

    const result = await db.execute(sql`SELECT 
        br.id as booking_id,
        br.user_email,
        br.user_name,
        br.request_date,
        br.start_time,
        br.end_time,
        br.session_id,
        br.status,
        br.declared_player_count as player_count,
        r.name as resource_name,
        r.type as resource_type,
        u.tier,
        u.first_name,
        u.last_name,
        COALESCE(
          (SELECT SUM(COALESCE(bp.cached_fee_cents, 0)) FROM booking_participants bp WHERE bp.session_id = br.session_id AND (bp.payment_status = 'pending' OR bp.payment_status IS NULL)),
          0
        ) as pending_fee_cents,
        (SELECT COUNT(*) FROM stripe_payment_intents spi WHERE spi.booking_id = br.id AND spi.status NOT IN ('succeeded', 'canceled')) as pending_intent_count,
        (SELECT COUNT(*) FROM booking_participants bp WHERE bp.session_id = br.session_id AND bp.participant_type = 'guest') as guest_count,
        (SELECT COUNT(*) FROM booking_participants bp WHERE bp.session_id = br.session_id) as participant_count
      FROM booking_requests br
      LEFT JOIN resources r ON r.id = br.resource_id
      LEFT JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
      WHERE br.status IN ('approved', 'confirmed')
      AND br.request_date >= (CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles')::date
      ORDER BY br.request_date, br.start_time
      LIMIT 50`);

    const futureBookings = (result.rows as unknown as DbFutureBookingRow[]).map((row) => {
      const pendingFeeCents = parseInt(row.pending_fee_cents, 10) || 0;
      const declaredPlayers = row.player_count || 1;
      const actualParticipants = parseInt(row.participant_count, 10) || 0;
      const emptySlots = Math.max(0, declaredPlayers - actualParticipants);
      const emptySlotFeeCents = emptySlots * PRICING.GUEST_FEE_CENTS;
      const totalFeeCents = pendingFeeCents + emptySlotFeeCents;
      
      return {
        bookingId: row.booking_id,
        memberEmail: row.user_email,
        memberName: row.first_name && row.last_name 
          ? `${row.first_name} ${row.last_name}` 
          : row.user_name || row.user_email,
        tier: row.tier,
        date: row.request_date,
        startTime: row.start_time,
        endTime: row.end_time,
        resourceName: row.resource_name,
        status: row.status,
        playerCount: row.player_count || 1,
        guestCount: parseInt(row.guest_count, 10) || 0,
        estimatedFeeCents: totalFeeCents,
        hasPaymentIntent: parseInt(row.pending_intent_count, 10) > 0
      };
    });

    res.json(futureBookings);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch future bookings', error);
  }
});

export default router;
