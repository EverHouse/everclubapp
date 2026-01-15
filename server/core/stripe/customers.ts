import { pool } from '../db';
import { getStripeClient } from './client';

export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  name?: string
): Promise<{ customerId: string; isNew: boolean }> {
  const userResult = await pool.query(
    'SELECT stripe_customer_id FROM users WHERE id = $1',
    [userId]
  );
  
  if (userResult.rows[0]?.stripe_customer_id) {
    return { customerId: userResult.rows[0].stripe_customer_id, isNew: false };
  }

  const stripe = await getStripeClient();
  
  const existingCustomers = await stripe.customers.list({
    email: email.toLowerCase(),
    limit: 1
  });

  let customerId: string;
  let isNew = false;

  if (existingCustomers.data.length > 0) {
    customerId = existingCustomers.data[0].id;
  } else {
    const customer = await stripe.customers.create({
      email: email.toLowerCase(),
      name: name || undefined,
      metadata: {
        userId: userId,
        source: 'even_house_app'
      }
    });
    customerId = customer.id;
    isNew = true;
  }

  await pool.query(
    'UPDATE users SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2',
    [customerId, userId]
  );

  console.log(`[Stripe] ${isNew ? 'Created' : 'Linked existing'} customer ${customerId} for user ${userId}`);
  
  return { customerId, isNew };
}

export async function getStripeCustomerByEmail(email: string): Promise<string | null> {
  const result = await pool.query(
    'SELECT stripe_customer_id FROM users WHERE LOWER(email) = $1 AND stripe_customer_id IS NOT NULL',
    [email.toLowerCase()]
  );
  
  return result.rows[0]?.stripe_customer_id || null;
}

export async function updateCustomerPaymentMethod(
  customerId: string,
  paymentMethodId: string
): Promise<void> {
  const stripe = await getStripeClient();
  
  await stripe.paymentMethods.attach(paymentMethodId, {
    customer: customerId,
  });

  await stripe.customers.update(customerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId,
    },
  });

  console.log(`[Stripe] Updated default payment method for customer ${customerId}`);
}
