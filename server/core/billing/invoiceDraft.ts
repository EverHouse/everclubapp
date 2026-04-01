import { createHash } from 'crypto';
  import { getStripeClient } from '../stripe/client';
  import { db } from '../../db';
  import { logger } from '../logger';
  import { getErrorMessage } from '../../utils/errorUtils';
  import { sql } from 'drizzle-orm';
  import type { BookingFeeLineItem } from '../stripe/invoices';
  import { PARTICIPANT_TYPE, RESOURCE_TYPE } from '../../../shared/constants/statuses';
  import type { ParticipantType } from '../../../shared/constants/statuses';
  import {
    type DraftInvoiceParams,
    type DraftInvoiceResult,
    safeBroadcast,
    buildInvoiceMetadata,
    addLineItemsToInvoice,
  } from './bookingInvoiceTypes';

  interface BookingInvoiceIdRow {
    stripe_invoice_id: string | null;
  }

  interface TrackmanBookingIdRow {
    trackman_booking_id: string | null;
  }

  export async function buildInvoiceDescription(
  bookingId: number,
  trackmanBookingId: string | null | undefined,
): Promise<string> {
  const bookingRef = trackmanBookingId ? `TM-${trackmanBookingId}` : `#${bookingId}`;
  try {
    const result = await db.execute(sql`
      SELECT br.request_date, br.start_time, br.end_time, r.name AS resource_name
      FROM booking_requests br
      LEFT JOIN resources r ON r.id = br.resource_id
      WHERE br.id = ${bookingId}
      LIMIT 1
    `);
    const row = result.rows[0] as { request_date: string; start_time: string; end_time: string; resource_name: string | null } | undefined;
    if (row) {
      const date = new Date(row.request_date);
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
      const formatTime = (t: string) => {
        const [h, m] = t.split(':').map(Number);
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`;
      };
      const timeRange = `${formatTime(row.start_time)}–${formatTime(row.end_time)}`;
      const resource = row.resource_name || 'Unassigned';
      return `Booking ${bookingRef} — ${resource}, ${dateStr}, ${timeRange}`;
    }
  } catch (err: unknown) {
    logger.warn('[BookingInvoice] Could not fetch booking details for invoice description', {
      extra: { bookingId, error: getErrorMessage(err) }
    });
  }
  return `Booking ${bookingRef} fees`;
}

  export async function createDraftInvoiceForBooking(
  params: DraftInvoiceParams
): Promise<DraftInvoiceResult> {
  const stripe = await getStripeClient();
  const { customerId, bookingId, sessionId, trackmanBookingId, feeLineItems } = params;

  const existingResult = await db.execute(sql`SELECT stripe_invoice_id FROM booking_requests WHERE id = ${bookingId} LIMIT 1`);
  const existingInvoiceId = existingResult.rows[0]?.stripe_invoice_id as string | undefined;

  if (existingInvoiceId) {
    try {
      let existingInvoice;
      try {
        existingInvoice = await stripe.invoices.retrieve(existingInvoiceId);
      } catch (retrieveErr: unknown) {
        const stripeErr = retrieveErr as { statusCode?: number };
        if (stripeErr.statusCode === 404) {
          logger.warn('[BookingInvoice] Stale invoice reference — invoice not found in Stripe, clearing and creating new draft', {
            extra: { bookingId, invoiceId: existingInvoiceId }
          });
          await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${bookingId}`);
          existingInvoice = null;
        } else {
          throw retrieveErr;
        }
      }
      if (existingInvoice && existingInvoice.status === 'draft') {
        logger.info('[BookingInvoice] Draft invoice already exists, updating instead', {
          extra: { bookingId, invoiceId: existingInvoiceId }
        });
        return updateDraftInvoiceLineItems({ bookingId, sessionId, feeLineItems });
      }
      if (existingInvoice && existingInvoice.status === 'paid') {
        logger.info('[BookingInvoice] Invoice already paid, skipping draft creation', {
          extra: { bookingId, invoiceId: existingInvoiceId }
        });
        return { invoiceId: existingInvoiceId, totalCents: existingInvoice.amount_paid };
      }
      if (existingInvoice && existingInvoice.status === 'open') {
        const newTotal = feeLineItems.reduce((sum, li) => sum + li.totalCents, 0);
        if (existingInvoice.amount_due !== newTotal) {
          logger.info('[BookingInvoice] Open invoice amount stale, voiding and recreating', {
            extra: { bookingId, invoiceId: existingInvoiceId, oldAmount: existingInvoice.amount_due, newAmount: newTotal }
          });
          await stripe.invoices.voidInvoice(existingInvoiceId);
          await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL WHERE id = ${bookingId}`);
        } else {
          logger.info('[BookingInvoice] Open invoice exists with correct amount, reusing', {
            extra: { bookingId, invoiceId: existingInvoiceId }
          });
          return { invoiceId: existingInvoiceId, totalCents: existingInvoice.amount_due };
        }
      }
      if (existingInvoice && (existingInvoice.status === 'void' || existingInvoice.status === 'uncollectible')) {
        logger.info('[BookingInvoice] Existing invoice is void/uncollectible, clearing reference before creating new draft', {
          extra: { bookingId, invoiceId: existingInvoiceId, status: existingInvoice.status }
        });
        await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${bookingId}`);
      }
    } catch (retrieveErr: unknown) {
      logger.warn('[BookingInvoice] Could not retrieve existing invoice, creating new one', {
        extra: { bookingId, existingInvoiceId, error: getErrorMessage(retrieveErr) }
      });
    }
  }

  const description = await buildInvoiceDescription(bookingId, trackmanBookingId);
  const invoiceMetadata = buildInvoiceMetadata(params, feeLineItems);

  let invoice = await stripe.invoices.create({
    customer: customerId,
    auto_advance: false,
    collection_method: 'charge_automatically',
    description,
    metadata: invoiceMetadata,
    pending_invoice_items_behavior: 'exclude',
    payment_settings: {
      payment_method_types: ['card', 'link'],
    },
  }, {
    idempotencyKey: `invoice_booking_draft_${bookingId}_${sessionId}_${createHash('sha256').update(JSON.stringify(feeLineItems.map(li => ({ id: li.participantId, o: li.overageCents, g: li.guestCents, t: li.totalCents })).sort((a, b) => String(a.id || '').localeCompare(String(b.id || ''))))).digest('hex').substring(0, 12)}_${Math.floor(Date.now() / 60000)}`
  });

  if (invoice.status === 'void' || invoice.status === 'uncollectible') {
    logger.warn('[BookingInvoice] Idempotency key returned stale void/uncollectible invoice, retrying with fresh key', {
      extra: { bookingId, staleInvoiceId: invoice.id, status: invoice.status }
    });
    invoice = await stripe.invoices.create({
      customer: customerId,
      auto_advance: false,
      collection_method: 'charge_automatically',
      description,
      metadata: invoiceMetadata,
      pending_invoice_items_behavior: 'exclude',
      payment_settings: {
        payment_method_types: ['card', 'link'],
      },
    }, {
      idempotencyKey: `invoice_booking_draft_${bookingId}_${sessionId}_retry_${Date.now()}`
    });
  }

  try {
    await addLineItemsToInvoice(stripe, invoice.id, customerId, feeLineItems);
  } catch (lineItemErr: unknown) {
    logger.error('[BookingInvoice] Failed to add line items, cleaning up orphaned invoice', {
      extra: { bookingId, invoiceId: invoice.id, error: getErrorMessage(lineItemErr) }
    });
    try {
      await stripe.invoices.del(invoice.id);
    } catch (deleteErr: unknown) {
      logger.error('[BookingInvoice] Failed to delete orphaned draft invoice in Stripe', {
        extra: { bookingId, invoiceId: invoice.id, error: getErrorMessage(deleteErr) }
      });
    }
    throw lineItemErr;
  }

  const totalCents = feeLineItems.reduce((sum, li) => sum + li.totalCents, 0);

  try {
    await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = ${invoice.id}, updated_at = NOW() WHERE id = ${bookingId}`);
  } catch (dbErr: unknown) {
    logger.error('[BookingInvoice] Failed to link invoice to booking in DB, cleaning up Stripe invoice', {
      extra: { bookingId, invoiceId: invoice.id, error: getErrorMessage(dbErr) }
    });
    try {
      await stripe.invoices.del(invoice.id);
    } catch (deleteErr: unknown) {
      logger.error('[BookingInvoice] ORPHANED INVOICE: Failed to delete draft invoice after DB error', {
        extra: { bookingId, invoiceId: invoice.id, error: getErrorMessage(deleteErr) }
      });
    }
    throw dbErr;
  }

  logger.info('[BookingInvoice] Created draft invoice for booking', {
    extra: { bookingId, sessionId, invoiceId: invoice.id, totalCents, lineItems: feeLineItems.length }
  });

  safeBroadcast({ bookingId, sessionId, action: 'invoice_created', invoiceId: invoice.id, totalCents });

  return { invoiceId: invoice.id, totalCents };
}

export async function updateDraftInvoiceLineItems(params: {
  bookingId: number;
  sessionId: number;
  feeLineItems: BookingFeeLineItem[];
}): Promise<DraftInvoiceResult> {
  const stripe = await getStripeClient();
  const { bookingId, sessionId, feeLineItems } = params;

  const result = await db.execute(sql`SELECT stripe_invoice_id FROM booking_requests WHERE id = ${bookingId} LIMIT 1`);
  const invoiceId = (result.rows as unknown as BookingInvoiceIdRow[])[0]?.stripe_invoice_id;

  if (!invoiceId) {
    throw new Error(`No draft invoice found for booking ${bookingId}`);
  }

  const invoice = await stripe.invoices.retrieve(invoiceId, { expand: ['lines.data'] });

  if (invoice.status !== 'draft') {
    logger.warn('[BookingInvoice] Cannot update non-draft invoice', {
      extra: { bookingId, invoiceId, status: invoice.status }
    });
    return { invoiceId, totalCents: invoice.amount_due };
  }

  const invoiceItems = await stripe.invoiceItems.list({ invoice: invoiceId, limit: 100 });
  for (const item of invoiceItems.data) {
    await stripe.invoiceItems.del(item.id);
  }

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id || '';
  await addLineItemsToInvoice(stripe, invoiceId, customerId, feeLineItems);

  const totalOverageCents = feeLineItems.reduce((sum, li) => sum + li.overageCents, 0);
  const totalGuestCents = feeLineItems.reduce((sum, li) => sum + li.guestCents, 0);
  const totalCents = feeLineItems.reduce((sum, li) => sum + li.totalCents, 0);

  const trackmanResult = await db.execute(sql`SELECT trackman_booking_id FROM booking_requests WHERE id = ${bookingId} LIMIT 1`);
  const trackmanBookingId = (trackmanResult.rows as unknown as TrackmanBookingIdRow[])[0]?.trackman_booking_id || null;

  await stripe.invoices.update(invoiceId, {
    description: await buildInvoiceDescription(bookingId, trackmanBookingId),
    metadata: {
      ...(invoice.metadata || {}),
      overageCents: totalOverageCents.toString(),
      guestCents: totalGuestCents.toString(),
      lastRosterUpdate: new Date().toISOString(),
    },
  });

  logger.info('[BookingInvoice] Updated draft invoice line items after roster change', {
    extra: { bookingId, sessionId, invoiceId, totalCents, lineItems: feeLineItems.length }
  });

  safeBroadcast({ bookingId, sessionId, action: 'invoice_updated', invoiceId, totalCents });

  return { invoiceId, totalCents };
}
  