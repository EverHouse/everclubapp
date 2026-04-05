import { getStripeClient } from '../server/core/stripe/client';
import { queryWithRetry } from '../server/core/db';
import { getErrorMessage, isStripeResourceMissing } from '../server/utils/errorUtils';

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');

interface BookingRow {
  id: number;
  user_email: string;
  user_name: string | null;
  stripe_invoice_id: string;
  status: string;
  request_date: string;
  start_time: string;
}

interface StaleInvoice {
  invoiceId: string;
  bookingId: number | null;
  bookingStatus: string | null;
  stripeStatus: string | null;
  amountCents: number;
  reason: string;
  customerEmail: string | null;
}

async function findStaleInvoices(): Promise<StaleInvoice[]> {
  const stripe = await getStripeClient();
  const stale: StaleInvoice[] = [];
  const seenInvoiceIds = new Set<string>();

  function addStale(inv: StaleInvoice): void {
    if (seenInvoiceIds.has(inv.invoiceId)) return;
    seenInvoiceIds.add(inv.invoiceId);
    stale.push(inv);
  }

  console.log('\n--- Phase 1: Terminal bookings (declined, expired, no_show) with invoice refs ---');
  const terminalBookings = await queryWithRetry<BookingRow>(
    `SELECT br.id, br.user_email, br.user_name, br.stripe_invoice_id, br.status,
            br.request_date, br.start_time
     FROM booking_requests br
     WHERE br.stripe_invoice_id IS NOT NULL
       AND br.status IN ('declined', 'expired', 'no_show')
     ORDER BY br.updated_at DESC
     LIMIT 500`
  );

  console.log(`Found ${terminalBookings.rows.length} terminal bookings with invoice refs`);

  for (const booking of terminalBookings.rows) {
    try {
      const invoice = await stripe.invoices.retrieve(booking.stripe_invoice_id);
      if (invoice.status === 'draft' || invoice.status === 'open') {
        addStale({
          invoiceId: booking.stripe_invoice_id,
          bookingId: booking.id,
          bookingStatus: booking.status,
          stripeStatus: invoice.status,
          amountCents: invoice.amount_due || 0,
          reason: `Booking #${booking.id} is ${booking.status}`,
          customerEmail: booking.user_email,
        });
      } else if (invoice.status === 'void' || invoice.status === 'uncollectible') {
        addStale({
          invoiceId: booking.stripe_invoice_id,
          bookingId: booking.id,
          bookingStatus: booking.status,
          stripeStatus: invoice.status,
          amountCents: 0,
          reason: `Stale DB ref — invoice already ${invoice.status}`,
          customerEmail: booking.user_email,
        });
      }
    } catch (err: unknown) {
      if (isStripeResourceMissing(err)) {
        addStale({
          invoiceId: booking.stripe_invoice_id,
          bookingId: booking.id,
          bookingStatus: booking.status,
          stripeStatus: 'NOT_FOUND',
          amountCents: 0,
          reason: `Stale DB ref — invoice not found in Stripe`,
          customerEmail: booking.user_email,
        });
      } else {
        console.error(`  Error checking invoice ${booking.stripe_invoice_id}: ${getErrorMessage(err)}`);
      }
    }
  }

  console.log('\n--- Phase 2: Cancelled bookings with invoice refs (24h past booking end) ---');
  const lateCancelBookings = await queryWithRetry<BookingRow>(
    `SELECT br.id, br.user_email, br.user_name, br.stripe_invoice_id, br.status,
            br.request_date, br.start_time
     FROM booking_requests br
     WHERE br.stripe_invoice_id IS NOT NULL
       AND br.status = 'cancelled'
       AND (
         (br.end_time IS NOT NULL AND (br.request_date::date + br.end_time::time) < (NOW() - INTERVAL '24 hours'))
         OR (br.end_time IS NULL AND (br.request_date::date + br.start_time::time) < (NOW() - INTERVAL '24 hours'))
       )
     ORDER BY br.updated_at DESC
     LIMIT 500`
  );

  console.log(`Found ${lateCancelBookings.rows.length} cancelled bookings past 24h window with invoice refs`);

  for (const booking of lateCancelBookings.rows) {
    try {
      const invoice = await stripe.invoices.retrieve(booking.stripe_invoice_id);
      if (invoice.status === 'draft') {
        addStale({
          invoiceId: booking.stripe_invoice_id,
          bookingId: booking.id,
          bookingStatus: booking.status,
          stripeStatus: invoice.status,
          amountCents: invoice.amount_due || 0,
          reason: `Late-cancel booking #${booking.id} — draft 24h past end`,
          customerEmail: booking.user_email,
        });
      } else if (invoice.status === 'void' || invoice.status === 'uncollectible') {
        addStale({
          invoiceId: booking.stripe_invoice_id,
          bookingId: booking.id,
          bookingStatus: booking.status,
          stripeStatus: invoice.status,
          amountCents: 0,
          reason: `Stale DB ref — late-cancel invoice already ${invoice.status}`,
          customerEmail: booking.user_email,
        });
      }
    } catch (err: unknown) {
      if (isStripeResourceMissing(err)) {
        addStale({
          invoiceId: booking.stripe_invoice_id,
          bookingId: booking.id,
          bookingStatus: booking.status,
          stripeStatus: 'NOT_FOUND',
          amountCents: 0,
          reason: `Stale DB ref — late-cancel invoice not found in Stripe`,
          customerEmail: booking.user_email,
        });
      } else {
        console.error(`  Error checking invoice ${booking.stripe_invoice_id}: ${getErrorMessage(err)}`);
      }
    }
  }

  console.log('\n--- Phase 3: Searching Stripe for orphaned draft invoices with bookingId metadata ---');
  try {
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    const searchResult = await stripe.invoices.search({
      query: `status:"draft" metadata["bookingId"]:"*" -created>${sevenDaysAgo}`,
      limit: 100,
    });

    console.log(`Found ${searchResult.data.length} old draft invoices in Stripe with bookingId metadata`);

    for (const invoice of searchResult.data) {
      if (seenInvoiceIds.has(invoice.id)) continue;

      const bookingIdStr = invoice.metadata?.bookingId;
      if (!bookingIdStr) continue;
      const bookingId = parseInt(bookingIdStr, 10);
      if (isNaN(bookingId)) continue;

      const bookingCheck = await queryWithRetry<{ id: number; status: string }>(
        `SELECT id, status FROM booking_requests WHERE id = $1 LIMIT 1`,
        [bookingId]
      );
      const booking = bookingCheck.rows[0];
      const terminalStatuses = new Set(['cancelled', 'declined', 'expired', 'no_show']);

      if (!booking || terminalStatuses.has(booking.status)) {
        addStale({
          invoiceId: invoice.id,
          bookingId,
          bookingStatus: booking?.status || 'NOT_FOUND',
          stripeStatus: invoice.status,
          amountCents: invoice.amount_due || 0,
          reason: !booking ? 'No matching booking in DB' : `Booking is ${booking.status}`,
          customerEmail: null,
        });
      }
    }
  } catch (err: unknown) {
    console.error(`Stripe search failed: ${getErrorMessage(err)}`);
  }

  return stale;
}

async function cleanupInvoice(inv: StaleInvoice): Promise<{ success: boolean; action: string; error?: string }> {
  try {
    const stripe = await getStripeClient();

    if (inv.stripeStatus === 'NOT_FOUND' || inv.stripeStatus === 'void' || inv.stripeStatus === 'uncollectible') {
      if (inv.bookingId) {
        await queryWithRetry(
          `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
          [inv.bookingId, inv.invoiceId]
        );
      }
      return { success: true, action: 'cleared_stale_ref' };
    }

    if (inv.stripeStatus === 'draft') {
      await stripe.invoices.del(inv.invoiceId);
    } else if (inv.stripeStatus === 'open') {
      await stripe.invoices.voidInvoice(inv.invoiceId);
    }

    if (inv.bookingId) {
      await queryWithRetry(
        `UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = $1 AND stripe_invoice_id = $2`,
        [inv.bookingId, inv.invoiceId]
      );
    }

    return { success: true, action: inv.stripeStatus === 'draft' ? 'deleted' : 'voided' };
  } catch (err: unknown) {
    return { success: false, action: 'failed', error: getErrorMessage(err) };
  }
}

async function main(): Promise<void> {
  console.log('=== Stale Draft Invoice Cleanup Script ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Date: ${new Date().toISOString()}\n`);

  const staleInvoices = await findStaleInvoices();

  if (staleInvoices.length === 0) {
    console.log('\nNo stale invoices found. All clean!');
    return;
  }

  console.log(`\n=== Found ${staleInvoices.length} stale invoice(s) ===\n`);

  const totalAmountCents = staleInvoices.reduce((sum, inv) => sum + inv.amountCents, 0);
  console.log(`Total amount to void/delete: $${(totalAmountCents / 100).toFixed(2)}\n`);

  for (const inv of staleInvoices) {
    console.log(`  ${inv.invoiceId} | Booking #${inv.bookingId || 'N/A'} | ${inv.bookingStatus || 'N/A'} | Stripe: ${inv.stripeStatus} | $${(inv.amountCents / 100).toFixed(2)} | ${inv.reason}`);
  }

  if (DRY_RUN) {
    console.log('\n--- DRY RUN complete. No changes made. ---');
    console.log('Run without --dry-run to execute cleanup.');
    return;
  }

  if (!FORCE) {
    console.log('\n--- Pass --force to execute cleanup without this warning. ---');
    console.log('Proceeding with cleanup in 5 seconds...');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log('\n=== Executing cleanup ===\n');

  let successCount = 0;
  let failCount = 0;

  for (const inv of staleInvoices) {
    const result = await cleanupInvoice(inv);
    if (result.success) {
      successCount++;
      console.log(`  ✓ ${inv.invoiceId} — ${result.action}`);
    } else {
      failCount++;
      console.log(`  ✗ ${inv.invoiceId} — ${result.error}`);
    }
  }

  console.log(`\n=== Cleanup complete ===`);
  console.log(`  Success: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log(`  Total amount cleaned: $${(totalAmountCents / 100).toFixed(2)}`);
}

main().catch((err) => {
  console.error('Fatal error:', getErrorMessage(err));
  process.exit(1);
});
