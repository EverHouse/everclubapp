import Stripe from 'stripe';

export function isExpandedProduct(product: string | Stripe.Product | Stripe.DeletedProduct): product is Stripe.Product {
  return typeof product !== 'string' && 'name' in product;
}

export function isExpandedCustomer(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null): customer is Stripe.Customer {
  return customer !== null && typeof customer !== 'string' && 'email' in customer;
}

export function isExpandedPrice(price: string | Stripe.Price): price is Stripe.Price {
  return typeof price !== 'string';
}

export function getCustomerId(customer: string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined): string | null {
  if (!customer) return null;
  if (typeof customer === 'string') return customer;
  return customer.id;
}

export function getPaymentIntentId(pi: string | Stripe.PaymentIntent | null | undefined): string | null {
  if (!pi) return null;
  if (typeof pi === 'string') return pi;
  return pi.id;
}

export interface SubscriptionPendingUpdate {
  billing_cycle_anchor?: number;
  expires_at?: number;
}
