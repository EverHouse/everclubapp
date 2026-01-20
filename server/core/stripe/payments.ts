
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

interface CreatePaymentIntentParams {
  userId: number;
  email: string;
  memberName: string;
  amountCents: number;
  purpose: 'booking_pre_auth' | 'other';
  description: string;
  bookingId?: number;
}

// Helper to find or create a Stripe customer by email
// This avoids the database dependency which is currently unavailable.
async function findOrCreateStripeCustomer(email: string, name: string): Promise<string> {
    // Search for existing customers with this email
    const customers = await stripe.customers.list({
        email: email,
        limit: 1,
    });

    if (customers.data.length > 0) {
        return customers.data[0].id;
    }

    // Create a new customer in Stripe
    const customer = await stripe.customers.create({
        email: email,
        name: name,
    });

    return customer.id;
}


export async function createPaymentIntent(params: CreatePaymentIntentParams): Promise<{ paymentIntentId: string; clientSecret: string; }> {
  const { userId, email, memberName, amountCents, purpose, description, bookingId } = params;

  if (amountCents <= 0) {
      throw new Error("Amount must be greater than zero to create a payment intent.");
  }

  const customerId = await findOrCreateStripeCustomer(email, memberName);

  const intentOptions: any = {
      amount: amountCents,
      currency: 'usd',
      customer: customerId,
      description: description,
      metadata: {
          app_user_id: userId,
          purpose: purpose,
          ...(bookingId && { app_booking_id: bookingId }),
      },
  };

  if (purpose === 'booking_pre_auth') {
      intentOptions.capture_method = 'manual';
      intentOptions.setup_future_usage = 'off_session';
  }

  const paymentIntent = await stripe.paymentIntents.create(intentOptions);

  return {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
  };
}

export async function cancelPaymentIntent(paymentIntentId: string): Promise<void> {
    if (!paymentIntentId) {
        console.warn("cancelPaymentIntent called with no paymentIntentId");
        return;
    }
  try {
    const intent = await stripe.paymentIntents.cancel(paymentIntentId);
    console.log(`Payment intent ${intent.id} cancelled successfully.`);
  } catch (error: any) {
      console.error(`Failed to cancel payment intent ${paymentIntentId}: ${error.message}`);
      if (error.code === 'payment_intent_unexpected_state') {
          // This is not a critical failure. It means the intent is no longer in a cancelable state
          // (e.g., it has already been captured or previously cancelled).
          const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
          console.warn(`Could not cancel payment intent ${paymentIntentId} because its status is '${intent.status}'. This may be expected.`);
      } else {
          // Rethrow for other unexpected errors
          throw error;
      }
  }
}
