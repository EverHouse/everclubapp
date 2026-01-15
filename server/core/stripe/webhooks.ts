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

  const sessionId = metadata?.sessionId ? parseInt(metadata.sessionId, 10) : NaN;
  const bookingId = metadata?.bookingId ? parseInt(metadata.bookingId, 10) : NaN;
  const amountDollars = (amount / 100).toFixed(2);
  
  interface ParticipantFee { id: number; amountCents: number; }
  let participantFees: ParticipantFee[] = [];
  let validatedParticipantIds: number[] = [];
  const feeSnapshotId = metadata?.feeSnapshotId ? parseInt(metadata.feeSnapshotId, 10) : NaN;
  
  if (!isNaN(feeSnapshotId)) {
    try {
      const snapshotResult = await pool.query(
        `SELECT bfs.*, bs.booking_id as verified_booking_id
         FROM booking_fee_snapshots bfs
         JOIN booking_sessions bs ON bfs.session_id = bs.id
         WHERE bfs.id = $1 AND bfs.stripe_payment_intent_id = $2 AND bfs.status = 'pending'`,
        [feeSnapshotId, id]
      );
      
      if (snapshotResult.rows.length === 0) {
        console.error(`[Stripe Webhook] Fee snapshot ${feeSnapshotId} not found or already used for intent ${id}`);
        return;
      }
      
      const snapshot = snapshotResult.rows[0];
      
      if (Math.abs(snapshot.total_cents - amount) > 1) {
        console.error(`[Stripe Webhook] Amount mismatch: snapshot=${snapshot.total_cents}, payment=${amount} - rejecting`);
        return;
      }
      
      const snapshotFees: ParticipantFee[] = snapshot.participant_fees;
      const participantIds = snapshotFees.map(pf => pf.id);
      
      const statusCheck = await pool.query(
        `SELECT id, payment_status FROM booking_participants WHERE id = ANY($1::int[])`,
        [participantIds]
      );
      
      const statusMap = new Map<number, string>();
      for (const row of statusCheck.rows) {
        statusMap.set(row.id, row.payment_status || 'pending');
      }
      
      for (const pf of snapshotFees) {
        const status = statusMap.get(pf.id);
        if (status === 'paid' || status === 'waived') {
          console.warn(`[Stripe Webhook] Participant ${pf.id} already ${status} - skipping`);
          continue;
        }
        participantFees.push(pf);
        validatedParticipantIds.push(pf.id);
      }
      
      await pool.query(
        `UPDATE booking_fee_snapshots SET status = 'used', used_at = NOW() WHERE id = $1`,
        [feeSnapshotId]
      );
      
      console.log(`[Stripe Webhook] Validated ${validatedParticipantIds.length} participants from snapshot ${feeSnapshotId}`);
    } catch (err) {
      console.error('[Stripe Webhook] Failed to validate from snapshot:', err);
      return;
    }
  } else if (metadata?.participantFees && !isNaN(bookingId) && bookingId > 0) {
    console.warn(`[Stripe Webhook] No snapshot ID - falling back to DB cached fee validation`);
    try {
      const clientFees: ParticipantFee[] = JSON.parse(metadata.participantFees);
      const participantIds = clientFees.map(pf => pf.id);
      
      const dbResult = await pool.query(
        `SELECT bp.id, bp.payment_status, bp.cached_fee_cents
         FROM booking_participants bp
         INNER JOIN booking_sessions bs ON bp.session_id = bs.id
         WHERE bp.id = ANY($1::int[]) AND bs.booking_id = $2`,
        [participantIds, bookingId]
      );
      
      const dbFeeMap = new Map<number, number>();
      const statusMap = new Map<number, string>();
      for (const row of dbResult.rows) {
        dbFeeMap.set(row.id, row.cached_fee_cents || 0);
        statusMap.set(row.id, row.payment_status || 'pending');
      }
      
      for (const pf of clientFees) {
        const cachedFee = dbFeeMap.get(pf.id);
        if (cachedFee === undefined) {
          console.warn(`[Stripe Webhook] Fallback: participant ${pf.id} not in booking - skipping`);
          continue;
        }
        const status = statusMap.get(pf.id);
        if (status === 'paid' || status === 'waived') {
          console.warn(`[Stripe Webhook] Fallback: participant ${pf.id} already ${status} - skipping`);
          continue;
        }
        if (cachedFee <= 0) {
          console.warn(`[Stripe Webhook] Fallback: participant ${pf.id} has no cached fee - skipping`);
          continue;
        }
        participantFees.push({ id: pf.id, amountCents: cachedFee });
        validatedParticipantIds.push(pf.id);
      }
      
      const dbTotal = participantFees.reduce((sum, pf) => sum + pf.amountCents, 0);
      if (Math.abs(dbTotal - amount) > 1) {
        console.error(`[Stripe Webhook] Fallback total mismatch: db=${dbTotal}, payment=${amount} - rejecting`);
        participantFees = [];
        validatedParticipantIds = [];
        return;
      }
      
      console.log(`[Stripe Webhook] Fallback validated ${validatedParticipantIds.length} participants using DB cached fees`);
    } catch (err) {
      console.error('[Stripe Webhook] Fallback validation failed:', err);
    }
  }

  if (validatedParticipantIds.length > 0 && !isNaN(bookingId) && bookingId > 0) {
    try {
      const updateResult = await pool.query(
        `UPDATE booking_participants bp
         SET payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $3, cached_fee_cents = 0
         FROM booking_sessions bs
         WHERE bp.session_id = bs.id 
           AND bs.booking_id = $1 
           AND bp.id = ANY($2::int[])
         RETURNING bp.id`,
        [bookingId, validatedParticipantIds, id]
      );
      console.log(`[Stripe Webhook] Updated ${updateResult.rowCount} participant(s) to paid and cleared cached fees with intent ${id}`);
    } catch (error) {
      console.error('[Stripe Webhook] Error updating participant payment status:', error);
    }
  } else if (validatedParticipantIds.length > 0) {
    console.error(`[Stripe Webhook] Cannot update participants - invalid bookingId: ${bookingId}`);
  }

  if (!isNaN(bookingId) && bookingId > 0) {
    try {
      if (participantFees.length > 0) {
        for (const pf of participantFees) {
          await pool.query(
            `INSERT INTO booking_payment_audit 
             (booking_id, session_id, participant_id, action, staff_email, staff_name, amount_affected, payment_method, metadata)
             VALUES ($1, $2, $3, 'payment_confirmed', 'system', 'Stripe Webhook', $4, $5, $6)`,
            [
              bookingId, 
              isNaN(sessionId) ? null : sessionId,
              pf.id,
              pf.amountCents / 100,
              'stripe',
              JSON.stringify({ stripePaymentIntentId: id })
            ]
          );
        }
        console.log(`[Stripe Webhook] Created ${participantFees.length} audit record(s) for booking ${bookingId}`);
      } else {
        await pool.query(
          `INSERT INTO booking_payment_audit 
           (booking_id, session_id, participant_id, action, staff_email, staff_name, amount_affected, payment_method, metadata)
           VALUES ($1, $2, NULL, 'payment_confirmed', 'system', 'Stripe Webhook', $3, $4, $5)`,
          [
            bookingId, 
            isNaN(sessionId) ? null : sessionId,
            parseFloat(amountDollars),
            'stripe',
            JSON.stringify({ stripePaymentIntentId: id })
          ]
        );
        console.log(`[Stripe Webhook] Created payment audit record for booking ${bookingId}`);
      }
    } catch (error) {
      console.error('[Stripe Webhook] Error creating payment audit:', error);
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
