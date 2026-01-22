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

export interface SubscriptionPendingUpdate {
  billing_cycle_anchor?: number;
  expires_at?: number;
}
