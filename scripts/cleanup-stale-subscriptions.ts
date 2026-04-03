import { getStripeClient } from '../server/core/stripe/client';
import { isStripeResourceMissing } from '../server/utils/errorUtils';
import { queueIntegrityFixSync } from '../server/core/hubspot/queueHelpers';
import type Stripe from 'stripe';

const STALE_SUBSCRIPTION_IDS = [
  'sub_1T4pPw4XrxqCSeuFScgJhqL4',
  'sub_1T4oPp4XrxqCSeuFP1eZrtJo',
  'sub_1T5LYu4XrxqCSeuFQv3MutZV',
  'sub_1T5KN04XrxqCSeuFyQh6HA3B',
  'sub_1TA49O4XrxqCSeuFY72lwPEG',
];

const ACTIVE_LIKE_STATUSES = ['active', 'past_due', 'trialing', 'unpaid'];

function stripeStatusToMembershipStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active': return 'active';
    case 'trialing': return 'active';
    case 'past_due': return 'past_due';
    case 'unpaid': return 'past_due';
    default: return 'inactive';
  }
}

interface SubSearchResult {
  subscription: Stripe.Subscription | null;
  error: string | null;
}

async function findActiveSubscription(
  stripe: Stripe,
  customerId: string | null,
  email: string
): Promise<SubSearchResult> {
  if (customerId) {
    try {
      const activeSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: 'active',
        limit: 10,
      });
      if (activeSubs.data.length > 0) return { subscription: activeSubs.data[0], error: null };

      const allSubs = await stripe.subscriptions.list({
        customer: customerId,
        limit: 10,
      });
      const recoverableSub = allSubs.data.find(s =>
        ['trialing', 'past_due', 'unpaid'].includes(s.status)
      );
      if (recoverableSub) return { subscription: recoverableSub, error: null };
    } catch (err: unknown) {
      const msg = `Customer lookup failed for ${customerId}: ${(err as Error).message}`;
      console.log(`  ERROR: ${msg}`);
      return { subscription: null, error: msg };
    }
  }

  try {
    const customers = await stripe.customers.list({ email: email.toLowerCase(), limit: 10 });
    for (const customer of customers.data) {
      if (customer.id === customerId) continue;
      const subs = await stripe.subscriptions.list({
        customer: customer.id,
        limit: 10,
      });
      const activeSub = subs.data.find(s =>
        ['active', 'trialing', 'past_due', 'unpaid'].includes(s.status)
      );
      if (activeSub) return { subscription: activeSub, error: null };
    }
  } catch (err: unknown) {
    const msg = `Email-based customer search failed for ${email}: ${(err as Error).message}`;
    console.log(`  ERROR: ${msg}`);
    return { subscription: null, error: msg };
  }

  return { subscription: null, error: null };
}

async function verifyStaleCount(pool: InstanceType<(typeof import('pg'))['Pool']>, stripe: Stripe): Promise<number> {
  const usersResult = await pool.query(
    `SELECT id, stripe_subscription_id FROM users WHERE stripe_subscription_id IS NOT NULL`
  );
  let staleCount = 0;
  const BATCH_SIZE = 10;
  for (let i = 0; i < usersResult.rows.length; i += BATCH_SIZE) {
    const batch = usersResult.rows.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (user: { stripe_subscription_id: string }) => {
        try {
          await stripe.subscriptions.retrieve(user.stripe_subscription_id);
          return false;
        } catch (err: unknown) {
          if (isStripeResourceMissing(err)) return true;
          return false;
        }
      })
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) staleCount++;
    }
  }
  return staleCount;
}

async function main() {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const stripe = await getStripeClient();

  const placeholders = STALE_SUBSCRIPTION_IDS.map((_, i) => `$${i + 1}`).join(', ');
  const usersResult = await pool.query(
    `SELECT id, email, first_name, last_name, stripe_subscription_id, stripe_customer_id, membership_status, tier, billing_provider
     FROM users
     WHERE stripe_subscription_id IN (${placeholders})`,
    STALE_SUBSCRIPTION_IDS
  );

  if (usersResult.rows.length === 0) {
    console.log('No users found with the specified stale subscription IDs. Already cleaned up.');
    console.log('\n=== POST-CLEANUP VERIFICATION ===');
    const staleCount = await verifyStaleCount(pool, stripe);
    console.log(`Stale subscription count: ${staleCount}`);
    console.log(staleCount === 0 ? 'PASS: 0 stale subscriptions found' : `FAIL: ${staleCount} stale subscription(s) still remain`);
    await pool.end();
    process.exit(staleCount === 0 ? 0 : 1);
  }

  console.log(`\n=== AUDIT: ${usersResult.rows.length} members with stale subscription IDs ===\n`);

  const actions: Array<{
    userId: string;
    email: string;
    name: string;
    tier: string;
    oldStatus: string;
    staleSubId: string;
    action: 'clear' | 'relink' | 'skip';
    newSubId?: string;
    newStripeStatus?: string;
    reason: string;
  }> = [];

  for (const user of usersResult.rows) {
    const memberName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
    console.log(`--- ${memberName} <${user.email}> ---`);
    console.log(`  User ID: ${user.id}`);
    console.log(`  Status: ${user.membership_status}, Tier: ${user.tier}, Billing: ${user.billing_provider}`);
    console.log(`  Stale Sub: ${user.stripe_subscription_id}`);
    console.log(`  Customer: ${user.stripe_customer_id || 'none'}`);

    let staleConfirmed = false;
    try {
      const sub = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
      console.log(`  Subscription STILL EXISTS in Stripe (status: ${sub.status}) — skipping`);
      actions.push({
        userId: user.id, email: user.email, name: memberName,
        tier: user.tier || '', oldStatus: user.membership_status || '',
        staleSubId: user.stripe_subscription_id,
        action: 'skip', reason: `Subscription still exists in Stripe (status: ${sub.status})`
      });
      continue;
    } catch (err: unknown) {
      if (isStripeResourceMissing(err)) {
        staleConfirmed = true;
        console.log(`  Confirmed stale — subscription not found in Stripe`);
      } else {
        console.log(`  Error checking subscription: ${(err as Error).message} — skipping`);
        actions.push({
          userId: user.id, email: user.email, name: memberName,
          tier: user.tier || '', oldStatus: user.membership_status || '',
          staleSubId: user.stripe_subscription_id,
          action: 'skip', reason: `Error checking subscription: ${(err as Error).message}`
        });
        continue;
      }
    }

    if (!staleConfirmed) continue;

    const searchResult = await findActiveSubscription(stripe, user.stripe_customer_id, user.email);

    if (searchResult.error) {
      console.log(`  Stripe lookup error — skipping to avoid incorrect deactivation`);
      actions.push({
        userId: user.id, email: user.email, name: memberName,
        tier: user.tier || '', oldStatus: user.membership_status || '',
        staleSubId: user.stripe_subscription_id,
        action: 'skip', reason: `Stripe lookup error: ${searchResult.error}`
      });
    } else if (searchResult.subscription) {
      const sub = searchResult.subscription;
      console.log(`  Found subscription: ${sub.id} (status: ${sub.status}, customer: ${typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer)?.id})`);
      actions.push({
        userId: user.id, email: user.email, name: memberName,
        tier: user.tier || '', oldStatus: user.membership_status || '',
        staleSubId: user.stripe_subscription_id,
        action: 'relink', newSubId: sub.id,
        newStripeStatus: sub.status,
        reason: `Found subscription ${sub.id} (status: ${sub.status})`
      });
    } else {
      console.log(`  No active/recoverable subscriptions found (checked customer + email search)`);
      actions.push({
        userId: user.id, email: user.email, name: memberName,
        tier: user.tier || '', oldStatus: user.membership_status || '',
        staleSubId: user.stripe_subscription_id,
        action: 'clear',
        reason: 'No active subscription found — membership genuinely lapsed'
      });
    }
    console.log('');
  }

  console.log('\n=== ACTIONS SUMMARY ===\n');
  for (const action of actions) {
    if (action.action === 'clear') {
      console.log(`CLEAR: "${action.name}" <${action.email}> — ${action.reason}`);
    } else if (action.action === 'relink') {
      console.log(`RELINK: "${action.name}" <${action.email}> — ${action.reason}`);
    } else {
      console.log(`SKIP: "${action.name}" <${action.email}> — ${action.reason}`);
    }
  }

  const dryRun = process.argv.includes('--dry-run');
  if (dryRun) {
    console.log('\n[DRY RUN] No changes applied. Remove --dry-run to execute.\n');
    await pool.end();
    return;
  }

  console.log('\n=== APPLYING FIXES ===\n');

  let cleared = 0;
  let relinked = 0;
  let skipped = 0;
  const PERFORMER = 'stale-subscription-cleanup-script';

  for (const action of actions) {
    if (action.action === 'skip') {
      skipped++;
      continue;
    }

    if (action.action === 'relink') {
      const newMembershipStatus = stripeStatusToMembershipStatus(action.newStripeStatus || 'active');
      const result = await pool.query(
        `UPDATE users 
         SET stripe_subscription_id = $1,
             membership_status = $4,
             membership_status_changed_at = CASE
               WHEN membership_status IS DISTINCT FROM $4 THEN NOW()
               ELSE membership_status_changed_at
             END,
             updated_at = NOW(),
             last_manual_fix_at = NOW(),
             last_manual_fix_by = $5
         WHERE id = $2 AND stripe_subscription_id = $3`,
        [action.newSubId, action.userId, action.staleSubId, newMembershipStatus, PERFORMER]
      );
      if (result.rowCount && result.rowCount > 0) {
        relinked++;
        console.log(`  Relinked "${action.name}": ${action.staleSubId} -> ${action.newSubId} (status -> ${newMembershipStatus})`);
        queueIntegrityFixSync({
          email: action.email,
          status: newMembershipStatus,
          tier: action.tier,
          fixAction: 'relink_stale_subscription',
          performedBy: PERFORMER
        }).catch(() => {});
      } else {
        console.log(`  Relink failed for "${action.name}" (concurrent change?)`);
      }
    }

    if (action.action === 'clear') {
      const statusChanged = ACTIVE_LIKE_STATUSES.includes(action.oldStatus);
      const result = await pool.query(
        `UPDATE users 
         SET stripe_subscription_id = NULL,
             membership_status = CASE 
               WHEN membership_status IN ('active', 'past_due', 'trialing', 'unpaid') THEN 'inactive'
               ELSE membership_status
             END,
             membership_status_changed_at = CASE 
               WHEN membership_status IN ('active', 'past_due', 'trialing', 'unpaid') THEN NOW()
               ELSE membership_status_changed_at
             END,
             updated_at = NOW(),
             last_manual_fix_at = NOW(),
             last_manual_fix_by = $3
         WHERE id = $1 AND stripe_subscription_id = $2`,
        [action.userId, action.staleSubId, PERFORMER]
      );
      if (result.rowCount && result.rowCount > 0) {
        cleared++;
        console.log(`  Cleared stale subscription for "${action.name}" (-> inactive)`);
        queueIntegrityFixSync({
          email: action.email,
          status: statusChanged ? 'inactive' : action.oldStatus,
          tier: action.tier,
          fixAction: 'clear_stale_subscription',
          performedBy: PERFORMER
        }).catch(() => {});
      } else {
        console.log(`  Clear failed for "${action.name}" (concurrent change?)`);
      }
    }
  }

  console.log(`\n=== COMPLETE: ${cleared} cleared, ${relinked} relinked, ${skipped} skipped ===\n`);

  console.log('=== POST-CLEANUP VERIFICATION ===');
  const staleCount = await verifyStaleCount(pool, stripe);
  console.log(`Stale subscription count: ${staleCount}`);
  console.log(staleCount === 0 ? 'PASS: 0 stale subscriptions found' : `FAIL: ${staleCount} stale subscription(s) still remain`);

  await pool.end();
  process.exit(staleCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
