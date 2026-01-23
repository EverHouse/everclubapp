import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { pool } from '../core/db';
import { getStripeClient } from '../core/stripe/client';
import { sendOutstandingBalanceEmail } from '../emails/paymentEmails';
import { getPacificMidnightUTC } from '../utils/dateUtils';
import Stripe from 'stripe';

const router = Router();

interface RecentTransaction {
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
 * Returns unified recent transactions from Stripe API AND local offline payments
 * Now queries Stripe directly for authoritative payment data
 * Requires staff authentication
 */
router.get('/api/financials/recent-transactions', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const stripe = await getStripeClient();
    const { date } = req.query;
    
    // Calculate date range for filtering using Pacific timezone
    let startOfDay: number | undefined;
    let endOfDay: number | undefined;
    
    if (date && typeof date === 'string') {
      startOfDay = Math.floor(getPacificMidnightUTC(date).getTime() / 1000);
      endOfDay = startOfDay + 86400; // 24 hours later
    }
    
    // Fetch all PaymentIntents with pagination
    const allPaymentIntents: Stripe.PaymentIntent[] = [];
    let piHasMore = true;
    let piStartingAfter: string | undefined;
    
    while (piHasMore && allPaymentIntents.length < 500) {
      const stripeParams: Stripe.PaymentIntentListParams = {
        limit: 100,
        expand: ['data.customer'],
      };
      
      if (startOfDay && endOfDay) {
        stripeParams.created = { gte: startOfDay, lt: endOfDay };
      }
      
      if (piStartingAfter) {
        stripeParams.starting_after = piStartingAfter;
      }
      
      const page = await stripe.paymentIntents.list(stripeParams);
      allPaymentIntents.push(...page.data);
      piHasMore = page.has_more;
      
      if (page.data.length > 0) {
        piStartingAfter = page.data[page.data.length - 1].id;
      }
    }
    
    console.log(`[Financials] Fetched ${allPaymentIntents.length} PaymentIntents from Stripe`);
    
    // Fetch all Charges with pagination (for payments that may not have PaymentIntents)
    const allCharges: Stripe.Charge[] = [];
    let chHasMore = true;
    let chStartingAfter: string | undefined;
    
    while (chHasMore && allCharges.length < 500) {
      const chargesParams: Stripe.ChargeListParams = {
        limit: 100,
        expand: ['data.customer'],
      };
      
      if (startOfDay && endOfDay) {
        chargesParams.created = { gte: startOfDay, lt: endOfDay };
      }
      
      if (chStartingAfter) {
        chargesParams.starting_after = chStartingAfter;
      }
      
      const page = await stripe.charges.list(chargesParams);
      allCharges.push(...page.data);
      chHasMore = page.has_more;
      
      if (page.data.length > 0) {
        chStartingAfter = page.data[page.data.length - 1].id;
      }
    }
    
    console.log(`[Financials] Fetched ${allCharges.length} Charges from Stripe`);
    
    // Convert Stripe PaymentIntents to our transaction format
    const stripeTransactions: RecentTransaction[] = allPaymentIntents
      .filter(pi => pi.status === 'succeeded' || pi.status === 'requires_capture')
      .map(pi => {
        const customer = pi.customer as Stripe.Customer | null;
        return {
          id: pi.id,
          type: 'stripe' as const,
          amount_cents: pi.amount,
          description: pi.description || pi.metadata?.productName || 'Stripe payment',
          member_email: customer?.email || pi.receipt_email || pi.metadata?.email || 'Unknown',
          member_name: customer?.name || pi.metadata?.memberName || customer?.email || 'Unknown',
          created_at: new Date(pi.created * 1000),
          status: pi.status === 'succeeded' ? 'succeeded' : 'pending',
        };
      });
    
    // Track PaymentIntent IDs to avoid duplicates from charges
    const piIds = new Set(allPaymentIntents.map(pi => pi.id));
    
    // Add charges that aren't already covered by PaymentIntents
    const chargeTransactions: RecentTransaction[] = allCharges
      .filter(ch => ch.paid && !ch.refunded && (!ch.payment_intent || !piIds.has(ch.payment_intent as string)))
      .map(ch => {
        const customer = ch.customer as Stripe.Customer | null;
        return {
          id: ch.id,
          type: 'stripe' as const,
          amount_cents: ch.amount,
          description: ch.description || 'Stripe charge',
          member_email: customer?.email || ch.receipt_email || ch.billing_details?.email || 'Unknown',
          member_name: customer?.name || ch.billing_details?.name || customer?.email || 'Unknown',
          created_at: new Date(ch.created * 1000),
          status: 'succeeded',
        };
      });
    
    // Fetch local offline payments and day passes
    let dateFilter = '';
    const queryParams: any[] = [];
    
    if (startOfDay && endOfDay) {
      dateFilter = ' WHERE created_at >= to_timestamp($1) AND created_at < to_timestamp($2)';
      queryParams.push(startOfDay, endOfDay);
    }
    
    const offlineQuery = `
      SELECT 
        'offline' as type, id::text, amount_cents, description, member_email, 
        COALESCE(member_name, 'Unknown') as member_name, created_at, 'completed' as status
      FROM offline_payments${dateFilter}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    
    const dayPassQuery = `
      SELECT 
        'day_pass' as type, id::text, price_cents as amount_cents, 'Day Pass' as description, email as member_email,
        COALESCE(purchaser_first_name || ' ' || purchaser_last_name, email) as member_name, purchased_at as created_at, 'completed' as status
      FROM day_passes WHERE status = 'active'${dateFilter ? ' AND purchased_at >= to_timestamp($1) AND purchased_at < to_timestamp($2)' : ''}
      ORDER BY purchased_at DESC
      LIMIT 100
    `;

    const [offlineResult, dayPassResult] = await Promise.all([
      pool.query(offlineQuery, queryParams),
      pool.query(dayPassQuery, queryParams),
    ]);
    
    const offlineTransactions: RecentTransaction[] = offlineResult.rows.map(row => ({
      id: row.id,
      type: row.type,
      amount_cents: parseInt(row.amount_cents),
      description: row.description,
      member_email: row.member_email,
      member_name: row.member_name,
      created_at: new Date(row.created_at),
      status: row.status
    }));
    
    const dayPassTransactions: RecentTransaction[] = dayPassResult.rows.map(row => ({
      id: row.id,
      type: row.type,
      amount_cents: parseInt(row.amount_cents),
      description: row.description,
      member_email: row.member_email,
      member_name: row.member_name,
      created_at: new Date(row.created_at),
      status: row.status
    }));

    // Merge all transactions and sort by date
    const allTransactions = [
      ...stripeTransactions,
      ...chargeTransactions,
      ...offlineTransactions,
      ...dayPassTransactions,
    ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
    
    // Deduplicate by ID (in case same transaction appears in multiple sources)
    const seen = new Set<string>();
    const transactions = allTransactions.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    }).slice(0, 100);

    res.json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (error: any) {
    console.error('[Financials] Error fetching recent transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent transactions'
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
    
    // Debug: Log account info to verify we're using the right API key
    try {
      const account = await stripe.accounts.retrieve();
      console.log(`[Financials] Stripe account: ${account.id}`);
    } catch (e: any) {
      console.log('[Financials] Could not get account info:', e.message);
    }
    
    // Use 'all' to fetch ALL subscriptions regardless of status (includes incomplete, canceled, etc.)
    // Without this, Stripe only returns active/trialing/past_due/unpaid by default
    const statusFilter = status && typeof status === 'string' && status !== 'all' 
      ? status as Stripe.Subscription.Status
      : 'all';
    
    const pageLimit = Math.min(Math.max(parseInt(limit as string) || 50, 1), 100);
    
    const listParams: Stripe.SubscriptionListParams = {
      limit: pageLimit,
      expand: ['data.customer', 'data.items.data.price'],
      status: statusFilter,
    };
    
    if (starting_after && typeof starting_after === 'string') {
      listParams.starting_after = starting_after;
    }
    
    console.log(`[Financials] Fetching subscriptions with params:`, listParams);
    let subscriptions = await stripe.subscriptions.list(listParams);
    console.log(`[Financials] Found ${subscriptions.data.length} subscriptions from global list`);
    
    // If no subscriptions found globally, fetch per-customer (needed for test clock subscriptions)
    // Test clock subscriptions don't appear in global list() calls
    if (subscriptions.data.length === 0) {
      console.log('[Financials] Fetching subscriptions per-customer (for test clock support)...');
      const allSubs: Stripe.Subscription[] = [];
      
      // Paginate through ALL customers to find test clock subscriptions
      let hasMoreCustomers = true;
      let customerStartingAfter: string | undefined;
      let customerCount = 0;
      
      while (hasMoreCustomers) {
        const customerParams: Stripe.CustomerListParams = { limit: 100 };
        if (customerStartingAfter) {
          customerParams.starting_after = customerStartingAfter;
        }
        
        const customersPage = await stripe.customers.list(customerParams);
        customerCount += customersPage.data.length;
        
        for (const cust of customersPage.data) {
          try {
            const custSubs = await stripe.subscriptions.list({ 
              customer: cust.id, 
              status: statusFilter,
              limit: 100,
              expand: ['data.items.data.price']
            });
            // Add customer data to each subscription
            for (const sub of custSubs.data) {
              (sub as any).customer = cust;
              allSubs.push(sub);
            }
          } catch (e: any) {
            console.log(`[Financials] Error fetching subs for ${cust.email}: ${e.message}`);
          }
        }
        
        hasMoreCustomers = customersPage.has_more;
        if (customersPage.data.length > 0) {
          customerStartingAfter = customersPage.data[customersPage.data.length - 1].id;
        }
        
        // Safety limit to avoid infinite loops - max 1000 customers
        if (customerCount >= 1000) {
          console.log('[Financials] Reached customer limit (1000) for test clock subscription search');
          break;
        }
      }
      
      console.log(`[Financials] Scanned ${customerCount} customers, found ${allSubs.length} subscriptions via per-customer fetch`);
      subscriptions = { data: allSubs, has_more: false, object: 'list', url: '' };
    }

    const subscriptionItems: SubscriptionListItem[] = subscriptions.data.map(sub => {
      const customer = sub.customer as Stripe.Customer;
      const item = sub.items.data[0];
      const price = item?.price;
      
      return {
        id: sub.id,
        memberEmail: customer?.email || 'Unknown',
        memberName: customer?.name || customer?.email || 'Unknown',
        planName: price?.nickname || 'Subscription Plan',
        amount: price?.unit_amount || 0,
        currency: price?.currency || 'usd',
        interval: price?.recurring?.interval || 'month',
        status: sub.status,
        currentPeriodEnd: sub.current_period_end,
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
  } catch (error: any) {
    console.error('[Financials] Error fetching subscriptions:', error);
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

    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['customer', 'items.data.price.product'],
    });

    if (!subscription) {
      return res.status(404).json({ success: false, error: 'Subscription not found' });
    }

    const customer = subscription.customer as Stripe.Customer;
    if (!customer?.email) {
      return res.status(400).json({ success: false, error: 'Customer email not found' });
    }

    const item = subscription.items.data[0];
    const price = item?.price;
    const product = price?.product as Stripe.Product | undefined;
    const amount = (price?.unit_amount || 0) / 100;

    const result = await sendOutstandingBalanceEmail(customer.email, {
      memberName: customer.name || 'Member',
      amount,
      description: `${product?.name || 'Membership'} subscription payment is past due`,
      dueDate: new Date(subscription.current_period_end * 1000).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    });

    if (result.success) {
      console.log(`[Financials] Sent payment reminder to ${customer.email} for subscription ${subscriptionId}`);
      res.json({ success: true, message: 'Reminder sent successfully' });
    } else {
      res.status(500).json({ success: false, error: result.error || 'Failed to send reminder' });
    }
  } catch (error: any) {
    console.error('[Financials] Error sending subscription reminder:', error);
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
    
    const pageLimit = Math.min(Math.max(parseInt(limit as string) || 50, 1), 100);
    
    const listParams: Stripe.InvoiceListParams = {
      limit: pageLimit,
      expand: ['data.customer'],
    };

    if (status && typeof status === 'string' && status !== 'all') {
      listParams.status = status as Stripe.InvoiceListParams['status'];
    }

    if (startDate && typeof startDate === 'string') {
      const startTimestamp = Math.floor(new Date(startDate).getTime() / 1000);
      listParams.created = { ...(listParams.created as object || {}), gte: startTimestamp };
    }

    if (endDate && typeof endDate === 'string') {
      const endTimestamp = Math.floor(new Date(endDate).getTime() / 1000) + 86400;
      listParams.created = { ...(listParams.created as object || {}), lte: endTimestamp };
    }

    if (starting_after && typeof starting_after === 'string') {
      listParams.starting_after = starting_after;
    }

    const invoices = await stripe.invoices.list(listParams);

    const invoiceItems: InvoiceListItem[] = invoices.data.map(invoice => {
      const customer = invoice.customer as Stripe.Customer | null;
      
      return {
        id: invoice.id,
        memberEmail: customer?.email || invoice.customer_email || 'Unknown',
        memberName: customer?.name || customer?.email || invoice.customer_email || 'Unknown',
        number: invoice.number,
        amountDue: invoice.amount_due,
        amountPaid: invoice.amount_paid,
        currency: invoice.currency,
        status: invoice.status || 'draft',
        created: invoice.created,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
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
  } catch (error: any) {
    console.error('[Financials] Error fetching invoices:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch invoices',
    });
  }
});

export default router;
