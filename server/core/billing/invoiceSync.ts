import { getStripeClient } from '../stripe/client';
  import { db } from '../../db';
  import { logger } from '../logger';
  import { getErrorMessage } from '../../utils/errorUtils';
  import { notifications } from '../../../shared/models/notifications';
  import { sql } from 'drizzle-orm';
  import type { BookingFeeLineItem } from '../stripe/invoices';
  import { notifyAllStaff } from '../notificationService';
  import { BOOKING_STATUS, PARTICIPANT_TYPE, RESOURCE_TYPE } from '../../../shared/constants/statuses';
  import type { ParticipantType } from '../../../shared/constants/statuses';
  import { safeBroadcast } from './bookingInvoiceTypes';
  import { createDraftInvoiceForBooking, updateDraftInvoiceLineItems } from './invoiceDraft';

  interface StripeCustomerIdRow {
    stripe_customer_id: string | null;
  }

  interface ParticipantFeeRow {
    id: number;
    display_name: string | null;
    participant_type: string;
    cached_fee_cents: number;
  }

  interface InvoiceSyncRow {
    stripe_invoice_id: string | null;
    user_email: string;
    trackman_booking_id: string | null;
    status: string;
    resource_id: number | null;
    resource_type: string;
    declared_player_count: number | null;
  }

  interface BookingInfoRow {
    user_email: string;
    session_id: number;
    trackman_booking_id: string | null;
    status: string;
    resource_id?: number;
    declared_player_count?: number;
    resource_type?: string;
  }

  export async function recreateDraftInvoiceFromBooking(bookingId: number): Promise<{ success: boolean; invoiceId?: string }> {
  try {
    const bookingResult = await db.execute(sql`SELECT br.user_email, br.session_id, br.trackman_booking_id, br.status, br.resource_id,
              br.declared_player_count,
              COALESCE(r.type, ${RESOURCE_TYPE.SIMULATOR}) as resource_type
       FROM booking_requests br
       LEFT JOIN resources r ON br.resource_id = r.id
       WHERE br.id = ${bookingId} LIMIT 1`);

    if (bookingResult.rows.length === 0) {
      logger.warn('[BookingInvoice] recreateDraftInvoiceFromBooking: booking not found', { extra: { bookingId } });
      return { success: false };
    }

    const booking = (bookingResult.rows as unknown as BookingInfoRow[])[0];

    if (booking.status !== BOOKING_STATUS.APPROVED) {
      logger.info('[BookingInvoice] recreateDraftInvoiceFromBooking: booking not approved, skipping', { extra: { bookingId, status: booking.status } });
      return { success: true };
    }

    const userResult = await db.execute(sql`SELECT stripe_customer_id FROM users WHERE LOWER(email) = LOWER(${booking.user_email}) LIMIT 1`);

    const stripeCustomerId = (userResult.rows as unknown as StripeCustomerIdRow[])[0]?.stripe_customer_id;
    if (!stripeCustomerId) {
      logger.warn('[BookingInvoice] recreateDraftInvoiceFromBooking: no stripe_customer_id for user', { extra: { bookingId, email: booking.user_email } });
      return { success: false };
    }

    const participantResult = await db.execute(sql`SELECT id, display_name, participant_type, cached_fee_cents
       FROM booking_participants
       WHERE session_id = ${booking.session_id} AND cached_fee_cents > 0`);

    const feeLineItems: BookingFeeLineItem[] = (participantResult.rows as unknown as ParticipantFeeRow[]).map((row) => {
      const totalCents = row.cached_fee_cents;
      const isGuest = row.participant_type === PARTICIPANT_TYPE.GUEST;
      return {
        participantId: row.id,
        displayName: row.display_name || 'Unknown',
        participantType: row.participant_type as ParticipantType,
        overageCents: isGuest ? 0 : totalCents,
        guestCents: isGuest ? totalCents : 0,
        totalCents,
      };
    });

    const totalFees = feeLineItems.reduce((sum, li) => sum + li.totalCents, 0);

    if (totalFees === 0) {
      logger.info('[BookingInvoice] recreateDraftInvoiceFromBooking: no fees, skipping draft creation', { extra: { bookingId } });
      return { success: true };
    }

    const draftResult = await createDraftInvoiceForBooking({
      customerId: stripeCustomerId as string,
      bookingId,
      sessionId: booking.session_id,
      trackmanBookingId: booking.trackman_booking_id || null,
      feeLineItems,
      purpose: 'booking_fee',
    });

    logger.info('[BookingInvoice] recreateDraftInvoiceFromBooking: draft invoice created', { extra: { bookingId, invoiceId: draftResult.invoiceId, totalCents: draftResult.totalCents } });
    return { success: true, invoiceId: draftResult.invoiceId };
  } catch (err: unknown) {
    logger.error('[BookingInvoice] recreateDraftInvoiceFromBooking failed', { extra: { bookingId, error: getErrorMessage(err) } });
    return { success: false };
  }
}

export interface SyncBookingInvoiceResult {
  success: boolean;
  error?: string;
}

export async function syncBookingInvoice(bookingId: number, sessionId: number, _retryDepth = 0): Promise<SyncBookingInvoiceResult> {
  try {
    const invoiceResult = await db.execute(sql`SELECT br.stripe_invoice_id, br.user_email, br.trackman_booking_id, br.status, br.resource_id,
              COALESCE(r.type, ${RESOURCE_TYPE.SIMULATOR}) as resource_type,
              br.declared_player_count
       FROM booking_requests br
       LEFT JOIN resources r ON br.resource_id = r.id
       WHERE br.id = ${bookingId} LIMIT 1`);
    const booking = (invoiceResult.rows as unknown as InvoiceSyncRow[])[0];
    if (!booking) return { success: true };
    const stripeInvoiceId = booking.stripe_invoice_id;

    if (!stripeInvoiceId) {
      if (booking.status !== BOOKING_STATUS.APPROVED && booking.status !== BOOKING_STATUS.CONFIRMED && booking.status !== BOOKING_STATUS.ATTENDED) return { success: true };

      const participantResult = await db.execute(sql`SELECT id, display_name, participant_type, cached_fee_cents
         FROM booking_participants
         WHERE session_id = ${sessionId} AND cached_fee_cents > 0`);

      const typedParticipants = participantResult.rows as unknown as ParticipantFeeRow[];

      const feeLineItems: BookingFeeLineItem[] = typedParticipants.map((row) => {
        const totalCents = row.cached_fee_cents;
        const isGuest = row.participant_type === PARTICIPANT_TYPE.GUEST;
        return {
          participantId: row.id,
          displayName: row.display_name || 'Unknown',
          participantType: row.participant_type as ParticipantType,
          overageCents: isGuest ? 0 : totalCents,
          guestCents: isGuest ? totalCents : 0,
          totalCents,
        };
      });

      const totalFees = feeLineItems.reduce((sum, li) => sum + li.totalCents, 0);
      if (totalFees <= 0) return { success: true };

      const userResult = await db.execute(sql`SELECT stripe_customer_id FROM users WHERE LOWER(email) = LOWER(${booking.user_email}) LIMIT 1`);
      const stripeCustomerId = (userResult.rows as unknown as StripeCustomerIdRow[])[0]?.stripe_customer_id;
      if (!stripeCustomerId) {
        logger.warn('[BookingInvoice] syncBookingInvoice: no stripe_customer_id for user, cannot create draft invoice', { extra: { bookingId, email: booking.user_email } });
        return { success: false, error: 'No stripe_customer_id for user' };
      }

      const draftResult = await createDraftInvoiceForBooking({
        customerId: stripeCustomerId as string,
        bookingId,
        sessionId,
        trackmanBookingId: booking.trackman_booking_id || null,
        feeLineItems,
        purpose: 'booking_fee',
      });

      logger.info('[BookingInvoice] syncBookingInvoice created draft invoice (none existed, fees > $0)', {
        extra: { bookingId, sessionId, invoiceId: draftResult.invoiceId, totalCents: draftResult.totalCents }
      });

      safeBroadcast({ bookingId, sessionId, action: 'invoice_created', invoiceId: draftResult.invoiceId });
      return { success: true };
    }

    const stripe = await getStripeClient();
    let invoice;
    try {
      invoice = await stripe.invoices.retrieve(stripeInvoiceId);
    } catch (retrieveErr: unknown) {
      const stripeErr = retrieveErr as { statusCode?: number };
      if (stripeErr.statusCode === 404) {
        logger.warn('[BookingInvoice] syncBookingInvoice: stale invoice reference — invoice not found in Stripe, clearing and retrying', {
          extra: { bookingId, invoiceId: stripeInvoiceId, retryDepth: _retryDepth }
        });
        await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${bookingId}`);
        if (_retryDepth >= 1) {
          logger.error('[BookingInvoice] syncBookingInvoice: stale invoice retry exhausted — giving up', {
            extra: { bookingId, invoiceId: stripeInvoiceId }
          });
          return { success: false, error: 'Stale invoice retry exhausted' };
        }
        return syncBookingInvoice(bookingId, sessionId, _retryDepth + 1);
      }
      throw retrieveErr;
    }
    if (invoice.status !== 'draft') {
      if (invoice.status === 'open') {
        logger.warn('[BookingInvoice] syncBookingInvoice skipped: invoice is open (already finalized). Manual review may be needed.', {
          extra: { bookingId, invoiceId: stripeInvoiceId }
        });
      } else if (invoice.status === 'paid') {
        logger.warn('[BookingInvoice] syncBookingInvoice skipped: invoice already paid. Roster changed after payment — staff review needed.', {
          extra: { bookingId, invoiceId: stripeInvoiceId }
        });
        const existingNotification = await db.select({ id: notifications.id })
          .from(notifications)
          .where(sql`${notifications.title} = 'Roster Changed After Payment' AND ${notifications.relatedId} = ${bookingId} AND ${notifications.relatedType} = 'booking' AND ${notifications.message} LIKE ${'%' + stripeInvoiceId + '%'}`)
          .limit(1);
        if (existingNotification.length === 0) {
          await notifyAllStaff(
            'Roster Changed After Payment',
            `Booking #${bookingId} roster was modified after invoice ${stripeInvoiceId} was already paid. Staff review needed.`,
            'warning',
            { relatedId: bookingId, relatedType: 'booking' }
          );
        } else {
          logger.info('[BookingInvoice] Skipping duplicate "Roster Changed After Payment" notification for booking+invoice', {
            extra: { bookingId, invoiceId: stripeInvoiceId, existingNotificationId: existingNotification[0].id }
          });
        }
      } else if (invoice.status === 'void' || invoice.status === 'uncollectible') {
        logger.info('[BookingInvoice] syncBookingInvoice: invoice is void/uncollectible, clearing reference and recreating draft', {
          extra: { bookingId, invoiceId: stripeInvoiceId, status: invoice.status }
        });
        await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${bookingId}`);
        if (booking.status === BOOKING_STATUS.APPROVED || booking.status === BOOKING_STATUS.CONFIRMED || booking.status === BOOKING_STATUS.ATTENDED) {
          const voidRecoveryParts = await db.execute(sql`SELECT id, display_name, participant_type, cached_fee_cents
             FROM booking_participants WHERE session_id = ${sessionId} AND cached_fee_cents > 0`);
          const voidRecoveryItems: BookingFeeLineItem[] = (voidRecoveryParts.rows as unknown as ParticipantFeeRow[]).map((row) => {
            const isGuest = row.participant_type === PARTICIPANT_TYPE.GUEST;
            return {
              participantId: row.id,
              displayName: row.display_name || 'Unknown',
              participantType: row.participant_type as ParticipantType,
              overageCents: isGuest ? 0 : row.cached_fee_cents,
              guestCents: isGuest ? row.cached_fee_cents : 0,
              totalCents: row.cached_fee_cents,
            };
          });
          const voidRecoveryTotal = voidRecoveryItems.reduce((sum, li) => sum + li.totalCents, 0);
          if (voidRecoveryTotal > 0) {
            const custResult = await db.execute(sql`SELECT stripe_customer_id FROM users WHERE LOWER(email) = LOWER(${booking.user_email}) LIMIT 1`);
            const custId = (custResult.rows as unknown as StripeCustomerIdRow[])[0]?.stripe_customer_id;
            if (custId) {
              await createDraftInvoiceForBooking({
                customerId: custId,
                bookingId,
                sessionId,
                trackmanBookingId: booking.trackman_booking_id || null,
                feeLineItems: voidRecoveryItems,
                purpose: 'booking_fee',
              });
              logger.info('[BookingInvoice] syncBookingInvoice recreated draft invoice after void/uncollectible recovery', {
                extra: { bookingId, sessionId, totalCents: voidRecoveryTotal }
              });
            }
          }
        }
        return { success: true };
      }
      return { success: true };
    }

    const participantResult = await db.execute(sql`SELECT id, display_name, participant_type, cached_fee_cents
       FROM booking_participants
       WHERE session_id = ${sessionId} AND cached_fee_cents > 0`);

    const feeLineItems: BookingFeeLineItem[] = (participantResult.rows as unknown as ParticipantFeeRow[]).map((row) => {
      const totalCents = row.cached_fee_cents;
      const isGuest = row.participant_type === PARTICIPANT_TYPE.GUEST;
      return {
        participantId: row.id,
        displayName: row.display_name || 'Unknown',
        participantType: row.participant_type as ParticipantType,
        overageCents: isGuest ? 0 : totalCents,
        guestCents: isGuest ? totalCents : 0,
        totalCents,
      };
    });

    const totalFees = feeLineItems.reduce((sum, li) => sum + li.totalCents, 0);

    if (totalFees > 0) {
      await updateDraftInvoiceLineItems({ bookingId, sessionId, feeLineItems });
      logger.info('[BookingInvoice] Draft invoice synced', {
        extra: { bookingId, sessionId, invoiceId: stripeInvoiceId, totalFees, lineItems: feeLineItems.length }
      });
    } else {
      await stripe.invoices.del(stripeInvoiceId);
      await db.execute(sql`UPDATE booking_requests SET stripe_invoice_id = NULL, updated_at = NOW() WHERE id = ${bookingId}`);
      logger.info('[BookingInvoice] Deleted draft invoice (fees now 0)', {
        extra: { bookingId, sessionId, invoiceId: stripeInvoiceId }
      });

      safeBroadcast({ bookingId, sessionId, action: 'invoice_deleted', invoiceId: stripeInvoiceId });
    }
    return { success: true };
  } catch (err: unknown) {
    const errorMsg = getErrorMessage(err);
    logger.warn('[BookingInvoice] Non-blocking: syncBookingInvoice failed', {
      extra: { error: errorMsg, bookingId, sessionId }
    });
    return { success: false, error: errorMsg };
  }
}
  