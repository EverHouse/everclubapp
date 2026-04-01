import Stripe from 'stripe';

export interface PromotionCodeWithCoupon extends Stripe.PromotionCode {
  coupon: string | Stripe.Coupon;
}

export interface InvoiceWithExpandedFields extends Stripe.Invoice {
  payment_intent?: string | Stripe.PaymentIntent | null;
  subscription?: string | Stripe.Subscription | null;
}

export interface InvoicePayWithIntent extends Stripe.InvoicePayParams {
  payment_intent?: string;
}

export interface LegacyPromotionCodeCreateParams {
  coupon: string;
  code?: string;
  active?: boolean;
  metadata?: Record<string, string>;
}
