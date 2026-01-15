import { getStripeSync } from './client';
import { syncPaymentToHubSpot } from './hubspotSync';
import { pool } from '../db';

export async function processStripeWebhook(
  payload: Buffer,
  signature: string
): Promise<void> {
  if (!Buffer.isBuffer(payload)) {
    throw new Error(
      'STRIPE WEBHOOK ERROR: Payload must be a Buffer. ' +
      'Received type: ' + typeof payload + '. ' +
      'This usually means express.json() parsed the body before reaching this handler.'
    );
  }

  const sync = await getStripeSync();
  
  await sync.processWebhook(payload, signature);

  const payloadString = payload.toString('utf8');
  const event = JSON.parse(payloadString);

  if (event.type === 'payment_intent.succeeded') {
    await handlePaymentIntentSucceeded(event.data.object);
  }
}

async function handlePaymentIntentSucceeded(paymentIntent: any): Promise<void> {
  const { id, metadata, amount } = paymentIntent;
  
  console.log(`[Stripe Webhook] Payment succeeded: ${id}, amount: $${(amount / 100).toFixed(2)}`);

  await pool.query(
    `UPDATE stripe_payment_intents 
     SET status = 'succeeded', updated_at = NOW() 
     WHERE stripe_payment_intent_id = $1`,
    [id]
  );

  if (metadata?.bookingId) {
    const bookingId = parseInt(metadata.bookingId, 10);
    const participantId = metadata.participantId ? parseInt(metadata.participantId, 10) : null;

    if (!isNaN(bookingId)) {
      try {
        if (participantId) {
          await pool.query(
            `UPDATE booking_participants 
             SET payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1
             WHERE booking_id = $2 AND id = $3`,
            [id, bookingId, participantId]
          );
        }

        await pool.query(
          `INSERT INTO booking_payment_audit (booking_id, action, payment_method, amount_cents, stripe_payment_intent_id, performed_by, performed_by_name)
           VALUES ($1, 'payment_confirmed', 'stripe', $2, $3, 'system', 'Stripe Webhook')`,
          [bookingId, amount, id]
        );

        console.log(`[Stripe Webhook] Updated booking ${bookingId} payment status`);
      } catch (error) {
        console.error('[Stripe Webhook] Error updating booking payment status:', error);
      }
    }
  }

  if (metadata?.email && metadata?.purpose) {
    try {
      await syncPaymentToHubSpot({
        email: metadata.email,
        amountCents: amount,
        purpose: metadata.purpose,
        description: paymentIntent.description || `Stripe payment: ${metadata.purpose}`,
        paymentIntentId: id
      });
    } catch (error) {
      console.error('[Stripe Webhook] Error syncing to HubSpot:', error);
    }
  }
}
