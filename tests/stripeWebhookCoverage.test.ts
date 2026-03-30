// @vitest-environment node
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const WEBHOOK_DISPATCHER_PATH = path.resolve(__dirname, '../server/core/stripe/webhooks/index.ts');

function extractHandledEventTypes(source: string): string[] {
  const eventTypes: string[] = [];

  const ifPattern = /eventType\s*===\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = ifPattern.exec(source)) !== null) {
    eventTypes.push(match[1]);
  }

  return [...new Set(eventTypes)].sort();
}

describe('Stripe webhook event coverage', () => {
  const source = fs.readFileSync(WEBHOOK_DISPATCHER_PATH, 'utf-8');
  const handledTypes = extractHandledEventTypes(source);

  it('should handle payment_intent.succeeded', () => {
    expect(handledTypes).toContain('payment_intent.succeeded');
  });

  it('should handle payment_intent.payment_failed', () => {
    expect(handledTypes).toContain('payment_intent.payment_failed');
  });

  it('should handle payment_intent.canceled', () => {
    expect(handledTypes).toContain('payment_intent.canceled');
  });

  it('should handle charge.refunded', () => {
    expect(handledTypes).toContain('charge.refunded');
  });

  it('should handle charge.dispute.created', () => {
    expect(handledTypes).toContain('charge.dispute.created');
  });

  it('should handle charge.dispute.closed', () => {
    expect(handledTypes).toContain('charge.dispute.closed');
  });

  it('should handle charge.dispute.updated', () => {
    expect(handledTypes).toContain('charge.dispute.updated');
  });

  it('should handle invoice.payment_succeeded', () => {
    expect(handledTypes).toContain('invoice.payment_succeeded');
  });

  it('should handle invoice.payment_failed', () => {
    expect(handledTypes).toContain('invoice.payment_failed');
  });

  it('should handle invoice.created', () => {
    expect(handledTypes).toContain('invoice.created');
  });

  it('should handle invoice.finalized', () => {
    expect(handledTypes).toContain('invoice.finalized');
  });

  it('should handle invoice.voided', () => {
    expect(handledTypes).toContain('invoice.voided');
  });

  it('should handle invoice.overdue', () => {
    expect(handledTypes).toContain('invoice.overdue');
  });

  it('should handle checkout.session.completed', () => {
    expect(handledTypes).toContain('checkout.session.completed');
  });

  it('should handle checkout.session.expired', () => {
    expect(handledTypes).toContain('checkout.session.expired');
  });

  it('should handle customer.subscription.created', () => {
    expect(handledTypes).toContain('customer.subscription.created');
  });

  it('should handle customer.subscription.updated', () => {
    expect(handledTypes).toContain('customer.subscription.updated');
  });

  it('should handle customer.subscription.deleted', () => {
    expect(handledTypes).toContain('customer.subscription.deleted');
  });

  it('should handle customer.subscription.paused', () => {
    expect(handledTypes).toContain('customer.subscription.paused');
  });

  it('should handle customer.subscription.resumed', () => {
    expect(handledTypes).toContain('customer.subscription.resumed');
  });

  it('should handle customer.subscription.trial_will_end', () => {
    expect(handledTypes).toContain('customer.subscription.trial_will_end');
  });

  it('should handle product lifecycle events', () => {
    expect(handledTypes).toContain('product.created');
    expect(handledTypes).toContain('product.updated');
    expect(handledTypes).toContain('product.deleted');
  });

  it('should handle price lifecycle events', () => {
    expect(handledTypes).toContain('price.created');
    expect(handledTypes).toContain('price.updated');
    expect(handledTypes).toContain('price.deleted');
  });

  it('should handle coupon events', () => {
    expect(handledTypes).toContain('coupon.created');
    expect(handledTypes).toContain('coupon.updated');
    expect(handledTypes).toContain('coupon.deleted');
  });

  it('should handle credit_note.created', () => {
    expect(handledTypes).toContain('credit_note.created');
  });

  it('should handle customer lifecycle events', () => {
    expect(handledTypes).toContain('customer.created');
    expect(handledTypes).toContain('customer.updated');
    expect(handledTypes).toContain('customer.deleted');
  });

  it('should handle payment method events', () => {
    expect(handledTypes).toContain('payment_method.attached');
    expect(handledTypes).toContain('payment_method.detached');
    expect(handledTypes).toContain('payment_method.updated');
    expect(handledTypes).toContain('payment_method.automatically_updated');
  });

  it('should handle setup intent events', () => {
    expect(handledTypes).toContain('setup_intent.succeeded');
    expect(handledTypes).toContain('setup_intent.setup_failed');
  });

  it('should handle subscription schedule events', () => {
    expect(handledTypes).toContain('subscription_schedule.created');
    expect(handledTypes).toContain('subscription_schedule.updated');
    expect(handledTypes).toContain('subscription_schedule.canceled');
  });

  it('should handle at least 40 event types total', () => {
    expect(handledTypes.length).toBeGreaterThanOrEqual(40);
  });
});
