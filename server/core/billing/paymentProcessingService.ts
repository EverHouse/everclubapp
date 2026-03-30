import { db } from '../../db';
import { sql } from 'drizzle-orm';
import {
  confirmPaymentSuccess,
  getOrCreateStripeCustomer,
  createBalanceAwarePayment,
  cancelPaymentIntent,
  createPaymentIntent,
  type BookingFeeLineItem,
} from '../stripe';
import { getStripeClient } from '../stripe/client';
import { resolveUserByEmail } from '../stripe/customers';
import { getPaymentByIntentId } from '../stripe/paymentRepository';
import { computeFeeBreakdown, applyFeeBreakdownToParticipants, getEffectivePlayerCount } from './unifiedFeeService';
import { sendNotificationToUser, broadcastBillingUpdate, broadcastBookingInvoiceUpdate } from '../websocket';
import { logPaymentAudit } from '../auditLog';
import { getErrorMessage } from '../../utils/errorUtils';
import { logger } from '../logger';
import { toIntArrayLiteral } from '../../utils/sqlArrayLiteral';
import { createDraftInvoiceForBooking, buildInvoiceDescription, finalizeAndPayInvoice, getBookingInvoiceId } from './bookingInvoiceService';
import {
  BookingRow,
  ParticipantRow,
  SnapshotRow,
  IdRow,
  describeFee,
  finalizeInvoiceWithPi,
  handleExistingInvoicePayment,
} from './paymentTypes';

type PaymentSource = 'member' | 'kiosk' | 'staff';

interface PayFeesParams {
  bookingId: number;
  memberEmail: string;
  useAccountBalance: boolean;
  source: PaymentSource;
  staffEmail?: string;
}

interface PayFeesResult {
  paidInFull: boolean;
  clientSecret?: string;
  paymentIntentId?: string;
  invoiceId?: string;
  totalAmount: number;
  balanceApplied: number;
  remainingAmount: number;
  participantFees: Array<{
    id: number | null;
    displayName: string;
    amount: number;
    feeType?: string;
    feeDescription?: string;
    participantType?: string;
  }>;
  description?: string;
  customerSessionClientSecret?: string;
  message?: string;
}

interface ConfirmPaymentParams {
  bookingId: number;
  memberEmail: string;
  paymentIntentId: string;
  source: PaymentSource;
  staffEmail?: string;
}

function auditStaffEmail(source: PaymentSource, staffEmail?: string): string {
  if (source === 'kiosk') return `kiosk:${staffEmail || 'unknown'}`;
  if (source === 'staff') return staffEmail || 'staff';
  return 'system';
}

function sourceLabel(source: PaymentSource): string {
  if (source === 'kiosk') return 'kiosk';
  if (source === 'staff') return 'staff';
  return 'member';
}

export async function processPayFees(params: PayFeesParams): Promise<{ status: number; body: PayFeesResult | { error: string } }> {
  const { bookingId, memberEmail, useAccountBalance, source, staffEmail } = params;
  const label = sourceLabel(source);

  const bookingResult = await db.execute(sql`
    SELECT br.id, br.session_id, br.user_email, br.user_name, br.status, br.trackman_booking_id, u.id as user_id, u.first_name, u.last_name
     FROM booking_requests br
     LEFT JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
     WHERE br.id = ${bookingId}
  `);

  if (bookingResult.rows.length === 0) {
    return { status: 404, body: { error: 'Booking not found' } };
  }

  const booking = bookingResult.rows[0] as unknown as BookingRow;

  if (booking.status === 'cancelled' || booking.status === 'cancellation_pending' || booking.status === 'declined') {
    return { status: 400, body: { error: 'Cannot pay for a cancelled or declined booking' } };
  }

  if (booking.user_email?.toLowerCase() !== memberEmail.toLowerCase()) {
    return { status: 403, body: { error: 'Only the booking owner can pay fees' } };
  }

  if (!booking.session_id) {
    return { status: 400, body: { error: 'Booking has no session' } };
  }

  const breakdown = await computeFeeBreakdown({
    sessionId: booking.session_id,
    source: 'stripe' as const
  });
  await applyFeeBreakdownToParticipants(booking.session_id, breakdown);

  const pendingParticipants = await db.execute(sql`
    SELECT bp.id, bp.participant_type, bp.display_name, bp.cached_fee_cents
     FROM booking_participants bp
     WHERE bp.session_id = ${booking.session_id} 
       AND (bp.payment_status IN ('pending', 'refunded') OR bp.payment_status IS NULL)
       AND bp.cached_fee_cents > 0
  `);

  if (pendingParticipants.rows.length === 0) {
    const unpaidCheck = await db.execute(sql`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count,
             SUM(CASE WHEN cached_fee_cents > 0 AND payment_status != 'paid' THEN 1 ELSE 0 END) as unpaid_with_fees
      FROM booking_participants
      WHERE session_id = ${booking.session_id}
    `);
    const row = unpaidCheck.rows[0] as { total: string; paid_count: string; unpaid_with_fees: string };
    const totalCount = parseInt(row.total, 10) || 0;
    const paidCount = parseInt(row.paid_count, 10) || 0;
    const unpaidWithFees = parseInt(row.unpaid_with_fees, 10) || 0;
    if (totalCount > 0 && unpaidWithFees === 0 && paidCount > 0) {
      const stalePiCheck = await db.execute(sql`
        SELECT spi.stripe_payment_intent_id FROM stripe_payment_intents spi
        WHERE spi.booking_id = ${bookingId} AND spi.status = 'succeeded'
        AND spi.purpose IN ('prepayment', 'booking_fee')
        ORDER BY spi.created_at DESC LIMIT 1
      `);
      if (stalePiCheck.rows.length > 0) {
        const piId = (stalePiCheck.rows[0] as { stripe_payment_intent_id: string }).stripe_payment_intent_id;
        try {
          const stripeClient = await getStripeClient();
          const livePi = await stripeClient.paymentIntents.retrieve(piId);
          if (livePi.status !== 'succeeded') {
            const correctedStatus = livePi.status === 'canceled' ? 'canceled' : livePi.status === 'requires_payment_method' ? 'failed' : livePi.status;
            logger.warn(`[${label} Stripe] All participants marked paid but Stripe PI not succeeded — correcting stale data`, {
              extra: { bookingId, piId, dbStatus: 'succeeded', stripeStatus: livePi.status }
            });
            await db.execute(sql`UPDATE stripe_payment_intents SET status = ${correctedStatus}, updated_at = NOW() WHERE stripe_payment_intent_id = ${piId}`);
            await db.execute(sql`UPDATE booking_participants SET payment_status = 'pending', stripe_payment_intent_id = NULL, paid_at = NULL
               WHERE stripe_payment_intent_id = ${piId} AND payment_status = 'paid'`);
            await db.execute(sql`UPDATE booking_fee_snapshots SET status = 'stale' WHERE stripe_payment_intent_id = ${piId} AND status IN ('completed', 'paid')`);
            await applyFeeBreakdownToParticipants(booking.session_id!, breakdown);
            const retryPending = await db.execute(sql`
              SELECT bp.id, bp.participant_type, bp.display_name, bp.cached_fee_cents
               FROM booking_participants bp
               WHERE bp.session_id = ${booking.session_id}
                 AND (bp.payment_status IN ('pending', 'refunded') OR bp.payment_status IS NULL)
                 AND bp.cached_fee_cents > 0
            `);
            if (retryPending.rows.length > 0) {
              logger.info(`[${label} Stripe] Stale data corrected, re-running with ${retryPending.rows.length} pending participants`, { extra: { bookingId } });
              return processPayFees(params);
            }
          }
        } catch (verifyErr: unknown) {
          logger.warn(`[${label} Stripe] Could not verify PI with Stripe during all-paid check`, {
            extra: { bookingId, piId, error: getErrorMessage(verifyErr) }
          });
        }
      }
      logger.info(`[${label} Stripe] All participants settled (paid or zero-fee)`, { extra: { bookingId, paidCount, totalCount } });
      return {
        status: 200,
        body: {
          paidInFull: true,
          message: 'This booking has already been paid.',
          totalAmount: 0,
          balanceApplied: 0,
          remainingAmount: 0,
          participantFees: [],
        }
      };
    }
    return { status: 400, body: { error: 'No unpaid fees found' } };
  }

  const typedParticipants = pendingParticipants.rows as unknown as ParticipantRow[];

  const pendingFees = typedParticipants
    .filter(p => p.cached_fee_cents > 0)
    .map(p => {
      const breakdownMatch = breakdown.participants.find(bp => bp.participantId === p.id);
      return {
        participantId: p.id,
        displayName: p.display_name || 'Unknown',
        participantType: p.participant_type as 'owner' | 'member' | 'guest',
        totalCents: p.cached_fee_cents,
        overageCents: breakdownMatch?.overageCents ?? (p.participant_type === 'guest' ? 0 : p.cached_fee_cents),
        guestCents: breakdownMatch?.guestCents ?? (p.participant_type === 'guest' ? p.cached_fee_cents : 0),
        guestPassUsed: breakdownMatch?.guestPassUsed || false,
      };
    });

  if (pendingFees.length === 0) {
    return { status: 400, body: { error: 'No fees to charge' } };
  }

  const serverTotal = pendingFees.reduce((sum, p) => sum + p.totalCents, 0);

  if (serverTotal === 0) {
    const zeroFeeParticipantIds = pendingFees.map(p => p.participantId!);
    await db.transaction(async (tx) => {
      if (zeroFeeParticipantIds.length > 0) {
        await tx.execute(sql`
          UPDATE booking_participants 
           SET payment_status = 'paid', paid_at = NOW(), updated_at = NOW(), cached_fee_cents = 0
           WHERE id = ANY(${toIntArrayLiteral(zeroFeeParticipantIds)}::int[])
        `);
      }
    });
    logger.info(`[${label} Stripe] $0 fee booking — bypassed Stripe, marked participants as paid`, { extra: { bookingId, participantCount: zeroFeeParticipantIds.length } });

    sendNotificationToUser(memberEmail, {
      type: 'billing_update',
      title: 'Booking Confirmed',
      message: 'Your booking fees have been resolved — no payment required.',
      data: { bookingId, status: 'paid' }
    });
    broadcastBillingUpdate({ memberEmail, action: 'payment_confirmed', bookingId, status: 'paid' });
    broadcastBookingInvoiceUpdate({ bookingId, action: 'payment_confirmed' });

    return {
      status: 200,
      body: {
        paidInFull: true,
        totalAmount: 0,
        balanceApplied: 0,
        remainingAmount: 0,
        participantFees: pendingFees.map(f => ({
          id: f.participantId,
          displayName: f.displayName,
          amount: 0
        }))
      }
    };
  }

  if (serverTotal < 50) {
    return { status: 400, body: { error: 'Total amount must be at least $0.50' } };
  }

  const serverFees = pendingFees.map(p => ({ id: p.participantId!, amountCents: p.totalCents }));

  const trackmanId = booking.trackman_booking_id;
  const memberName = [booking.first_name, booking.last_name].filter(Boolean).join(' ') || booking.user_name || memberEmail.split('@')[0];
  let resolvedUserId = booking.user_id;
  if (!resolvedUserId) {
    const resolved = await resolveUserByEmail(memberEmail);
    resolvedUserId = resolved?.userId || memberEmail;
  }
  const { customerId: stripeCustomerId } = await getOrCreateStripeCustomer(
    resolvedUserId,
    memberEmail,
    memberName
  );

  if (useAccountBalance) {
    const balanceResult = await createBalanceAwarePayment({
      stripeCustomerId,
      userId: resolvedUserId,
      email: memberEmail,
      memberName,
      amountCents: serverTotal,
      purpose: 'booking_fee',
      description: `Booking #${bookingId} fees`,
      bookingId,
      sessionId: booking.session_id,
      metadata: {
        participantIds: participantIds.join(','),
        source: `${label}_pay_fees_balance_aware`,
      },
    });

    if (balanceResult.error) {
      return { status: 500, body: { error: balanceResult.error } };
    }

    const participantFeesList = pendingFees.map(f => {
      const participant = typedParticipants.find(p => p.id === f.participantId);
      const pType = participant?.participant_type as 'owner' | 'member' | 'guest' | undefined;
      const isGuest = pType === 'guest';
      const overageCents = 'overageCents' in f ? (f as { overageCents: number }).overageCents : 0;
      const guestCents = 'guestCents' in f ? (f as { guestCents: number }).guestCents : 0;
      const { feeType, feeDescription } = describeFee(isGuest, overageCents, guestCents);
      return { id: f.participantId, displayName: participant?.display_name || (isGuest ? 'Guest' : 'Member'), amount: f.totalCents / 100, feeType, feeDescription, participantType: pType || 'member' };
    });

    if (balanceResult.paidInFull) {
      const paidParticipantIds = pendingFees.map(f => f.participantId!).filter(Boolean);
      if (paidParticipantIds.length > 0) {
        await db.execute(sql`
          UPDATE booking_participants SET payment_status = 'paid', paid_at = NOW()
          WHERE id = ANY(${toIntArrayLiteral(paidParticipantIds)}::int[])
        `);
      }

      await logPaymentAudit({
        bookingId,
        sessionId: booking.session_id,
        action: 'payment_confirmed',
        staffEmail: auditStaffEmail(source, staffEmail),
        amountAffected: serverTotal / 100,
        paymentMethod: 'account_credit',
        metadata: { trigger: `${label}_pay_fees_balance_aware`, balanceApplied: balanceResult.balanceApplied },
      });

      sendNotificationToUser(memberEmail, {
        type: 'billing_update',
        title: 'Payment Confirmed',
        message: `Account credit of $${(balanceResult.balanceApplied / 100).toFixed(2)} applied to Booking #${bookingId}`,
        data: { bookingId, status: 'paid' }
      });
      broadcastBillingUpdate({ memberEmail, action: 'payment_confirmed', bookingId, status: 'paid' });
      broadcastBookingInvoiceUpdate({ bookingId, action: 'payment_confirmed' });

      return {
        status: 200,
        body: {
          paidInFull: true,
          totalAmount: serverTotal / 100,
          balanceApplied: balanceResult.balanceApplied / 100,
          remainingAmount: 0,
          participantFees: participantFeesList,
        }
      };
    }

    if (balanceResult.balanceApplied === 0) {
      if (balanceResult.paymentIntentId) {
        try { await cancelPaymentIntent(balanceResult.paymentIntentId); } catch (_e: unknown) { /* best-effort */ }
      }
      return { status: 400, body: { error: 'No account credit available to apply' } };
    }

    if (balanceResult.paymentIntentId) {
      const remainingFees = serverFees.map(f => ({
        id: f.id,
        amountCents: Math.max(0, f.amountCents - Math.round(balanceResult.balanceApplied * (f.amountCents / serverTotal))),
      }));

      await db.execute(sql`
        INSERT INTO booking_fee_snapshots (booking_id, session_id, participant_fees, total_cents, status, stripe_payment_intent_id)
        VALUES (${bookingId}, ${booking.session_id}, ${JSON.stringify(remainingFees)}, ${balanceResult.remainingCents}, 'pending', ${balanceResult.paymentIntentId})
      `);
    }

    await logPaymentAudit({
      bookingId,
      sessionId: booking.session_id,
      action: 'balance_payment_partial',
      staffEmail: auditStaffEmail(source, staffEmail),
      amountAffected: balanceResult.balanceApplied / 100,
      paymentMethod: 'account_credit',
      metadata: { trigger: `${label}_pay_fees_balance_aware`, balanceApplied: balanceResult.balanceApplied, remaining: balanceResult.remainingCents },
    });

    return {
      status: 200,
      body: {
        paidInFull: false,
        clientSecret: balanceResult.clientSecret,
        paymentIntentId: balanceResult.paymentIntentId,
        totalAmount: serverTotal / 100,
        balanceApplied: balanceResult.balanceApplied / 100,
        remainingAmount: balanceResult.remainingCents / 100,
        participantFees: participantFeesList,
        description: `Booking #${bookingId} fees ($${(balanceResult.balanceApplied / 100).toFixed(2)} credit applied)`,
      }
    };
  }

  const existingInvoiceResult = await handleExistingInvoicePayment({
    bookingId,
    sessionId: booking.session_id,
    bookingEmail: memberEmail,
    serverFees,
    serverTotal,
    pendingFees: pendingFees.map(f => ({
      participantId: f.participantId ?? null,
      displayName: f.displayName,
      totalCents: f.totalCents,
      overageCents: f.overageCents,
      guestCents: f.guestCents,
      participantType: f.participantType,
      minutesAllocated: f.minutesAllocated,
    })),
    resolvedUserId,
    stripeCustomerId,
    trackmanId,
  });
  if (existingInvoiceResult) {
    return { status: 200, body: existingInvoiceResult as PayFeesResult };
  }

  const feeLineItems: BookingFeeLineItem[] = [];
  for (const p of typedParticipants) {
    const fee = pendingFees.find(f => f.participantId === p.id);
    if (!fee || fee.totalCents <= 0) continue;
    const isGuest = p.participant_type === 'guest';
    feeLineItems.push({
      participantId: p.id,
      displayName: p.display_name || (isGuest ? 'Guest' : 'Member'),
      participantType: p.participant_type as 'owner' | 'member' | 'guest',
      overageCents: isGuest ? 0 : fee.totalCents,
      guestCents: isGuest ? fee.totalCents : 0,
      totalCents: fee.totalCents,
    });
  }

  const snapshotResult = await db.execute(sql`
    INSERT INTO booking_fee_snapshots (booking_id, session_id, participant_fees, total_cents, status)
     VALUES (${bookingId}, ${booking.session_id}, ${JSON.stringify(serverFees)}, ${serverTotal}, 'pending') RETURNING id
  `);
  const snapshotId = (snapshotResult.rows[0] as unknown as IdRow).id;

  const draftResult = await createDraftInvoiceForBooking({
    customerId: stripeCustomerId,
    bookingId,
    sessionId: booking.session_id,
    trackmanBookingId: trackmanId || null,
    feeLineItems,
    metadata: {
      feeSnapshotId: snapshotId.toString(),
      participantCount: serverFees.length.toString(),
      participantIds: serverFees.map(f => f.id).join(',').substring(0, 490),
      memberPayment: 'true',
      ...(source === 'kiosk' ? { kioskPayment: 'true' } : {}),
    },
    purpose: 'booking_fee',
  });

  const participantFeesList = pendingFees.map(f => {
    const participant = typedParticipants.find(p => p.id === f.participantId);
    const pType = participant?.participant_type as 'owner' | 'member' | 'guest' | undefined;
    const isGuest = pType === 'guest';
    const overageCents = 'overageCents' in f ? (f as { overageCents: number }).overageCents : 0;
    const guestCents = 'guestCents' in f ? (f as { guestCents: number }).guestCents : 0;
    const { feeType, feeDescription } = describeFee(isGuest, overageCents, guestCents);
    return {
      id: f.participantId,
      displayName: participant?.display_name || (isGuest ? 'Guest' : 'Member'),
      amount: f.totalCents / 100,
      feeType,
      feeDescription,
      participantType: pType || 'member',
    };
  });

  const { getStripeClient } = await import('../stripe/client');
  const stripe = await getStripeClient();

  await stripe.invoices.update(draftResult.invoiceId, {
    collection_method: 'charge_automatically',
  });

  const newPiResult = await finalizeInvoiceWithPi(stripe, draftResult.invoiceId);

  if (newPiResult.paidInFull) {
    const paidParticipantIds = pendingFees.map(f => f.participantId!).filter(Boolean);
    if (paidParticipantIds.length > 0) {
      await db.execute(sql`
        UPDATE booking_participants
         SET payment_status = 'paid', paid_at = NOW(), updated_at = NOW()
         WHERE id = ANY(${toIntArrayLiteral(paidParticipantIds)}::int[])
      `);
    }
    await db.execute(sql`
      UPDATE booking_fee_snapshots SET status = 'completed', used_at = NOW(), updated_at = NOW() WHERE id = ${snapshotId}
    `);
    logger.info(`[${label} Stripe] New invoice auto-paid after finalization`, { extra: { bookingId, invoiceId: draftResult.invoiceId } });
    await logPaymentAudit({
      bookingId,
      sessionId: booking.session_id,
      action: 'payment_confirmed',
      staffEmail: auditStaffEmail(source, staffEmail),
      amountAffected: serverTotal / 100,
      paymentMethod: 'account_credit',
      metadata: { invoiceId: draftResult.invoiceId, trigger: `${label}_auto_pay_new_invoice` },
    });
    return {
      status: 200,
      body: {
        paidInFull: true,
        invoiceId: draftResult.invoiceId,
        paymentIntentId: '',
        totalAmount: serverTotal / 100,
        balanceApplied: serverTotal / 100,
        remainingAmount: 0,
        participantFees: participantFeesList,
      }
    };
  }

  const invoicePiId = newPiResult.piId;
  let invoicePiSecret = newPiResult.clientSecret;
  if (!invoicePiSecret?.startsWith('pi_')) {
    logger.warn(`[${label} Stripe] New invoice finalization returned non-standard client_secret, attempting direct PI retrieve`, {
      extra: { bookingId, invoiceId: draftResult.invoiceId, piId: invoicePiId }
    });
    const directPi = await stripe.paymentIntents.retrieve(invoicePiId);
    if (directPi.client_secret) {
      invoicePiSecret = directPi.client_secret;
    }
  }
  logger.info(`[${label} Stripe] Finalized new invoice for payment`, { extra: { bookingId, invoiceId: draftResult.invoiceId, paymentIntentId: invoicePiId } });

  try {
    await stripe.paymentIntents.update(invoicePiId, {
      setup_future_usage: 'off_session',
    });
  } catch (sfuErr: unknown) {
    logger.warn(`[${label} Stripe] Could not set setup_future_usage on invoice PI`, {
      extra: { bookingId, piId: invoicePiId, error: getErrorMessage(sfuErr) }
    });
  }

  await db.execute(sql`
    UPDATE booking_fee_snapshots SET stripe_payment_intent_id = ${invoicePiId}, status = 'pending', updated_at = NOW() WHERE id = ${snapshotId}
  `);
  const newPiDescription = await buildInvoiceDescription(bookingId, trackmanId);

  await db.execute(sql`
    INSERT INTO stripe_payment_intents 
     (user_id, stripe_payment_intent_id, stripe_customer_id, amount_cents, purpose, booking_id, session_id, description, status)
     VALUES (${resolvedUserId || memberEmail}, ${invoicePiId}, ${stripeCustomerId},
     ${serverTotal}, ${'booking_fee'}, ${bookingId}, ${booking.session_id},
     ${newPiDescription}, 'pending')
     ON CONFLICT (stripe_payment_intent_id) DO NOTHING
  `);

  let customerSessionSecret: string | undefined;
  try {
    const customerSession = await stripe.customerSessions.create({
      customer: stripeCustomerId,
      components: {
        payment_element: {
          enabled: true,
          features: {
            payment_method_redisplay: 'enabled',
            payment_method_save: 'enabled',
            payment_method_remove: 'enabled',
          },
        },
      },
    });
    customerSessionSecret = customerSession.client_secret;
  } catch (csErr: unknown) {
    logger.warn(`[${label} Stripe] Failed to create customer session for saved cards`, {
      extra: { bookingId, error: getErrorMessage(csErr) }
    });
  }

  return {
    status: 200,
    body: {
      paidInFull: false,
      clientSecret: invoicePiSecret,
      paymentIntentId: invoicePiId,
      invoiceId: draftResult.invoiceId,
      totalAmount: serverTotal / 100,
      balanceApplied: 0,
      remainingAmount: serverTotal / 100,
      participantFees: participantFeesList,
      description: newPiDescription,
      customerSessionClientSecret: customerSessionSecret,
    }
  };
}

export async function processConfirmPayment(params: ConfirmPaymentParams): Promise<{ status: number; body: { success?: boolean; error?: string; message?: string } }> {
  const { bookingId, memberEmail, paymentIntentId, source, staffEmail } = params;
  const label = sourceLabel(source);

  const bookingResult = await db.execute(sql`
    SELECT br.id, br.session_id, br.user_email, br.user_name
     FROM booking_requests br
     WHERE br.id = ${bookingId}
  `);

  if (bookingResult.rows.length === 0) {
    return { status: 404, body: { error: 'Booking not found' } };
  }

  const booking = bookingResult.rows[0] as unknown as BookingRow;

  if (booking.user_email?.toLowerCase() !== memberEmail.toLowerCase()) {
    return { status: 403, body: { error: 'Only the booking owner can confirm payment' } };
  }

  const snapshotResult = await db.execute(sql`
    SELECT id, participant_fees, status
     FROM booking_fee_snapshots
     WHERE booking_id = ${bookingId} AND stripe_payment_intent_id = ${paymentIntentId}
  `);

  if (snapshotResult.rows.length === 0) {
    return { status: 404, body: { error: 'Payment record not found' } };
  }

  const snapshot = snapshotResult.rows[0] as unknown as SnapshotRow;

  if (snapshot.status === 'completed') {
    return { status: 200, body: { success: true, message: 'Payment already confirmed' } };
  }

  const currentFees = await computeFeeBreakdown({ sessionId: booking.session_id!, source: 'stripe' as const });
  let snapshotFees: unknown;
  try {
    snapshotFees = typeof snapshot.participant_fees === 'string' ? JSON.parse(snapshot.participant_fees) : snapshot.participant_fees;
  } catch { /* best-effort JSON parse of snapshot fees — fall back to null on malformed data */
    snapshotFees = null;
  }
  const snapshotTotal = Array.isArray(snapshotFees)
    ? snapshotFees.reduce((sum: number, f: Record<string, unknown>) => sum + ((f.amountCents as number) || 0), 0)
    : 0;
  const currentTotal = currentFees.totals.totalCents;

  if (Math.abs(currentTotal - snapshotTotal) > 100) {
    logger.warn(`[${label} Stripe] Fee drift detected during confirm-payment — proceeding since Stripe already charged`, {
      extra: { bookingId, snapshotTotal, currentTotal, difference: currentTotal - snapshotTotal, paymentIntentId }
    });
    try {
      await db.execute(sql`
        UPDATE booking_sessions SET needs_review = true, review_reason = ${`Fee drift: snapshot ${snapshotTotal} cents vs current ${currentTotal} cents (diff: ${currentTotal - snapshotTotal}). ${label} payment ${paymentIntentId} already succeeded.`} WHERE id = ${booking.session_id}
      `);
    } catch (flagErr: unknown) {
      logger.error(`[${label} Stripe] Failed to flag session for review after fee drift`, { extra: { error: getErrorMessage(flagErr) } });
    }
  }

  const confirmResult = await confirmPaymentSuccess(
    paymentIntentId,
    memberEmail,
    booking.user_name || 'Member'
  );

  if (!confirmResult.success) {
    return { status: 400, body: { error: confirmResult.error || 'Payment verification failed' } };
  }

  let participantFees: Array<{ id: number; amountCents?: number }> = [];
  try {
    participantFees = JSON.parse(typeof snapshot.participant_fees === 'string' ? snapshot.participant_fees : '[]');
  } catch (parseErr: unknown) {
    logger.error(`[${label} Payments] Failed to parse participant_fees for snapshot`, { extra: { snapshot_id: snapshot.id, parseErr: getErrorMessage(parseErr) } });
  }
  const participantIdsToUpdate = participantFees.map((pf) => pf.id);

  await db.transaction(async (tx) => {
    if (participantIdsToUpdate.length > 0) {
      await tx.execute(sql`
        UPDATE booking_participants 
         SET payment_status = 'paid', paid_at = NOW(), updated_at = NOW(), stripe_payment_intent_id = ${paymentIntentId}, cached_fee_cents = 0
         WHERE id = ANY(${toIntArrayLiteral(participantIdsToUpdate)}::int[])
      `);
    }

    await tx.execute(sql`
      UPDATE booking_fee_snapshots SET status = 'completed', updated_at = NOW() WHERE id = ${snapshot.id}
    `);
  });

  logger.info(`[${label} Stripe] Payment confirmed for booking, participants marked as paid`, { extra: { bookingId, participantIdsLength: participantIdsToUpdate.length, ...(staffEmail ? { staffEmail } : {}) } });

  try {
    const invoiceIdResult = await db.execute(sql`SELECT stripe_invoice_id FROM booking_requests WHERE id = ${bookingId} AND stripe_invoice_id IS NOT NULL LIMIT 1`);
    const invoiceId = (invoiceIdResult.rows[0] as Record<string, unknown> | undefined)?.stripe_invoice_id as string | undefined;
    if (invoiceId) {
      const { getStripeClient } = await import('../stripe/client');
      const stripe = await getStripeClient();
      const inv = await stripe.invoices.retrieve(invoiceId);
      if (inv.status === 'paid') {
        logger.info(`[${label} Stripe] Invoice paid via its own PI`, { extra: { bookingId, invoiceId } });
      } else {
        logger.info(`[${label} Stripe] Invoice not yet marked paid — Stripe will settle automatically`, { extra: { bookingId, invoiceId, paymentIntentId, invoiceStatus: inv.status } });
      }
    }
  } catch (invoiceCheckErr: unknown) {
    logger.warn(`[${label} Stripe] Non-blocking: Failed to check invoice status after confirm-payment`, { extra: { bookingId, error: getErrorMessage(invoiceCheckErr) } });
  }

  sendNotificationToUser(memberEmail, {
    type: 'billing_update',
    title: 'Payment Successful',
    message: 'Your payment has been processed successfully.',
    data: { bookingId, status: 'paid' }
  });

  broadcastBillingUpdate({
    memberEmail,
    action: 'payment_confirmed',
    bookingId,
    status: 'paid'
  });

  broadcastBookingInvoiceUpdate({
    bookingId,
    action: 'payment_confirmed',
  });

  return { status: 200, body: { success: true } };
}

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
