import { schedulerTracker, withLeaderLock } from '../core/schedulerTracker';
import { queryWithRetry } from '../core/db';
import { getStripeClient } from '../core/stripe/client';
import { notifyAllStaff } from '../core/notificationService';
import { logger } from '../core/logger';
import { getErrorMessage, isStripeResourceMissing } from '../utils/errorUtils';
import { getTodayPacific, formatTimePacific } from '../utils/dateUtils';

interface DraftInvoiceBooking {
  id: number;
  userEmail: string;
  userName: string | null;
  stripeInvoiceId: string;
  requestDate: string;
  startTime: string;
}

const SCHEDULER_NAME = 'Invoice Auto-Finalize';

async function autoFinalizeDraftInvoices(): Promise<void> {
  const startMs = Date.now();
  try {
    const now = new Date();
    const todayStr = getTodayPacific();
    const currentTimePacific = formatTimePacific(now);

    logger.info(`[Invoice Auto-Finalize] Running auto-finalize check at ${todayStr} ${currentTimePacific}`);

    const result = await queryWithRetry<DraftInvoiceBooking>(
      `SELECT br.id, br.user_email AS "userEmail", br.user_name AS "userName",
              br.stripe_invoice_id AS "stripeInvoiceId",
              br.request_date AS "requestDate", br.start_time AS "startTime"
       FROM booking_requests br
       WHERE br.stripe_invoice_id IS NOT NULL
         AND br.status IN ('approved', 'confirmed', 'attended')
         AND (
           br.request_date < $1::date
           OR (br.request_date = $1::date AND br.start_time::time <= $2::time)
         )
         AND br.request_date >= $1::date - INTERVAL '30 days'`,
      [todayStr, currentTimePacific]
    );

    if (result.rows.length === 0) {
      logger.info('[Invoice Auto-Finalize] No eligible draft invoices found');
      schedulerTracker.recordRun(SCHEDULER_NAME, true, undefined, Date.now() - startMs);
      return;
    }

    logger.info(`[Invoice Auto-Finalize] Found ${result.rows.length} booking(s) with invoices to check`);

    const stripe = await getStripeClient();
    let finalizedCount = 0;
    let alreadyFinalizedCount = 0;
    let errorCount = 0;
    let clearedCount = 0;
    const finalizedBookings: DraftInvoiceBooking[] = [];
    const errors: { bookingId: number; error: string }[] = [];

    for (const booking of result.rows) {
      try {
        const invoice = await stripe.invoices.retrieve(booking.stripeInvoiceId);

        if (invoice.status !== 'draft') {
          alreadyFinalizedCount++;
          continue;
        }

        await stripe.invoices.finalizeInvoice(booking.stripeInvoiceId);
        finalizedCount++;
        finalizedBookings.push(booking);

        logger.info('[Invoice Auto-Finalize] Finalized draft invoice', {
          extra: {
            bookingId: booking.id,
            invoiceId: booking.stripeInvoiceId,
            userEmail: booking.userEmail,
          }
        });
      } catch (err: unknown) {
        const errMsg = getErrorMessage(err);

        if (isStripeResourceMissing(err)) {
          logger.warn('[Invoice Auto-Finalize] Invoice no longer exists in Stripe — clearing stale reference', {
            extra: { bookingId: booking.id, invoiceId: booking.stripeInvoiceId }
          });
          try {
            const clearResult = await queryWithRetry(
              `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
              [booking.id, booking.stripeInvoiceId]
            );
            if (clearResult.rowCount && clearResult.rowCount > 0) {
              clearedCount++;
            } else {
              logger.info('[Invoice Auto-Finalize] Stale invoice reference already updated by another process', {
                extra: { bookingId: booking.id, invoiceId: booking.stripeInvoiceId }
              });
            }
          } catch (clearErr: unknown) {
            logger.error('[Invoice Auto-Finalize] Failed to clear stale invoice ID', {
              extra: { bookingId: booking.id, error: getErrorMessage(clearErr) }
            });
            errorCount++;
            errors.push({ bookingId: booking.id, error: errMsg });
          }
          continue;
        }

        errorCount++;
        errors.push({ bookingId: booking.id, error: errMsg });

        logger.error('[Invoice Auto-Finalize] Failed to finalize invoice', {
          extra: {
            bookingId: booking.id,
            invoiceId: booking.stripeInvoiceId,
            error: errMsg,
          }
        });
      }
    }

    logger.info(`[Invoice Auto-Finalize] Complete: ${finalizedCount} finalized, ${alreadyFinalizedCount} already non-draft, ${clearedCount} stale cleared, ${errorCount} errors`);

    if (finalizedCount > 0) {
      const summary = finalizedBookings
        .slice(0, 10)
        .map(b => `• #${b.id} ${b.userName || b.userEmail} — ${b.requestDate} ${b.startTime}`)
        .join('\n');

      await notifyAllStaff(
        `Invoices Auto-Finalized — ${finalizedCount} Booking(s)`,
        `${finalizedCount} draft invoice(s) were auto-finalized because the booking start time passed. Stripe will email the member a payment link:\n\n${summary}${finalizedCount > 10 ? `\n...and ${finalizedCount - 10} more` : ''}`,
        'system',
        { sendPush: false }
      );
    }

    if (errorCount > 0) {
      const errorSummary = errors
        .slice(0, 5)
        .map(e => `• Booking #${e.bookingId}: ${e.error}`)
        .join('\n');

      await notifyAllStaff(
        `Invoice Auto-Finalize Errors — ${errorCount} Failed`,
        `${errorCount} invoice(s) failed to auto-finalize:\n\n${errorSummary}${errorCount > 5 ? `\n...and ${errorCount - 5} more` : ''}`,
        'warning',
        { sendPush: true }
      );
    }

    schedulerTracker.recordRun(SCHEDULER_NAME, errorCount === 0, errorCount > 0 ? `${errorCount} finalization errors` : undefined, Date.now() - startMs);
  } catch (error: unknown) {
    logger.error('[Invoice Auto-Finalize] Error running auto-finalize:', { extra: { error: getErrorMessage(error) } });
    schedulerTracker.recordRun(SCHEDULER_NAME, false, getErrorMessage(error), Date.now() - startMs);
  }
}

let intervalId: NodeJS.Timeout | null = null;
let initialTimeoutId: NodeJS.Timeout | null = null;
let isRunning = false;

async function guardedAutoFinalize(): Promise<void> {
  if (isRunning) {
    logger.info('[Invoice Auto-Finalize] Skipping run — previous run still in progress');
    return;
  }
  isRunning = true;
  try {
    await withLeaderLock(SCHEDULER_NAME, autoFinalizeDraftInvoices);
  } finally {
    isRunning = false;
  }
}

export function startInvoiceAutoFinalizeScheduler(): void {
  if (intervalId) {
    logger.info('[Invoice Auto-Finalize] Scheduler already running');
    return;
  }

  logger.info('[Startup] Invoice auto-finalize scheduler enabled (runs every 30 minutes)');

  intervalId = setInterval(() => {
    guardedAutoFinalize().catch((err: unknown) => {
      logger.error('[Invoice Auto-Finalize] Uncaught error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 30 * 60 * 1000);

  initialTimeoutId = setTimeout(() => {
    initialTimeoutId = null;
    guardedAutoFinalize().catch((err: unknown) => {
      logger.error('[Invoice Auto-Finalize] Initial run error:', { extra: { error: getErrorMessage(err) } });
    });
  }, 30000);
}

export function stopInvoiceAutoFinalizeScheduler(): void {
  if (initialTimeoutId) {
    clearTimeout(initialTimeoutId);
    initialTimeoutId = null;
  }
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('[Invoice Auto-Finalize] Scheduler stopped');
  }
}
