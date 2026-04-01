import { getStripeClient } from '../stripe/client';
  import { db } from '../../db';
  import { logger } from '../logger';
  import { getErrorMessage } from '../../utils/errorUtils';
  import { bookingRequests } from '../../../shared/schema';
  import { eq, sql } from 'drizzle-orm';
  import type Stripe from 'stripe';
  import type { BookingFeeLineItem } from '../stripe/invoices';
  import { PARTICIPANT_TYPE, RESOURCE_TYPE } from '../../../shared/constants/statuses';
  import type { ParticipantType } from '../../../shared/constants/statuses';
  import { markPaymentRefunded } from './PaymentStatusService';
  import {
    type FinalizeAndPayResult,
    extractPaymentIntentId,
    computeBalanceApplied,
    safeBroadcast,
  } from './bookingInvoiceTypes';
  import { getBookingInvoiceId } from './invoiceQueries';
  import { createDraftInvoiceForBooking } from './invoiceDraft';

  interface StripeCustomerIdRow {
    stripe_customer_id: string | null;
  }

  interface ParticipantFeeRow {
    id: number;
    display_name: string | null;
    participant_type: string;
    cached_fee_cents: number;
  }

  export type { FinalizeAndPayResult };

  export async function finalizeAndPayInvoice(params: {
  bookingId: number;
  paymentMethodId?: string;
  offSession?: boolean;
}): Promise<FinalizeAndPayResult> {
  const stripe = await getStripeClient();
  const { bookingId, paymentMethodId, offSession } = params;

  const invoiceId = await getBookingInvoiceId(bookingId);
  if (!invoiceId) {
    throw new Error(`No invoice found for booking ${bookingId}`);
  }

  const invoice = await stripe.invoices.retrieve(invoiceId);

  if (invoice.status === 'paid') {
    safeBroadcast({
      bookingId,
      action: 'invoice_paid',
      invoiceId,
      paidInFull: true,
      totalCents: invoice.amount_paid,
    });
    return {
      invoiceId,
      paymentIntentId: extractPaymentIntentId(invoice) || `invoice-balance-${invoiceId}`,
      clientSecret: '',
      status: 'succeeded',
      paidInFull: true,
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null,
      amountFromBalance: invoice.amount_paid,
      amountCharged: 0,
    };
  }

  const existingPiResult = await db.execute(sql`SELECT spi.stripe_payment_intent_id, spi.amount_cents
     FROM stripe_payment_intents spi
     WHERE spi.booking_id = ${bookingId} AND spi.status = 'succeeded'
     AND spi.purpose IN ('booking_fee', 'overage_fee')
     ORDER BY spi.created_at DESC LIMIT 1`);

  if (existingPiResult.rows.length > 0) {
    const existingPi = (existingPiResult.rows as unknown as PaymentIntentLookupRow[])[0];
    if (!existingPi.stripe_payment_intent_id.startsWith('pi_')) {
      logger.warn('[BookingInvoice] Synthetic PI found as succeeded — marking canceled', { extra: { bookingId, piId: existingPi.stripe_payment_intent_id } });
      await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${existingPi.stripe_payment_intent_id}`);
      await db.execute(sql`UPDATE booking_participants SET payment_status = 'pending', stripe_payment_intent_id = NULL, paid_at = NULL
         WHERE stripe_payment_intent_id = ${existingPi.stripe_payment_intent_id} AND payment_status = 'paid'`);
    } else {
    try {
      const stripePi = await stripe.paymentIntents.retrieve(existingPi.stripe_payment_intent_id);
      const pmTypes = stripePi.payment_method_types || [];
      const isTerminal = pmTypes.includes('card_present') || pmTypes.includes('interac_present');
      const invoiceTotal = invoice.amount_due || invoice.total || 0;

      if (isTerminal && stripePi.status === 'succeeded' && invoiceTotal > 0 && stripePi.amount >= invoiceTotal) {
        logger.info('[BookingInvoice] Terminal payment already covers invoice, settling OOB instead of new charge', {
          extra: { bookingId, existingPiId: existingPi.stripe_payment_intent_id, piAmount: stripePi.amount, invoiceTotal }
        });

        const oobResult = await finalizeInvoicePaidOutOfBand({
          bookingId,
          terminalPaymentIntentId: existingPi.stripe_payment_intent_id,
          paidVia: 'terminal',
        });

        if (oobResult.success) {
          safeBroadcast({
            bookingId,
            action: 'invoice_paid',
            invoiceId,
            paidInFull: true,
          });
          return {
            invoiceId,
            paymentIntentId: existingPi.stripe_payment_intent_id,
            clientSecret: '',
            status: 'succeeded',
            paidInFull: true,
            hostedInvoiceUrl: oobResult.hostedInvoiceUrl || null,
            invoicePdf: oobResult.invoicePdf || null,
            amountFromBalance: 0,
            amountCharged: 0,
          };
        }
      }
    } catch (piCheckErr: unknown) {
      logger.warn('[BookingInvoice] Could not verify existing PI for terminal detection', {
        extra: { bookingId, piId: existingPi.stripe_payment_intent_id, error: getErrorMessage(piCheckErr) }
      });
    }
    }
  }

  if (invoice.status === 'void' || invoice.status === 'uncollectible') {
    logger.info('[BookingInvoice] Invoice is void/uncollectible, clearing and recreating draft', {
      extra: { bookingId, invoiceId, status: invoice.status }
    });
    await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${bookingId}`);

    const bookingInfoResult = await db.execute(sql`
      SELECT br.user_email, br.session_id, br.trackman_booking_id, br.resource_id,
             COALESCE(r.type, ${RESOURCE_TYPE.SIMULATOR}) as resource_type
      FROM booking_requests br
      LEFT JOIN resources r ON br.resource_id = r.id
      WHERE br.id = ${bookingId} LIMIT 1
    `);
    const bookingInfo = bookingInfoResult.rows[0] as { user_email: string; session_id: number; trackman_booking_id: string | null; resource_type: string } | undefined;

    if (!bookingInfo) {
      throw new Error(`Booking ${bookingId} not found when trying to recreate invoice`);
    }

    const custResult = await db.execute(sql`SELECT stripe_customer_id FROM users WHERE LOWER(email) = LOWER(${bookingInfo.user_email}) LIMIT 1`);
    const custId = (custResult.rows as unknown as StripeCustomerIdRow[])[0]?.stripe_customer_id;
    if (!custId) {
      logger.error('[BookingInvoice] No Stripe customer for invoice recovery', {
        extra: { bookingId, email: bookingInfo.user_email, invoiceId, invoiceStatus: invoice.status }
      });
      throw new Error(`No billing account found. Please contact support. (Booking #${bookingId})`);
    }

    const partResult = await db.execute(sql`
      SELECT id, display_name, participant_type, cached_fee_cents
      FROM booking_participants
      WHERE session_id = ${bookingInfo.session_id} AND cached_fee_cents > 0
    `);
    const newFeeLineItems: BookingFeeLineItem[] = (partResult.rows as unknown as ParticipantFeeRow[]).map((row) => {
      const isGuest = row.participant_type === PARTICIPANT_TYPE.GUEST;
      return {
        participantId: row.id,
        displayName: row.display_name || 'Unknown',
        participantType: row.participant_type as ParticipantType,
        overageCents: isGuest ? 0 : row.cached_fee_cents,
        guestCents: isGuest ? row.cached_fee_cents : 0,
        totalCents: row.cached_fee_cents,
      };
    });

    if (newFeeLineItems.length === 0) {
      throw new Error(`No fee line items found for booking ${bookingId} when recreating invoice`);
    }

    await createDraftInvoiceForBooking({
      customerId: custId,
      bookingId,
      sessionId: bookingInfo.session_id,
      trackmanBookingId: bookingInfo.trackman_booking_id || null,
      feeLineItems: newFeeLineItems,
      purpose: 'booking_fee',
    });

    return finalizeAndPayInvoice({ bookingId, paymentMethodId, offSession });
  }

  if (invoice.status !== 'draft' && invoice.status !== 'open') {
    throw new Error(`Invoice ${invoiceId} is in unexpected status: ${invoice.status}`);
  }

  let finalizedInvoice: Stripe.Invoice;
  if (invoice.status === 'draft') {
    finalizedInvoice = await stripe.invoices.finalizeInvoice(invoiceId);
  } else {
    finalizedInvoice = invoice;
  }

  if (finalizedInvoice.status === 'paid') {
    const paidInvoice = await stripe.invoices.retrieve(invoiceId, { expand: ['lines.data'] });
    const amountFromBalance = computeBalanceApplied(paidInvoice);
    safeBroadcast({
      bookingId,
      action: 'invoice_paid',
      invoiceId,
      paidInFull: true,
      totalCents: paidInvoice.amount_paid,
    });
    return {
      invoiceId,
      paymentIntentId: extractPaymentIntentId(paidInvoice) || `invoice-balance-${invoiceId}`,
      clientSecret: '',
      status: 'succeeded',
      paidInFull: true,
      hostedInvoiceUrl: paidInvoice.hosted_invoice_url ?? null,
      invoicePdf: paidInvoice.invoice_pdf ?? null,
      amountFromBalance,
      amountCharged: 0,
    };
  }

  if (offSession && paymentMethodId) {
    logger.info('[BookingInvoice] Paying invoice with saved card via invoices.pay()', {
      extra: { bookingId, invoiceId, paymentMethodId, invoiceStatus: finalizedInvoice.status }
    });
    try {
      const paidInvoice = await stripe.invoices.pay(invoiceId, {
        payment_method: paymentMethodId,
      });
      const amountFromBalance = computeBalanceApplied(paidInvoice);
      const amountCharged = paidInvoice.amount_paid - amountFromBalance;
      const resultPiId = extractPaymentIntentId(paidInvoice) || `invoice-pay-${invoiceId}`;

      const isPaid = paidInvoice.status === 'paid';
      if (isPaid) {
        safeBroadcast({
          bookingId,
          action: 'invoice_paid',
          invoiceId,
          paidInFull: true,
          totalCents: paidInvoice.amount_paid,
        });
      }

      return {
        invoiceId,
        paymentIntentId: resultPiId,
        clientSecret: '',
        status: isPaid ? 'succeeded' : 'requires_action',
        paidInFull: isPaid,
        hostedInvoiceUrl: paidInvoice.hosted_invoice_url ?? null,
        invoicePdf: paidInvoice.invoice_pdf ?? null,
        amountFromBalance,
        amountCharged: Math.max(0, amountCharged),
      };
    } catch (payErr: unknown) {
      const stripeErr = payErr as { type?: string; code?: string; decline_code?: string; payment_intent?: { id: string; status: string; client_secret: string } | string; raw?: { payment_intent?: { id: string; status: string; client_secret: string } | string } };
      const rawPi = typeof stripeErr.payment_intent === 'object' && stripeErr.payment_intent
        ? stripeErr.payment_intent
        : typeof stripeErr.raw?.payment_intent === 'object' && stripeErr.raw.payment_intent
          ? stripeErr.raw.payment_intent
          : null;
      const piId = rawPi?.id || (typeof stripeErr.payment_intent === 'string' ? stripeErr.payment_intent : undefined);
      logger.error('[BookingInvoice] invoices.pay() failed for saved card', {
        extra: {
          error: getErrorMessage(payErr),
          bookingId,
          invoiceId,
          paymentMethodId,
          stripeType: stripeErr.type,
          stripeCode: stripeErr.code,
          declineCode: stripeErr.decline_code,
          piStatus: rawPi?.status,
          piId,
        }
      });
      if (rawPi?.status === 'requires_action' && rawPi?.client_secret) {
        return {
          invoiceId,
          paymentIntentId: rawPi.id,
          clientSecret: rawPi.client_secret,
          status: 'requires_action' as const,
          paidInFull: false,
          hostedInvoiceUrl: null,
          invoicePdf: null,
          amountFromBalance: 0,
          amountCharged: 0,
        };
      }
      if (piId && !rawPi) {
        try {
          const retrievedPi = await stripe.paymentIntents.retrieve(piId);
          if (retrievedPi.status === 'requires_action' && retrievedPi.client_secret) {
            return {
              invoiceId,
              paymentIntentId: retrievedPi.id,
              clientSecret: retrievedPi.client_secret,
              status: 'requires_action' as const,
              paidInFull: false,
              hostedInvoiceUrl: null,
              invoicePdf: null,
              amountFromBalance: 0,
              amountCharged: 0,
            };
          }
        } catch { /* PI retrieval failed, fall through to rethrow */ }
      }
      throw payErr;
    }
  }

  let invoicePiId = extractPaymentIntentId(finalizedInvoice);

  if (!invoicePiId) {
    const expandedInvoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] });
    const expandedRawPi = (expandedInvoice as unknown as { payment_intent: string | Stripe.PaymentIntent | null }).payment_intent;
    if (typeof expandedRawPi === 'object' && expandedRawPi !== null) {
      invoicePiId = expandedRawPi.id;
      logger.info('[BookingInvoice] Retrieved invoice PI via expand', {
        extra: { bookingId, invoiceId, paymentIntentId: invoicePiId, piStatus: expandedRawPi.status }
      });
    }
  }

  if (!invoicePiId) {
    logger.warn('[BookingInvoice] No PaymentIntent after finalization even with expand — returning hosted URL as fallback', {
      extra: { bookingId, invoiceId, invoiceStatus: finalizedInvoice.status }
    });
    return {
      invoiceId,
      paymentIntentId: '',
      clientSecret: '',
      status: 'requires_payment_method',
      paidInFull: false,
      hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url ?? null,
      invoicePdf: finalizedInvoice.invoice_pdf ?? null,
      amountFromBalance: 0,
      amountCharged: 0,
    };
  }

  const invoiceMeta = finalizedInvoice.metadata || {};
  await stripe.paymentIntents.update(invoicePiId, {
    metadata: {
      ...invoiceMeta,
      source: 'ever_house_app',
    },
    description: finalizedInvoice.description || undefined,
  });

  const paymentIntent = await stripe.paymentIntents.retrieve(invoicePiId);

  logger.info('[BookingInvoice] Invoice finalized, awaiting payment', {
    extra: { bookingId, invoiceId, paymentIntentId: invoicePiId }
  });

  return {
    invoiceId,
    paymentIntentId: invoicePiId,
    clientSecret: paymentIntent.client_secret || '',
    status: paymentIntent.status,
    paidInFull: false,
    hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url ?? null,
    invoicePdf: finalizedInvoice.invoice_pdf ?? null,
    amountFromBalance: 0,
    amountCharged: 0,
  };
}

export async function finalizeInvoicePaidOutOfBand(params: {
  bookingId: number;
  terminalPaymentIntentId?: string;
  paidVia?: string;
}): Promise<{
  success: boolean;
  invoiceId?: string;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
  error?: string;
}> {
  const stripe = await getStripeClient();
  const { bookingId, terminalPaymentIntentId, paidVia = 'terminal' } = params;

  const invoiceId = await getBookingInvoiceId(bookingId);
  if (!invoiceId) {
    return { success: false, error: `No invoice found for booking ${bookingId}` };
  }

  try {
    const invoice = await stripe.invoices.retrieve(invoiceId);

    if (invoice.status === 'paid') {
      return {
        success: true,
        invoiceId,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
      };
    }

    if (invoice.status !== 'draft' && invoice.status !== 'open') {
      return { success: false, error: `Invoice ${invoiceId} is in unexpected status: ${invoice.status}` };
    }

    let openInvoice: Stripe.Invoice;
    if (invoice.status === 'draft') {
      await stripe.invoices.update(invoiceId, { auto_advance: false });
      openInvoice = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false });
    } else {
      openInvoice = invoice;
    }

    const piId = extractPaymentIntentId(openInvoice);
    if (piId) {
      try {
        const existingPi = await stripe.paymentIntents.retrieve(piId);
        if (existingPi.status === 'succeeded') {
          const freshInvoice = await stripe.invoices.retrieve(invoiceId);
          if (freshInvoice.status === 'paid') {
            return {
              success: true,
              invoiceId,
              hostedInvoiceUrl: freshInvoice.hosted_invoice_url,
              invoicePdf: freshInvoice.invoice_pdf,
            };
          }
        } else if (existingPi.status === 'processing') {
          logger.warn('[BookingInvoice] Auto-generated PI is processing, waiting before OOB payment', {
            extra: { piId, invoiceId, bookingId }
          });
          await new Promise(resolve => setTimeout(resolve, 3000));
          const recheckPi = await stripe.paymentIntents.retrieve(piId);
          if (recheckPi.status === 'succeeded') {
            const freshInvoice = await stripe.invoices.retrieve(invoiceId);
            if (freshInvoice.status === 'paid') {
              return {
                success: true,
                invoiceId,
                hostedInvoiceUrl: freshInvoice.hosted_invoice_url,
                invoicePdf: freshInvoice.invoice_pdf,
              };
            }
          } else if (recheckPi.status !== 'canceled') {
            // Intentional direct cancel — NOT cancelPaymentIntent() — because we need the invoice to stay open for OOB payment below
            await stripe.paymentIntents.cancel(piId);
          }
        } else if (existingPi.status !== 'canceled') {
          // Intentional direct cancel — NOT cancelPaymentIntent() — because we need the invoice to stay open for OOB payment below
          await stripe.paymentIntents.cancel(piId);
        }
      } catch (cancelErr: unknown) {
        logger.warn('[BookingInvoice] Could not cancel auto-generated PI', {
          extra: { piId, error: getErrorMessage(cancelErr) }
        });
      }
    }

    const preOobInvoice = await stripe.invoices.retrieve(invoiceId);
    if (preOobInvoice.status === 'paid') {
      logger.info('[BookingInvoice] Invoice already paid before OOB step, skipping', {
        extra: { bookingId, invoiceId }
      });
      return {
        success: true,
        invoiceId,
        hostedInvoiceUrl: preOobInvoice.hosted_invoice_url,
        invoicePdf: preOobInvoice.invoice_pdf,
      };
    }

    if (terminalPaymentIntentId) {
      const terminalPi = await stripe.paymentIntents.retrieve(terminalPaymentIntentId);
      const terminalPm = typeof terminalPi.payment_method === 'string'
        ? terminalPi.payment_method
        : terminalPi.payment_method?.id;
      if (terminalPm) {
        await stripe.invoices.pay(invoiceId, { payment_method: terminalPm });
      } else {
        logger.warn(`[BookingInvoice] Terminal PI ${terminalPaymentIntentId} has no payment_method, falling back to paid_out_of_band`);
        await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
      }
    } else {
      await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });
    }

    const invoiceMeta: Record<string, string> = {
      ...(invoice.metadata || {}),
      paidVia,
    };
    if (terminalPaymentIntentId) {
      invoiceMeta.terminalPaymentIntentId = terminalPaymentIntentId;
    } else {
      invoiceMeta.paidOutOfBand = 'true';
    }
    await stripe.invoices.update(invoiceId, { metadata: invoiceMeta });

    const paidInvoice = await stripe.invoices.retrieve(invoiceId);

    logger.info(`[BookingInvoice] Invoice finalized and paid ${terminalPaymentIntentId ? 'via terminal PI' : 'out-of-band'}`, {
      extra: { bookingId, invoiceId, paidVia, terminalPaymentIntentId }
    });

    safeBroadcast({ bookingId, action: 'invoice_paid', invoiceId });

    return {
      success: true,
      invoiceId,
      hostedInvoiceUrl: paidInvoice.hosted_invoice_url,
      invoicePdf: paidInvoice.invoice_pdf,
    };
  } catch (error: unknown) {
    logger.error('[BookingInvoice] Error finalizing invoice OOB', {
      extra: { bookingId, invoiceId, error: getErrorMessage(error) }
    });
    return { success: false, invoiceId, error: getErrorMessage(error) };
  }
}

export async function voidBookingInvoice(bookingId: number): Promise<{
  success: boolean;
  error?: string;
}> {
  const stripe = await getStripeClient();

  const invoiceIds: string[] = [];
  const primaryInvoiceId = await getBookingInvoiceId(bookingId);
  if (primaryInvoiceId) {
    invoiceIds.push(primaryInvoiceId);
  }

  try {
    const searchResult = await stripe.invoices.search({
      query: `metadata["bookingId"]:"${bookingId}"`,
      limit: 20,
    });
    for (const inv of searchResult.data) {
      if (!invoiceIds.includes(inv.id)) {
        invoiceIds.push(inv.id);
      }
    }
  } catch (searchErr: unknown) {
    logger.warn('[BookingInvoice] Failed to search Stripe for booking invoices, falling back to primary only', {
      extra: { bookingId, error: getErrorMessage(searchErr) }
    });
  }

  if (invoiceIds.length === 0) {
    return { success: true };
  }

  const errors: string[] = [];

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['payment_intent'] });

      if (invoice.status === 'draft') {
        await stripe.invoices.del(invoiceId);
        logger.info('[BookingInvoice] Deleted draft invoice for cancelled booking', {
          extra: { bookingId, invoiceId }
        });
      } else if (invoice.status === 'open') {
        await stripe.invoices.voidInvoice(invoiceId);
        logger.info('[BookingInvoice] Voided open invoice for cancelled booking', {
          extra: { bookingId, invoiceId }
        });
      } else if (invoice.status === 'void' || invoice.status === 'uncollectible') {
        logger.info('[BookingInvoice] Invoice already voided or uncollectible, skipping', {
          extra: { bookingId, invoiceId, status: invoice.status }
        });
      } else if (invoice.status === 'paid') {
        const rawInvPi = (invoice as unknown as { payment_intent: string | { id: string } | null }).payment_intent;
        let invoicePI = typeof rawInvPi === 'string'
          ? rawInvPi
          : rawInvPi?.id;

        if (!invoicePI && invoice.amount_paid > 0) {
          const piLookup = await db.execute(sql`
            SELECT stripe_payment_intent_id, status FROM stripe_payment_intents 
            WHERE booking_id = ${bookingId} AND status IN ('succeeded', 'refunding', 'refunded') 
            ORDER BY updated_at DESC LIMIT 1`);
          if (piLookup.rows.length > 0) {
            invoicePI = (piLookup.rows[0] as { stripe_payment_intent_id: string }).stripe_payment_intent_id;
            logger.info('[BookingInvoice] Resolved PI from local DB for paid invoice refund', {
              extra: { bookingId, invoiceId, paymentIntentId: invoicePI }
            });
          }
        }

        if (invoicePI && invoice.amount_paid > 0) {
          const alreadyQueued = await db.execute(sql`
            SELECT 1 FROM stripe_payment_intents 
            WHERE stripe_payment_intent_id = ${invoicePI} AND status IN ('refunding', 'refunded')
            LIMIT 1`);

          if ((alreadyQueued.rows?.length || 0) === 0) {
            const idempotencyKey = `refund_paid_invoice_${bookingId}_${invoiceId}`;
            try {
              const invoiceCustomerEmail = typeof invoice.customer_email === 'string' ? invoice.customer_email : '';

              await db.execute(sql`
                INSERT INTO stripe_payment_intents 
                  (user_id, stripe_payment_intent_id, amount_cents, purpose, booking_id, description, status, created_at, updated_at)
                VALUES (${invoiceCustomerEmail}, ${invoicePI}, ${invoice.amount_paid}, 'booking_fee', ${bookingId}, 'Invoice payment refund', 'refunding', NOW(), NOW())
                ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET status = 'refunding', updated_at = NOW()`);

              const refundCreateParams: { payment_intent: string; reason: 'requested_by_customer'; metadata: Record<string, string>; } = {
                payment_intent: invoicePI,
                reason: 'requested_by_customer',
                metadata: {
                  reason: 'booking_cancellation_paid_invoice',
                  bookingId: bookingId.toString(),
                  invoiceId,
                },
              };
              const refund = await stripe.refunds.create(refundCreateParams, { idempotencyKey });
              logger.info('[BookingInvoice] Refund issued for paid invoice', {
                extra: { bookingId, invoiceId, paymentIntentId: invoicePI, refundId: refund.id, amountPaid: invoice.amount_paid }
              });

              try {
                await markPaymentRefunded({
                  paymentIntentId: invoicePI,
                  refundId: refund.id,
                });
              } catch (statusErr: unknown) {
                logger.warn('[BookingInvoice] Non-blocking: failed to mark payment refunded, setting refund_succeeded_sync_failed', {
                  extra: { paymentIntentId: invoicePI, error: getErrorMessage(statusErr) }
                });
                try {
                  await db.execute(sql`UPDATE stripe_payment_intents 
                     SET status = 'refund_succeeded_sync_failed', updated_at = NOW() 
                     WHERE stripe_payment_intent_id = ${invoicePI}`);
                } catch (syncErr: unknown) {
                  logger.error('[BookingInvoice] CRITICAL: Failed to set refund_succeeded_sync_failed status', {
                    extra: { error: getErrorMessage(syncErr), paymentIntentId: invoicePI }
                  });
                }
              }
            } catch (refundErr: unknown) {
              logger.error('[BookingInvoice] Inline refund failed for paid invoice', {
                extra: { bookingId, invoiceId, paymentIntentId: invoicePI, error: getErrorMessage(refundErr) }
              });
              errors.push(`Failed to refund paid invoice ${invoiceId}: ${getErrorMessage(refundErr)}`);
            }
          } else {
            logger.info('[BookingInvoice] Paid invoice PI already being refunded, skipping', {
              extra: { bookingId, invoiceId, paymentIntentId: invoicePI }
            });
          }
        } else {
          logger.info('[BookingInvoice] Paid invoice has no payment intent or zero amount, skipping refund', {
            extra: { bookingId, invoiceId, amountPaid: invoice.amount_paid }
          });
        }
      }
    } catch (error: unknown) {
      const msg = `Failed to void/handle invoice ${invoiceId}: ${getErrorMessage(error)}`;
      errors.push(msg);
      logger.error('[BookingInvoice] Error processing invoice during cancellation', {
        extra: { bookingId, invoiceId, error: getErrorMessage(error) }
      });
    }
  }

  await db.update(bookingRequests).set({ stripeInvoiceId: null, updatedAt: new Date() }).where(eq(bookingRequests.id, bookingId));

  safeBroadcast({ bookingId, action: 'invoice_voided', invoiceId: invoiceIds[0] });

  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') };
  }

  return { success: true };
}
  