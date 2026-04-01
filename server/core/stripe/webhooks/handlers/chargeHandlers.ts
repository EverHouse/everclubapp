import Stripe from 'stripe';
  import { notifyAllStaff } from '../../../notificationService';
  import { broadcastBillingUpdate, sendNotificationToUser } from '../../../websocket';
  import { recalculateSessionFees } from '../../../billing/unifiedFeeService';
  import { logSystemAction, logPaymentAudit } from '../../../auditLog';
  import { logger } from '../../../logger';
  import type { PoolClient } from 'pg';
  import type { DeferredAction } from '../types';
  import { upsertTransactionCache } from '../framework';
  import { getErrorMessage } from '../../../../utils/errorUtils';
  
export async function handleChargeRefunded(client: PoolClient, charge: Stripe.Charge): Promise<DeferredAction[]> {
  const { id, amount, amount_refunded, currency, customer, payment_intent, created, refunded } = charge;
  const deferredActions: DeferredAction[] = [];
  
  logger.info(`[Stripe Webhook] Charge refunded: ${id}, refunded amount: $${(amount_refunded / 100).toFixed(2)}`);
  
  const status = refunded ? 'refunded' : 'partially_refunded';
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  const paymentIntentId = typeof payment_intent === 'string' ? payment_intent : payment_intent?.id;
  
  const refunds = charge.refunds?.data || [];
  
  if (refunds.length > 0) {
    for (const refund of refunds) {
      if (refund?.id && refund?.amount) {
        deferredActions.push(async () => {
          await upsertTransactionCache({
            stripeId: refund.id,
            objectType: 'refund',
            amountCents: refund.amount,
            currency: refund.currency || currency || 'usd',
            status: refund.status || 'succeeded',
            createdAt: new Date(refund.created ? refund.created * 1000 : Date.now()),
            customerId,
            paymentIntentId,
            chargeId: id,
            source: 'webhook',
          });
        });
      }
    }
    logger.info(`[Stripe Webhook] Cached ${refunds.length} refund(s) for charge ${id}`);
  } else {
    logger.warn(`[Stripe Webhook] No refund objects found in charge.refunded event for charge ${id}`);
  }
  
  deferredActions.push(async () => {
    await upsertTransactionCache({
      stripeId: id,
      objectType: 'charge',
      amountCents: amount,
      currency: currency || 'usd',
      status,
      createdAt: new Date(created * 1000),
      customerId,
      paymentIntentId,
      chargeId: id,
      source: 'webhook',
    });
  });
  
  if (paymentIntentId) {
    await client.query(
      `UPDATE stripe_payment_intents SET status = $1, updated_at = NOW() WHERE stripe_payment_intent_id = $2`,
      [status, paymentIntentId]
    );
    
    deferredActions.push(async () => {
      await upsertTransactionCache({
        stripeId: paymentIntentId,
        objectType: 'payment_intent',
        amountCents: amount,
        currency: currency || 'usd',
        status,
        createdAt: new Date(created * 1000),
        customerId,
        paymentIntentId,
        chargeId: id,
        source: 'webhook',
      });
    });
    
    if (refunded || amount_refunded >= amount) {
    const lockedRows = await client.query(
      `SELECT id FROM booking_participants
       WHERE stripe_payment_intent_id = $1 AND payment_status = 'paid'
       ORDER BY id ASC
       FOR UPDATE`,
      [paymentIntentId]
    );
    const lockedIds = lockedRows.rows.map((r: { id: number }) => r.id);

    const participantUpdate = lockedIds.length > 0
      ? await client.query(
        `WITH updated AS (
          UPDATE booking_participants
          SET payment_status = 'refunded', refunded_at = NOW()
          WHERE id = ANY($1::int[])
          RETURNING id, session_id, user_id
        )
        SELECT updated.id, updated.session_id, updated.user_id, u.email AS user_email
        FROM updated
        LEFT JOIN users u ON u.id = updated.user_id`,
        [lockedIds]
      )
      : { rows: [], rowCount: 0 };
    
    if (participantUpdate.rowCount && participantUpdate.rowCount > 0) {
      logger.info(`[Stripe Webhook] Marked ${participantUpdate.rowCount} participant(s) as refunded for PI ${paymentIntentId} (full refund)`);
      
      for (const row of participantUpdate.rows) {
        const bookingLookup = await client.query(
          `SELECT br.id, br.user_email AS booking_owner_email FROM booking_sessions bs 
           JOIN booking_requests br ON br.session_id = bs.id 
           WHERE bs.id = $1 LIMIT 1`,
          [row.session_id]
        );
        const auditBookingId = bookingLookup.rows[0]?.id;
        const bookingOwnerEmail = bookingLookup.rows[0]?.booking_owner_email;
        if (auditBookingId) {
          await logPaymentAudit({
            bookingId: auditBookingId,
            sessionId: row.session_id,
            participantId: row.id,
            action: 'refund_processed',
            staffEmail: 'system',
            staffName: 'Stripe Webhook',
            amountAffected: 0,
            paymentMethod: 'stripe',
            metadata: { stripePaymentIntentId: paymentIntentId, source: 'manual_stripe_refund' },
          });
        }

        const guestPassCheck = await client.query(
          `SELECT id, display_name, used_guest_pass FROM booking_participants
           WHERE id = $1 AND used_guest_pass = true`,
          [row.id]
        );
        if (guestPassCheck.rowCount && guestPassCheck.rowCount > 0 && bookingOwnerEmail) {
          const guestName = guestPassCheck.rows[0].display_name;
          const sessionDateCheck = await client.query(
            `SELECT bs.session_date FROM booking_sessions bs WHERE bs.id = $1`,
            [row.session_id]
          );
          const sessionDate = sessionDateCheck.rows[0]?.session_date;
          const guestPassRow = await client.query(
            `SELECT last_reset_date FROM guest_passes WHERE LOWER(member_email) = LOWER($1)`,
            [bookingOwnerEmail]
          );
          const lastReset = guestPassRow.rows[0]?.last_reset_date;
          const isCurrentCycle = !lastReset || !sessionDate || new Date(sessionDate) >= new Date(lastReset);

          if (isCurrentCycle) {
            await client.query(
              `UPDATE guest_passes SET passes_used = GREATEST(0, passes_used - 1) WHERE LOWER(member_email) = LOWER($1)`,
              [bookingOwnerEmail]
            );
            logger.info(`[Stripe Webhook] Refunded guest pass for participant ${row.id} (guest: ${guestName}) back to ${bookingOwnerEmail} (current cycle)`);
          } else {
            logger.info(`[Stripe Webhook] Skipped guest pass refund for participant ${row.id} — booking was from a previous cycle (session: ${sessionDate}, last reset: ${lastReset})`);
          }
          await client.query(
            `UPDATE booking_participants SET used_guest_pass = false WHERE id = $1`,
            [row.id]
          );
        }

        const userIdLookup = row.user_id || (row.user_email ? (await client.query(
          `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          [row.user_email]
        )).rows[0]?.id : null);
        const ledgerDelete = userIdLookup ? await client.query(
          `DELETE FROM usage_ledger WHERE session_id = $1 AND member_id = $2 RETURNING minutes_charged`,
          [row.session_id, userIdLookup]
        ) : { rows: [], rowCount: 0 };
        if (ledgerDelete.rowCount && ledgerDelete.rowCount > 0) {
          const minutesRestored = ledgerDelete.rows.reduce((sum: number, r: { minutes_charged: number }) => sum + (r.minutes_charged || 0), 0);
          logger.info(`[Stripe Webhook] Restored ${minutesRestored} usage_ledger minutes for ${row.user_email} session ${row.session_id} (manual Stripe refund teardown)`);
        }

        if (auditBookingId) {
          await client.query(
            `DELETE FROM guest_pass_holds WHERE booking_id = $1`,
            [auditBookingId]
          );
        }
        
        if (row.user_email) {
          await client.query(
            `INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [row.user_email.toLowerCase(), 'Payment Refunded', `Your booking payment of $${(amount_refunded / 100).toFixed(2)} has been refunded. It may take 5-10 business days to appear on your statement.`, 'billing', 'payment']
          );
          
          deferredActions.push(async () => {
            await sendNotificationToUser(row.user_email, {
              type: 'notification',
              title: 'Payment Refunded',
              message: `Your booking payment of $${(amount_refunded / 100).toFixed(2)} has been refunded. It may take 5-10 business days to appear on your statement.`,
              data: { sessionId: row.session_id, eventType: 'payment_refunded' }
            }, { action: 'payment_refunded', triggerSource: 'webhooks.ts' });
          });
        }
      }
    }

    const refundedSessionIds = new Set<number>();
    for (const row of participantUpdate.rows) {
      if (row.session_id) refundedSessionIds.add(row.session_id);
    }
    for (const sid of refundedSessionIds) {
      deferredActions.push(async () => {
        try {
          await recalculateSessionFees(sid, 'stripe');
          logger.info(`[Stripe Webhook] Recalculated session fees after refund for session ${sid}`);
        } catch (recalcErr: unknown) {
          logger.error('[Stripe Webhook] Fee recalculation after refund failed', { extra: { sessionId: sid, error: getErrorMessage(recalcErr) } });
        }
      });
    }
    } else {
      logger.info(`[Stripe Webhook] Partial refund of $${(amount_refunded / 100).toFixed(2)} for PI ${paymentIntentId} - skipping auto-participant update to preserve ledger`);
    }
  }
  
  deferredActions.push(async () => {
    broadcastBillingUpdate({ action: 'payment_refunded', status, amount: amount_refunded });
  });

  if (paymentIntentId) {
    const terminalPaymentResult = await client.query(
      `UPDATE terminal_payments 
       SET status = $1, refunded_at = NOW(), refund_amount_cents = GREATEST(COALESCE(refund_amount_cents, 0), $2), updated_at = NOW()
       WHERE stripe_payment_intent_id = $3 AND status IN ('succeeded', 'partially_refunded')
       RETURNING id, user_id, user_email, stripe_subscription_id, amount_cents`,
      [status, amount_refunded, paymentIntentId]
    );
    
    if (terminalPaymentResult.rowCount && terminalPaymentResult.rowCount > 0) {
      const terminalPayment = terminalPaymentResult.rows[0];
      logger.info(`[Stripe Webhook] Terminal payment refunded for user ${terminalPayment.user_email}`);
      
      if (refunded) {
        const refundUserCheck = await client.query(
          `SELECT billing_provider FROM users WHERE id = $1`,
          [terminalPayment.user_id]
        );
        const refundBillingProvider = refundUserCheck.rows[0]?.billing_provider;

        if (refundBillingProvider && refundBillingProvider !== '' && refundBillingProvider !== 'stripe') {
          logger.info(`[Stripe Webhook] Skipping charge.refunded for ${terminalPayment.user_email} — billing_provider is '${refundBillingProvider}', not 'stripe'`);
        } else {
          logger.info(`[Stripe Webhook] Terminal payment fully refunded for user ${terminalPayment.user_id} — flagging for admin review (not auto-suspending)`);

          deferredActions.push(async () => {
            await notifyAllStaff(
              'Terminal Payment Refunded — Review Required',
              `A Terminal payment of $${(terminalPayment.amount_cents / 100).toFixed(2)} for ${terminalPayment.user_email} has been fully refunded ($${(amount_refunded / 100).toFixed(2)}). Please review whether membership status should be changed.`,
              'terminal_refund',
              { sendPush: true }
            );

            await logSystemAction({
              action: 'terminal_payment_refunded',
              resourceType: 'user',
              resourceId: terminalPayment.user_id,
              resourceName: terminalPayment.user_email,
              details: {
                source: 'stripe_webhook',
                stripe_payment_intent_id: paymentIntentId,
                stripe_subscription_id: terminalPayment.stripe_subscription_id,
                amount_cents: terminalPayment.amount_cents,
                refund_amount_cents: amount_refunded,
                membership_action: 'flagged_for_review'
              }
            });
          });
        }
      }
    }
  }

  const isPartialRefund = amount_refunded < amount;
  const memberEmail = charge.billing_details?.email || charge.receipt_email || 'unknown';
  for (const refund of refunds) {
    if (refund?.id) {
      deferredActions.push(async () => {
        await logSystemAction({
          action: isPartialRefund ? 'payment_refund_partial' : 'payment_refunded',
          resourceType: 'payment',
          resourceId: refund.id,
          resourceName: `Refund for ${memberEmail}`,
          details: {
            source: 'stripe_webhook',
            stripe_refund_id: refund.id,
            stripe_payment_intent_id: paymentIntentId,
            amount_cents: refund.amount,
            refund_reason: refund.reason || 'not_specified',
            member_email: memberEmail,
            is_partial: isPartialRefund
          }
        });
      });
    }
  }

  if (refunded && paymentIntentId) {
    deferredActions.push(async () => {
      try {
        const piMetadata = charge.metadata || {};
        let merchCartItems: string | undefined = piMetadata.merchCartItems;

        if (!merchCartItems && paymentIntentId) {
          const { getStripeClient } = await import('../../client');
          const stripe = await getStripeClient();
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
          merchCartItems = pi.metadata?.merchCartItems;
        }

        if (merchCartItems) {
          const { restoreMerchStock } = await import('../../../../routes/merch');
          const items = JSON.parse(merchCartItems) as Array<{ productId?: string; quantity?: number }>;
          await restoreMerchStock(items, paymentIntentId);
          logger.info('[Stripe Webhook] Merch stock restored after full refund', { extra: { paymentIntentId } });
        }
      } catch (stockErr: unknown) {
        logger.error('[Stripe Webhook] Failed to restore merch stock after refund (non-blocking)', { extra: { paymentIntentId, error: getErrorMessage(stockErr) } });
      }
    });
  }

  return deferredActions;
}

export async function handleChargeDisputeCreated(client: PoolClient, dispute: Stripe.Dispute): Promise<DeferredAction[]> {
  const { id, amount, charge, payment_intent, reason, status } = dispute;
  const deferredActions: DeferredAction[] = [];
  
  logger.info(`[Stripe Webhook] Dispute created: ${id}, amount: $${(amount / 100).toFixed(2)}, reason: ${reason}`);
  
  const paymentIntentId = typeof payment_intent === 'string' ? payment_intent : payment_intent?.id;
  
  if (paymentIntentId) {
    const terminalPaymentResult = await client.query(
      `UPDATE terminal_payments 
       SET disputed_at = NOW(), dispute_id = $1, dispute_status = $2, status = 'disputed', updated_at = NOW()
       WHERE stripe_payment_intent_id = $3 AND status IN ('succeeded', 'partially_refunded')
       RETURNING id, user_id, user_email, stripe_subscription_id, amount_cents`,
      [id, status, paymentIntentId]
    );
    
    if (terminalPaymentResult.rowCount && terminalPaymentResult.rowCount > 0) {
      const terminalPayment = terminalPaymentResult.rows[0];
      logger.info(`[Stripe Webhook] Terminal payment disputed for user ${terminalPayment.user_email}`);
      
      const disputeUserCheck = await client.query(
        `SELECT billing_provider FROM users WHERE id = $1`,
        [terminalPayment.user_id]
      );
      const disputeBillingProvider = disputeUserCheck.rows[0]?.billing_provider;

      if (disputeBillingProvider && disputeBillingProvider !== '' && disputeBillingProvider !== 'stripe') {
        logger.info(`[Stripe Webhook] Skipping charge.dispute.created for ${terminalPayment.user_email} — billing_provider is '${disputeBillingProvider}', not 'stripe'`);
      } else {
        const disputeSuspendResult = await client.query(
          `UPDATE users SET membership_status = 'suspended', membership_status_changed_at = CASE WHEN membership_status IS DISTINCT FROM 'suspended' THEN NOW() ELSE membership_status_changed_at END, billing_provider = 'stripe', updated_at = NOW() WHERE id = $1 AND (membership_status IS NULL OR membership_status IN ('active', 'trialing', 'past_due', 'suspended', 'frozen'))`,
          [terminalPayment.user_id]
        );
        if (disputeSuspendResult.rowCount === 0) {
          logger.warn(`[Stripe Webhook] Skipping dispute suspension for user ${terminalPayment.user_id} — current status is terminal or incompatible`);
        } else {
          logger.info(`[Stripe Webhook] Suspended membership for user ${terminalPayment.user_id} due to payment dispute`);
      
          await client.query(
            `INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())`,
            [
              terminalPayment.user_email.toLowerCase(), 
              'Membership Suspended', 
              'Your membership has been suspended due to a payment dispute. Please contact staff immediately to resolve this issue.',
              'billing',
              'membership'
            ]
          );
        }
      }
      
      deferredActions.push(async () => {
        await notifyAllStaff(
          'URGENT: Payment Dispute Received',
          `A payment dispute has been filed for ${terminalPayment.user_email}. Amount: $${(amount / 100).toFixed(2)}. Reason: ${reason || 'not specified'}. Membership has been suspended.`,
          'terminal_dispute',
          { sendPush: true }
        );
        
        await logSystemAction({
          action: 'terminal_payment_disputed',
          resourceType: 'user',
          resourceId: terminalPayment.user_id,
          resourceName: terminalPayment.user_email,
          details: {
            source: 'stripe_webhook',
            dispute_id: id,
            dispute_reason: reason,
            dispute_status: status,
            stripe_payment_intent_id: paymentIntentId,
            stripe_subscription_id: terminalPayment.stripe_subscription_id,
            amount_cents: terminalPayment.amount_cents,
            disputed_amount_cents: amount,
            membership_action: 'suspended'
          }
        });
      });
    } else {
      const webPaymentResult = await client.query(
        `SELECT spi.user_id, u.email as user_email, u.billing_provider, spi.amount_cents, spi.booking_id
         FROM stripe_payment_intents spi
         LEFT JOIN users u ON (u.id = spi.user_id OR LOWER(u.email) = LOWER(spi.user_id))
         WHERE spi.stripe_payment_intent_id = $1
         LIMIT 1`,
        [paymentIntentId]
      );
      
      if (webPaymentResult.rows.length > 0) {
        const webPayment = webPaymentResult.rows[0];
        logger.info(`[Stripe Webhook] Web payment disputed for user ${webPayment.user_email || webPayment.user_id}`);
        
        await client.query(
          `UPDATE stripe_payment_intents SET status = 'disputed', updated_at = NOW() WHERE stripe_payment_intent_id = $1`,
          [paymentIntentId]
        );
        
        if (webPayment.billing_provider && webPayment.billing_provider !== '' && webPayment.billing_provider !== 'stripe') {
          logger.info(`[Stripe Webhook] Skipping charge.dispute.created for ${webPayment.user_email} — billing_provider is '${webPayment.billing_provider}', not 'stripe'`);
        } else {
          const webSuspendResult = await client.query(
            `UPDATE users SET membership_status = 'suspended', membership_status_changed_at = CASE WHEN membership_status IS DISTINCT FROM 'suspended' THEN NOW() ELSE membership_status_changed_at END, billing_provider = 'stripe', updated_at = NOW() WHERE id = $1 AND (membership_status IS NULL OR membership_status IN ('active', 'trialing', 'past_due', 'suspended', 'frozen'))`,
            [webPayment.user_id]
          );
          if (webSuspendResult.rowCount === 0) {
            logger.warn(`[Stripe Webhook] Skipping dispute suspension for user ${webPayment.user_id} — current status is terminal or incompatible`);
          } else {
            logger.info(`[Stripe Webhook] Suspended membership for user ${webPayment.user_id} due to web payment dispute`);
            
            await client.query(
              `INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
               VALUES ($1, $2, $3, $4, $5, NOW())`,
              [
                webPayment.user_email.toLowerCase(),
                'Membership Suspended',
                'Your membership has been suspended due to a payment dispute. Please contact staff immediately to resolve this issue.',
                'billing',
                'membership'
              ]
            );
          }
        }
        
        deferredActions.push(async () => {
          await notifyAllStaff(
            'URGENT: Payment Dispute Received',
            `A payment dispute has been filed for ${webPayment.user_email}. Amount: $${(amount / 100).toFixed(2)}. Reason: ${reason || 'not specified'}. Membership has been suspended.`,
            'payment_dispute',
            { sendPush: true }
          );
          
          await logSystemAction({
            action: 'web_payment_disputed',
            resourceType: 'user',
            resourceId: webPayment.user_id,
            resourceName: webPayment.user_email,
            details: {
              source: 'stripe_webhook',
              dispute_id: id,
              dispute_reason: reason,
              dispute_status: status,
              stripe_payment_intent_id: paymentIntentId,
              booking_id: webPayment.booking_id,
              amount_cents: webPayment.amount_cents,
              disputed_amount_cents: amount,
              membership_action: 'suspended'
            }
          });
        });
      } else {
        logger.warn(`[Stripe Webhook] Dispute ${id} for PI ${paymentIntentId}: no matching terminal or web payment found — alerting staff`);
        deferredActions.push(async () => {
          await notifyAllStaff(
            'URGENT: Unmatched Payment Dispute',
            `A payment dispute (${id}) was filed but could not be matched to any payment record. Amount: $${(amount / 100).toFixed(2)}. Reason: ${reason || 'not specified'}. PI: ${paymentIntentId}. Manual investigation required.`,
            'payment_dispute',
            { sendPush: true }
          );
        });
      }
    }
  } else {
    const chargeId = typeof charge === 'string' ? charge : charge?.id;
    logger.warn(`[Stripe Webhook] Dispute ${id} has no payment_intent (charge: ${chargeId || 'unknown'}) — alerting staff for manual review`);
    deferredActions.push(async () => {
      await notifyAllStaff(
        'URGENT: Payment Dispute (No Payment Intent)',
        `A payment dispute (${id}) was received without a payment intent ID. Charge: ${chargeId || 'unknown'}. Amount: $${(amount / 100).toFixed(2)}. Reason: ${reason || 'not specified'}. Manual investigation required.`,
        'payment_dispute',
        { sendPush: true }
      );
      
      await logSystemAction({
        action: 'unmatched_dispute_created',
        resourceType: 'dispute',
        resourceId: id,
        details: {
          source: 'stripe_webhook',
          dispute_id: id,
          charge_id: chargeId,
          dispute_reason: reason,
          dispute_status: status,
          disputed_amount_cents: amount,
          note: 'No payment_intent on dispute — requires manual investigation'
        }
      });
    });
  }
  
  deferredActions.push(async () => {
    broadcastBillingUpdate({ action: 'payment_failed', status, amount });
  });
  
  return deferredActions;
}

export async function handleChargeDisputeClosed(client: PoolClient, dispute: Stripe.Dispute): Promise<DeferredAction[]> {
  const { id, amount, payment_intent, reason: _reason, status } = dispute;
  const deferredActions: DeferredAction[] = [];
  
  const disputeWon = status === 'won';
  logger.info(`[Stripe Webhook] Dispute closed: ${id}, status: ${status}, won: ${disputeWon}`);
  
  const paymentIntentId = typeof payment_intent === 'string' ? payment_intent : payment_intent?.id;
  
  if (paymentIntentId) {
    const terminalPaymentResult = await client.query(
      `UPDATE terminal_payments 
       SET dispute_status = $1, dispute_id = $2, disputed_at = COALESCE(disputed_at, NOW()), 
           status = CASE
             WHEN $3 = true AND status = 'partially_refunded' THEN 'partially_refunded'
             WHEN $3 = true THEN 'succeeded'
             ELSE 'disputed_lost'
           END, updated_at = NOW()
       WHERE stripe_payment_intent_id = $4 AND status IN ('succeeded', 'partially_refunded', 'disputed')
       RETURNING id, user_id, user_email, stripe_subscription_id, amount_cents`,
      [status, id, disputeWon, paymentIntentId]
    );
    
    if (terminalPaymentResult.rowCount && terminalPaymentResult.rowCount > 0) {
      const terminalPayment = terminalPaymentResult.rows[0];
      logger.info(`[Stripe Webhook] Terminal payment dispute closed for user ${terminalPayment.user_email}: ${status}`);
      
      let membershipAction: 'reactivated' | 'blocked_manual_review' | 'remained_suspended' | 'skipped_non_stripe' | 'skipped' = 'remained_suspended';

      if (disputeWon) {
        const disputeClosedUserCheck = await client.query(
          `SELECT billing_provider, membership_status, stripe_subscription_id FROM users WHERE id = $1`,
          [terminalPayment.user_id]
        );
        const disputeClosedUser = disputeClosedUserCheck.rows[0];
        const disputeClosedBillingProvider = disputeClosedUser?.billing_provider;

        if (disputeClosedBillingProvider && disputeClosedBillingProvider !== '' && disputeClosedBillingProvider !== 'stripe') {
          logger.info(`[Stripe Webhook] Skipping charge.dispute.closed for ${terminalPayment.user_email} — billing_provider is '${disputeClosedBillingProvider}', not 'stripe'`);
          membershipAction = 'skipped_non_stripe';
        } else {
          const otherOpenTerminalDisputes = await client.query(
            `SELECT id FROM terminal_payments 
             WHERE user_id = $1 AND status = 'disputed' AND id != $2`,
            [terminalPayment.user_id, terminalPayment.id]
          );
          const otherOpenWebDisputes = await client.query(
            `SELECT id FROM stripe_payment_intents WHERE user_id = $1 AND status = 'disputed'`,
            [terminalPayment.user_id]
          );

          const blockingReasons: string[] = [];
          const totalOpenDisputes = (otherOpenTerminalDisputes.rowCount || 0) + (otherOpenWebDisputes.rowCount || 0);

          if (totalOpenDisputes > 0) {
            blockingReasons.push(`${totalOpenDisputes} other open dispute(s)`);
          }

          if (disputeClosedUser?.stripe_subscription_id) {
            try {
              const stripeClient = await (await import('../../client')).getStripeClient();
              const sub = await stripeClient.subscriptions.retrieve(disputeClosedUser.stripe_subscription_id);
              if (sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'canceled') {
                blockingReasons.push(`subscription status is '${sub.status}'`);
              }
            } catch (subErr: unknown) {
              logger.warn(`[Stripe Webhook] Could not verify subscription status for dispute reactivation — blocking as precaution`, { extra: { error: getErrorMessage(subErr) } });
              blockingReasons.push('subscription status could not be verified');
            }
          }

          if (blockingReasons.length > 0) {
            membershipAction = 'blocked_manual_review';
            logger.warn(`[Stripe Webhook] Dispute won for user ${terminalPayment.user_id} but cannot auto-reactivate: ${blockingReasons.join(', ')}`);

            deferredActions.push(async () => {
              await notifyAllStaff(
                'Dispute Won — Manual Review Required',
                `Payment dispute ${id} won for ${terminalPayment.user_email} ($${(amount / 100).toFixed(2)}), ` +
                `but auto-reactivation was blocked: ${blockingReasons.join('; ')}. ` +
                `Please review and reactivate manually if appropriate.`,
                'terminal_dispute_closed',
                { sendPush: true }
              );
            });
          } else {
            membershipAction = 'reactivated';
            const disputeWonResult = await client.query(
              `UPDATE users SET membership_status = 'active', membership_status_changed_at = CASE WHEN membership_status IS DISTINCT FROM 'active' THEN NOW() ELSE membership_status_changed_at END, billing_provider = 'stripe', archived_at = NULL, archived_by = NULL, updated_at = NOW() WHERE id = $1 AND membership_status IN ('suspended', 'past_due', 'frozen')`,
              [terminalPayment.user_id]
            );
            if (disputeWonResult.rowCount === 0) {
              logger.warn(`[Stripe Webhook] Skipping dispute-won reactivation for user ${terminalPayment.user_id} — current status is terminal or incompatible`);
              membershipAction = 'skipped';
            } else {
              logger.info(`[Stripe Webhook] Reactivated membership for user ${terminalPayment.user_id} - dispute won`);
          
              await client.query(
                `INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())`,
                [
                  terminalPayment.user_email.toLowerCase(), 
                  'Membership Reactivated', 
                  'Your membership has been reactivated. The payment dispute has been resolved in your favor.',
                  'billing',
                  'membership'
                ]
              );
            }
          }
        }
      }

      const disputeStaffTitle = membershipAction === 'reactivated'
        ? 'Dispute Won - Membership Reactivated'
        : membershipAction === 'blocked_manual_review'
          ? 'Dispute Won - Reactivation Blocked (Review Required)'
          : membershipAction === 'skipped_non_stripe'
            ? 'Dispute Won - Non-Stripe Member (No Action Taken)'
            : 'Dispute Lost - Membership Remains Suspended';
      const disputeStaffMessage = membershipAction === 'reactivated'
        ? `Payment dispute for ${terminalPayment.user_email} has been closed. Status: ${status}. Amount: $${(amount / 100).toFixed(2)}. Membership has been reactivated.`
        : membershipAction === 'blocked_manual_review'
          ? `Payment dispute for ${terminalPayment.user_email} has been closed (won). Amount: $${(amount / 100).toFixed(2)}. Auto-reactivation was blocked — manual review required.`
          : membershipAction === 'skipped_non_stripe'
            ? `Payment dispute for ${terminalPayment.user_email} has been closed (won). Amount: $${(amount / 100).toFixed(2)}. Member uses a non-Stripe billing provider — no automatic action taken.`
            : `Payment dispute for ${terminalPayment.user_email} has been closed. Status: ${status}. Amount: $${(amount / 100).toFixed(2)}. Membership remains suspended.`;
      
      deferredActions.push(async () => {
        await notifyAllStaff(
          disputeStaffTitle,
          disputeStaffMessage,
          'terminal_dispute_closed',
          { sendPush: true }
        );
        
        await logSystemAction({
          action: 'terminal_dispute_closed',
          resourceType: 'user',
          resourceId: terminalPayment.user_id,
          resourceName: terminalPayment.user_email,
          details: {
            source: 'stripe_webhook',
            dispute_id: id,
            dispute_status: status,
            dispute_won: disputeWon,
            stripe_payment_intent_id: paymentIntentId,
            stripe_subscription_id: terminalPayment.stripe_subscription_id,
            amount_cents: terminalPayment.amount_cents,
            disputed_amount_cents: amount,
            membership_action: membershipAction
          }
        });
      });
    } else {
      const webPaymentResult = await client.query(
        `SELECT spi.user_id, u.email as user_email, u.billing_provider, u.membership_status, u.stripe_subscription_id as user_stripe_sub, spi.amount_cents, spi.booking_id
         FROM stripe_payment_intents spi
         LEFT JOIN users u ON (u.id = spi.user_id OR LOWER(u.email) = LOWER(spi.user_id))
         WHERE spi.stripe_payment_intent_id = $1
         LIMIT 1`,
        [paymentIntentId]
      );

      if (webPaymentResult.rows.length > 0) {
        const webPayment = webPaymentResult.rows[0];
        logger.info(`[Stripe Webhook] Web payment dispute closed for user ${webPayment.user_email || webPayment.user_id}: ${status}`);

        await client.query(
          `UPDATE stripe_payment_intents SET status = CASE WHEN $1 = true THEN 'succeeded' ELSE 'disputed_lost' END, updated_at = NOW() WHERE stripe_payment_intent_id = $2`,
          [disputeWon, paymentIntentId]
        );

        let webMembershipAction: 'reactivated' | 'blocked_manual_review' | 'remained_suspended' | 'skipped_non_stripe' | 'skipped' = 'remained_suspended';

        if (disputeWon) {
          if (webPayment.billing_provider && webPayment.billing_provider !== '' && webPayment.billing_provider !== 'stripe') {
            logger.info(`[Stripe Webhook] Skipping charge.dispute.closed for ${webPayment.user_email} — billing_provider is '${webPayment.billing_provider}', not 'stripe'`);
            webMembershipAction = 'skipped_non_stripe';
          } else {
            const otherOpenWebDisputes = await client.query(
              `SELECT id FROM stripe_payment_intents WHERE user_id = $1 AND status = 'disputed' AND stripe_payment_intent_id != $2`,
              [webPayment.user_id, paymentIntentId]
            );
            const otherOpenTerminalDisputes = await client.query(
              `SELECT id FROM terminal_payments WHERE user_id = $1 AND status = 'disputed'`,
              [webPayment.user_id]
            );

            const webBlockingReasons: string[] = [];
            const totalOpenDisputes = (otherOpenWebDisputes.rowCount || 0) + (otherOpenTerminalDisputes.rowCount || 0);
            if (totalOpenDisputes > 0) {
              webBlockingReasons.push(`${totalOpenDisputes} other open dispute(s)`);
            }

            if (webPayment.user_stripe_sub) {
              try {
                const stripeClient = await (await import('../../client')).getStripeClient();
                const sub = await stripeClient.subscriptions.retrieve(webPayment.user_stripe_sub);
                if (sub.status === 'past_due' || sub.status === 'unpaid' || sub.status === 'canceled') {
                  webBlockingReasons.push(`subscription status is '${sub.status}'`);
                }
              } catch (subErr: unknown) {
                logger.warn(`[Stripe Webhook] Could not verify subscription status for web dispute reactivation — blocking as precaution`, { extra: { error: getErrorMessage(subErr) } });
                webBlockingReasons.push('subscription status could not be verified');
              }
            }

            if (webBlockingReasons.length > 0) {
              webMembershipAction = 'blocked_manual_review';
              logger.warn(`[Stripe Webhook] Web dispute won for user ${webPayment.user_id} but cannot auto-reactivate: ${webBlockingReasons.join(', ')}`);
              deferredActions.push(async () => {
                await notifyAllStaff(
                  'Dispute Won — Manual Review Required',
                  `Web payment dispute ${id} won for ${webPayment.user_email} ($${(amount / 100).toFixed(2)}), ` +
                  `but auto-reactivation was blocked: ${webBlockingReasons.join('; ')}. ` +
                  `Please review and reactivate manually if appropriate.`,
                  'payment_dispute_closed',
                  { sendPush: true }
                );
              });
            } else {
              webMembershipAction = 'reactivated';
              const webReactivateResult = await client.query(
                `UPDATE users SET membership_status = 'active', membership_status_changed_at = CASE WHEN membership_status IS DISTINCT FROM 'active' THEN NOW() ELSE membership_status_changed_at END, billing_provider = 'stripe', archived_at = NULL, archived_by = NULL, updated_at = NOW() WHERE id = $1 AND membership_status IN ('suspended', 'past_due', 'frozen')`,
                [webPayment.user_id]
              );
              if (webReactivateResult.rowCount === 0) {
                logger.warn(`[Stripe Webhook] Skipping dispute-won reactivation for web user ${webPayment.user_id} — current status is terminal or incompatible`);
                webMembershipAction = 'skipped';
              } else {
                logger.info(`[Stripe Webhook] Reactivated membership for user ${webPayment.user_id} - web dispute won`);
                await client.query(
                  `INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
                   VALUES ($1, $2, $3, $4, $5, NOW())`,
                  [
                    webPayment.user_email.toLowerCase(),
                    'Membership Reactivated',
                    'Your membership has been reactivated. The payment dispute has been resolved in your favor.',
                    'billing',
                    'membership'
                  ]
                );
              }
            }
          }
        }

        const webDisputeTitle = webMembershipAction === 'reactivated'
          ? 'Dispute Won - Membership Reactivated'
          : webMembershipAction === 'blocked_manual_review'
            ? 'Dispute Won - Reactivation Blocked (Review Required)'
            : webMembershipAction === 'skipped_non_stripe'
              ? 'Dispute Won - Non-Stripe Member (No Action Taken)'
              : 'Dispute Lost - Membership Remains Suspended';
        const webDisputeMessage = webMembershipAction === 'reactivated'
          ? `Web payment dispute for ${webPayment.user_email} has been closed. Status: ${status}. Amount: $${(amount / 100).toFixed(2)}. Membership has been reactivated.`
          : webMembershipAction === 'blocked_manual_review'
            ? `Web payment dispute for ${webPayment.user_email} has been closed (won). Amount: $${(amount / 100).toFixed(2)}. Auto-reactivation was blocked — manual review required.`
            : webMembershipAction === 'skipped_non_stripe'
              ? `Web payment dispute for ${webPayment.user_email} has been closed (won). Amount: $${(amount / 100).toFixed(2)}. Member uses a non-Stripe billing provider — no automatic action taken.`
              : `Web payment dispute for ${webPayment.user_email} has been closed. Status: ${status}. Amount: $${(amount / 100).toFixed(2)}. Membership remains suspended.`;

        deferredActions.push(async () => {
          await notifyAllStaff(
            webDisputeTitle,
            webDisputeMessage,
            'payment_dispute_closed',
            { sendPush: true }
          );

          await logSystemAction({
            action: 'web_dispute_closed',
            resourceType: 'user',
            resourceId: webPayment.user_id,
            resourceName: webPayment.user_email,
            details: {
              source: 'stripe_webhook',
              dispute_id: id,
              dispute_status: status,
              dispute_won: disputeWon,
              stripe_payment_intent_id: paymentIntentId,
              booking_id: webPayment.booking_id,
              amount_cents: webPayment.amount_cents,
              disputed_amount_cents: amount,
              membership_action: webMembershipAction
            }
          });
        });
      } else {
        logger.warn(`[Stripe Webhook] Dispute closed ${id} for PI ${paymentIntentId}: no matching terminal or web payment found`);
        deferredActions.push(async () => {
          await notifyAllStaff(
            'Dispute Closed — Unmatched Payment',
            `Dispute ${id} closed (${status}) but could not be matched to any payment record. Amount: $${(amount / 100).toFixed(2)}. PI: ${paymentIntentId}. Manual investigation required.`,
            'payment_dispute_closed',
            { sendPush: true }
          );
        });
      }
    }
  } else {
    logger.warn(`[Stripe Webhook] Dispute closed ${id} has no payment_intent — alerting staff for manual review`);
    deferredActions.push(async () => {
      await notifyAllStaff(
        'Dispute Closed (No Payment Intent)',
        `Dispute ${id} closed (${status}) without a payment intent ID. Amount: $${(amount / 100).toFixed(2)}. Manual investigation required.`,
        'payment_dispute_closed',
        { sendPush: true }
      );

      await logSystemAction({
        action: 'unmatched_dispute_closed',
        resourceType: 'dispute',
        resourceId: id,
        details: {
          source: 'stripe_webhook',
          dispute_id: id,
          dispute_status: status,
          dispute_won: disputeWon,
          disputed_amount_cents: amount,
          note: 'No payment_intent on dispute — requires manual investigation'
        }
      });
    });
  }
  
  deferredActions.push(async () => {
    broadcastBillingUpdate({ action: 'payment_succeeded', status, amount });
  });
  
  return deferredActions;
}

export async function handleChargeDisputeUpdated(client: PoolClient, dispute: Stripe.Dispute): Promise<DeferredAction[]> {
  const deferredActions: DeferredAction[] = [];

  try {
    const { id, amount, payment_intent, reason, status, evidence_details } = dispute;

    const paymentIntentId = typeof payment_intent === 'string'
      ? payment_intent
      : payment_intent?.id || null;

    if (paymentIntentId) {
      await client.query(
        `UPDATE terminal_payments SET dispute_status = $1 WHERE stripe_payment_intent_id = $2`,
        [status, paymentIntentId]
      );
      
      await client.query(
        `UPDATE stripe_payment_intents SET status = CASE WHEN $1 IN ('won', 'charge_refunded') THEN 'succeeded' WHEN $1 = 'lost' THEN 'disputed_lost' ELSE 'disputed' END, updated_at = NOW() WHERE stripe_payment_intent_id = $2 AND status = 'disputed'`,
        [status, paymentIntentId]
      );
    }

    const statusDescriptions: Record<string, string> = {
      'needs_response': 'Needs Response',
      'under_review': 'Under Review',
      'won': 'Won',
      'lost': 'Lost',
      'warning_needs_response': 'Warning - Needs Response',
      'warning_under_review': 'Warning - Under Review',
      'warning_closed': 'Warning - Closed',
      'charge_refunded': 'Charge Refunded',
    };

    const statusDescription = statusDescriptions[status] || status;

    logger.info(`[Stripe Webhook] Dispute ${id} updated: status=${status} (${statusDescription}), amount=$${(amount / 100).toFixed(2)}, reason=${reason}`);

    deferredActions.push(async () => {
      try {
        await notifyAllStaff(
          'Dispute Status Updated',
          `Dispute ${id} status changed to ${statusDescription}. Amount: $${(amount / 100).toFixed(2)}. Reason: ${reason || 'unknown'}.${paymentIntentId ? ` Payment Intent: ${paymentIntentId}` : ''}`,
          'billing',
          { sendPush: status === 'needs_response' || status === 'warning_needs_response' }
        );
      } catch (err: unknown) {
        logger.error('[Stripe Webhook] Failed to notify staff about dispute update:', { extra: { error: getErrorMessage(err) } });
      }
    });

    deferredActions.push(async () => {
      try {
        await logSystemAction({
          action: 'charge_dispute_updated',
          resourceType: 'dispute',
          resourceId: id,
          details: {
            status,
            statusDescription,
            amount: amount / 100,
            reason,
            paymentIntentId,
            evidenceDueBy: evidence_details?.due_by ? new Date(evidence_details.due_by * 1000).toISOString() : null,
          },
        });
      } catch (err: unknown) {
        logger.error('[Stripe Webhook] Failed to log dispute update:', { extra: { error: getErrorMessage(err) } });
      }
    });
  } catch (error: unknown) {
    logger.error('[Stripe Webhook] Error handling charge.dispute.updated:', { extra: { error: getErrorMessage(error) } });
  }

  return deferredActions;
}
