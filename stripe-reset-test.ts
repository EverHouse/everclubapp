import { getStripeClient } from './server/core/stripe/client';

async function main() {
  const stripe = await getStripeClient();
  
  // The old clock was already deleted, but we need to clean up the new customer  
  console.log('Cleaning up customer cus_TqNYEijlEcjPPP...');
  try {
    await stripe.customers.del('cus_TqNYEijlEcjPPP');
    console.log('Deleted orphaned customer');
  } catch (e: any) {
    console.log('Already deleted or not found');
  }
  
  // Delete the test clock we just created
  try {
    await stripe.testHelpers.testClocks.del('clock_1Ssgmz4XrxqCSeuFd4OANAj2');
    console.log('Deleted test clock');
  } catch (e: any) {
    console.log('Clock already deleted');
  }
  
  // Create a new test clock starting from 1 month ago (December 23, 2025)
  const oneMonthAgo = Math.floor(Date.now() / 1000) - (30 * 24 * 60 * 60);
  console.log('\nCreating new test clock starting from', new Date(oneMonthAgo * 1000).toISOString());
  
  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: oneMonthAgo,
    name: 'Test account - 1 month history',
  });
  console.log('Created test clock:', clock.id);
  
  // Create customer on this test clock
  const customer = await stripe.customers.create({
    email: 'testaccount@example.com',
    name: 'Test account',
    test_clock: clock.id,
  });
  console.log('Created customer:', customer.id);
  
  // Add a payment method FIRST (before subscription)
  const paymentMethod = await stripe.paymentMethods.create({
    type: 'card',
    card: {
      token: 'tok_visa',
    },
  });
  await stripe.paymentMethods.attach(paymentMethod.id, { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: paymentMethod.id },
  });
  console.log('Attached payment method:', paymentMethod.id);
  
  // Find the Social tier price
  const prices = await stripe.prices.list({ 
    active: true,
    limit: 100,
    expand: ['data.product']
  });
  
  // Find a recurring price (Social membership)
  const socialPrice = prices.data.find(p => {
    const product = p.product as any;
    return p.recurring && product.name && product.name.toLowerCase().includes('social');
  });
  
  const priceToUse = socialPrice || prices.data.find(p => p.recurring);
  if (!priceToUse) {
    throw new Error('No recurring price found!');
  }
  
  console.log('Using price:', priceToUse.id, 'Product:', (priceToUse.product as any)?.name || priceToUse.product);
  
  // Create subscription
  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: priceToUse.id }],
    metadata: { source: 'test_setup' },
    default_payment_method: paymentMethod.id,
  });
  console.log('Created subscription:', subscription.id, 'Status:', subscription.status);
  
  // Advance the test clock to today (generates billing history)
  console.log('\nAdvancing test clock to today...');
  const today = Math.floor(Date.now() / 1000);
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: today });
  console.log('Advancing to:', new Date(today * 1000).toISOString());
  
  // Wait for clock to be ready
  let clockStatus = 'advancing';
  while (clockStatus === 'advancing') {
    await new Promise(r => setTimeout(r, 2000));
    const updatedClock = await stripe.testHelpers.testClocks.retrieve(clock.id);
    clockStatus = updatedClock.status;
    console.log('Clock status:', clockStatus);
  }
  
  // Check subscription status
  const updatedSub = await stripe.subscriptions.retrieve(subscription.id);
  console.log('\nFinal subscription status:', updatedSub.status);
  
  // List invoices
  const invoices = await stripe.invoices.list({ customer: customer.id });
  console.log('Invoices:', invoices.data.length);
  for (const inv of invoices.data) {
    console.log('  ', inv.id, inv.status, '$' + ((inv.amount_paid || 0) / 100));
  }
  
  console.log('\n=== SUMMARY ===');
  console.log('New customer ID:', customer.id);
  console.log('New subscription ID:', subscription.id);
  console.log('Test clock ID:', clock.id);
  console.log('\nUpdate database with: UPDATE users SET stripe_customer_id = \'' + customer.id + '\' WHERE email = \'testaccount@example.com\';');
}

main().catch(console.error);
