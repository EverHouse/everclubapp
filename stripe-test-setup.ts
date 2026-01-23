import { getStripeClient } from './server/core/stripe/client';

async function main() {
  const stripe = await getStripeClient();
  
  // List test clocks
  const clocks = await stripe.testHelpers.testClocks.list({ limit: 20 });
  console.log('Test Clocks:');
  for (const c of clocks.data) {
    console.log('  ID:', c.id, 'Name:', c.name || 'unnamed', 'Status:', c.status, 'Frozen:', new Date(c.frozen_time * 1000).toISOString());
  }
  
  // Check the specific customer
  try {
    const cust = await stripe.customers.retrieve('cus_TqGbm6crr88MWl');
    if (!cust.deleted) {
      console.log('\nCustomer cus_TqGbm6crr88MWl exists');
      console.log('  test_clock:', (cust as any).test_clock || 'none');
      console.log('  email:', (cust as any).email);
    }
  } catch (e: any) {
    console.log('Customer not found:', e.message);
  }
  
  // List subscriptions for this customer
  const subs = await stripe.subscriptions.list({ customer: 'cus_TqGbm6crr88MWl', status: 'all' });
  console.log('\nSubscriptions for cus_TqGbm6crr88MWl:');
  for (const s of subs.data) {
    console.log('  ID:', s.id, 'Status:', s.status, 'Created:', new Date(s.created * 1000).toISOString());
  }
}

main().catch(console.error);
