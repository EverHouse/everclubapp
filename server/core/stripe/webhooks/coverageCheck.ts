import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

function resolveDispatcherPath(): string {
  const candidates = [
    path.resolve(process.cwd(), 'server/core/stripe/webhooks/index.ts'),
  ];
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    candidates.push(path.resolve(currentDir, './index.ts'));
  } catch {}
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

export const EXPECTED_WEBHOOK_EVENTS: string[] = [
  'payment_intent.created',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',

  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.closed',
  'charge.dispute.updated',

  'invoice.created',
  'invoice.finalized',
  'invoice.updated',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.voided',
  'invoice.marked_uncollectible',
  'invoice.payment_action_required',
  'invoice.overdue',

  'checkout.session.completed',
  'checkout.session.expired',
  'checkout.session.async_payment_failed',
  'checkout.session.async_payment_succeeded',

  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.paused',
  'customer.subscription.resumed',
  'customer.subscription.deleted',
  'customer.subscription.trial_will_end',

  'subscription_schedule.created',
  'subscription_schedule.updated',
  'subscription_schedule.canceled',

  'product.updated',
  'product.created',
  'product.deleted',

  'price.updated',
  'price.created',
  'price.deleted',

  'coupon.updated',
  'coupon.created',
  'coupon.deleted',

  'credit_note.created',

  'customer.created',
  'customer.updated',
  'customer.deleted',

  'payment_method.attached',
  'payment_method.detached',
  'payment_method.updated',
  'payment_method.automatically_updated',

  'setup_intent.succeeded',
  'setup_intent.setup_failed',
];

export interface CoverageResult {
  handledCount: number;
  expectedCount: number;
  unhandledExpected: string[];
  unexpectedHandled: string[];
  handledTypes: string[];
}

function extractHandledEventTypes(source: string): string[] {
  const eventTypes: string[] = [];

  const ifPattern = /eventType\s*===\s*'([^']+)'/g;
  let match: RegExpExecArray | null;
  while ((match = ifPattern.exec(source)) !== null) {
    eventTypes.push(match[1]);
  }

  const orPattern = /eventType\s*===\s*'([^']+)'\s*\|\|\s*eventType\s*===\s*'([^']+)'/g;
  while ((match = orPattern.exec(source)) !== null) {
    if (!eventTypes.includes(match[1])) eventTypes.push(match[1]);
    if (!eventTypes.includes(match[2])) eventTypes.push(match[2]);
  }

  return [...new Set(eventTypes)].sort();
}

export function checkWebhookCoverage(dispatcherPath?: string): CoverageResult {
  const filePath = dispatcherPath || resolveDispatcherPath();

  if (!fs.existsSync(filePath)) {
    throw new Error(`Webhook dispatcher not found at ${filePath}`);
  }

  const source = fs.readFileSync(filePath, 'utf-8');
  const handledTypes = extractHandledEventTypes(source);

  const unhandledExpected = EXPECTED_WEBHOOK_EVENTS.filter(e => !handledTypes.includes(e));
  const unexpectedHandled = handledTypes.filter(e => !EXPECTED_WEBHOOK_EVENTS.includes(e));

  return {
    handledCount: handledTypes.length,
    expectedCount: EXPECTED_WEBHOOK_EVENTS.length,
    unhandledExpected,
    unexpectedHandled,
    handledTypes,
  };
}
