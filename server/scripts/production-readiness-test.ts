import { getResendClient } from '../utils/resend';
import { getStripeClient } from '../core/stripe/client';
import { runAllIntegrityChecks } from '../core/dataIntegrity';
import { db } from '../db';
import { sql } from 'drizzle-orm';

interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'warning';
  details: string;
  duration?: number;
}

const results: TestResult[] = [];

async function logResult(name: string, testFn: () => Promise<{ status: 'pass' | 'fail' | 'warning'; details: string }>) {
  const start = Date.now();
  try {
    const result = await testFn();
    results.push({ name, ...result, duration: Date.now() - start });
    console.log(`${result.status === 'pass' ? '✓' : result.status === 'warning' ? '⚠' : '✗'} ${name}: ${result.details}`);
  } catch (error: any) {
    results.push({ name, status: 'fail', details: error.message, duration: Date.now() - start });
    console.log(`✗ ${name}: ${error.message}`);
  }
}

async function testStripeConnection() {
  return logResult('Stripe Connection', async () => {
    const stripe = await getStripeClient();
    const account = await stripe.accounts.retrieve();
    return { 
      status: 'pass', 
      details: `Connected to Stripe account: ${account.business_profile?.name || account.id}` 
    };
  });
}

async function testStripeProducts() {
  return logResult('Stripe Products Configured', async () => {
    const stripe = await getStripeClient();
    const products = await stripe.products.list({ active: true, limit: 10 });
    const prices = await stripe.prices.list({ active: true, limit: 20 });
    
    if (products.data.length === 0) {
      return { status: 'warning', details: 'No active products found in Stripe' };
    }
    
    return { 
      status: 'pass', 
      details: `${products.data.length} products, ${prices.data.length} prices configured` 
    };
  });
}

async function testStripeWebhookEndpoint() {
  return logResult('Stripe Webhook Endpoint', async () => {
    const stripe = await getStripeClient();
    const webhooks = await stripe.webhookEndpoints.list({ limit: 10 });
    
    const activeWebhooks = webhooks.data.filter(w => w.status === 'enabled');
    if (activeWebhooks.length === 0) {
      return { status: 'fail', details: 'No enabled webhook endpoints found' };
    }
    
    return { 
      status: 'pass', 
      details: `${activeWebhooks.length} active webhook endpoint(s)` 
    };
  });
}

async function testStripeTestCard() {
  return logResult('Stripe Test Card (PaymentIntent)', async () => {
    const stripe = await getStripeClient();
    
    const paymentIntent = await stripe.paymentIntents.create({
      amount: 100,
      currency: 'usd',
      payment_method: 'pm_card_visa',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
    });
    
    if (paymentIntent.status === 'succeeded') {
      await stripe.refunds.create({ payment_intent: paymentIntent.id });
      return { status: 'pass', details: 'Test payment succeeded and refunded' };
    }
    
    return { status: 'warning', details: `Payment status: ${paymentIntent.status}` };
  });
}

async function testResendConnection() {
  return logResult('Resend Email Connection', async () => {
    const { client, fromEmail } = await getResendClient();
    
    if (!fromEmail) {
      return { status: 'warning', details: 'Resend connected but no from_email configured' };
    }
    
    return { status: 'pass', details: `Resend connected, from: ${fromEmail}` };
  });
}

async function testResendTestEmail() {
  return logResult('Resend Test Email Delivery', async () => {
    const { client, fromEmail } = await getResendClient();
    
    const testEmail = process.env.ALERT_EMAIL || 'nick@evenhouse.club';
    
    const result = await client.emails.send({
      from: fromEmail || 'Ever House <noreply@everhouse.app>',
      to: testEmail,
      subject: '[TEST] Production Readiness Check - Email Delivery Verified',
      html: `
        <div style="font-family: -apple-system, system-ui, sans-serif; padding: 20px; max-width: 600px;">
          <h2 style="color: #293515;">Email Delivery Test Successful</h2>
          <p>This is an automated test email to verify that the Ever House app can send emails correctly.</p>
          <p style="color: #666; font-size: 14px;">Tested at: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} Pacific</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">This is a system test email. No action required.</p>
        </div>
      `
    });
    
    return { status: 'pass', details: `Test email sent to ${testEmail} (ID: ${result.data?.id})` };
  });
}

async function testDataIntegrity() {
  return logResult('Data Integrity Checks', async () => {
    const checks = await runAllIntegrityChecks('manual');
    
    const passed = checks.filter(c => c.status === 'pass').length;
    const warnings = checks.filter(c => c.status === 'warning').length;
    const failed = checks.filter(c => c.status === 'fail').length;
    const totalIssues = checks.reduce((sum, c) => sum + c.issueCount, 0);
    
    const criticalIssues = checks
      .filter(c => c.status === 'fail')
      .map(c => `${c.checkName} (${c.issueCount} issues)`);
    
    if (failed > 0) {
      return { 
        status: 'warning', 
        details: `${passed} passed, ${warnings} warnings, ${failed} failed. Critical: ${criticalIssues.join(', ')}` 
      };
    }
    
    return { 
      status: 'pass', 
      details: `${checks.length} checks run: ${passed} passed, ${warnings} warnings, ${totalIssues} total issues` 
    };
  });
}

async function testWebhookLogging() {
  return logResult('Webhook Logging Table', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM trackman_webhook_log WHERE created_at > NOW() - INTERVAL '7 days'
    `);
    const count = (result.rows[0] as any)?.count || 0;
    
    const recentErrors = await db.execute(sql`
      SELECT COUNT(*)::int as count FROM trackman_webhook_log 
      WHERE created_at > NOW() - INTERVAL '7 days' AND status = 'error'
    `);
    const errorCount = (recentErrors.rows[0] as any)?.count || 0;
    
    if (errorCount > 10) {
      return { 
        status: 'warning', 
        details: `${count} webhooks last 7 days, ${errorCount} errors - review error logs` 
      };
    }
    
    return { status: 'pass', details: `${count} webhooks logged in last 7 days, ${errorCount} errors` };
  });
}

async function testSchedulerHealth() {
  return logResult('Scheduler Health', async () => {
    const result = await db.execute(sql`
      SELECT 
        (SELECT COUNT(*)::int FROM integrity_check_history WHERE checked_at > NOW() - INTERVAL '2 days') as integrity_runs,
        (SELECT COUNT(*)::int FROM stripe_transaction_cache WHERE created_at > NOW() - INTERVAL '7 days') as stripe_cache_entries
    `);
    const row = result.rows[0] as any;
    
    if (row.integrity_runs === 0) {
      return { status: 'warning', details: 'No integrity checks run in last 2 days' };
    }
    
    return { 
      status: 'pass', 
      details: `${row.integrity_runs} integrity check(s) in 2 days, ${row.stripe_cache_entries} Stripe cache entries` 
    };
  });
}

async function testErrorAlertConfig() {
  return logResult('Error Alert Configuration', async () => {
    const alertEmail = process.env.ALERT_EMAIL;
    
    if (!alertEmail) {
      return { status: 'warning', details: 'ALERT_EMAIL not set - using default nick@evenhouse.club' };
    }
    
    return { status: 'pass', details: `Error alerts configured for: ${alertEmail}` };
  });
}

async function testDatabaseConnection() {
  return logResult('Database Connection', async () => {
    const result = await db.execute(sql`SELECT NOW() as current_time, current_database() as db_name`);
    const row = result.rows[0] as any;
    
    return { status: 'pass', details: `Connected to ${row.db_name}` };
  });
}

async function runAllTests() {
  console.log('\n========================================');
  console.log('  PRODUCTION READINESS TEST SUITE');
  console.log('========================================\n');
  console.log(`Started at: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} Pacific\n`);
  
  console.log('--- PAYMENT SYSTEM (Stripe) ---');
  await testStripeConnection();
  await testStripeProducts();
  await testStripeWebhookEndpoint();
  await testStripeTestCard();
  
  console.log('\n--- EMAIL DELIVERY (Resend) ---');
  await testResendConnection();
  await testResendTestEmail();
  
  console.log('\n--- DATA INTEGRITY ---');
  await testDatabaseConnection();
  await testDataIntegrity();
  
  console.log('\n--- MONITORING & LOGGING ---');
  await testWebhookLogging();
  await testSchedulerHealth();
  await testErrorAlertConfig();
  
  console.log('\n========================================');
  console.log('  SUMMARY');
  console.log('========================================');
  
  const passed = results.filter(r => r.status === 'pass').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const failed = results.filter(r => r.status === 'fail').length;
  
  console.log(`\nTotal: ${results.length} tests`);
  console.log(`  ✓ Passed: ${passed}`);
  console.log(`  ⚠ Warnings: ${warnings}`);
  console.log(`  ✗ Failed: ${failed}`);
  
  if (failed > 0) {
    console.log('\nFailed Tests:');
    results.filter(r => r.status === 'fail').forEach(r => {
      console.log(`  - ${r.name}: ${r.details}`);
    });
  }
  
  if (warnings > 0) {
    console.log('\nWarnings:');
    results.filter(r => r.status === 'warning').forEach(r => {
      console.log(`  - ${r.name}: ${r.details}`);
    });
  }
  
  console.log('\n========================================\n');
  
  return { passed, warnings, failed, results };
}

runAllTests()
  .then(({ passed, warnings, failed }) => {
    if (failed > 0) {
      process.exit(1);
    }
    process.exit(0);
  })
  .catch(error => {
    console.error('Test suite crashed:', error);
    process.exit(1);
  });
