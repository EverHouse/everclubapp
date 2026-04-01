import { createHash } from 'crypto';
import { getStripeClient } from '../stripe/client';
import { db } from '../../db';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { notifyAllStaff } from '../notificationService';
import { broadcastBookingInvoiceUpdate } from '../websocket';
import { bookingRequests } from '../../../shared/schema';
import { notifications } from '../../../shared/models/notifications';
import { eq, sql } from 'drizzle-orm';
import type Stripe from 'stripe';
import type { BookingFeeLineItem } from '../stripe/invoices';
import { PRICING } from './pricingConfig';
import { markPaymentRefunded } from './PaymentStatusService';
import { BOOKING_STATUS, PARTICIPANT_TYPE, RESOURCE_TYPE, PAYMENT_STATUS } from '../../../shared/constants/statuses';
import type { ParticipantType } from '../../../shared/constants/statuses';

interface _InvoiceWithPaymentIntent extends Stripe.Invoice {
  payment_intent: string | Stripe.PaymentIntent | null;
}

interface BookingInvoiceIdRow {
  stripe_invoice_id: string | null;
}

interface StripeCustomerIdRow {
  stripe_customer_id: string | null;
}

interface ParticipantFeeRow {
  id: number;
  display_name: string | null;
  participant_type: string;
  cached_fee_cents: number;
}

interface _RefundCountRow {
  cnt: string | number;
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

export interface PaymentIntentLookupRow {
  stripe_payment_intent_id: string;
  amount_cents: number;
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

interface TrackmanBookingIdRow {
  trackman_booking_id: string | null;
}

export function safeBroadcast(params: Parameters<typeof broadcastBookingInvoiceUpdate>[0]): void {
  try {
    broadcastBookingInvoiceUpdate(params);
  } catch (err: unknown) {
    logger.warn('[BookingInvoice] Failed to broadcast invoice update', {
      extra: { bookingId: params.bookingId, action: params.action, error: getErrorMessage(err) }
    });
  }
}

  export interface DraftInvoiceParams {
  customerId: string;
  bookingId: number;
  sessionId: number;
  trackmanBookingId?: string | null;
  feeLineItems: BookingFeeLineItem[];
  metadata?: Record<string, string>;
  purpose?: string;
}

export interface DraftInvoiceResult {
  invoiceId: string;
  totalCents: number;
}

export interface FinalizeAndPayResult {
  invoiceId: string;
  paymentIntentId: string;
  clientSecret: string | null;
  status: string;
  paidInFull: boolean;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  amountFromBalance: number;
  amountCharged: number;
}

export function buildInvoiceMetadata(
  params: DraftInvoiceParams,
  feeLineItems: BookingFeeLineItem[]
): Record<string, string> {
  const totalOverageCents = feeLineItems.reduce((sum, li) => sum + li.overageCents, 0);
  const totalGuestCents = feeLineItems.reduce((sum, li) => sum + li.guestCents, 0);
  const meta: Record<string, string> = {
    ...(params.metadata || {}),
    source: 'ever_house_app',
    purpose: params.purpose || 'booking_fee',
    bookingId: params.bookingId.toString(),
    sessionId: params.sessionId.toString(),
    overageCents: totalOverageCents.toString(),
    guestCents: totalGuestCents.toString(),
    invoiceModel: 'single_per_booking',
  };
  if (params.trackmanBookingId) {
    meta.trackmanBookingId = String(params.trackmanBookingId);
  }
  return meta;
}

async function getFeePriceIds(): Promise<{ overagePriceId: string | null; guestPriceId: string | null }> {
  const { feeProducts } = await import('../../../shared/schema');
  const rows = await db.select({ slug: feeProducts.slug, stripePriceId: feeProducts.stripePriceId })
    .from(feeProducts)
    .where(sql`${feeProducts.slug} IN ('simulator-overage-30min', 'guest-pass')`);
  let overagePriceId: string | null = null;
  let guestPriceId: string | null = null;
  for (const r of rows) {
    if (r.slug === 'simulator-overage-30min') overagePriceId = r.stripePriceId;
    if (r.slug === 'guest-pass') guestPriceId = r.stripePriceId;
  }
  return { overagePriceId, guestPriceId };
}

function isIdempotencyKeyReuse(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.message.includes('Keys for idempotent requests can only be used with the same parameters');
}

export async function addLineItemsToInvoice(
  stripe: Stripe,
  invoiceId: string,
  customerId: string,
  feeLineItems: BookingFeeLineItem[]
): Promise<void> {
  const { overagePriceId, guestPriceId } = await getFeePriceIds();

  for (const li of feeLineItems) {
    if (li.totalCents <= 0) continue;

    if (li.overageCents > 0) {
      const overageDesc = li.participantType === PARTICIPANT_TYPE.OWNER
        ? `Overage fee — ${li.displayName}`
        : `Overage fee — ${li.displayName} (${li.participantType})`;

      const overageRateCents = PRICING.OVERAGE_RATE_CENTS;
      const quantity = overageRateCents > 0 ? Math.round(li.overageCents / overageRateCents) : 1;
      const overageRemainder = overageRateCents > 0 ? li.overageCents % overageRateCents : 0;

      if (overagePriceId && overageRateCents > 0 && quantity > 0 && overageRemainder === 0) {
        try {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoiceId,
            pricing: { price: overagePriceId },
            quantity,
            description: overageDesc,
            metadata: {
              participantId: li.participantId?.toString() || '',
              feeType: 'overage',
              participantType: li.participantType,
            },
          }, {
            idempotencyKey: `invitem_overage_${invoiceId}_${li.participantId || 'unknown'}_${li.overageCents}`
          });
        } catch (priceErr: unknown) {
          const errObj = priceErr instanceof Error ? priceErr : null;
          const errType = errObj && 'type' in errObj ? (errObj as Record<string, unknown>).type : undefined;
          const errCode = errObj && 'code' in errObj ? (errObj as Record<string, unknown>).code : undefined;
          const isStalePrice = (errType === 'StripeInvalidRequestError' && (errCode === 'resource_missing' || errCode === 'price_inactive'))
            || (errObj !== null && (errObj.message.includes('No such price') || errObj.message.includes('inactive')));
          if (isIdempotencyKeyReuse(priceErr)) {
            logger.info('[BookingInvoice] Overage line item already exists (idempotency key reuse), skipping', { extra: { invoiceId, participantId: li.participantId } });
          } else if (isStalePrice) {
            const errMsg = errObj ? errObj.message : String(priceErr);
            logger.warn('[BookingInvoice] Stale/inactive overage price ID, falling back to custom amount', { extra: { overagePriceId, error: errMsg } });
            await stripe.invoiceItems.create({
              customer: customerId,
              invoice: invoiceId,
              amount: li.overageCents,
              currency: 'usd',
              description: overageDesc,
              metadata: {
                participantId: li.participantId?.toString() || '',
                feeType: 'overage',
                participantType: li.participantType,
              },
            }, {
              idempotencyKey: `invitem_overage_fallback_${invoiceId}_${li.participantId || 'unknown'}_${li.overageCents}`
            });
          } else {
            throw priceErr;
          }
        }
      } else {
        try {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoiceId,
            amount: li.overageCents,
            currency: 'usd',
            description: overageDesc,
            metadata: {
              participantId: li.participantId?.toString() || '',
              feeType: 'overage',
              participantType: li.participantType,
            },
          }, {
            idempotencyKey: `invitem_overage_${invoiceId}_${li.participantId || 'unknown'}_${li.overageCents}`
          });
        } catch (amtErr: unknown) {
          if (isIdempotencyKeyReuse(amtErr)) {
            logger.info('[BookingInvoice] Overage line item already exists (idempotency key reuse), skipping', { extra: { invoiceId, participantId: li.participantId } });
          } else {
            throw amtErr;
          }
        }
      }
    }

    if (li.guestCents > 0) {
      const guestRateCents = PRICING.GUEST_FEE_CENTS;
      const guestQty = guestPriceId && guestRateCents > 0 ? Math.round(li.guestCents / guestRateCents) : 1;
      const guestRemainder = guestRateCents > 0 ? li.guestCents % guestRateCents : 0;

      if (guestPriceId && guestRateCents > 0 && guestQty > 0 && guestRemainder === 0) {
        try {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoiceId,
            pricing: { price: guestPriceId },
            quantity: guestQty,
            description: `Guest fee — ${li.displayName}`,
            metadata: {
              participantId: li.participantId?.toString() || '',
              feeType: 'guest',
              participantType: li.participantType,
            },
          }, {
            idempotencyKey: `invitem_guest_${invoiceId}_${li.participantId || 'unknown'}_${li.guestCents}`
          });
        } catch (priceErr: unknown) {
          const errObj = priceErr instanceof Error ? priceErr : null;
          const errType = errObj && 'type' in errObj ? (errObj as Record<string, unknown>).type : undefined;
          const errCode = errObj && 'code' in errObj ? (errObj as Record<string, unknown>).code : undefined;
          const isStalePrice = (errType === 'StripeInvalidRequestError' && (errCode === 'resource_missing' || errCode === 'price_inactive'))
            || (errObj !== null && (errObj.message.includes('No such price') || errObj.message.includes('inactive')));
          if (isIdempotencyKeyReuse(priceErr)) {
            logger.info('[BookingInvoice] Guest line item already exists (idempotency key reuse), skipping', { extra: { invoiceId, participantId: li.participantId } });
          } else if (isStalePrice) {
            const errMsg = errObj ? errObj.message : String(priceErr);
            logger.warn('[BookingInvoice] Stale/inactive guest price ID, falling back to custom amount', { extra: { guestPriceId, error: errMsg } });
            await stripe.invoiceItems.create({
              customer: customerId,
              invoice: invoiceId,
              amount: li.guestCents,
              currency: 'usd',
              description: `Guest fee — ${li.displayName}`,
              metadata: {
                participantId: li.participantId?.toString() || '',
                feeType: 'guest',
                participantType: li.participantType,
              },
            }, {
              idempotencyKey: `invitem_guest_fallback_${invoiceId}_${li.participantId || 'unknown'}_${li.guestCents}`
            });
          } else {
            throw priceErr;
          }
        }
      } else {
        try {
          await stripe.invoiceItems.create({
            customer: customerId,
            invoice: invoiceId,
            amount: li.guestCents,
            currency: 'usd',
            description: `Guest fee — ${li.displayName}`,
            metadata: {
              participantId: li.participantId?.toString() || '',
              feeType: 'guest',
              participantType: li.participantType,
            },
          }, {
            idempotencyKey: `invitem_guest_${invoiceId}_${li.participantId || 'unknown'}_${li.guestCents}`
          });
        } catch (amtErr: unknown) {
          if (isIdempotencyKeyReuse(amtErr)) {
            logger.info('[BookingInvoice] Guest line item already exists (idempotency key reuse), skipping', { extra: { invoiceId, participantId: li.participantId } });
          } else {
            throw amtErr;
          }
        }
      }
    }
  }
}

export function extractPaymentIntentId(invoice: Stripe.Invoice): string | null {
  const rawPi = (invoice as unknown as { payment_intent: string | Stripe.PaymentIntent | null }).payment_intent;
  if (typeof rawPi === 'string') return rawPi;
  if (rawPi && typeof rawPi === 'object' && 'id' in rawPi) return rawPi.id;
  return null;
}

export function computeBalanceApplied(invoice: Stripe.Invoice): number {
  const startingBalance = invoice.starting_balance || 0;
  const endingBalance = invoice.ending_balance || 0;
  return Math.max(0, Math.abs(startingBalance) - Math.abs(endingBalance));
}
  