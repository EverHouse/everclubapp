import { schedulerTracker, withLeaderLock } from '../core/schedulerTracker';
import { queryWithRetry } from '../core/db';
import { getStripeClient } from '../core/stripe/client';
import { notifyAllStaff } from '../core/notificationService';
import { logger } from '../core/logger';
import { getErrorMessage, isStripeResourceMissing } from '../utils/errorUtils';

interface DraftInvoiceRow {
  id: number;
  user_email: string;
  user_name: string | null;
  stripe_invoice_id: string;
  status: string;
  request_date: string;
  start_time: string;
  end_time: string | null;
}

interface CleanupResult {
  voidedCount: number;
  deletedCount: number;
  clearedCount: number;
  errorCount: number;
  totalAmountCents: number;
  details: string[];
  errors: string[];
}

const SCHEDULER_NAME = 'Stale Draft Invoice Cleanup';

async function cleanupStaleDraftInvoices(): Promise<void> {
  const startMs = Date.now();
  try {
    const stripe = await getStripeClient();
    const result: CleanupResult = {
      voidedCount: 0,
      deletedCount: 0,
      clearedCount: 0,
      errorCount: 0,
      totalAmountCents: 0,
      details: [],
      errors: [],
    };

    const terminalBookings = await queryWithRetry<DraftInvoiceRow>(
      `SELECT br.id, br.user_email, br.user_name, br.stripe_invoice_id, br.status,
              br.request_date, br.start_time, br.end_time
       FROM booking_requests br
       WHERE br.stripe_invoice_id IS NOT NULL
         AND br.status IN ('declined', 'expired', 'no_show')
       ORDER BY br.updated_at DESC
       LIMIT 200`
    );

    for (const booking of terminalBookings.rows) {
      try {
        const invoice = await stripe.invoices.retrieve(booking.stripe_invoice_id);

        if (invoice.status === 'draft') {
          await stripe.invoices.del(booking.stripe_invoice_id);
          result.deletedCount++;
          result.totalAmountCents += invoice.amount_due || 0;
          result.details.push(`Deleted draft inv ${booking.stripe_invoice_id} for booking #${booking.id} (${booking.status}) — $${((invoice.amount_due || 0) / 100).toFixed(2)}`);
          logger.info('[Stale Draft Cleanup] Deleted draft invoice for terminal booking', {
            extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, status: booking.status, amountCents: invoice.amount_due }
          });
        } else if (invoice.status === 'open') {
          await stripe.invoices.voidInvoice(booking.stripe_invoice_id);
          result.voidedCount++;
          result.totalAmountCents += invoice.amount_due || 0;
          result.details.push(`Voided open inv ${booking.stripe_invoice_id} for booking #${booking.id} (${booking.status}) — $${((invoice.amount_due || 0) / 100).toFixed(2)}`);
          logger.info('[Stale Draft Cleanup] Voided open invoice for terminal booking', {
            extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, status: booking.status, amountCents: invoice.amount_due }
          });
        } else if (invoice.status === 'void' || invoice.status === 'uncollectible') {
          logger.info('[Stale Draft Cleanup] Invoice already void/uncollectible, clearing reference', {
            extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, invoiceStatus: invoice.status }
          });
        } else {
          continue;
        }

        await queryWithRetry(
          `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
          [booking.id, booking.stripe_invoice_id]
        );
        result.clearedCount++;
      } catch (err: unknown) {
        if (isStripeResourceMissing(err)) {
          logger.warn('[Stale Draft Cleanup] Invoice not found in Stripe, clearing stale reference', {
            extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id }
          });
          await queryWithRetry(
            `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
            [booking.id, booking.stripe_invoice_id]
          );
          result.clearedCount++;
          continue;
        }
        result.errorCount++;
        result.errors.push(`Booking #${booking.id} (${booking.stripe_invoice_id}): ${getErrorMessage(err)}`);
        logger.error('[Stale Draft Cleanup] Error processing terminal booking invoice', {
          extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, error: getErrorMessage(err) }
        });
      }
    }

    const lateCancelBookings = await queryWithRetry<DraftInvoiceRow>(
      `SELECT br.id, br.user_email, br.user_name, br.stripe_invoice_id, br.status,
              br.request_date, br.start_time, br.end_time
       FROM booking_requests br
       WHERE br.stripe_invoice_id IS NOT NULL
         AND br.status = 'cancelled'
         AND (
           (br.end_time IS NOT NULL AND (br.request_date::date + br.end_time::time) < (NOW() - INTERVAL '24 hours'))
           OR (br.end_time IS NULL AND (br.request_date::date + br.start_time::time) < (NOW() - INTERVAL '24 hours'))
         )
       ORDER BY br.updated_at DESC
       LIMIT 200`
    );

    for (const booking of lateCancelBookings.rows) {
      try {
        const invoice = await stripe.invoices.retrieve(booking.stripe_invoice_id);

        if (invoice.status === 'draft') {
          await stripe.invoices.del(booking.stripe_invoice_id);
          result.deletedCount++;
          result.totalAmountCents += invoice.amount_due || 0;
          result.details.push(`Deleted late-cancel draft inv ${booking.stripe_invoice_id} for booking #${booking.id} — $${((invoice.amount_due || 0) / 100).toFixed(2)} (24h past end)`);
          logger.info('[Stale Draft Cleanup] Deleted late-cancel draft invoice past 24h window', {
            extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, amountCents: invoice.amount_due }
          });
        } else if (invoice.status === 'void' || invoice.status === 'uncollectible') {
          logger.info('[Stale Draft Cleanup] Late-cancel invoice already void/uncollectible, clearing reference', {
            extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, invoiceStatus: invoice.status }
          });
        } else {
          continue;
        }

        await queryWithRetry(
          `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
          [booking.id, booking.stripe_invoice_id]
        );
        result.clearedCount++;
      } catch (err: unknown) {
        if (isStripeResourceMissing(err)) {
          await queryWithRetry(
            `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
            [booking.id, booking.stripe_invoice_id]
          );
          result.clearedCount++;
          continue;
        }
        result.errorCount++;
        result.errors.push(`Late-cancel #${booking.id} (${booking.stripe_invoice_id}): ${getErrorMessage(err)}`);
        logger.error('[Stale Draft Cleanup] Error processing late-cancel invoice', {
          extra: { bookingId: booking.id, invoiceId: booking.stripe_invoice_id, error: getErrorMessage(err) }
        });
      }
    }

    let orphanedDrafts: { data: Array<{ id: string; status: string | null; amount_due: number; metadata: Record<string, string> | null; created: number }> };
    try {
      orphanedDrafts = await stripe.invoices.search({
        query: `status:"draft" metadata["bookingId"]:"*" -created>${Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60}`,
        limit: 50,
      });
    } catch (searchErr: unknown) {
      logger.warn('[Stale Draft Cleanup] Stripe invoice search failed, skipping orphan check', {
        extra: { error: getErrorMessage(searchErr) }
      });
      orphanedDrafts = { data: [] };
    }

    for (const invoice of orphanedDrafts.data) {
      const bookingIdStr = invoice.metadata?.bookingId;
      if (!bookingIdStr) continue;
      const bookingId = parseInt(bookingIdStr, 10);
      if (isNaN(bookingId)) continue;

      try {
        const bookingCheck = await queryWithRetry<{ id: number; status: string; stripe_invoice_id: string | null }>(
          `SELECT id, status, stripe_invoice_id FROM booking_requests WHERE id = $1 LIMIT 1`,
          [bookingId]
        );

        const booking = bookingCheck.rows[0];
        const terminalStatuses = new Set(['cancelled', 'declined', 'expired', 'no_show']);

        if (!booking || terminalStatuses.has(booking.status)) {
          await stripe.invoices.del(invoice.id);
          result.deletedCount++;
          result.totalAmountCents += invoice.amount_due || 0;
          const reason = !booking ? 'no matching booking' : `booking ${booking.status}`;
          result.details.push(`Deleted orphaned draft inv ${invoice.id} for booking #${bookingId} (${reason}) — $${((invoice.amount_due || 0) / 100).toFixed(2)}`);
          logger.info('[Stale Draft Cleanup] Deleted orphaned Stripe draft invoice', {
            extra: { invoiceId: invoice.id, bookingId, reason, amountCents: invoice.amount_due }
          });

          if (booking?.stripe_invoice_id === invoice.id) {
            await queryWithRetry(
              `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
              [bookingId, invoice.id]
            );
            result.clearedCount++;
          }
        }
      } catch (err: unknown) {
        result.errorCount++;
        result.errors.push(`Orphan inv ${invoice.id} (booking #${bookingId}): ${getErrorMessage(err)}`);
        logger.error('[Stale Draft Cleanup] Error processing orphaned invoice', {
          extra: { invoiceId: invoice.id, bookingId, error: getErrorMessage(err) }
        });
      }
    }

    const totalCleaned = result.deletedCount + result.voidedCount;
    logger.info(`[Stale Draft Cleanup] Complete: ${result.deletedCount} deleted, ${result.voidedCount} voided, ${result.clearedCount} refs cleared, ${result.errorCount} errors, $${(result.totalAmountCents / 100).toFixed(2)} total`);

    if (totalCleaned > 0) {
      const summary = result.details
        .slice(0, 15)
        .join('\n');

      await notifyAllStaff(
        `Stale Draft Invoices Cleaned — ${totalCleaned} Invoice(s)`,
        `${totalCleaned} stale draft invoice(s) were cleaned up (${result.deletedCount} deleted, ${result.voidedCount} voided). Total amount: $${(result.totalAmountCents / 100).toFixed(2)}\n\n${summary}${result.details.length > 15 ? `\n...and ${result.details.length - 15} more` : ''}`,
        'system',
        { sendPush: false }
      );
    }

    if (result.errorCount > 0) {
      const errorSummary = result.errors
        .slice(0, 5)
        .join('\n');

      await notifyAllStaff(
        `Stale Draft Cleanup Errors — ${result.errorCount} Failed`,
        `${result.errorCount} invoice(s) failed during stale draft cleanup:\n\n${errorSummary}${result.errors.length > 5 ? `\n...and ${result.errors.length - 5} more` : ''}`,
        'warning',
        { sendPush: true }
      );
    }

    schedulerTracker.recordRun(SCHEDULER_NAME, result.errorCount === 0, result.errorCount > 0 ? `${result.errorCount} errors` : undefined, Date.now() - startMs);
  } catch (error: unknown) {
    logger.error('[Stale Draft Cleanup] Scheduler error:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun(SCHEDULER_NAME, false, getErrorMessage(error), Date.now() - startMs);
  }
}

let intervalId: NodeJS.Timeout | null = null;
let initialTimeoutId: NodeJS.Timeout | null = null;
let isRunning = false;

async function guardedCleanup(): Promise<void> {
  if (isRunning) {
    logger.info('[Stale Draft Cleanup] Skipping run — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    await withLeaderLock(SCHEDULER_NAME, cleanupStaleDraftInvoices);
  } finally {
    isRunning = false;
  }
}

export function startStaleDraftInvoiceScheduler(): void {
  if (intervalId) {
    logger.info('[Stale Draft Cleanup] Scheduler already running');
    return;
  }

  logger.info('[Startup] Stale draft invoice cleanup scheduler enabled (runs every 24 hours)');

  intervalId = setInterval(() => {
    guardedCleanup().catch((err: unknown) => {
      logger.error('[Stale Draft Cleanup] Uncaught error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 24 * 60 * 60 * 1000);

  initialTimeoutId = setTimeout(() => {
    initialTimeoutId = null;
    guardedCleanup().catch((err: unknown) => {
      logger.error('[Stale Draft Cleanup] Initial run error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 45000);
}

export function stopStaleDraftInvoiceScheduler(): void {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[Stale Draft Cleanup] Scheduler stopped');
  }
}
