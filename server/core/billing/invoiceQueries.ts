import { db } from '../../db';
  import { logger } from '../logger';
  import { getErrorMessage } from '../../utils/errorUtils';
  import { sql } from 'drizzle-orm';
  import { getStripeClient } from '../stripe/client';
  import { PAYMENT_STATUS } from '../../../shared/constants/statuses';

  interface BookingInvoiceIdRow {
    stripe_invoice_id: string | null;
  }

  export async function getBookingInvoiceId(bookingId: number): Promise<string | null> {
  const result = await db.execute(sql`SELECT stripe_invoice_id FROM booking_requests WHERE id = ${bookingId} LIMIT 1`);
  return (result.rows as unknown as BookingInvoiceIdRow[])[0]?.stripe_invoice_id || null;
}

export async function getBookingInvoiceStatus(bookingId: number): Promise<{
  invoiceId: string | null;
  status: string | null;
  amountDue: number;
} | null> {
  const invoiceId = await getBookingInvoiceId(bookingId);
  if (!invoiceId) return null;

  try {
    const stripe = await getStripeClient();
    const invoice = await stripe.invoices.retrieve(invoiceId);
    return {
      invoiceId,
      status: invoice.status,
      amountDue: invoice.amount_due,
    };
  } catch (err) {
    logger.warn('[BookingInvoice] Failed to retrieve invoice status', { extra: { error: getErrorMessage(err) } });
    return null;
  }
}

  export async function isBookingInvoicePaid(bookingId: number): Promise<{ locked: boolean; invoiceId?: string; reason?: string }> {
  try {
    const bookingResult = await db.execute(sql`SELECT stripe_invoice_id FROM booking_requests WHERE id = ${bookingId} LIMIT 1`);
    const invoiceId = (bookingResult.rows as unknown as BookingInvoiceIdRow[])[0]?.stripe_invoice_id;
    if (!invoiceId) return { locked: false };

    try {
      const stripe = await getStripeClient();
      const invoice = await stripe.invoices.retrieve(invoiceId);
      if (invoice.status === 'paid') {
        return { locked: true, invoiceId, reason: 'Invoice has been paid' };
      }
      return { locked: false };
    } catch (stripeErr) {
      logger.warn('[BookingInvoice] Stripe check failed, falling back to local fee snapshot', {
        extra: { bookingId, invoiceId, error: getErrorMessage(stripeErr) }
      });
      try {
        const completedSnapshot = await db.execute(sql`
          SELECT id, total_cents FROM booking_fee_snapshots
          WHERE booking_id = ${bookingId}
            AND status = 'completed'
            AND total_cents > 0
          LIMIT 1
        `);
        const snapshot = (completedSnapshot.rows as unknown as Array<{ id: number; total_cents: number }>)[0];
        if (snapshot) {
          return { locked: true, invoiceId, reason: 'Invoice has been paid (verified from completed payment snapshot)' };
        }
        return { locked: false };
      } catch (fallbackErr) {
        logger.error('[BookingInvoice] Both Stripe and local fallback failed for invoice check', {
          extra: { bookingId, invoiceId, error: getErrorMessage(fallbackErr) }
        });
        return { locked: true, invoiceId, reason: 'Unable to verify invoice status — locked as a precaution' };
      }
    }
  } catch (dbErr) {
    logger.error('[BookingInvoice] DB query failed in isBookingInvoicePaid — locking as precaution', {
      extra: { bookingId, error: getErrorMessage(dbErr) }
    });
    return { locked: true, reason: 'Unable to verify invoice status — locked as a precaution' };
  }
}

export interface BookingPaymentStatus {
  allPaid: boolean;
  hasPaidFees: boolean;
  pendingFeeCount: number;
  totalWithFees: number;
  paidCount: number;
  hasCompletedSnapshot: boolean;
}

  export async function checkBookingPaymentStatus(params: {
  bookingId: number;
  sessionId: number;
  hasEmptySlots?: boolean;
}): Promise<BookingPaymentStatus> {
  const { bookingId, sessionId, hasEmptySlots = false } = params;

  const [paidCheck, feeSnapshotCheck] = await Promise.all([
    db.execute(sql`SELECT 
         COUNT(*) FILTER (WHERE payment_status IN (${PAYMENT_STATUS.PAID}, ${PAYMENT_STATUS.WAIVED})) as paid_count,
         COUNT(*) FILTER (WHERE cached_fee_cents > 0 OR payment_status IN (${PAYMENT_STATUS.PAID}, ${PAYMENT_STATUS.WAIVED})) as total_with_fees,
         COUNT(*) FILTER (WHERE cached_fee_cents > 0 AND payment_status NOT IN (${PAYMENT_STATUS.PAID}, ${PAYMENT_STATUS.WAIVED})) as pending_count
       FROM booking_participants 
       WHERE session_id = ${sessionId}`),
    db.execute(sql`SELECT id, total_cents FROM booking_fee_snapshots 
       WHERE session_id = ${sessionId} AND status IN ('completed', 'paid') 
       ORDER BY created_at DESC LIMIT 1`),
  ]);

  interface PaidRow { paid_count: string; total_with_fees: string; pending_count: string }
  const row = paidCheck.rows[0] as unknown as PaidRow;
  const paidCount = parseInt(row?.paid_count || '0', 10);
  const totalWithFees = parseInt(row?.total_with_fees || '0', 10);
  const pendingFeeCount = parseInt(row?.pending_count || '0', 10);
  const hasCompletedSnapshot = feeSnapshotCheck.rows.length > 0;
  const hasPaidFees = paidCount > 0;

  let allPaid = (
    (hasCompletedSnapshot && pendingFeeCount === 0) ||
    (pendingFeeCount === 0 && hasPaidFees)
  );

  if (allPaid) {
    const syntheticPaidCheck = await db.execute(sql`
      SELECT bp.id, bp.stripe_payment_intent_id 
      FROM booking_participants bp
      WHERE bp.session_id = ${sessionId}
        AND bp.payment_status = 'paid'
        AND bp.cached_fee_cents > 0
        AND bp.stripe_payment_intent_id IS NOT NULL
        AND bp.stripe_payment_intent_id NOT LIKE 'pi_%'
    `);
    if (syntheticPaidCheck.rows.length > 0) {
      const syntheticIds = (syntheticPaidCheck.rows as Array<{ id: number; stripe_payment_intent_id: string }>);
      logger.warn('[PaymentStatus] Found participants marked paid with synthetic/non-Stripe PI IDs — resetting to pending', {
        extra: { bookingId, sessionId, participantIds: syntheticIds.map(r => r.id), piIds: syntheticIds.map(r => r.stripe_payment_intent_id) }
      });
      await db.execute(sql`
        UPDATE booking_participants 
        SET payment_status = 'pending', stripe_payment_intent_id = NULL, paid_at = NULL
        WHERE session_id = ${sessionId}
          AND payment_status = 'paid'
          AND cached_fee_cents > 0
          AND stripe_payment_intent_id IS NOT NULL
          AND stripe_payment_intent_id NOT LIKE 'pi_%'
      `);
      await db.execute(sql`
        UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW()
        WHERE booking_id = ${bookingId} AND status IN ('succeeded', 'processing')
          AND stripe_payment_intent_id NOT LIKE 'pi_%'
      `);
      await db.execute(sql`
        UPDATE booking_fee_snapshots SET status = 'stale'
        WHERE session_id = ${sessionId} AND status IN ('completed', 'paid')
          AND stripe_payment_intent_id IS NOT NULL AND stripe_payment_intent_id NOT LIKE 'pi_%'
      `);
      allPaid = false;
    }

    if (allPaid) {
      const invoiceStatus = await isBookingInvoicePaid(bookingId);
      if (invoiceStatus.locked === false && hasPaidFees) {
        const hasSucceededPi = await db.execute(
          sql`SELECT 1 FROM stripe_payment_intents WHERE booking_id = ${bookingId} AND status = 'succeeded' AND stripe_payment_intent_id LIKE 'pi_%' LIMIT 1`
        );
        if (hasSucceededPi.rows.length === 0) {
          allPaid = false;
        }
      }
    }
  }

  return { allPaid, hasPaidFees, pendingFeeCount, totalWithFees, paidCount, hasCompletedSnapshot };
}

  