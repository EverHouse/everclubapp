import { logger } from '../core/logger';
import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getStripeClient } from '../core/stripe/client';
import { sendOutstandingBalanceEmail } from '../emails/paymentEmails';
import { getPacificMidnightUTC, addDaysToPacificDate } from '../utils/dateUtils';
import { upsertTransactionCache } from '../core/stripe/webhooks';
import Stripe from 'stripe';
import { requiredStringParam } from '../middleware/paramSchemas';

interface StripeInvoiceExpanded extends Stripe.Invoice {
  payment_intent: string | Stripe.PaymentIntent | null;
}

import { getErrorMessage } from '../utils/errorUtils';
import { logFromRequest, logBillingAudit } from '../core/auditLog';
import { getStaffInfo } from './stripe/helpers';

const router = Router();

interface _RecentTransaction {
  id: string;
  type: 'offline' | 'stripe' | 'day_pass';
  amount_cents: number;
  description: string;
  member_email: string;
  member_name: string;
  created_at: Date;
  status: string;
}

/**
 * GET /api/financials/recent-transactions
 * Returns unified recent transactions from cache AND local offline payments
 * Uses stripe_transaction_cache for fast queries instead of hitting Stripe API
 * Supports cursor-based pagination for reliable data loading
 * Requires staff authentication
 */
router.get('/api/financials/recent-transactions', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { date, cursor, limit: limitParam } = req.query;
    const limit = Math.min(Math.max(parseInt(String(limitParam), 10) || 100, 1), 500);
    
    let startOfDay: number | undefined;
    let endOfDay: number | undefined;
    
    if (date && typeof date === 'string') {
      startOfDay = Math.floor(getPacificMidnightUTC(date).getTime() / 1000);
      const nextDay = addDaysToPacificDate(date, 1);
      endOfDay = Math.floor(getPacificMidnightUTC(nextDay).getTime() / 1000);
    }
    
    const cursorDate = cursor && typeof cursor === 'string' ? new Date(cursor) : null;
    
    let stcDateFilter = sql``;
    let genericDateFilter = sql``;
    let purchasedDateFilter = sql``;
    let stcCursorFilter = sql``;
    let genericCursorFilter = sql``;
    let purchasedCursorFilter = sql``;
    
    if (startOfDay && endOfDay) {
      stcDateFilter = sql` AND stc.created_at >= to_timestamp(${startOfDay}) AND stc.created_at < to_timestamp(${endOfDay})`;
      genericDateFilter = sql` AND created_at >= to_timestamp(${startOfDay}) AND created_at < to_timestamp(${endOfDay})`;
      purchasedDateFilter = sql` AND purchased_at >= to_timestamp(${startOfDay}) AND purchased_at < to_timestamp(${endOfDay})`;
    }
    
    if (cursorDate) {
      stcCursorFilter = sql` AND stc.created_at < ${cursorDate}`;
      genericCursorFilter = sql` AND created_at < ${cursorDate}`;
      purchasedCursorFilter = sql` AND purchased_at < ${cursorDate}`;
    }
    
    const limitPlusOne = limit + 1;

    const result = await db.execute(sql`
      WITH all_transactions AS (
        SELECT 
          stc.stripe_id as id,
          'stripe' as type,
          stc.amount_cents,
          COALESCE(stc.description, 'Stripe payment') as description,
          COALESCE(stc.customer_email, 'Unknown') as member_email,
          COALESCE(stc.customer_name, u.first_name || ' ' || u.last_name, stc.customer_email, 'Unknown') as member_name,
          stc.created_at,
          stc.status
        FROM stripe_transaction_cache stc
        LEFT JOIN users u ON LOWER(u.email) = LOWER(stc.customer_email)
        LEFT JOIN stripe_payment_intents spi ON spi.stripe_payment_intent_id = stc.stripe_id
        WHERE stc.status IN ('succeeded', 'paid')
          AND (spi.status IS NULL OR spi.status NOT IN ('refunded', 'refunding'))
          AND NOT EXISTS (
            SELECT 1 FROM stripe_transaction_cache ref_ch
            WHERE ref_ch.payment_intent_id = stc.stripe_id
            AND ref_ch.object_type = 'charge'
            AND ref_ch.status IN ('refunded', 'partially_refunded')
          )
          AND stc.stripe_id NOT IN (SELECT stripe_payment_intent_id FROM day_pass_purchases WHERE stripe_payment_intent_id IS NOT NULL)${stcDateFilter}${stcCursorFilter}
        
        UNION ALL
        
        SELECT 
          id::text,
          'offline' as type,
          amount_cents,
          description,
          member_email,
          COALESCE(member_name, 'Unknown') as member_name,
          created_at,
          'completed' as status
        FROM offline_payments
        WHERE 1=1${genericDateFilter}${genericCursorFilter}
        
        UNION ALL
        
        SELECT 
          id::text,
          'day_pass' as type,
          amount_cents,
          'Day Pass' as description,
          purchaser_email as member_email,
          COALESCE(purchaser_first_name || ' ' || purchaser_last_name, purchaser_email) as member_name,
          purchased_at as created_at,
          'completed' as status
        FROM day_pass_purchases
        WHERE status IN ('active', 'exhausted')${purchasedDateFilter}${purchasedCursorFilter}
      )
      SELECT * FROM all_transactions
      ORDER BY created_at DESC
      LIMIT ${limitPlusOne}
    `);
    
    const hasMore = result.rows.length > limit;
    const transactions = (result.rows.slice(0, limit) as Array<{ id: string; type: string; amount_cents: string; description: string; member_email: string; member_name: string; created_at: string; status: string }>).map((row) => ({
      id: row.id,
      type: row.type,
      amount_cents: parseInt(row.amount_cents, 10) || 0,
      description: row.description,
      member_email: row.member_email,
      member_name: row.member_name,
      created_at: new Date(row.created_at),
      status: row.status
    }));
    
    const seen = new Set<string>();
    const deduplicatedTransactions = transactions.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });

    const nextCursor = hasMore && deduplicatedTransactions.length > 0
      ? deduplicatedTransactions[deduplicatedTransactions.length - 1].created_at.toISOString()
      : null;

    res.json({
      success: true,
      count: deduplicatedTransactions.length,
      transactions: deduplicatedTransactions,
      hasMore,
      nextCursor
    });
  } catch (error: unknown) {
    logger.error('[Financials] Error fetching recent transactions', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent transactions'
    });
  }
});

/**
 * POST /api/financials/backfill-stripe-cache
 * Backfills historical transactions from Stripe into the cache
 * Requires admin authentication
 */
router.post('/api/financials/backfill-stripe-cache', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { daysBack = 90, batchSize = 100 } = req.body;
    const stripe = await getStripeClient();
    
    const startDate = Math.floor((Date.now() - (daysBack * 24 * 60 * 60 * 1000)) / 1000);
    
    let paymentIntentsProcessed = 0;
    let chargesProcessed = 0;
    let invoicesProcessed = 0;
    const errors: string[] = [];
    
    logger.info('[Financials Backfill] Starting backfill for last days...', { extra: { daysBack } });
    
    let piHasMore = true;
    let piStartingAfter: string | undefined;
    
    while (piHasMore) {
      try {
        const params: Stripe.PaymentIntentListParams = {
          limit: Math.min(batchSize, 100),
          created: { gte: startDate },
          expand: ['data.customer'],
        };
        
        if (piStartingAfter) {
          params.starting_after = piStartingAfter;
        }
        
        const page = await stripe.paymentIntents.list(params);
        
        for (const pi of page.data) {
          if (pi.status !== 'succeeded' && pi.status !== 'requires_capture') continue;
          
          const customer = pi.customer as Stripe.Customer | null;
          await upsertTransactionCache({
            stripeId: pi.id,
            objectType: 'payment_intent',
            amountCents: pi.amount,
            currency: pi.currency || 'usd',
            status: pi.status,
            createdAt: new Date(pi.created * 1000),
            customerId: typeof pi.customer === 'string' ? pi.customer : customer?.id,
            customerEmail: customer?.email || pi.receipt_email || pi.metadata?.email,
            customerName: customer?.name || pi.metadata?.memberName,
            description: pi.description || pi.metadata?.productName || 'Stripe payment',
            metadata: pi.metadata,
            source: 'backfill',
            paymentIntentId: pi.id,
          });
          paymentIntentsProcessed++;
        }
        
        piHasMore = page.has_more;
        if (page.data.length > 0) {
          piStartingAfter = page.data[page.data.length - 1].id;
        }
        
        if (piHasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err: unknown) {
        errors.push(`PaymentIntents batch error: ${getErrorMessage(err)}`);
        logger.error('[Financials Backfill] PaymentIntents error', { extra: { err: getErrorMessage(err) } });
        break;
      }
    }
    
    let chHasMore = true;
    let chStartingAfter: string | undefined;
    
    while (chHasMore) {
      try {
        const params: Stripe.ChargeListParams = {
          limit: Math.min(batchSize, 100),
          created: { gte: startDate },
          expand: ['data.customer'],
        };
        
        if (chStartingAfter) {
          params.starting_after = chStartingAfter;
        }
        
        const page = await stripe.charges.list(params);
        
        for (const ch of page.data) {
          if (!ch.paid || ch.refunded) continue;
          
          const customer = ch.customer as Stripe.Customer | null;
          await upsertTransactionCache({
            stripeId: ch.id,
            objectType: 'charge',
            amountCents: ch.amount,
            currency: ch.currency || 'usd',
            status: 'succeeded',
            createdAt: new Date(ch.created * 1000),
            customerId: typeof ch.customer === 'string' ? ch.customer : customer?.id,
            customerEmail: customer?.email || ch.receipt_email || ch.billing_details?.email,
            customerName: customer?.name || ch.billing_details?.name,
            description: ch.description || 'Stripe charge',
            metadata: ch.metadata,
            source: 'backfill',
            chargeId: ch.id,
            paymentIntentId: typeof ch.payment_intent === 'string' ? ch.payment_intent : undefined,
          });
          chargesProcessed++;
        }
        
        chHasMore = page.has_more;
        if (page.data.length > 0) {
          chStartingAfter = page.data[page.data.length - 1].id;
        }
        
        if (chHasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err: unknown) {
        errors.push(`Charges batch error: ${getErrorMessage(err)}`);
        logger.error('[Financials Backfill] Charges error', { extra: { err: getErrorMessage(err) } });
        break;
      }
    }
    
    let invHasMore = true;
    let invStartingAfter: string | undefined;
    
    while (invHasMore) {
      try {
        const params: Stripe.InvoiceListParams = {
          limit: Math.min(batchSize, 100),
          created: { gte: startDate },
          status: 'paid',
          expand: ['data.customer'],
        };
        
        if (invStartingAfter) {
          params.starting_after = invStartingAfter;
        }
        
        const page = await stripe.invoices.list(params);
        
        for (const inv of page.data) {
          const customer = inv.customer as Stripe.Customer | null;
          await upsertTransactionCache({
            stripeId: inv.id,
            objectType: 'invoice',
            amountCents: inv.amount_paid,
            currency: inv.currency || 'usd',
            status: 'paid',
            createdAt: new Date(inv.created * 1000),
            customerId: typeof inv.customer === 'string' ? inv.customer : customer?.id,
            customerEmail: customer?.email || inv.customer_email,
            customerName: customer?.name,
            description: inv.lines?.data?.[0]?.description || 'Invoice payment',
            metadata: inv.metadata,
            source: 'backfill',
            invoiceId: inv.id,
            paymentIntentId: (inv as StripeInvoiceExpanded).payment_intent ? (typeof (inv as StripeInvoiceExpanded).payment_intent === 'string' ? (inv as StripeInvoiceExpanded).payment_intent as string : ((inv as StripeInvoiceExpanded).payment_intent as Stripe.PaymentIntent).id) : undefined,
          });
          invoicesProcessed++;
        }
        
        invHasMore = page.has_more;
        if (page.data.length > 0) {
          invStartingAfter = page.data[page.data.length - 1].id;
        }
        
        if (invHasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (err: unknown) {
        errors.push(`Invoices batch error: ${getErrorMessage(err)}`);
        logger.error('[Financials Backfill] Invoices error', { extra: { err: getErrorMessage(err) } });
        break;
      }
    }
    
    logger.info('[Financials Backfill] Complete: payment intents, charges, invoices', { extra: { paymentIntentsProcessed, chargesProcessed, invoicesProcessed } });
    
    logFromRequest(req, 'backfill_stripe_cache', 'stripe', null as unknown as string, undefined, {
      action: 'backfill',
      daysBack,
      paymentIntentsProcessed,
      chargesProcessed,
      invoicesProcessed,
      errorCount: errors.length,
    });
    
    res.json({
      success: true,
      processed: {
        paymentIntents: paymentIntentsProcessed,
        charges: chargesProcessed,
        invoices: invoicesProcessed,
        total: paymentIntentsProcessed + chargesProcessed + invoicesProcessed
      },
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: unknown) {
    logger.error('[Financials Backfill] Error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to backfill Stripe cache'
    });
  }
});

/**
 * POST /api/financials/sync-member-payments
 * Manually sync a specific member's payments from Stripe to the cache
 * Staff can use this to refresh payment history for a member
 * Requires staff authentication
 */
router.post('/api/financials/sync-member-payments', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { email: rawEmail, daysBack = 365 } = req.body;
    const email = rawEmail?.trim()?.toLowerCase();
    
    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required' });
    }
    
    // Find the user's Stripe customer ID
    const userResult = await db.execute(sql`SELECT id, stripe_customer_id, first_name, last_name FROM users WHERE LOWER(email) = LOWER(${email})`);
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    const user = userResult.rows[0] as { id: string; stripe_customer_id: string | null; first_name: string | null; last_name: string | null };
    if (!user.stripe_customer_id) {
      return res.status(400).json({ success: false, error: 'User has no Stripe customer linked' });
    }
    
    const stripe = await getStripeClient();
    const startDate = Math.floor((Date.now() - (daysBack * 24 * 60 * 60 * 1000)) / 1000);
    
    let paymentsProcessed = 0;
    let invoicesProcessed = 0;
    const errors: string[] = [];
    
    logger.info('[Financials Sync] Syncing payments for (customer: )...', { extra: { email, userStripe_customer_id: user.stripe_customer_id } });
    
    // Fetch all payment intents for this customer (with pagination)
    try {
      let hasMore = true;
      let startingAfter: string | undefined;
      
      while (hasMore) {
        const params: Stripe.PaymentIntentListParams = {
          customer: user.stripe_customer_id as string,
          limit: 100,
          created: { gte: startDate },
          expand: ['data.customer', 'data.latest_charge']
        };
        if (startingAfter) params.starting_after = startingAfter;
        
        const page = await stripe.paymentIntents.list(params);
        
        for (const pi of page.data) {
          if (pi.status === 'succeeded' || pi.status === 'requires_payment_method') {
            const customer = pi.customer && typeof pi.customer === 'object' ? pi.customer as Stripe.Customer : null;
            const latestCharge = pi.latest_charge && typeof pi.latest_charge === 'object' ? pi.latest_charge as Stripe.Charge : null;
            const effectiveStatus = latestCharge?.refunded ? 'refunded' : pi.status;
            await upsertTransactionCache({
              stripeId: pi.id,
              objectType: 'payment_intent',
              status: effectiveStatus,
              amountCents: pi.amount,
              currency: pi.currency || 'usd',
              createdAt: new Date(pi.created * 1000),
              customerId: user.stripe_customer_id as string,
              customerEmail: email.toLowerCase(),
              customerName: customer?.name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
              description: pi.description || pi.metadata?.productName || 'Stripe payment',
              metadata: pi.metadata,
              source: 'backfill',
              paymentIntentId: pi.id,
            });
            paymentsProcessed++;
          }
        }
        
        hasMore = page.has_more;
        if (page.data.length > 0) {
          startingAfter = page.data[page.data.length - 1].id;
        }
      }
    } catch (err: unknown) {
      errors.push(`PaymentIntents error: ${getErrorMessage(err)}`);
    }
    
    // Fetch all invoices for this customer (with pagination)
    try {
      let hasMore = true;
      let startingAfter: string | undefined;
      
      while (hasMore) {
        const params: Stripe.InvoiceListParams = {
          customer: user.stripe_customer_id as string,
          limit: 100,
          created: { gte: startDate },
          expand: ['data.customer']
        };
        if (startingAfter) params.starting_after = startingAfter;
        
        const page = await stripe.invoices.list(params);
        
        for (const inv of page.data) {
          if (inv.status === 'paid' || inv.status === 'open' || inv.status === 'uncollectible') {
            const customer = inv.customer && typeof inv.customer === 'object' ? inv.customer as Stripe.Customer : null;
            await upsertTransactionCache({
              stripeId: inv.id,
              objectType: 'invoice',
              status: inv.status || 'unknown',
              amountCents: inv.amount_paid || inv.amount_due || 0,
              currency: inv.currency || 'usd',
              createdAt: new Date(inv.created * 1000),
              customerId: user.stripe_customer_id as string,
              customerEmail: email.toLowerCase(),
              customerName: customer?.name || `${user.first_name || ''} ${user.last_name || ''}`.trim(),
              description: inv.lines?.data?.[0]?.description || 'Invoice payment',
              metadata: inv.metadata,
              source: 'backfill',
              invoiceId: inv.id,
            });
            invoicesProcessed++;
          }
        }
        
        hasMore = page.has_more;
        if (page.data.length > 0) {
          startingAfter = page.data[page.data.length - 1].id;
        }
      }
    } catch (err: unknown) {
      errors.push(`Invoices error: ${getErrorMessage(err)}`);
    }
    
    logger.info('[Financials Sync] Complete for : payments, invoices', { extra: { email, paymentsProcessed, invoicesProcessed } });
    
    res.json({
      success: true,
      member: { 
        email, 
        name: `${user.first_name} ${user.last_name}`.trim(),
        stripeCustomerId: user.stripe_customer_id
      },
      synced: {
        payments: paymentsProcessed,
        invoices: invoicesProcessed,
        total: paymentsProcessed + invoicesProcessed
      },
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error: unknown) {
    logger.error('[Financials Sync] Error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to sync member payments'
    });
  }
});

/**
 * GET /api/financials/cache-stats
 * Returns statistics about the stripe_transaction_cache
 * Requires staff authentication
 */
router.get('/api/financials/cache-stats', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const statsResult = await db.execute(sql`
      SELECT 
        COUNT(*) as total_count,
        COUNT(DISTINCT customer_email) as unique_customers,
        MIN(created_at) as oldest_transaction,
        MAX(created_at) as newest_transaction,
        SUM(amount_cents) as total_amount_cents,
        object_type,
        source
      FROM stripe_transaction_cache
      GROUP BY object_type, source
      ORDER BY object_type, source
    `);
    
    const totalResult = await db.execute(sql`
      SELECT 
        COUNT(*) as total_count,
        COUNT(DISTINCT customer_email) as unique_customers,
        MIN(created_at) as oldest_transaction,
        MAX(created_at) as newest_transaction
      FROM stripe_transaction_cache
    `);
    
    res.json({
      success: true,
      overall: totalResult.rows[0],
      byTypeAndSource: statsResult.rows
    });
  } catch (error: unknown) {
    logger.error('[Financials] Error fetching cache stats', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cache stats'
    });
  }
});

interface SubscriptionListItem {
  id: string;
  memberEmail: string;
  memberName: string;
  planName: string;
  amount: number;
  currency: string;
  interval: string;
  status: string;
  currentPeriodEnd: number;
  cancelAtPeriodEnd: boolean;
}

/**
 * GET /api/financials/subscriptions
 * Returns Stripe subscriptions with member info
 * Supports pagination (limit, starting_after) and server-side status filtering
 * Requires staff authentication
 */
router.get('/api/financials/subscriptions', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const stripe = await getStripeClient();
    const { status, limit, starting_after } = req.query;
    
    try {
      const account = await stripe.accounts.retrieve();
      logger.info('[Financials] Stripe account', { extra: { accountId: account.id } });
    } catch (e: unknown) {
      logger.info('[Financials] Could not get account info', { extra: { e: getErrorMessage(e) } });
    }
    
    const statusFilter = status && typeof status === 'string' && status !== 'all' 
      ? status as Stripe.Subscription.Status
      : 'all';
    
    const pageLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
    
    const listParams: Stripe.SubscriptionListParams = {
      limit: pageLimit,
      expand: ['data.customer', 'data.items.data.price'],
      status: statusFilter,
    };
    
    if (starting_after && typeof starting_after === 'string') {
      listParams.starting_after = starting_after;
    }
    
    logger.info('[Financials] Fetching subscriptions with params:', { extra: { listParams } });
    const globalSubscriptions = await stripe.subscriptions.list(listParams);
    logger.info('[Financials] Found subscriptions from global list', { extra: { globalSubscriptionsDataLength: globalSubscriptions.data.length } });
    
    const seenSubIds = new Set<string>(globalSubscriptions.data.map(s => s.id));
    const allSubs: Stripe.Subscription[] = [...globalSubscriptions.data];
    
    const additionalSubs: Stripe.Subscription[] = [];
    
    if (globalSubscriptions.data.length === 0) {
      logger.info('[Financials] No subscriptions in global list - scanning database customers (for test clock support)...');
      
      const dbResult = await db.execute(sql`
        SELECT DISTINCT email, stripe_customer_id, first_name, last_name 
        FROM users 
        WHERE stripe_customer_id IS NOT NULL 
        AND stripe_customer_id != ''
        AND billing_provider = 'stripe'
        LIMIT 100
      `);
      
      logger.info('[Financials] Found Stripe-billed customers in database', { extra: { dbResultRowsLength: dbResult.rows.length } });
      
      const uniqueCustomers = new Map<string, { email: string; stripe_customer_id: string; first_name: string | null; last_name: string | null }>();
      for (const row of dbResult.rows as Array<{ email: string; stripe_customer_id: string; first_name: string | null; last_name: string | null }>) {
        if (!uniqueCustomers.has(row.stripe_customer_id)) {
          uniqueCustomers.set(row.stripe_customer_id, row);
        }
      }
      
      const CONCURRENCY_LIMIT = 5;
      const customerArray = Array.from(uniqueCustomers.values());
      
      for (let i = 0; i < customerArray.length; i += CONCURRENCY_LIMIT) {
        const batch = customerArray.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await Promise.allSettled(
          batch.map(async (row) => {
            const custSubs = await stripe.subscriptions.list({ 
              customer: row.stripe_customer_id, 
              status: statusFilter,
              limit: 100,
              expand: ['data.items.data.price', 'data.customer']
            });
            return { subs: custSubs.data, row };
          })
        );
        
        for (const result of batchResults) {
          if (result.status === 'fulfilled') {
            for (const sub of result.value.subs) {
              if (seenSubIds.has(sub.id)) continue;
              seenSubIds.add(sub.id);
              
              const row = result.value.row;
              if (typeof sub.customer === 'string') {
                (sub as unknown as { customer: unknown }).customer = {
                  id: row.stripe_customer_id as string,
                  email: row.email as string,
                  name: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email as string,
                };
              }
              additionalSubs.push(sub);
            }
          } else {
            logger.info('[Financials] Error fetching subs', { extra: { error: getErrorMessage(result.reason) } });
          }
        }
        
        if (i + CONCURRENCY_LIMIT < customerArray.length) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      }
      
      logger.info('[Financials] Scanned database customers, found additional subscriptions', { extra: { uniqueCustomersSize: uniqueCustomers.size, additionalSubsLength: additionalSubs.length } });
    }
    
    allSubs.push(...additionalSubs);
    const subscriptions = { data: allSubs, has_more: globalSubscriptions.has_more, object: 'list' as const, url: '' };

    const productIds = new Set<string>();
    for (const sub of subscriptions.data) {
      for (const item of sub.items.data) {
        if (item.price?.product && typeof item.price.product === 'string') {
          productIds.add(item.price.product);
        }
      }
    }
    
    const productMap = new Map<string, string>();
    if (productIds.size > 0) {
      const productBatches = Array.from(productIds);
      const PRODUCT_BATCH_SIZE = 10;
      for (let i = 0; i < productBatches.length; i += PRODUCT_BATCH_SIZE) {
        const batch = productBatches.slice(i, i + PRODUCT_BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(id => stripe.products.retrieve(id))
        );
        for (let j = 0; j < results.length; j++) {
          const result = results[j];
          if (result.status === 'fulfilled') {
            productMap.set(result.value.id, result.value.name);
          } else {
            logger.warn('[Financials] Failed to fetch product', { extra: { productId: batch[j], error: result.reason?.message } });
          }
        }
      }
    }

    const subscriptionItems: SubscriptionListItem[] = subscriptions.data.map(sub => {
      const customer = typeof sub.customer === 'object' && sub.customer && !('deleted' in sub.customer) ? sub.customer as Stripe.Customer : null;
      const item = sub.items?.data?.[0];
      const price = item?.price;
      const productId = price?.product;
      const productName = typeof productId === 'string' 
        ? productMap.get(productId) 
        : (productId && typeof productId === 'object' ? (productId as Stripe.Product).name : null);
      
      return {
        id: sub.id,
        memberEmail: customer?.email || 'Unknown',
        memberName: customer?.name || customer?.email || 'Unknown',
        planName: productName || price?.nickname || 'Subscription Plan',
        amount: price?.unit_amount || 0,
        currency: price?.currency || 'usd',
        interval: price?.recurring?.interval || 'month',
        status: sub.status,
        currentPeriodEnd: sub.items.data[0]?.current_period_end || 0,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
      };
    });

    const lastItem = subscriptions.data[subscriptions.data.length - 1];

    res.json({
      success: true,
      count: subscriptionItems.length,
      subscriptions: subscriptionItems,
      hasMore: subscriptions.has_more,
      nextCursor: subscriptions.has_more && lastItem ? lastItem.id : null,
    });
  } catch (error: unknown) {
    logger.error('[Financials] Error fetching subscriptions', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch subscriptions',
    });
  }
});

/**
 * POST /api/financials/subscriptions/:subscriptionId/send-reminder
 * Sends a payment reminder email for a past_due subscription
 * Requires staff authentication
 */
router.post('/api/financials/subscriptions/:subscriptionId/send-reminder', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const stripe = await getStripeClient();

    const subIdParse = requiredStringParam.safeParse(subscriptionId);
    if (!subIdParse.success) return res.status(400).json({ error: 'Invalid subscription ID' });
    const subscription = await stripe.subscriptions.retrieve(subIdParse.data, {
      expand: ['customer', 'items.data.price.product'],
    });

    if (!subscription) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    const customer = typeof subscription.customer === 'object' && subscription.customer && !('deleted' in subscription.customer) ? subscription.customer as Stripe.Customer : null;
    if (!customer?.email) {
      return res.status(400).json({ success: false, error: 'Customer email not found' });
    }

    const item = subscription.items?.data?.[0];
    const price = item?.price;
    const product = price?.product as Stripe.Product | undefined;
    const amount = (price?.unit_amount || 0) / 100;

    const result = await sendOutstandingBalanceEmail(customer.email, {
      memberName: customer.name || 'Member',
      amount,
      description: `${product?.name || 'Membership'} subscription payment is past due`,
      dueDate: new Date((subscription.items.data[0]?.current_period_end || 0) * 1000).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'America/Los_Angeles',
      }),
    });

    if (result.success) {
      logger.info('[Financials] Sent payment reminder to for subscription', { extra: { customerEmail: customer.email, subscriptionId } });
      res.json({ success: true, message: 'Reminder sent successfully' });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Failed to send reminder' });
    }
  } catch (error: unknown) {
    logger.error('[Financials] Error sending subscription reminder', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to send reminder',
    });
  }
});

interface InvoiceListItem {
  id: string;
  memberEmail: string;
  memberName: string;
  number: string | null;
  amountDue: number;
  amountPaid: number;
  amountRefunded: number;
  currency: string;
  status: string;
  created: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
}

/**
 * GET /api/financials/invoices
 * Returns Stripe invoices with member info
 * Supports pagination (limit, starting_after) and server-side filtering by status and date range
 * Requires staff authentication
 */
router.get('/api/financials/invoices', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const stripe = await getStripeClient();
    const { status, startDate, endDate, limit, starting_after } = req.query;
    
    const pageLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 100);
    
    const listParams: Stripe.InvoiceListParams = {
      limit: pageLimit,
      expand: ['data.customer'],
    };

    if (status && typeof status === 'string' && status !== 'all') {
      listParams.status = status as Stripe.InvoiceListParams['status'];
    }

    if (startDate && typeof startDate === 'string') {
      const startTimestamp = Math.floor(getPacificMidnightUTC(startDate).getTime() / 1000);
      listParams.created = { ...(listParams.created as object || {}), gte: startTimestamp };
    }

    if (endDate && typeof endDate === 'string') {
      const nextDay = addDaysToPacificDate(endDate, 1);
      const endTimestamp = Math.floor(getPacificMidnightUTC(nextDay).getTime() / 1000);
      listParams.created = { ...(listParams.created as object || {}), lte: endTimestamp };
    }

    if (starting_after && typeof starting_after === 'string') {
      listParams.starting_after = starting_after;
    }

    const invoices = await stripe.invoices.list(listParams);

    const bookingIdsByInvoice = new Map<string, string>();
    for (const inv of invoices.data) {
      if (inv.status === 'paid' && inv.metadata?.bookingId) {
        bookingIdsByInvoice.set(inv.id, inv.metadata.bookingId);
      }
    }

    const cancelledRefundedBookings = new Set<number>();
    if (bookingIdsByInvoice.size > 0) {
      const bookingIds = [...new Set([...bookingIdsByInvoice.values()])].map(Number).filter(n => !isNaN(n));
      if (bookingIds.length > 0) {
        const bookingIdsStr = `{${bookingIds.join(',')}}`;
        const refundResult = await db.execute(sql`
          SELECT DISTINCT br.id
          FROM booking_requests br
          WHERE br.id = ANY(${bookingIdsStr}::int[])
            AND br.status = 'cancelled'
            AND EXISTS (
              SELECT 1 FROM stripe_payment_intents spi
              WHERE spi.booking_id = br.id AND spi.status = 'refunded'
            )
        `);
        for (const row of refundResult.rows) {
          cancelledRefundedBookings.add(Number(row.id));
        }
      }
    }

    const invoiceItems: InvoiceListItem[] = invoices.data.map(invoice => {
      const customer = typeof invoice.customer === 'object' && invoice.customer && !('deleted' in invoice.customer) ? invoice.customer as Stripe.Customer : null;
      
      let effectiveStatus: string = invoice.status || 'draft';
      const bookingId = invoice.metadata?.bookingId;
      if (effectiveStatus === 'paid' && bookingId && cancelledRefundedBookings.has(Number(bookingId))) {
        effectiveStatus = 'refunded';
      }

      return {
        id: invoice.id,
        memberEmail: customer?.email || invoice.customer_email || 'Unknown',
        memberName: customer?.name || customer?.email || invoice.customer_email || 'Unknown',
        number: invoice.number,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        amountRefunded: 0,
        currency: invoice.currency,
        status: effectiveStatus,
        created: invoice.created,
        hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
        invoicePdf: invoice.invoice_pdf ?? null,
      };
    });

    const lastItem = invoices.data[invoices.data.length - 1];

    res.json({
      success: true,
      count: invoiceItems.length,
      invoices: invoiceItems,
      hasMore: invoices.has_more,
      nextCursor: invoices.has_more && lastItem ? lastItem.id : null,
    });
  } catch (error: unknown) {
    logger.error('[Financials] Error fetching invoices', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invoices',
    });
  }
});

function normalizeActivityType(raw: string): string {
  if (['membership', 'membership_renewal', 'subscription'].includes(raw)) return 'subscription';
  if (['pos', 'terminal', 'pos_purchase', 'merch', 'merchandise', 'one_time_purchase', 'cafe'].includes(raw)) return 'pos';
  if (raw === 'invoice') return 'invoice';
  if (raw === 'charge') return 'payment';
  return 'payment';
}

const activityRateLimits = new Map<string, number>();

router.get('/api/financials/activity', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const {
      cursor,
      limit: limitParam,
      startDate,
      endDate,
      search,
      status: statusFilter,
      type: typeFilter,
      minAmount,
      maxAmount,
    } = req.query;

    const limit = Math.min(Math.max(parseInt(String(limitParam), 10) || 50, 1), 200);

    const conditions: ReturnType<typeof sql>[] = [];

    if (startDate && typeof startDate === 'string') {
      const startTs = getPacificMidnightUTC(startDate);
      conditions.push(sql`created_at >= ${startTs}`);
    }
    if (endDate && typeof endDate === 'string') {
      const nextDay = addDaysToPacificDate(endDate, 1);
      const endTs = getPacificMidnightUTC(nextDay);
      conditions.push(sql`created_at < ${endTs}`);
    }
    if (search && typeof search === 'string') {
      const searchLower = `%${search.toLowerCase()}%`;
      conditions.push(sql`(LOWER(member_name) LIKE ${searchLower} OR LOWER(member_email) LIKE ${searchLower})`);
    }
    if (statusFilter && typeof statusFilter === 'string' && statusFilter !== 'all') {
      const statuses = statusFilter.split(',').map(s => s.trim().toLowerCase());
      const statusList = statuses.map(s => sql`${s}`);
      conditions.push(sql`status IN (${sql.join(statusList, sql`, `)})`);
    }
    if (typeFilter && typeof typeFilter === 'string' && typeFilter !== 'all') {
      const types = typeFilter.split(',').map(t => t.trim().toLowerCase());
      const typeList = types.map(t => sql`${t}`);
      conditions.push(sql`type IN (${sql.join(typeList, sql`, `)})`);
    }
    if (minAmount && typeof minAmount === 'string') {
      const minCents = Math.round(parseFloat(minAmount) * 100);
      if (!isNaN(minCents)) {
        conditions.push(sql`amount_cents >= ${minCents}`);
      }
    }
    if (maxAmount && typeof maxAmount === 'string') {
      const maxCents = Math.round(parseFloat(maxAmount) * 100);
      if (!isNaN(maxCents)) {
        conditions.push(sql`amount_cents <= ${maxCents}`);
      }
    }
    if (cursor && typeof cursor === 'string') {
      const cursorDate = new Date(cursor);
      if (!isNaN(cursorDate.getTime())) {
        conditions.push(sql`created_at < ${cursorDate}`);
      }
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const limitPlusOne = limit + 1;

    const result = await db.execute(sql`
      WITH unified AS (
        SELECT
          spi.stripe_payment_intent_id AS id,
          spi.amount_cents,
          spi.status,
          spi.description,
          COALESCE(u.email, spi.user_id) AS member_email,
          COALESCE(
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
            u.email,
            spi.user_id
          ) AS member_name,
          spi.created_at,
          CASE
            WHEN spi.purpose IN ('membership', 'membership_renewal', 'subscription') THEN 'subscription'
            WHEN spi.purpose IN ('pos', 'terminal', 'pos_purchase', 'merch', 'merchandise', 'one_time_purchase', 'cafe') THEN 'pos'
            WHEN spi.purpose = 'invoice' THEN 'invoice'
            ELSE 'payment'
          END AS type,
          spi.booking_id
        FROM stripe_payment_intents spi
        LEFT JOIN users u ON (u.id::text = spi.user_id OR LOWER(u.email) = LOWER(spi.user_id)
          OR (u.stripe_customer_id IS NOT NULL AND u.stripe_customer_id = spi.stripe_customer_id))

        UNION ALL

        SELECT
          stc.stripe_id AS id,
          stc.amount_cents,
          CASE stc.status
            WHEN 'payment_failed' THEN 'failed'
            WHEN 'paid' THEN 'succeeded'
            ELSE stc.status
          END AS status,
          COALESCE(stc.description, 'Stripe payment') AS description,
          COALESCE(stc.customer_email, 'Unknown') AS member_email,
          COALESCE(
            stc.customer_name,
            NULLIF(TRIM(COALESCE(u2.first_name, '') || ' ' || COALESCE(u2.last_name, '')), ''),
            stc.customer_email,
            'Unknown'
          ) AS member_name,
          stc.created_at,
          CASE stc.object_type
            WHEN 'invoice' THEN 'invoice'
            WHEN 'charge' THEN 'payment'
            ELSE 'payment'
          END AS type,
          NULL::int AS booking_id
        FROM stripe_transaction_cache stc
        LEFT JOIN users u2 ON LOWER(u2.email) = LOWER(stc.customer_email)
        WHERE NOT EXISTS (
          SELECT 1 FROM stripe_payment_intents spi2
          WHERE spi2.stripe_payment_intent_id = stc.stripe_id
             OR spi2.stripe_payment_intent_id = stc.payment_intent_id
        )
      )
      SELECT * FROM unified
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ${limitPlusOne}
    `);

    const hasMore = result.rows.length > limit;
    const rows = result.rows.slice(0, limit) as Array<{
      id: string;
      amount_cents: number;
      status: string;
      description: string;
      member_email: string;
      member_name: string;
      created_at: string;
      type: string;
      booking_id: number | null;
    }>;

    const seen = new Set<string>();
    const items = rows
      .filter(row => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      })
      .map(row => ({
        id: row.id,
        amountCents: Number(row.amount_cents) || 0,
        status: row.status,
        description: row.description,
        memberEmail: row.member_email,
        memberName: row.member_name,
        createdAt: new Date(row.created_at).toISOString(),
        type: row.type,
        bookingId: row.booking_id,
      }));

    const nextCursor = hasMore && items.length > 0
      ? items[items.length - 1].createdAt
      : null;

    res.json({
      success: true,
      count: items.length,
      items,
      hasMore,
      nextCursor,
    });
  } catch (error: unknown) {
    logger.error('[Activity] Error fetching activity feed', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ success: false, error: 'Failed to fetch activity feed' });
  }
});

router.get('/api/financials/activity/counts', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      WITH unified AS (
        SELECT
          spi.stripe_payment_intent_id AS id,
          spi.status,
          spi.created_at
        FROM stripe_payment_intents spi

        UNION ALL

        SELECT
          stc.stripe_id AS id,
          CASE stc.status
            WHEN 'payment_failed' THEN 'failed'
            WHEN 'paid' THEN 'succeeded'
            ELSE stc.status
          END AS status,
          stc.created_at
        FROM stripe_transaction_cache stc
        WHERE NOT EXISTS (
          SELECT 1 FROM stripe_payment_intents spi2
          WHERE spi2.stripe_payment_intent_id = stc.stripe_id
             OR spi2.stripe_payment_intent_id = stc.payment_intent_id
        )
      ),
      deduped AS (
        SELECT DISTINCT ON (id) id, status FROM unified ORDER BY id, created_at DESC
      )
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
        COUNT(*) FILTER (WHERE status IN ('refunded', 'partially_refunded')) AS refunded,
        COUNT(*) FILTER (WHERE status = 'failed') AS failed,
        COUNT(*) FILTER (WHERE status = 'disputed') AS disputed,
        COUNT(*) FILTER (WHERE status = 'draft') AS draft,
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'void') AS void,
        COUNT(*) FILTER (WHERE status = 'uncollectible') AS uncollectible
      FROM deduped
    `);

    const row = result.rows[0] as Record<string, string> | undefined;

    res.json({
      success: true,
      counts: {
        all: parseInt(row?.total ?? '0', 10),
        succeeded: parseInt(row?.succeeded ?? '0', 10),
        refunded: parseInt(row?.refunded ?? '0', 10),
        failed: parseInt(row?.failed ?? '0', 10),
        disputed: parseInt(row?.disputed ?? '0', 10),
        draft: parseInt(row?.draft ?? '0', 10),
        open: parseInt(row?.open ?? '0', 10),
        void: parseInt(row?.void ?? '0', 10),
        uncollectible: parseInt(row?.uncollectible ?? '0', 10),
      },
    });
  } catch (error: unknown) {
    logger.error('[Activity] Error fetching activity counts', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ success: false, error: 'Failed to fetch activity counts' });
  }
});

router.get('/api/financials/activity/export', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const {
      startDate,
      endDate,
      search,
      status: statusFilter,
      type: typeFilter,
      minAmount,
      maxAmount,
    } = req.query;

    const conditions: ReturnType<typeof sql>[] = [];

    if (startDate && typeof startDate === 'string') {
      const startTs = getPacificMidnightUTC(startDate);
      conditions.push(sql`created_at >= ${startTs}`);
    }
    if (endDate && typeof endDate === 'string') {
      const nextDay = addDaysToPacificDate(endDate, 1);
      const endTs = getPacificMidnightUTC(nextDay);
      conditions.push(sql`created_at < ${endTs}`);
    }
    if (search && typeof search === 'string') {
      const searchLower = `%${search.toLowerCase()}%`;
      conditions.push(sql`(LOWER(member_name) LIKE ${searchLower} OR LOWER(member_email) LIKE ${searchLower})`);
    }
    if (statusFilter && typeof statusFilter === 'string' && statusFilter !== 'all') {
      const statuses = statusFilter.split(',').map(s => s.trim().toLowerCase());
      const statusList = statuses.map(s => sql`${s}`);
      conditions.push(sql`status IN (${sql.join(statusList, sql`, `)})`);
    }
    if (typeFilter && typeof typeFilter === 'string' && typeFilter !== 'all') {
      const types = typeFilter.split(',').map(t => t.trim().toLowerCase());
      const typeList = types.map(t => sql`${t}`);
      conditions.push(sql`type IN (${sql.join(typeList, sql`, `)})`);
    }
    if (minAmount && typeof minAmount === 'string') {
      const minCents = Math.round(parseFloat(minAmount) * 100);
      if (!isNaN(minCents)) {
        conditions.push(sql`amount_cents >= ${minCents}`);
      }
    }
    if (maxAmount && typeof maxAmount === 'string') {
      const maxCents = Math.round(parseFloat(maxAmount) * 100);
      if (!isNaN(maxCents)) {
        conditions.push(sql`amount_cents <= ${maxCents}`);
      }
    }

    const whereClause = conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

    const result = await db.execute(sql`
      WITH unified AS (
        SELECT
          spi.stripe_payment_intent_id AS id,
          spi.amount_cents,
          spi.status,
          spi.description,
          COALESCE(u.email, spi.user_id) AS member_email,
          COALESCE(
            NULLIF(TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')), ''),
            u.email,
            spi.user_id
          ) AS member_name,
          spi.created_at,
          CASE
            WHEN spi.purpose IN ('membership', 'membership_renewal', 'subscription') THEN 'subscription'
            WHEN spi.purpose IN ('pos', 'terminal', 'pos_purchase', 'merch', 'merchandise', 'one_time_purchase', 'cafe') THEN 'pos'
            WHEN spi.purpose = 'invoice' THEN 'invoice'
            ELSE 'payment'
          END AS type,
          COALESCE(
            stc_pm.metadata->>'paymentMethodType',
            stc_pm.metadata->>'payment_method_type',
            'Stripe'
          ) AS payment_method
        FROM stripe_payment_intents spi
        LEFT JOIN users u ON (u.id::text = spi.user_id OR LOWER(u.email) = LOWER(spi.user_id)
          OR (u.stripe_customer_id IS NOT NULL AND u.stripe_customer_id = spi.stripe_customer_id))
        LEFT JOIN stripe_transaction_cache stc_pm ON stc_pm.stripe_id = spi.stripe_payment_intent_id
          OR stc_pm.payment_intent_id = spi.stripe_payment_intent_id

        UNION ALL

        SELECT
          stc.stripe_id AS id,
          stc.amount_cents,
          CASE stc.status
            WHEN 'payment_failed' THEN 'failed'
            WHEN 'paid' THEN 'succeeded'
            ELSE stc.status
          END AS status,
          COALESCE(stc.description, 'Stripe payment') AS description,
          COALESCE(stc.customer_email, 'Unknown') AS member_email,
          COALESCE(
            stc.customer_name,
            NULLIF(TRIM(COALESCE(u2.first_name, '') || ' ' || COALESCE(u2.last_name, '')), ''),
            stc.customer_email,
            'Unknown'
          ) AS member_name,
          stc.created_at,
          CASE stc.object_type
            WHEN 'invoice' THEN 'invoice'
            WHEN 'charge' THEN 'payment'
            ELSE 'payment'
          END AS type,
          COALESCE(
            stc.metadata->>'paymentMethodType',
            stc.metadata->>'payment_method_type',
            'Stripe'
          ) AS payment_method
        FROM stripe_transaction_cache stc
        LEFT JOIN users u2 ON LOWER(u2.email) = LOWER(stc.customer_email)
        WHERE NOT EXISTS (
          SELECT 1 FROM stripe_payment_intents spi2
          WHERE spi2.stripe_payment_intent_id = stc.stripe_id
             OR spi2.stripe_payment_intent_id = stc.payment_intent_id
        )
      )
      SELECT * FROM unified
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT 10000
    `);

    const rows = result.rows as Array<{
      id: string;
      amount_cents: number;
      status: string;
      description: string;
      member_email: string;
      member_name: string;
      created_at: string;
      type: string;
      payment_method: string;
    }>;

    const seen = new Set<string>();
    const deduped = rows.filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });

    const sanitizeCsvCell = (val: string): string => {
      let sanitized = val;
      if (/^[=+\-@\t\r]/.test(sanitized)) {
        sanitized = "'" + sanitized;
      }
      if (sanitized.includes(',') || sanitized.includes('"') || sanitized.includes('\n')) {
        return `"${sanitized.replace(/"/g, '""')}"`;
      }
      return sanitized;
    };

    const csvHeader = 'Date,Member Name,Member Email,Amount,Status,Type,Description,Payment Method\n';
    const csvRows = deduped.map(row => {
      const date = new Date(row.created_at).toISOString().split('T')[0];
      const amount = (Number(row.amount_cents) / 100).toFixed(2);
      return [
        date,
        sanitizeCsvCell(row.member_name || ''),
        sanitizeCsvCell(row.member_email || ''),
        amount,
        sanitizeCsvCell(row.status),
        sanitizeCsvCell(row.type),
        sanitizeCsvCell(row.description || ''),
        sanitizeCsvCell(row.payment_method || 'Stripe'),
      ].join(',');
    }).join('\n');

    const csv = csvHeader + csvRows;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="activity-export-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error: unknown) {
    logger.error('[Activity] Error exporting activity', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ success: false, error: 'Failed to export activity' });
  }
});

router.get('/api/financials/activity/:id', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, error: 'Transaction ID is required' });
    }

    const localResult = await db.execute(sql`
      SELECT
        spi.id AS local_id,
        spi.stripe_payment_intent_id,
        spi.user_id,
        spi.stripe_customer_id,
        spi.amount_cents,
        spi.purpose,
        spi.booking_id,
        spi.session_id,
        spi.description,
        spi.status,
        spi.created_at,
        u.email AS member_email,
        u.first_name,
        u.last_name
      FROM stripe_payment_intents spi
      LEFT JOIN users u ON (u.id::text = spi.user_id OR LOWER(u.email) = LOWER(spi.user_id)
        OR (u.stripe_customer_id IS NOT NULL AND u.stripe_customer_id = spi.stripe_customer_id))
      WHERE spi.stripe_payment_intent_id = ${id}
      LIMIT 1
    `);

    const cacheResult = await db.execute(sql`
      SELECT * FROM stripe_transaction_cache WHERE stripe_id = ${id} OR payment_intent_id = ${id} LIMIT 1
    `);

    const localRow = localResult.rows[0] as Record<string, unknown> | undefined;
    const cacheRow = cacheResult.rows[0] as Record<string, unknown> | undefined;

    if (!localRow && !cacheRow) {
      return res.status(404).json({ success: false, error: 'Transaction not found' });
    }

    const rawStatus = (localRow?.status ?? cacheRow?.status ?? 'unknown') as string;
    const normalizedStatus = rawStatus === 'payment_failed' ? 'failed' : rawStatus === 'paid' ? 'succeeded' : rawStatus;

    const detail: Record<string, unknown> = {
      id,
      amountCents: Number(localRow?.amount_cents ?? cacheRow?.amount_cents ?? 0),
      status: normalizedStatus,
      description: (localRow?.description ?? cacheRow?.description ?? '') as string,
      memberEmail: (localRow?.member_email ?? cacheRow?.customer_email ?? '') as string,
      memberName: '',
      createdAt: localRow?.created_at ?? cacheRow?.created_at ?? null,
      type: normalizeActivityType((localRow?.purpose ?? cacheRow?.object_type ?? 'payment') as string),
      bookingId: localRow?.booking_id ?? null,
      sessionId: localRow?.session_id ?? null,
    };

    const firstName = localRow?.first_name as string | null;
    const lastName = localRow?.last_name as string | null;
    const nameFromCache = cacheRow?.customer_name as string | null;
    detail.memberName = [firstName, lastName].filter(Boolean).join(' ').trim()
      || nameFromCache
      || (detail.memberEmail as string)
      || 'Unknown';

    let stripePaymentMethod: Record<string, unknown> | null = null;
    let receiptUrl: string | null = null;
    let refunds: Array<Record<string, unknown>> = [];
    const timeline: Array<Record<string, unknown>> = [];

    const extractPaymentMethodDetails = (pmd: Stripe.Charge.PaymentMethodDetails): Record<string, unknown> => {
      if (pmd.card) {
        return {
          type: 'card',
          brand: pmd.card.brand,
          last4: pmd.card.last4,
          expMonth: pmd.card.exp_month,
          expYear: pmd.card.exp_year,
        };
      } else if (pmd.us_bank_account) {
        return {
          type: 'us_bank_account',
          bankName: pmd.us_bank_account.bank_name,
          last4: pmd.us_bank_account.last4,
        };
      }
      return { type: pmd.type || 'unknown' };
    };

    if (id.startsWith('pi_')) {
      try {
        const stripe = await getStripeClient();
        const pi = await stripe.paymentIntents.retrieve(id, {
          expand: ['latest_charge', 'latest_charge.refunds'],
        });

        timeline.push({
          event: 'payment_intent_created',
          timestamp: new Date(pi.created * 1000).toISOString(),
          detail: { amount: pi.amount, currency: pi.currency, status: pi.status },
        });

        const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge as Stripe.Charge : null;

        if (charge) {
          receiptUrl = charge.receipt_url || null;

          timeline.push({
            event: charge.paid ? 'charge_succeeded' : 'charge_failed',
            timestamp: new Date(charge.created * 1000).toISOString(),
            detail: { chargeId: charge.id, amount: charge.amount, paid: charge.paid },
          });

          if (charge.payment_method_details) {
            stripePaymentMethod = extractPaymentMethodDetails(charge.payment_method_details);
          }

          if (charge.refunds?.data) {
            refunds = charge.refunds.data.map(r => ({
              id: r.id,
              amount: r.amount,
              currency: r.currency,
              status: r.status,
              reason: r.reason,
              createdAt: new Date((r.created || 0) * 1000).toISOString(),
            }));

            for (const r of charge.refunds.data) {
              timeline.push({
                event: 'refund',
                timestamp: new Date((r.created || 0) * 1000).toISOString(),
                detail: { refundId: r.id, amount: r.amount, reason: r.reason, status: r.status },
              });
            }
          }

          if (charge.disputed) {
            timeline.push({
              event: 'dispute',
              timestamp: new Date(charge.created * 1000).toISOString(),
              detail: { disputed: true },
            });
          }
        }

        detail.chargeSource = pi.metadata?.source || pi.metadata?.purpose || 'unknown';
        detail.stripeMetadata = pi.metadata || {};
      } catch (stripeErr: unknown) {
        logger.warn('[Activity] Could not enrich from Stripe API (pi)', { extra: { id, error: getErrorMessage(stripeErr) } });
      }
    } else if (id.startsWith('in_')) {
      try {
        const stripe = await getStripeClient();
        const invoice = await stripe.invoices.retrieve(id, {
          expand: ['charge', 'payment_intent'],
        });

        timeline.push({
          event: 'invoice_created',
          timestamp: new Date(invoice.created * 1000).toISOString(),
          detail: { invoiceNumber: invoice.number, status: invoice.status },
        });

        if (invoice.status === 'paid' && invoice.status_transitions?.paid_at) {
          timeline.push({
            event: 'invoice_paid',
            timestamp: new Date(invoice.status_transitions.paid_at * 1000).toISOString(),
            detail: { amountPaid: invoice.amount_paid },
          });
        }
        if (invoice.status === 'void' && invoice.status_transitions?.voided_at) {
          timeline.push({
            event: 'invoice_voided',
            timestamp: new Date(invoice.status_transitions.voided_at * 1000).toISOString(),
            detail: {},
          });
        }

        detail.amountCents = invoice.amount_paid || invoice.amount_due || 0;
        const invoiceStatus = invoice.status || 'unknown';
        detail.status = invoiceStatus === 'paid' ? 'succeeded' : invoiceStatus;
        detail.description = invoice.lines?.data?.[0]?.description || detail.description;
        detail.invoiceNumber = invoice.number;
        detail.invoicePdf = invoice.invoice_pdf;
        detail.hostedInvoiceUrl = invoice.hosted_invoice_url;
        receiptUrl = invoice.hosted_invoice_url || null;

        const customer = typeof invoice.customer === 'object' && invoice.customer && !('deleted' in invoice.customer)
          ? invoice.customer as Stripe.Customer : null;
        if (customer) {
          detail.memberEmail = customer.email || detail.memberEmail;
          detail.memberName = customer.name || detail.memberName;
        }

        const charge = typeof invoice.charge === 'object' ? invoice.charge as Stripe.Charge : null;
        if (charge?.payment_method_details) {
          stripePaymentMethod = extractPaymentMethodDetails(charge.payment_method_details);
        }

        detail.stripeMetadata = invoice.metadata || {};
      } catch (stripeErr: unknown) {
        logger.warn('[Activity] Could not enrich from Stripe API (invoice)', { extra: { id, error: getErrorMessage(stripeErr) } });
      }
    } else if (id.startsWith('ch_')) {
      try {
        const stripe = await getStripeClient();
        const charge = await stripe.charges.retrieve(id, {
          expand: ['refunds'],
        });

        timeline.push({
          event: charge.paid ? 'charge_succeeded' : 'charge_failed',
          timestamp: new Date(charge.created * 1000).toISOString(),
          detail: { chargeId: charge.id, amount: charge.amount, paid: charge.paid },
        });

        receiptUrl = charge.receipt_url || null;
        if (charge.payment_method_details) {
          stripePaymentMethod = extractPaymentMethodDetails(charge.payment_method_details);
        }

        if (charge.refunds?.data) {
          refunds = charge.refunds.data.map(r => ({
            id: r.id,
            amount: r.amount,
            currency: r.currency,
            status: r.status,
            reason: r.reason,
            createdAt: new Date((r.created || 0) * 1000).toISOString(),
          }));

          for (const r of charge.refunds.data) {
            timeline.push({
              event: 'refund',
              timestamp: new Date((r.created || 0) * 1000).toISOString(),
              detail: { refundId: r.id, amount: r.amount, reason: r.reason, status: r.status },
            });
          }
        }

        detail.stripeMetadata = charge.metadata || {};
      } catch (stripeErr: unknown) {
        logger.warn('[Activity] Could not enrich from Stripe API (charge)', { extra: { id, error: getErrorMessage(stripeErr) } });
      }
    }

    if (refunds.length > 0) {
      const refundAuditResult = await db.execute(sql`
        SELECT action, staff_email, details, created_at
        FROM admin_audit_log
        WHERE resource_type = 'billing'
          AND action IN ('refund_payment', 'partial_refund_payment')
          AND (resource_id = ${id} OR details::text LIKE ${'%' + id + '%'})
        ORDER BY created_at DESC
      `);
      const auditRows = refundAuditResult.rows as Array<{
        action: string; staff_email: string; details: Record<string, unknown>; created_at: string;
      }>;

      const usedAuditIndices = new Set<number>();
      for (const refund of refunds) {
        let bestMatch: { idx: number; delta: number } | null = null;
        for (let i = 0; i < auditRows.length; i++) {
          if (usedAuditIndices.has(i)) continue;
          const delta = Math.abs(
            new Date(auditRows[i].created_at).getTime() - new Date(refund.createdAt as string).getTime()
          );
          if (delta < 120000 && (!bestMatch || delta < bestMatch.delta)) {
            bestMatch = { idx: i, delta };
          }
        }
        if (bestMatch) {
          refund.processedBy = auditRows[bestMatch.idx].staff_email;
          usedAuditIndices.add(bestMatch.idx);
        }
      }
    }

    timeline.sort((a, b) =>
      new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime()
    );

    detail.paymentMethod = stripePaymentMethod;
    detail.receiptUrl = receiptUrl;
    detail.refunds = refunds;
    detail.timeline = timeline;

    logFromRequest(req, {
      action: 'view_activity_detail',
      resourceType: 'billing',
      resourceId: id,
      resourceName: detail.description as string,
      details: { transactionId: id }
    });

    res.json({ success: true, transaction: detail });
  } catch (error: unknown) {
    logger.error('[Activity] Error fetching activity detail', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ success: false, error: 'Failed to fetch transaction detail' });
  }
});

router.post('/api/financials/sync-stripe', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const staffEmail = req.session?.user?.email || 'staff';
    const now = Date.now();
    const lastSync = activityRateLimits.get(staffEmail) || 0;
    if (now - lastSync < 60_000) {
      return res.status(429).json({
        success: false,
        error: 'Rate limited. Please wait at least 60 seconds between sync requests.',
      });
    }
    activityRateLimits.set(staffEmail, now);

    const { daysBack = 7 } = req.body;
    const safeDaysBack = Math.min(Math.max(parseInt(String(daysBack), 10) || 7, 1), 90);

    const stripe = await getStripeClient();
    const startDate = Math.floor((Date.now() - (safeDaysBack * 24 * 60 * 60 * 1000)) / 1000);

    let paymentIntentsProcessed = 0;
    let invoicesProcessed = 0;
    const errors: string[] = [];

    try {
      let hasMore = true;
      let startingAfter: string | undefined;

      while (hasMore && paymentIntentsProcessed < 500) {
        const params: Stripe.PaymentIntentListParams = {
          limit: 100,
          created: { gte: startDate },
          expand: ['data.customer'],
        };
        if (startingAfter) params.starting_after = startingAfter;

        const page = await stripe.paymentIntents.list(params);

        for (const pi of page.data) {
          const customer = pi.customer as Stripe.Customer | null;
          await upsertTransactionCache({
            stripeId: pi.id,
            objectType: 'payment_intent',
            amountCents: pi.amount,
            currency: pi.currency || 'usd',
            status: pi.status,
            createdAt: new Date(pi.created * 1000),
            customerId: typeof pi.customer === 'string' ? pi.customer : customer?.id,
            customerEmail: customer?.email || pi.receipt_email || pi.metadata?.email,
            customerName: customer?.name || pi.metadata?.memberName,
            description: pi.description || pi.metadata?.productName || 'Stripe payment',
            metadata: pi.metadata,
            source: 'sync',
            paymentIntentId: pi.id,
          });
          paymentIntentsProcessed++;
        }

        hasMore = page.has_more;
        if (page.data.length > 0) {
          startingAfter = page.data[page.data.length - 1].id;
        }
        if (hasMore) await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err: unknown) {
      errors.push(`PaymentIntents: ${getErrorMessage(err)}`);
    }

    try {
      let hasMore = true;
      let startingAfter: string | undefined;

      while (hasMore && invoicesProcessed < 500) {
        const params: Stripe.InvoiceListParams = {
          limit: 100,
          created: { gte: startDate },
          expand: ['data.customer'],
        };
        if (startingAfter) params.starting_after = startingAfter;

        const page = await stripe.invoices.list(params);

        for (const inv of page.data) {
          const customer = inv.customer as Stripe.Customer | null;
          const linkedPiId = typeof inv.payment_intent === 'string'
            ? inv.payment_intent
            : (inv.payment_intent as Stripe.PaymentIntent | null)?.id ?? undefined;
          await upsertTransactionCache({
            stripeId: inv.id,
            objectType: 'invoice',
            amountCents: inv.amount_paid || inv.amount_due || 0,
            currency: inv.currency || 'usd',
            status: inv.status || 'unknown',
            createdAt: new Date(inv.created * 1000),
            customerId: typeof inv.customer === 'string' ? inv.customer : customer?.id,
            customerEmail: customer?.email || inv.customer_email,
            customerName: customer?.name,
            description: inv.lines?.data?.[0]?.description || 'Invoice',
            metadata: inv.metadata,
            source: 'sync',
            invoiceId: inv.id,
            paymentIntentId: linkedPiId,
          });
          invoicesProcessed++;
        }

        hasMore = page.has_more;
        if (page.data.length > 0) {
          startingAfter = page.data[page.data.length - 1].id;
        }
        if (hasMore) await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (err: unknown) {
      errors.push(`Invoices: ${getErrorMessage(err)}`);
    }

    logFromRequest(req, {
      action: 'sync_stripe_activity',
      resourceType: 'billing',
      resourceId: 'sync',
      details: { daysBack: safeDaysBack, paymentIntentsProcessed, invoicesProcessed, errorCount: errors.length },
    });

    logger.info('[Activity] Stripe sync complete', { extra: { paymentIntentsProcessed, invoicesProcessed, errors: errors.length } });

    const totalSynced = paymentIntentsProcessed + invoicesProcessed;
    const allFailed = errors.length > 0 && totalSynced === 0;

    if (allFailed) {
      return res.status(502).json({
        success: false,
        error: 'All sync phases failed',
        errors,
      });
    }

    res.json({
      success: true,
      synced: {
        paymentIntents: paymentIntentsProcessed,
        invoices: invoicesProcessed,
        total: totalSynced,
      },
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error: unknown) {
    logger.error('[Activity] Error syncing from Stripe', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ success: false, error: 'Failed to sync from Stripe' });
  }
});

router.post('/api/financials/invoices/:id/finalize', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    if (!invoiceId.startsWith('in_')) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const { staffEmail, staffName } = getStaffInfo(req);
    const stripe = await getStripeClient();

    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: `Cannot finalize invoice with status: ${invoice.status}` });
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoiceId);

    const customerEmail = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer | null)?.email || 'unknown';

    await logBillingAudit({
      memberEmail: invoice.customer_email || customerEmail,
      actionType: 'invoice_finalized',
      actionDetails: {
        invoiceId,
        amountDue: finalized.amount_due,
        description: invoice.description,
      },
      previousValue: 'draft',
      newValue: 'open',
      performedBy: staffEmail,
      performedByName: staffName,
    });

    await logFromRequest(req, {
      action: 'invoice_finalized',
      resourceType: 'invoices',
      resourceId: invoiceId,
      resourceName: `$${(finalized.amount_due / 100).toFixed(2)} - ${invoice.description || 'Invoice'}`,
      details: { memberEmail: invoice.customer_email || customerEmail },
    });

    logger.info('[Invoices] Invoice finalized by staff', { extra: { invoiceId, staffEmail } });

    res.json({ success: true, status: finalized.status });
  } catch (error: unknown) {
    logger.error('[Invoices] Error finalizing invoice', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to finalize invoice' });
  }
});

router.post('/api/financials/invoices/:id/void', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    if (!invoiceId.startsWith('in_')) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const { staffEmail, staffName } = getStaffInfo(req);
    const stripe = await getStripeClient();

    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status !== 'open') {
      return res.status(400).json({ error: `Cannot void invoice with status: ${invoice.status}` });
    }

    const voided = await stripe.invoices.voidInvoice(invoiceId);

    const customerEmail = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer | null)?.email || 'unknown';

    await logBillingAudit({
      memberEmail: invoice.customer_email || customerEmail,
      actionType: 'invoice_voided',
      actionDetails: {
        invoiceId,
        amountDue: invoice.amount_due,
        description: invoice.description,
      },
      previousValue: 'open',
      newValue: 'void',
      performedBy: staffEmail,
      performedByName: staffName,
    });

    await logFromRequest(req, {
      action: 'invoice_voided',
      resourceType: 'invoices',
      resourceId: invoiceId,
      resourceName: `$${(invoice.amount_due / 100).toFixed(2)} - ${invoice.description || 'Invoice'}`,
      details: { memberEmail: invoice.customer_email || customerEmail },
    });

    logger.info('[Invoices] Invoice voided by staff', { extra: { invoiceId, staffEmail } });

    res.json({ success: true, status: voided.status });
  } catch (error: unknown) {
    logger.error('[Invoices] Error voiding invoice', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to void invoice' });
  }
});

router.post('/api/financials/invoices/:id/send', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    if (!invoiceId.startsWith('in_')) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const { staffEmail, staffName } = getStaffInfo(req);
    const stripe = await getStripeClient();

    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status !== 'open') {
      return res.status(400).json({ error: `Cannot send invoice with status: ${invoice.status}. Invoice must be open.` });
    }

    await stripe.invoices.sendInvoice(invoiceId);

    const customerEmail = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer | null)?.email || 'unknown';

    await logBillingAudit({
      memberEmail: invoice.customer_email || customerEmail,
      actionType: 'invoice_sent',
      actionDetails: {
        invoiceId,
        amountDue: invoice.amount_due,
        description: invoice.description,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
      },
      newValue: `Sent invoice for $${(invoice.amount_due / 100).toFixed(2)}`,
      performedBy: staffEmail,
      performedByName: staffName,
    });

    await logFromRequest(req, {
      action: 'invoice_sent',
      resourceType: 'invoices',
      resourceId: invoiceId,
      resourceName: `$${(invoice.amount_due / 100).toFixed(2)} - ${invoice.description || 'Invoice'}`,
      details: { memberEmail: invoice.customer_email || customerEmail },
    });

    logger.info('[Invoices] Invoice sent to member by staff', { extra: { invoiceId, staffEmail, memberEmail: invoice.customer_email } });

    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('[Invoices] Error sending invoice', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to send invoice' });
  }
});

router.post('/api/financials/invoices/:id/mark-uncollectible', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    if (!invoiceId.startsWith('in_')) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const { staffEmail, staffName } = getStaffInfo(req);
    const stripe = await getStripeClient();

    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status !== 'open') {
      return res.status(400).json({ error: `Cannot mark uncollectible an invoice with status: ${invoice.status}` });
    }

    const updated = await stripe.invoices.markUncollectible(invoiceId);

    const customerEmail = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer | null)?.email || 'unknown';

    await logBillingAudit({
      memberEmail: invoice.customer_email || customerEmail,
      actionType: 'invoice_marked_uncollectible',
      actionDetails: {
        invoiceId,
        amountDue: invoice.amount_due,
        description: invoice.description,
      },
      previousValue: 'open',
      newValue: 'uncollectible',
      performedBy: staffEmail,
      performedByName: staffName,
    });

    await logFromRequest(req, {
      action: 'invoice_marked_uncollectible',
      resourceType: 'invoices',
      resourceId: invoiceId,
      resourceName: `$${(invoice.amount_due / 100).toFixed(2)} - ${invoice.description || 'Invoice'}`,
      details: { memberEmail: invoice.customer_email || customerEmail },
    });

    logger.info('[Invoices] Invoice marked uncollectible by staff', { extra: { invoiceId, staffEmail } });

    res.json({ success: true, status: updated.status });
  } catch (error: unknown) {
    logger.error('[Invoices] Error marking invoice uncollectible', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to mark invoice as uncollectible' });
  }
});

router.delete('/api/financials/invoices/:id', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const invoiceId = req.params.id;
    if (!invoiceId.startsWith('in_')) {
      return res.status(400).json({ error: 'Invalid invoice ID' });
    }
    const { staffEmail, staffName } = getStaffInfo(req);
    const stripe = await getStripeClient();

    const invoice = await stripe.invoices.retrieve(invoiceId);
    if (invoice.status !== 'draft') {
      return res.status(400).json({ error: `Cannot delete invoice with status: ${invoice.status}. Only draft invoices can be deleted.` });
    }

    const customerEmail = typeof invoice.customer === 'string'
      ? invoice.customer
      : (invoice.customer as Stripe.Customer | null)?.email || 'unknown';

    await stripe.invoices.del(invoiceId);

    await logBillingAudit({
      memberEmail: invoice.customer_email || customerEmail,
      actionType: 'invoice_draft_deleted',
      actionDetails: {
        invoiceId,
        amountDue: invoice.amount_due,
        description: invoice.description,
      },
      previousValue: 'draft',
      newValue: 'deleted',
      performedBy: staffEmail,
      performedByName: staffName,
    });

    await logFromRequest(req, {
      action: 'invoice_draft_deleted',
      resourceType: 'invoices',
      resourceId: invoiceId,
      resourceName: `$${(invoice.amount_due / 100).toFixed(2)} - ${invoice.description || 'Invoice'}`,
      details: { memberEmail: invoice.customer_email || customerEmail },
    });

    logger.info('[Invoices] Draft invoice deleted by staff', { extra: { invoiceId, staffEmail } });

    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('[Invoices] Error deleting draft invoice', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to delete draft invoice' });
  }
});

export default router;
