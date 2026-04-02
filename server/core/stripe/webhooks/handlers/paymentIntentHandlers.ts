import Stripe from 'stripe';
  import { db } from '../../../../db';
  import { sql } from 'drizzle-orm';
  import { notifyPaymentFailed, notifyStaffPaymentFailed, notifyAllStaff } from '../../../notificationService';
  import { sendPaymentFailedEmail } from '../../../../emails/paymentEmails';
  import { broadcastBillingUpdate } from '../../../websocket';
  import { computeFeeBreakdown } from '../../../billing/unifiedFeeService';
  import { logPaymentFailure } from '../../../monitoring';
  import { sendErrorAlert } from '../../../errorAlerts';
  import { logSystemAction, logPaymentAudit } from '../../../auditLog';
  import { finalizeInvoicePaidOutOfBand } from '../../invoices';
  import { queueJobInTransaction } from '../../../jobQueue';
  import { logger } from '../../../logger';
  import type { PoolClient } from 'pg';
  import type { DeferredAction } from '../types';
  import { upsertTransactionCache } from '../framework';
  import { getErrorMessage } from '../../../../utils/errorUtils';
  import { PaymentStatusService } from '../../../billing/PaymentStatusService';

  const MAX_RETRY_ATTEMPTS = 3;
  
export async function handlePaymentIntentSucceeded(client: PoolClient, paymentIntent: Stripe.PaymentIntent): Promise<DeferredAction[]> {
  const { id, metadata, amount, currency, customer, receipt_email, description, created } = paymentIntent;
  const deferredActions: DeferredAction[] = [];
  
  logger.info(`[Stripe Webhook] Payment succeeded: ${id}, amount: $${(amount / 100).toFixed(2)}`);

  const customerEmail = typeof customer === 'object' ? (customer as Stripe.Customer)?.email : receipt_email || metadata?.email;
  const customerName = typeof customer === 'object' ? (customer as Stripe.Customer)?.name : metadata?.memberName;
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  
  deferredActions.push(async () => {
    await upsertTransactionCache({
      stripeId: id,
      objectType: 'payment_intent',
      amountCents: amount,
      currency: currency || 'usd',
      status: 'succeeded',
      createdAt: new Date(created * 1000),
      customerId,
      customerEmail,
      customerName,
      description: description || metadata?.productName || 'Stripe payment',
      metadata,
      source: 'webhook',
      paymentIntentId: id,
    });
  });

  const bookingIdFromMeta = metadata?.bookingId ? parseInt(metadata.bookingId, 10) : NaN;
  const sessionIdFromMeta = metadata?.sessionId ? parseInt(metadata.sessionId, 10) : NaN;
  const userIdFromMeta = metadata?.email || metadata?.memberEmail || customerEmail || '';

  await client.query(
    `INSERT INTO stripe_payment_intents 
       (user_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, purpose, booking_id, session_id, description, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'succeeded', NOW(), NOW())
     ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
       status = 'succeeded',
       updated_at = NOW(),
       booking_id = COALESCE(stripe_payment_intents.booking_id, EXCLUDED.booking_id),
       session_id = COALESCE(stripe_payment_intents.session_id, EXCLUDED.session_id)`,
    [
      userIdFromMeta,
      id,
      customerId || null,
      amount,
      metadata?.purpose || 'payment',
      isNaN(bookingIdFromMeta) ? null : bookingIdFromMeta,
      isNaN(sessionIdFromMeta) ? null : sessionIdFromMeta,
      description || metadata?.productName || 'Stripe payment',
    ]
  );

  const sessionId = metadata?.sessionId ? parseInt(metadata.sessionId, 10) : NaN;
  const bookingId = metadata?.bookingId ? parseInt(metadata.bookingId, 10) : NaN;
  const amountDollars = (amount / 100).toFixed(2);
  
  interface ParticipantFee { id: number; amountCents: number; }
  let participantFees: ParticipantFee[] = [];
  let validatedParticipantIds: number[] = [];
  const feeSnapshotId = metadata?.feeSnapshotId ? parseInt(metadata.feeSnapshotId, 10) : NaN;
  
  if (!isNaN(feeSnapshotId)) {
    const snapshotResult = await client.query(
      `SELECT bfs.*
       FROM booking_fee_snapshots bfs
       WHERE bfs.id = $1 AND bfs.stripe_payment_intent_id = $2 AND bfs.status IN ('pending', 'failed')
       FOR UPDATE OF bfs`,
      [feeSnapshotId, id]
    );
    
    if (snapshotResult.rows.length === 0) {
      const completedCheck = await client.query(
        `SELECT id, status FROM booking_fee_snapshots WHERE id = $1 AND stripe_payment_intent_id = $2 AND status IN ('completed', 'paid')`,
        [feeSnapshotId, id]
      );
      if (completedCheck.rows.length > 0) {
        logger.info(`[Stripe Webhook] Fee snapshot ${feeSnapshotId} already completed for PI ${id} — idempotent webhook retry, skipping`);
        return deferredActions;
      }
      logger.error(`[Stripe Webhook] Fee snapshot ${feeSnapshotId} not found or locked by another process — queueing auto-refund for orphaned payment`);
      await queueJobInTransaction(client, 'stripe_auto_refund', {
        paymentIntentId: id,
        reason: 'duplicate',
        metadata: {
          reason: 'snapshot_not_found_or_already_used',
          feeSnapshotId: String(feeSnapshotId),
          bookingId: String(bookingId),
        },
        idempotencyKey: `refund_orphaned_snapshot_${id}_${feeSnapshotId}`,
        sessionId: !isNaN(sessionId) ? sessionId : undefined,
        reviewReason: `Auto-refund queued for orphaned payment: PI ${id}, $${amountDollars}. Fee snapshot ${feeSnapshotId} not found or already used.`,
      }, { priority: 10, maxRetries: 5 });
      return deferredActions;
    }
    
    const snapshot = snapshotResult.rows[0];
    
    if (Math.abs(snapshot.total_cents - amount) > 1) {
      logger.error(`[Stripe Webhook] CRITICAL: Amount mismatch: snapshot=${snapshot.total_cents}, payment=${amount} - flagging for review`);
      await client.query(
        `UPDATE booking_sessions SET needs_review = true, review_reason = $1 WHERE id = $2`,
        [`Amount mismatch: expected ${snapshot.total_cents} cents, received ${amount} cents from Stripe`, snapshot.session_id]
      );
    }
    
    const capturedSessionId = snapshot.session_id;
    const capturedSnapshotTotal = snapshot.total_cents;
    deferredActions.push(async () => {
      try {
        const currentFees = await computeFeeBreakdown({ 
          sessionId: capturedSessionId, 
          source: 'stripe',
          excludeSessionFromUsage: true
        });
        
        if (Math.abs(currentFees.totals.totalCents - capturedSnapshotTotal) > 100) {
          logger.error(`[Stripe Webhook] Fee snapshot mismatch - potential drift detected`, { extra: { detail: {
            sessionId: capturedSessionId,
            snapshotTotal: capturedSnapshotTotal,
            currentTotal: currentFees.totals.totalCents,
            difference: currentFees.totals.totalCents - capturedSnapshotTotal
          } } });
        }
      } catch (verifyError: unknown) {
        logger.warn(`[Stripe Webhook] Could not verify fee breakdown for session ${capturedSessionId}:`, { extra: { error: getErrorMessage(verifyError) } });
      }
    });
    
    const snapshotFees: ParticipantFee[] = snapshot.participant_fees;
    const participantIds = snapshotFees.map(pf => pf.id);
    
    const statusCheck = await client.query(
      `SELECT id, payment_status FROM booking_participants WHERE id = ANY($1::int[]) ORDER BY id ASC FOR UPDATE`,
      [participantIds]
    );
    
    const statusMap = new Map<number, string>();
    for (const row of statusCheck.rows) {
      statusMap.set(row.id, row.payment_status || 'pending');
    }
    
    for (const pf of snapshotFees) {
      const status = statusMap.get(pf.id);
      if (status === 'paid' || status === 'waived') {
        logger.warn(`[Stripe Webhook] Participant ${pf.id} already ${status} - skipping`);
        continue;
      }
      participantFees.push(pf);
      validatedParticipantIds.push(pf.id);
    }
    
    const unpaidTotal = participantFees.reduce((sum, pf) => sum + pf.amountCents, 0);
    if (amount > unpaidTotal + 1) {
      const alreadyPaidCount = snapshotFees.length - participantFees.length;
      const overpaymentCents = amount - unpaidTotal;
      const overpaymentReason = participantFees.length < snapshotFees.length
        ? `${alreadyPaidCount} participant(s) already paid separately.`
        : `All ${participantFees.length} participant(s) were unpaid — possible price mismatch or Stripe misconfiguration.`;
      logger.error(`[Stripe Webhook] CRITICAL: Overpayment detected — auto-refunding`, { extra: { detail: {
        sessionId: snapshot.session_id,
        paymentIntentId: id,
        paymentAmount: amount,
        unpaidTotal,
        overpaymentCents,
        alreadyPaidCount,
        message: `Payment of ${amount} cents received but only ${unpaidTotal} cents was owed. ${overpaymentReason}`
      } } });

      if (validatedParticipantIds.length === 0) {
        await queueJobInTransaction(client, 'stripe_auto_refund', {
          paymentIntentId: id,
          reason: 'duplicate',
          metadata: {
            reason: 'all_participants_already_paid',
            sessionId: String(snapshot.session_id),
            bookingId: String(bookingId),
            overpaymentCents: String(overpaymentCents),
          },
          idempotencyKey: `refund_overpayment_full_${id}_${bookingId}`,
          sessionId: snapshot.session_id,
          reviewReason: `Auto-refund failed for overpayment: PI ${id}, ${overpaymentCents} cents. All participants already paid.`,
        }, { priority: 10, maxRetries: 5 });
      } else {
        await queueJobInTransaction(client, 'stripe_auto_refund', {
          paymentIntentId: id,
          amountCents: overpaymentCents,
          reason: 'duplicate',
          metadata: {
            reason: 'partial_participants_already_paid',
            sessionId: String(snapshot.session_id),
            bookingId: String(bookingId),
            overpaymentCents: String(overpaymentCents),
          },
          idempotencyKey: `refund_overpayment_partial_${id}_${bookingId}_${overpaymentCents}`,
          sessionId: snapshot.session_id,
          reviewReason: `Partial auto-refund failed: PI ${id}, ${overpaymentCents} cents overpaid.`,
        }, { priority: 10, maxRetries: 5 });
      }
    }
    
    await client.query(
      `UPDATE booking_fee_snapshots SET status = 'completed', used_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [feeSnapshotId]
    );
    
    if (validatedParticipantIds.length > 0) {
      const paidResult = await PaymentStatusService.markPaymentSucceeded({
        paymentIntentId: id,
        preValidatedParticipants: participantFees,
        bookingId,
        sessionId: isNaN(sessionId) ? undefined : sessionId,
        feeSnapshotId,
        skipSnapshotUpdate: true,
        staffEmail: 'system',
        staffName: 'Stripe Webhook',
      }, client);
      if (!paidResult.success) {
        throw new Error(`PaymentStatusService.markPaymentSucceeded failed for PI ${id}: ${paidResult.error}`);
      }
      
      const localBookingId = bookingId;
      const localSessionId = sessionId;
      const localAmount = amount;
      deferredActions.push(async () => {
        broadcastBillingUpdate({
          action: 'booking_payment_updated',
          bookingId: localBookingId,
          sessionId: isNaN(localSessionId) ? undefined : localSessionId,
          amount: localAmount
        });
      });
    }
    
    logger.info(`[Stripe Webhook] Snapshot ${feeSnapshotId} processed via PaymentStatusService`);
    validatedParticipantIds = [];
    participantFees = [];
  } else if (metadata?.participantFees) {
    logger.warn(`[Stripe Webhook] No snapshot ID - falling back to DB cached fee validation`);
    let clientFees: ParticipantFee[];
    try {
      clientFees = JSON.parse(metadata.participantFees);
    } catch (parseErr: unknown) {
      logger.error(`[Stripe Webhook] Failed to parse participantFees metadata for PI ${id} - marking for review`, { extra: { error: getErrorMessage(parseErr) } });
      await client.query(
        `INSERT INTO audit_log (action, resource_type, resource_id, details, created_at)
         VALUES ('parse_error', 'payment', $1, $2, NOW())`,
        [id, JSON.stringify({ error: 'Failed to parse participantFees metadata', raw: metadata.participantFees?.substring(0, 200) })]
      );
      clientFees = [];
    }
    if (clientFees.length === 0 && metadata?.participantFees) {
      logger.warn(`[Stripe Webhook] Empty or unparseable participantFees for PI ${id} - skipping participant updates`);
    }
    const participantIds = clientFees.map(pf => pf.id);
    
    const dbResult = await client.query(
      `SELECT bp.id, bp.payment_status, bp.cached_fee_cents
       FROM booking_participants bp
       WHERE bp.id = ANY($1::int[])
       ORDER BY bp.id ASC
       FOR UPDATE`,
      [participantIds]
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
        logger.warn(`[Stripe Webhook] Fallback: participant ${pf.id} not in booking - skipping`);
        continue;
      }
      const status = statusMap.get(pf.id);
      if (status === 'paid' || status === 'waived') {
        logger.warn(`[Stripe Webhook] Fallback: participant ${pf.id} already ${status} - skipping`);
        continue;
      }
      if (cachedFee <= 0) {
        logger.warn(`[Stripe Webhook] Fallback: participant ${pf.id} has no cached fee - skipping`);
        continue;
      }
      participantFees.push({ id: pf.id, amountCents: cachedFee });
      validatedParticipantIds.push(pf.id);
    }
    
    const dbTotal = participantFees.reduce((sum, pf) => sum + pf.amountCents, 0);
    if (Math.abs(dbTotal - amount) > 1) {
      // Investigated March 20 2026 incident (db=5000c vs payment=10000c).
      // Known scenarios that cause this mismatch:
      // 1. Roster changes between payment creation and webhook delivery (participants added/removed)
      // 2. Fee recalculation after pricing config update while payment was in-flight
      // 3. Credit/discount applied at Stripe level not reflected in cached_fee_cents
      // The proportional scaling below is the correct behavior — Stripe amount is authoritative.
      // Session is flagged needs_review for staff to verify the discrepancy.
      logger.error(`[Stripe Webhook] CRITICAL: Fallback total mismatch: db=${dbTotal}, payment=${amount} - using Stripe amount as source of truth`, { extra: { paymentIntentId: id, dbTotal, stripeAmount: amount, participantCount: participantFees.length } });
      if (sessionId) {
        await client.query(
          `UPDATE booking_sessions SET needs_review = true, review_reason = $1 WHERE id = $2`,
          [`Fallback amount mismatch: DB fees ${dbTotal} cents vs Stripe charged ${amount} cents — participant fees adjusted proportionally to match Stripe`, sessionId]
        );
      }
      if (dbTotal > 0 && participantFees.length > 0) {
        const scale = amount / dbTotal;
        let distributed = 0;
        for (let i = 0; i < participantFees.length; i++) {
          if (i === participantFees.length - 1) {
            const remainder = amount - distributed;
            participantFees[i].amountCents = Math.max(0, remainder);
          } else {
            participantFees[i].amountCents = Math.max(0, Math.floor(participantFees[i].amountCents * scale));
            distributed += participantFees[i].amountCents;
          }
        }
        logger.info(`[Stripe Webhook] Adjusted participant fees proportionally to match Stripe amount ${amount}`, { extra: { adjusted: participantFees.map(pf => ({ id: pf.id, cents: pf.amountCents })) } });
      }
    }
    
    logger.info(`[Stripe Webhook] Fallback validated ${validatedParticipantIds.length} participants using DB cached fees`);
  }

  if (validatedParticipantIds.length === 0 && !isNaN(bookingId) && metadata?.paymentType === 'booking_fee') {
    logger.warn(`[Stripe Webhook] No snapshot or participantFees metadata for booking_fee PI ${id} — attempting booking-fee fallback`);
    const fallbackResult = await client.query(
      `SELECT bp.id, bp.cached_fee_cents FROM booking_participants bp
       WHERE bp.session_id = (SELECT session_id FROM booking_requests WHERE id = $1)
       AND bp.payment_status IN ('pending', 'refunded') AND bp.cached_fee_cents > 0
       AND bp.stripe_payment_intent_id IS NULL
       ORDER BY bp.id ASC
       FOR UPDATE`,
      [bookingId]
    );

    if (fallbackResult.rows.length > 0) {
      const fallbackTotal = fallbackResult.rows.reduce((sum: number, r: { cached_fee_cents: number }) => sum + r.cached_fee_cents, 0);
      const tolerance = 50;

      if (Math.abs(fallbackTotal - amount) <= tolerance) {
        for (const row of fallbackResult.rows) {
          participantFees.push({ id: row.id, amountCents: row.cached_fee_cents });
          validatedParticipantIds.push(row.id);
        }
        logger.info(`[Stripe Webhook] Booking-fee fallback: matched ${validatedParticipantIds.length} participant(s) for booking ${bookingId} (pending=${fallbackTotal}, paid=${amount})`);
      } else {
        logger.warn(`[Stripe Webhook] Booking-fee fallback: amount mismatch for booking ${bookingId} (pending=${fallbackTotal}, paid=${amount}, tolerance=${tolerance}) — skipping auto-update`);
        if (!isNaN(sessionId)) {
          await client.query(
            `UPDATE booking_sessions SET needs_review = true, review_reason = $1 WHERE id = $2`,
            [`Booking-fee fallback amount mismatch: pending fees ${fallbackTotal} cents vs payment ${amount} cents`, sessionId]
          );
        }
      }
    } else {
      logger.info(`[Stripe Webhook] Booking-fee fallback: no pending participants found for booking ${bookingId}`);
    }
  }

  if (validatedParticipantIds.length > 0) {
    const fallbackPaidResult = await PaymentStatusService.markPaymentSucceeded({
      paymentIntentId: id,
      preValidatedParticipants: participantFees,
      bookingId,
      sessionId: isNaN(sessionId) ? undefined : sessionId,
      staffEmail: 'system',
      staffName: 'Stripe Webhook',
      persistAmountPaid: true,
    }, client);
    if (!fallbackPaidResult.success) {
      throw new Error(`PaymentStatusService.markPaymentSucceeded failed for PI ${id} (fallback): ${fallbackPaidResult.error}`);
    }
    
    const localBookingId = bookingId;
    const localSessionId = sessionId;
    const localAmount = amount;
    deferredActions.push(async () => {
      broadcastBillingUpdate({
        action: 'booking_payment_updated',
        bookingId: localBookingId,
        sessionId: isNaN(localSessionId) ? undefined : localSessionId,
        amount: localAmount
      });
    });
  }

  if (!isNaN(bookingId) && bookingId > 0 && participantFees.length === 0) {
    await logPaymentAudit({
      bookingId,
      sessionId: isNaN(sessionId) ? null : sessionId,
      participantId: null,
      action: 'payment_confirmed',
      staffEmail: 'system',
      staffName: 'Stripe Webhook',
      amountAffected: parseFloat(amountDollars),
      paymentMethod: 'stripe',
      metadata: { stripePaymentIntentId: id },
    });
    logger.info(`[Stripe Webhook] Created payment audit record for booking ${bookingId}`);
  }

  const pendingCreditRefund = metadata?.pendingCreditRefund ? parseInt(metadata.pendingCreditRefund, 10) : 0;
  if (pendingCreditRefund > 0 && customerId) {
    await queueJobInTransaction(client, 'stripe_credit_refund', {
      paymentIntentId: id,
      amountCents: pendingCreditRefund,
      email: metadata?.email || ''
    }, { webhookEventId: id, priority: 2, maxRetries: 5 });
    logger.info(`[Stripe Webhook] Queued credit refund of $${(pendingCreditRefund / 100).toFixed(2)} for ${metadata?.email || 'unknown'}`);
  }

  const creditToConsume = metadata?.creditToConsume ? parseInt(metadata.creditToConsume, 10) : 0;
  const alreadyConsumedSync = !!metadata?.balanceTransactionId;
  if (creditToConsume > 0 && customerId && !alreadyConsumedSync) {
    await queueJobInTransaction(client, 'stripe_credit_consume', {
      customerId,
      paymentIntentId: id,
      amountCents: creditToConsume,
      email: metadata?.email || ''
    }, { webhookEventId: id, priority: 2, maxRetries: 5 });
    logger.info(`[Stripe Webhook] Queued credit consumption of $${(creditToConsume / 100).toFixed(2)} for ${metadata?.email || 'unknown'}`);
  }

  const posInvoiceId = metadata?.draftInvoiceId || metadata?.invoice_id;
  if (posInvoiceId) {
    deferredActions.push(async () => {
      try {
        const isTerminalPayment = paymentIntent.payment_method_types?.includes('card_present') || metadata?.paidVia === 'terminal';
        const result = await finalizeInvoicePaidOutOfBand(posInvoiceId, isTerminalPayment ? { terminalPaymentIntentId: id } : undefined);
        if (result.success) {
          logger.info(`[Stripe Webhook] Invoice ${posInvoiceId} finalized and paid${isTerminalPayment ? ' via terminal PI' : ' out-of-band'} for PI ${id}`);
        } else {
          logger.error(`[Stripe Webhook] Failed to finalize invoice ${posInvoiceId}: ${result.error}`);
        }
      } catch (invoiceErr: unknown) {
        logger.error(`[Stripe Webhook] Error finalizing invoice ${posInvoiceId}:`, { extra: { error: getErrorMessage(invoiceErr) } });
      }
    });
  }

  const paymentMemberEmail = metadata?.email || customerEmail || 'unknown';
  const paymentDescription = description || metadata?.productName || 'Stripe payment';
  deferredActions.push(async () => {
    await logSystemAction({
      action: 'payment_succeeded',
      resourceType: 'payment',
      resourceId: id,
      resourceName: `Payment from ${paymentMemberEmail}`,
      details: {
        source: 'stripe_webhook',
        amount_cents: amount,
        member_email: paymentMemberEmail,
        description: paymentDescription
      }
    });
  });

  if (metadata?.email && metadata?.purpose) {
    if (metadata.purpose === 'add_funds') {
      logger.info(`[Stripe Webhook] Skipping PI-level notifications for add_funds payment ${id} — already handled by checkout.session.completed`);
    } else {
      const email = metadata.email;
      const desc = paymentIntent.description || `Stripe payment: ${metadata.purpose}`;
      const _localBookingId = bookingId;
      const localAmount = amount;
      const localId = id;
      
      const userResult = await client.query('SELECT first_name, last_name FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1', [email]);
      const memberName = userResult.rows[0] 
        ? `${userResult.rows[0].first_name || ''} ${userResult.rows[0].last_name || ''}`.trim() || email
        : email;

      await queueJobInTransaction(client, 'send_payment_receipt', {
        to: email,
        memberName,
        amount: localAmount / 100,
        description: desc,
        date: new Date().toISOString(),
        paymentMethod: 'card'
      }, { webhookEventId: localId, priority: 2 });

      await queueJobInTransaction(client, 'notify_payment_success', {
        userEmail: email,
        amount: localAmount / 100,
        description: desc
      }, { webhookEventId: localId, priority: 1 });

      await queueJobInTransaction(client, 'notify_all_staff', {
        title: 'Payment Received',
        message: `${memberName} (${email}) made a payment of $${(localAmount / 100).toFixed(2)} for: ${desc}`,
        type: 'payment_success'
      }, { webhookEventId: localId, priority: 0 });

      await queueJobInTransaction(client, 'broadcast_billing_update', {
        action: 'payment_succeeded',
        memberEmail: email,
        memberName,
        amount: localAmount / 100
      }, { webhookEventId: localId, priority: 0 });

      logger.info(`[Stripe Webhook] Queued ${5} jobs for payment ${localId} to ${email}`);
    }
  }

  return deferredActions;
}

export async function handlePaymentIntentStatusUpdate(client: PoolClient, paymentIntent: Stripe.PaymentIntent): Promise<DeferredAction[]> {
  const { id, status, amount, currency, customer, metadata, created } = paymentIntent;
  const deferredActions: DeferredAction[] = [];

  logger.info(`[Stripe Webhook] Payment intent status update: ${id} → ${status}`);

  await client.query(
    `UPDATE stripe_payment_intents SET status = $2, updated_at = NOW() WHERE stripe_payment_intent_id = $1`,
    [id, status]
  );

  const customerId = typeof customer === 'string' ? customer : customer?.id;
  const customerEmail = typeof customer === 'object' ? (customer as Stripe.Customer)?.email : metadata?.email;
  const customerName = typeof customer === 'object' ? (customer as Stripe.Customer)?.name : metadata?.memberName;

  deferredActions.push(async () => {
    await upsertTransactionCache({
      stripeId: id,
      objectType: 'payment_intent',
      amountCents: amount,
      currency: currency || 'usd',
      status,
      createdAt: new Date(created * 1000),
      customerId,
      customerEmail,
      customerName,
      description: metadata?.description || `Payment ${status}`,
      metadata,
      source: 'webhook',
      paymentIntentId: id,
    });
  });

  return deferredActions;
}

export async function handlePaymentIntentFailed(client: PoolClient, paymentIntent: Stripe.PaymentIntent): Promise<DeferredAction[]> {
  const { id, metadata, amount, last_payment_error, customer } = paymentIntent;
  const reason = last_payment_error?.message || 'Payment could not be processed';
  const errorCode = last_payment_error?.code || 'unknown';
  const declineCode = last_payment_error?.decline_code;
  
  const deferredActions: DeferredAction[] = [];
  
  logger.info(`[Stripe Webhook] Payment failed: ${id}, amount: $${(amount / 100).toFixed(2)}, reason: ${reason}, code: ${errorCode}${declineCode ? `, decline_code: ${declineCode}` : ''}`);
  
  logPaymentFailure({
    paymentIntentId: id,
    customerId: typeof customer === 'string' ? customer : customer?.id,
    userEmail: metadata?.email,
    amountCents: amount,
    errorMessage: reason,
    errorCode
  });

  const userIdFromMeta = metadata?.email || metadata?.memberEmail || '';
  const bookingIdFromMeta = metadata?.bookingId ? parseInt(metadata.bookingId, 10) : NaN;
  const sessionIdFromMeta = metadata?.sessionId ? parseInt(metadata.sessionId, 10) : NaN;

  const upsertResult = await client.query(
    `INSERT INTO stripe_payment_intents
       (stripe_payment_intent_id, user_id, amount_cents, status, retry_count, last_retry_at, failure_reason, dunning_notified_at, requires_card_update, booking_id, session_id, purpose, created_at, updated_at)
     VALUES ($1, $2, $3, 'failed', 1, NOW(), $4, NOW(), (1 >= ${MAX_RETRY_ATTEMPTS}), $5, $6, $7, NOW(), NOW())
     ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
       status = 'failed',
       updated_at = NOW(),
       retry_count = stripe_payment_intents.retry_count + 1,
       last_retry_at = NOW(),
       failure_reason = $4,
       dunning_notified_at = NOW(),
       requires_card_update = (stripe_payment_intents.retry_count + 1) >= ${MAX_RETRY_ATTEMPTS}
     RETURNING retry_count, requires_card_update`,
    [id, userIdFromMeta, amount, reason,
     isNaN(bookingIdFromMeta) ? null : bookingIdFromMeta,
     isNaN(sessionIdFromMeta) ? null : sessionIdFromMeta,
     metadata?.paymentType || 'unknown']
  );

  const newRetryCount = upsertResult.rows[0]?.retry_count ?? 1;
  const requiresCardUpdate = upsertResult.rows[0]?.requires_card_update ?? false;

  await client.query(
    `UPDATE booking_fee_snapshots SET status = 'failed', updated_at = NOW() WHERE stripe_payment_intent_id = $1 AND status = 'pending'`,
    [id]
  );
  
  logger.info(`[Stripe Webhook] Updated payment ${id}: retry ${newRetryCount}/${MAX_RETRY_ATTEMPTS}, requires_card_update=${requiresCardUpdate}`);

  const customerId = typeof customer === 'string' ? customer : customer?.id;
  const customerEmail = typeof customer === 'object' ? (customer as Stripe.Customer)?.email : metadata?.email;
  const customerName = typeof customer === 'object' ? (customer as Stripe.Customer)?.name : metadata?.memberName;
  
  deferredActions.push(async () => {
    await upsertTransactionCache({
      stripeId: id,
      objectType: 'payment_intent',
      amountCents: amount,
      currency: paymentIntent.currency || 'usd',
      status: 'failed',
      createdAt: new Date(paymentIntent.created * 1000),
      customerId,
      customerEmail,
      customerName,
      description: metadata?.description || `Failed payment - ${reason}`,
      metadata,
      source: 'webhook',
      paymentIntentId: id,
    });
  });

  const failedPaymentEmail = metadata?.email || customerEmail || 'unknown';
  deferredActions.push(async () => {
    await logSystemAction({
      action: 'payment_failed',
      resourceType: 'payment',
      resourceId: id,
      resourceName: `Failed payment from ${failedPaymentEmail}`,
      details: {
        source: 'stripe_webhook',
        amount_cents: amount,
        member_email: failedPaymentEmail,
        failure_reason: reason,
        error_code: errorCode,
        decline_code: declineCode || null,
        retry_count: newRetryCount,
        requires_card_update: requiresCardUpdate
      }
    });
  });

  deferredActions.push(async () => {
    try {
      await sendErrorAlert({
        type: 'payment_failure',
        title: requiresCardUpdate
          ? `Payment failed ${newRetryCount}x — card update needed`
          : `Payment failed (attempt ${newRetryCount})`,
        message: `PaymentIntent ${id} for ${failedPaymentEmail}: $${(amount / 100).toFixed(2)} — ${reason}${declineCode ? ` (decline: ${declineCode})` : ''}`,
        userEmail: failedPaymentEmail !== 'unknown' ? failedPaymentEmail : undefined,
        details: {
          paymentIntentId: id,
          amount_cents: amount,
          error_code: errorCode,
          decline_code: declineCode || null,
          retry_count: newRetryCount,
          requires_card_update: requiresCardUpdate
        }
      });
    } catch (alertErr: unknown) {
      logger.error('[Stripe Webhook] Error alert send failed (non-blocking):', { extra: { error: getErrorMessage(alertErr) } });
    }
  });

  const email = metadata?.email;
  if (!email) {
    logger.warn('[Stripe Webhook] No email in metadata for failed payment - cannot send notifications');
    return deferredActions;
  }

  const bookingId = metadata?.bookingId ? parseInt(metadata.bookingId, 10) : NaN;
  const localAmount = amount;
  const localReason = reason;
  const localRequiresCardUpdate = requiresCardUpdate;
  const localRetryCount = newRetryCount;
  const localErrorCode = errorCode;
  const localDeclineCode = declineCode;

  deferredActions.push(async () => {
    try {
      const userResult = await db.execute(sql`SELECT first_name, last_name FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1`);
      const memberName = userResult.rows[0] 
        ? `${userResult.rows[0].first_name || ''} ${userResult.rows[0].last_name || ''}`.trim() || email
        : email;

      const memberMessage = localRequiresCardUpdate
        ? `Your payment of $${(localAmount / 100).toFixed(2)} failed after ${MAX_RETRY_ATTEMPTS} attempts. Please update your payment method.`
        : `Your payment of $${(localAmount / 100).toFixed(2)} could not be processed. Reason: ${localReason}`;

      await notifyPaymentFailed(email, localAmount / 100, memberMessage, { 
        sendEmail: false, 
        bookingId: !isNaN(bookingId) ? bookingId : undefined,
        idempotencyKey: `payment_failed_${id}_${email}`
      });

      await sendPaymentFailedEmail(email, { 
        memberName, 
        amount: localAmount / 100, 
        reason: localRequiresCardUpdate 
          ? `Payment failed after ${MAX_RETRY_ATTEMPTS} attempts. Please update your card.`
          : localReason
      });

      logger.info(`[Stripe Webhook] Payment failed notifications sent to ${email} (retry=${localRetryCount}, requires_card_update=${localRequiresCardUpdate})`);

      const staffMessage = localRequiresCardUpdate
        ? `${memberName} (${email}) payment failed ${localRetryCount}x — card update required. Code: ${localErrorCode}${localDeclineCode ? ` / ${localDeclineCode}` : ''}`
        : `Payment of $${(localAmount / 100).toFixed(2)} failed for ${memberName} (${email}). Attempt ${localRetryCount}/${MAX_RETRY_ATTEMPTS}. Reason: ${localReason}`;
      
      await notifyStaffPaymentFailed(email, memberName, localAmount / 100, staffMessage);

      broadcastBillingUpdate({
        action: 'payment_failed',
        memberEmail: email,
        memberName,
        amount: localAmount / 100,
      });

      logger.info(`[Stripe Webhook] Staff notified about payment failure for ${email}`);
    } catch (error: unknown) {
      logger.error('[Stripe Webhook] Error sending payment failed notifications:', { extra: { error: getErrorMessage(error) } });
    }
  });

  return deferredActions;
}

export async function handlePaymentIntentCanceled(client: PoolClient, paymentIntent: Stripe.PaymentIntent): Promise<DeferredAction[]> {
  const { id, metadata, amount, cancellation_reason } = paymentIntent;
  const deferredActions: DeferredAction[] = [];
  
  logger.info(`[Stripe Webhook] Payment canceled: ${id}, amount: $${(amount / 100).toFixed(2)}, reason: ${cancellation_reason || 'not specified'}`);
  
  if (metadata?.paymentType === 'subscription_terminal') {
    const email = metadata?.email;
    const subscriptionId = metadata?.subscriptionId;
    
    try {
      await client.query(
        `INSERT INTO terminal_payments (
          user_id, user_email, stripe_payment_intent_id, stripe_subscription_id,
          amount_cents, currency, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, 'canceled', NOW(), NOW())
        ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
          status = 'canceled',
          updated_at = NOW()`,
        [
          metadata?.userId || null,
          email || 'unknown',
          id,
          subscriptionId || null,
          amount,
          paymentIntent.currency || 'usd'
        ]
      );
    } catch (err: unknown) {
      logger.error(`[Stripe Webhook] Failed to record canceled payment ${id}`, { extra: { error: getErrorMessage(err) } });
    }
    
    logger.info(`[Stripe Webhook] Terminal payment canceled/abandoned: ${id} for ${email || 'unknown'}`);
    
    deferredActions.push(async () => {
      await notifyAllStaff(
        'Terminal Payment Canceled',
        `A card reader payment was canceled or timed out. Email: ${email || 'unknown'}, Amount: $${(amount / 100).toFixed(2)}, Subscription: ${subscriptionId || 'N/A'}`,
        'terminal_payment_canceled',
        { sendPush: true }
      );
      
      await logSystemAction({
        action: 'terminal_payment_canceled',
        resourceType: 'payment',
        resourceId: id,
        resourceName: email || 'Unknown',
        details: {
          source: 'stripe_webhook',
          cancellation_reason: cancellation_reason,
          stripe_payment_intent_id: id,
          stripe_subscription_id: subscriptionId,
          amount_cents: amount
        }
      });
    });
  }
  
  return deferredActions;
}

