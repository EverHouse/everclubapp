import { db } from '../../db';
  import { sql } from 'drizzle-orm';
  import {
    confirmPaymentSuccess,
    getOrCreateStripeCustomer,
    cancelPaymentIntent,
    createPaymentIntent,
    type BookingFeeLineItem,
  } from '../stripe';
  import { getStripeClient } from '../stripe/client';
  import { resolveUserByEmail } from '../stripe/customers';
  import { getPaymentByIntentId } from '../stripe/paymentRepository';
  import { computeFeeBreakdown, applyFeeBreakdownToParticipants, getEffectivePlayerCount } from './unifiedFeeService';
  import { broadcastBillingUpdate } from '../websocket';
  import { getErrorMessage } from '../../utils/errorUtils';
  import { logger } from '../logger';
  import { toIntArrayLiteral } from '../../utils/sqlArrayLiteral';
  import { createDraftInvoiceForBooking, finalizeAndPayInvoice, getBookingInvoiceId } from './bookingInvoiceService';
  import { buildInvoiceDescription } from './bookingInvoiceService';
  import {
    ParticipantRow,
  } from './paymentTypes';
  import { auditStaffEmail, sourceLabel } from './memberPaymentProcessing';

  interface StaffPayFeesParams {
  userId: string;
  email: string;
  memberName: string;
  amountCents: number;
  purpose: string;
  bookingId?: number;
  sessionId?: number;
  description?: string;
  participantFees?: Array<{ id: number }>;
  auditLogFn: (paymentIntentId: string, meta: Record<string, unknown>) => void;
}

interface StaffPayFeesResult {
  paidInFull?: boolean;
  alreadyPaid?: boolean;
  message?: string;
  paymentIntentId?: string;
  clientSecret?: string;
  customerId?: string;
  reused?: boolean;
  balanceApplied?: number;
  remainingCents?: number;
  invoiceId?: string;
  hostedInvoiceUrl?: string | null;
  invoicePdf?: string | null;
  feeLineItems?: Array<{
    participantId: number;
    displayName: string;
    participantType: string;
    overageCents: number;
    guestCents: number;
    totalCents: number;
  }>;
}

export async function processStaffPayFees(params: StaffPayFeesParams): Promise<{ status: number; body: StaffPayFeesResult | { error: string } }> {
  const {
    userId, email, memberName, amountCents, purpose,
    bookingId, sessionId, description, participantFees: clientParticipantFees,
    auditLogFn
  } = params;

  let finalDescription = description;
  let trackmanId: unknown = null;
  if (bookingId) {
    const trackmanLookup = await db.execute(sql`SELECT trackman_booking_id FROM booking_requests WHERE id = ${bookingId}`);
    trackmanId = (trackmanLookup.rows[0] as { trackman_booking_id?: string })?.trackman_booking_id;
    finalDescription = await buildInvoiceDescription(bookingId, (trackmanId as string) || null);
  }

  let resolvedUserId = userId || '';
  if (!resolvedUserId && email) {
    const resolved = await resolveUserByEmail(email);
    if (resolved) {
      resolvedUserId = resolved.userId;
    }
  }

  let snapshotId: number | null = null;
  const serverFees: Array<{ id: number; amountCents: number }> = [];
  let serverTotal = Math.round(amountCents);
  let pendingFees: Array<{ participantId?: number; displayName: string; participantType: string; overageCents: number; guestCents: number; totalCents: number }> = [];
  const isBookingPayment = bookingId && sessionId && clientParticipantFees && Array.isArray(clientParticipantFees) && clientParticipantFees.length > 0;

  if (isBookingPayment) {
    const sessionCheck = await db.execute(sql`SELECT bs.id FROM booking_sessions bs
       JOIN booking_requests br ON br.session_id = bs.id
       WHERE bs.id = ${sessionId} AND br.id = ${bookingId}`);
    if (sessionCheck.rows.length === 0) {
      return { status: 400, body: { error: 'Invalid session/booking combination' } };
    }

    const existingSucceeded = await db.execute(sql`SELECT spi.stripe_payment_intent_id, spi.amount_cents
       FROM stripe_payment_intents spi
       WHERE spi.booking_id = ${bookingId} AND spi.session_id = ${sessionId} AND spi.status = 'succeeded'
       ORDER BY spi.created_at DESC LIMIT 1`);
    if (existingSucceeded.rows.length > 0) {
      const succeededPi = existingSucceeded.rows[0] as { stripe_payment_intent_id: string; amount_cents: number };
      if (!succeededPi.stripe_payment_intent_id.startsWith('pi_')) {
        logger.info('[Stripe] Synthetic/non-Stripe PI ID in succeeded check — correcting to canceled and allowing charge', {
          extra: { bookingId, sessionId, piId: succeededPi.stripe_payment_intent_id }
        });
        await db.execute(sql`UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() WHERE stripe_payment_intent_id = ${succeededPi.stripe_payment_intent_id}`);
        await db.execute(sql`UPDATE booking_participants SET payment_status = 'pending', stripe_payment_intent_id = NULL, paid_at = NULL
           WHERE stripe_payment_intent_id = ${succeededPi.stripe_payment_intent_id} AND payment_status = 'paid'`);
        await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'stale' WHERE stripe_payment_intent_id = ${succeededPi.stripe_payment_intent_id} AND status IN ('completed', 'paid')`);
      } else {
        try {
          const stripeClient = await getStripeClient();
          const livePi = await stripeClient.paymentIntents.retrieve(succeededPi.stripe_payment_intent_id);
          if (livePi.status === 'succeeded') {
            logger.info('[Stripe] Booking already has succeeded payment (verified with Stripe), preventing double charge', {
              extra: { bookingId, sessionId, existingPiId: succeededPi.stripe_payment_intent_id }
            });
            return { status: 200, body: {
              alreadyPaid: true,
              message: 'Payment already completed',
              paymentIntentId: succeededPi.stripe_payment_intent_id
            }};
          }
          const correctedStatus = livePi.status === 'canceled' ? 'canceled' : livePi.status === 'requires_payment_method' ? 'failed' : livePi.status;
          logger.warn('[Stripe] DB says payment succeeded but Stripe disagrees — correcting and allowing retry', {
            extra: { bookingId, sessionId, piId: succeededPi.stripe_payment_intent_id, dbStatus: 'succeeded', stripeStatus: livePi.status }
          });
          await db.execute(sql`UPDATE stripe_payment_intents SET status = ${correctedStatus}, updated_at = NOW() WHERE stripe_payment_intent_id = ${succeededPi.stripe_payment_intent_id}`);
          const resetResult = await db.execute(sql`UPDATE booking_participants SET payment_status = 'pending', stripe_payment_intent_id = NULL, paid_at = NULL
             WHERE stripe_payment_intent_id = ${succeededPi.stripe_payment_intent_id} AND payment_status = 'paid'`);
          if ((resetResult as { rowCount?: number }).rowCount && (resetResult as { rowCount?: number }).rowCount! > 0) {
            logger.info('[Stripe] Reset participants linked to stale PI back to pending', {
              extra: { bookingId, sessionId, piId: succeededPi.stripe_payment_intent_id, resetCount: (resetResult as { rowCount?: number }).rowCount }
            });
          }
          await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'stale' WHERE stripe_payment_intent_id = ${succeededPi.stripe_payment_intent_id} AND status IN ('completed', 'paid')`);
        } catch (verifyErr: unknown) {
          logger.warn('[Stripe] Could not verify existing payment with Stripe — allowing charge retry', {
            extra: { bookingId, sessionId, piId: succeededPi.stripe_payment_intent_id, error: getErrorMessage(verifyErr) }
          });
        }
      }
    }

    const existingPendingSnapshot = await db.execute(sql`SELECT bfs.id, bfs.stripe_payment_intent_id, spi.status as pi_status
       FROM booking_fee_snapshots bfs
       LEFT JOIN stripe_payment_intents spi ON bfs.stripe_payment_intent_id = spi.stripe_payment_intent_id
       WHERE bfs.booking_id = ${bookingId} AND bfs.status = 'pending'
       ORDER BY bfs.created_at DESC
       LIMIT 1`);

    if (existingPendingSnapshot.rows.length > 0) {
      const existing = existingPendingSnapshot.rows[0] as { id: number; stripe_payment_intent_id: string | null; pi_status: string | null };
      if (existing.stripe_payment_intent_id) {
        try {
          const stripe = await getStripeClient();
          const pi = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id as string);
          if (pi.status === 'succeeded') {
            await confirmPaymentSuccess(existing.stripe_payment_intent_id as string, 'system', 'Auto-sync');
            return { status: 200, body: {
              alreadyPaid: true,
              message: 'Payment already completed'
            }};
          } else if (pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation') {
            if (pi.amount !== Math.round(amountCents)) {
              logger.warn('[Stripe] Stale payment intent : PI amount != requested , cancelling and creating new one', { extra: { existingStripe_payment_intent_id: existing.stripe_payment_intent_id, piAmount: pi.amount, MathRound_amountCents: Math.round(amountCents) } });
              try {
                await cancelPaymentIntent(existing.stripe_payment_intent_id as string);
              } catch (cancelErr: unknown) {
                logger.warn('[Stripe] Failed to cancel stale payment intent', { extra: { error: getErrorMessage(cancelErr) } });
              }
              await db.execute(sql`DELETE FROM booking_fee_snapshots WHERE id = ${existing.id}`);
            } else {
              logger.info('[Stripe] Reusing existing payment intent', { extra: { existingStripe_payment_intent_id: existing.stripe_payment_intent_id } });
              return { status: 200, body: {
                clientSecret: pi.client_secret!,
                paymentIntentId: pi.id,
                reused: true
              }};
            }
          }
        } catch (err: unknown) {
          logger.warn('[Stripe] Failed to check existing payment intent, creating new one', { extra: { error: getErrorMessage(err) } });
        }
      }
    }

    const requestedIds: number[] = clientParticipantFees.map((pf: { id: number }) => pf.id);

    const participantCountResult = await db.execute(sql`SELECT COUNT(*) as count FROM booking_participants WHERE session_id = ${sessionId} AND NOT (participant_type = 'guest' AND user_id IS NULL AND guest_id IS NULL AND display_name = 'Empty Slot')`);
    const actualParticipantCount = parseInt((participantCountResult.rows[0] as { count: string })?.count || '1', 10);
    const effectivePlayerCount = getEffectivePlayerCount(actualParticipantCount, actualParticipantCount);

    let feeBreakdown;
    try {
      feeBreakdown = await computeFeeBreakdown({
        sessionId,
        declaredPlayerCount: effectivePlayerCount,
        source: 'stripe' as const
      });
      await applyFeeBreakdownToParticipants(sessionId, feeBreakdown);
      logger.info(`[Stripe] Applied unified fees for session ${sessionId}: $${(feeBreakdown.totals.totalCents / 100).toFixed(2)}`, { extra: { sessionId, totalCents: feeBreakdown.totals.totalCents } });
    } catch (unifiedError: unknown) {
      logger.error('[Stripe] Failed to calculate fees for booking payment', { extra: { bookingId, sessionId, error: getErrorMessage(unifiedError) } });
      return { status: 500, body: { error: 'Failed to calculate fees' } };
    }

    const dbPendingResult = await db.execute(sql`
      SELECT id, participant_type, display_name, cached_fee_cents
      FROM booking_participants
      WHERE session_id = ${sessionId}
        AND id = ANY(${toIntArrayLiteral(requestedIds)}::int[])
        AND cached_fee_cents > 0
        AND (payment_status IN ('pending', 'refunded') OR payment_status IS NULL)
    `);
    const dbPending = dbPendingResult.rows as unknown as ParticipantRow[];

    pendingFees = dbPending.map(p => {
      const breakdownMatch = feeBreakdown.participants.find(bp => bp.participantId === p.id);
      const isGuest = p.participant_type === 'guest';
      return {
        participantId: p.id,
        displayName: p.display_name || 'Unknown',
        participantType: p.participant_type,
        totalCents: p.cached_fee_cents,
        overageCents: breakdownMatch?.overageCents ?? (isGuest ? 0 : p.cached_fee_cents),
        guestCents: breakdownMatch?.guestCents ?? (isGuest ? p.cached_fee_cents : 0),
      };
    });

    if (pendingFees.length === 0) {
      return { status: 400, body: { error: 'No valid pending participants with fees to charge' } };
    }

    for (const fee of pendingFees) {
      serverFees.push({ id: fee.participantId!, amountCents: fee.totalCents });
    }

    logger.info('[Stripe] Calculated authoritative fees using unified service', { extra: { pendingFeesLength: pendingFees.length } });

    serverTotal = serverFees.reduce((sum, f) => sum + f.amountCents, 0);

    if (serverTotal < 50) {
      return { status: 400, body: { error: 'Total amount must be at least $0.50' } };
    }

    logger.info(`[Stripe] Using authoritative cached fees from DB, total: $${(serverTotal / 100).toFixed(2)}`, { extra: { serverTotal } });
    if (Math.abs(serverTotal - amountCents) > 1) {
      logger.warn(`[Stripe] Client total mismatch: client=${amountCents}, server=${serverTotal} - using server total`, { extra: { amountCents, serverTotal } });
    }

    const snapshotResult = await db.execute(sql`INSERT INTO booking_fee_snapshots (booking_id, session_id, participant_fees, total_cents, status)
         VALUES (${bookingId ?? null}, ${sessionId ?? null}, ${JSON.stringify(serverFees)}, ${serverTotal}, 'pending') RETURNING id`);
    snapshotId = (snapshotResult.rows[0] as { id: number }).id;
    logger.info(`[Stripe] Created fee snapshot for booking ${bookingId}: $${(serverTotal / 100).toFixed(2)} with ${serverFees.length} participants`, { extra: { snapshotId, bookingId, serverTotal, participantCount: serverFees.length } });
  } else {
    if (serverTotal < 50) {
      return { status: 400, body: { error: 'Amount must be at least $0.50' } };
    }
    logger.info(`[Stripe] Non-booking payment: $${(serverTotal / 100).toFixed(2)} for ${purpose}`, { extra: { serverTotal, purpose } });
  }

  const metadata: Record<string, string> = {};
  if (snapshotId) {
    metadata.feeSnapshotId = snapshotId.toString();
  }
  if (serverFees.length > 0) {
    metadata.participantCount = serverFees.length.toString();
    const participantIds = serverFees.map(f => f.id).join(',');
    metadata.participantIds = participantIds.length > 490 ? participantIds.substring(0, 490) + '...' : participantIds;
  }
  if (trackmanId) {
    metadata.trackmanBookingId = String(trackmanId);
  }

  if (isBookingPayment) {
    const { customerId: stripeCustomerId } = await getOrCreateStripeCustomer(resolvedUserId, email, memberName || email.split('@')[0]);

    const participantIdsLiteral = toIntArrayLiteral(serverFees.map(f => f.id));
    const participantDetails = await db.execute(sql`SELECT id, display_name, participant_type FROM booking_participants WHERE id = ANY(${participantIdsLiteral}::int[])`);

    const feeLineItems: Array<{ participantId: number; displayName: string; participantType: 'owner' | 'member' | 'guest'; overageCents: number; guestCents: number; totalCents: number }> = [];
    for (const rawDetail of participantDetails.rows as Array<{ id: number; display_name: string; participant_type: string }>) {
      const fee = pendingFees.find(f => f.participantId === rawDetail.id);
      if (!fee || fee.totalCents <= 0) continue;
      feeLineItems.push({
        participantId: rawDetail.id,
        displayName: rawDetail.display_name || (rawDetail.participant_type === 'guest' ? 'Guest' : 'Member'),
        participantType: rawDetail.participant_type as 'owner' | 'member' | 'guest',
        overageCents: fee.overageCents || 0,
        guestCents: fee.guestCents || 0,
        totalCents: fee.totalCents,
      });
    }

    let invoiceResult;
    try {
      const existingInvoiceId = await getBookingInvoiceId(bookingId!);
      if (existingInvoiceId) {
        invoiceResult = await finalizeAndPayInvoice({ bookingId: bookingId! });
      } else {
        await createDraftInvoiceForBooking({
          customerId: stripeCustomerId,
          bookingId: bookingId!,
          sessionId: sessionId!,
          trackmanBookingId: trackmanId ? String(trackmanId) : null,
          feeLineItems: feeLineItems as unknown as import('../../core/stripe').BookingFeeLineItem[],
          metadata,
          purpose: 'booking_fee',
        });
        invoiceResult = await finalizeAndPayInvoice({ bookingId: bookingId! });
      }
    } catch (stripeErr: unknown) {
      if (snapshotId) {
        await db.execute(sql`DELETE FROM booking_fee_snapshots WHERE id = ${snapshotId}`);
        logger.info('[Stripe] Deleted orphaned snapshot after invoice creation failed', { extra: { snapshotId } });
      }
      throw stripeErr;
    }

    if (invoiceResult.paidInFull) {
      if (snapshotId) {
        await db.execute(sql`UPDATE booking_fee_snapshots SET stripe_payment_intent_id = ${invoiceResult.paymentIntentId}, status = 'paid', updated_at = NOW() WHERE id = ${snapshotId}`);
      }

      await db.execute(sql`INSERT INTO stripe_payment_intents 
         (user_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, purpose, booking_id, session_id, description, status)
         VALUES (${resolvedUserId || email}, ${invoiceResult.paymentIntentId}, ${stripeCustomerId}, ${serverTotal}, ${purpose}, ${bookingId ?? null}, ${sessionId ?? null}, ${finalDescription}, 'succeeded')
         ON CONFLICT (stripe_payment_intent_id) DO NOTHING`);

      auditLogFn(invoiceResult.paymentIntentId, {
        amount: serverTotal,
        description,
        paidByCredit: true,
        invoiceId: invoiceResult.invoiceId
      });

      return { status: 200, body: {
        paidInFull: true,
        balanceApplied: invoiceResult.amountFromBalance || serverTotal,
        paymentIntentId: invoiceResult.paymentIntentId,
        invoiceId: invoiceResult.invoiceId,
        hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl || null,
        invoicePdf: invoiceResult.invoicePdf || null,
        feeLineItems: feeLineItems.map(li => ({
          participantId: li.participantId,
          displayName: li.displayName,
          participantType: li.participantType,
          overageCents: li.overageCents,
          guestCents: li.guestCents,
          totalCents: li.totalCents,
        })),
      }};
    }

    if (snapshotId) {
      await db.execute(sql`UPDATE booking_fee_snapshots SET stripe_payment_intent_id = ${invoiceResult.paymentIntentId}, updated_at = NOW() WHERE id = ${snapshotId}`);
    }

    await db.execute(sql`INSERT INTO stripe_payment_intents 
       (user_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, purpose, booking_id, session_id, description, status)
       VALUES (${resolvedUserId || email}, ${invoiceResult.paymentIntentId}, ${stripeCustomerId}, ${serverTotal}, ${purpose}, ${bookingId ?? null}, ${sessionId ?? null}, ${finalDescription}, 'pending')
       ON CONFLICT (stripe_payment_intent_id) DO NOTHING`);

    auditLogFn(invoiceResult.paymentIntentId, {
      amount: serverTotal,
      description,
      invoiceId: invoiceResult.invoiceId
    });

    return { status: 200, body: {
      paymentIntentId: invoiceResult.paymentIntentId,
      clientSecret: invoiceResult.clientSecret,
      customerId: stripeCustomerId,
      invoiceId: invoiceResult.invoiceId,
      paidInFull: false,
      balanceApplied: 0,
      remainingCents: serverTotal,
      hostedInvoiceUrl: invoiceResult.hostedInvoiceUrl || null,
      invoicePdf: invoiceResult.invoicePdf || null,
      feeLineItems: feeLineItems.map(li => ({
        participantId: li.participantId,
        displayName: li.displayName,
        participantType: li.participantType,
        overageCents: li.overageCents,
        guestCents: li.guestCents,
        totalCents: li.totalCents,
      })),
    }};
  }

  let result;
  try {
    result = await createPaymentIntent({
      userId: resolvedUserId,
      email,
      memberName: memberName || email.split('@')[0],
      amountCents: serverTotal,
      purpose,
      bookingId,
      sessionId,
      description: finalDescription,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined
    });
  } catch (stripeErr: unknown) {
    if (snapshotId) {
      await db.execute(sql`DELETE FROM booking_fee_snapshots WHERE id = ${snapshotId}`);
      logger.info('[Stripe] Deleted orphaned snapshot after PaymentIntent creation failed', { extra: { snapshotId } });
    }
    throw stripeErr;
  }

  if (snapshotId) {
    await db.execute(sql`UPDATE booking_fee_snapshots SET stripe_payment_intent_id = ${result.paymentIntentId}, updated_at = NOW() WHERE id = ${snapshotId}`);
  }

  auditLogFn(result.paymentIntentId, {
    amount: serverTotal,
    description
  });

  if (result.status === 'succeeded') {
    return { status: 200, body: {
      paidInFull: true,
      paymentIntentId: result.paymentIntentId,
      customerId: result.customerId
    }};
  }

  return { status: 200, body: {
    paymentIntentId: result.paymentIntentId,
    clientSecret: result.clientSecret,
    customerId: result.customerId
  }};
}

export async function processStaffConfirmPayment(paymentIntentId: string, staffEmail: string, staffName: string): Promise<{ status: number; body: { success?: boolean; error?: string } }> {
  const result = await confirmPaymentSuccess(
    paymentIntentId,
    staffEmail,
    staffName
  );

  if (!result.success) {
    return { status: 400, body: { error: result.error } };
  }

  const paymentRecord = await getPaymentByIntentId(paymentIntentId);

  broadcastBillingUpdate({
    action: 'payment_succeeded',
    memberEmail: paymentRecord?.memberEmail || paymentRecord?.member_email || undefined,
    amount: paymentRecord?.amountCents || paymentRecord?.amount_cents
  });

  return { status: 200, body: { success: true } };
}

  