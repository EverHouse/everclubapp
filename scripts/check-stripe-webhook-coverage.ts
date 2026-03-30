import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEBHOOK_DISPATCHER_PATH = path.resolve(__dirname, '../server/core/stripe/webhooks/index.ts');

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

const EXPECTED_WEBHOOK_EVENTS: string[] = [
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

function main(): void {
  if (!fs.existsSync(WEBHOOK_DISPATCHER_PATH)) {
    console.error(`ERROR: Webhook dispatcher not found at ${WEBHOOK_DISPATCHER_PATH}`);
    process.exit(1);
  }

  const source = fs.readFileSync(WEBHOOK_DISPATCHER_PATH, 'utf-8');
  const handledTypes = extractHandledEventTypes(source);

  console.log(`\n=== Stripe Webhook Coverage Check ===\n`);
  console.log(`Handled event types in dispatcher: ${handledTypes.length}`);
  console.log(`Expected event types: ${EXPECTED_WEBHOOK_EVENTS.length}\n`);

  const unhandledExpected = EXPECTED_WEBHOOK_EVENTS.filter(e => !handledTypes.includes(e));
  const unexpectedHandled = handledTypes.filter(e => !EXPECTED_WEBHOOK_EVENTS.includes(e));

  let hasIssues = false;

  if (unhandledExpected.length > 0) {
    hasIssues = true;
    console.log(`MISSING HANDLERS (${unhandledExpected.length} expected events not handled in dispatcher):`);
    for (const eventType of unhandledExpected) {
      console.log(`  - ${eventType}`);
    }
    console.log();
  }

  if (unexpectedHandled.length > 0) {
    console.log(`EXTRA HANDLERS (${unexpectedHandled.length} handled events not in expected list):`);
    for (const eventType of unexpectedHandled) {
      console.log(`  + ${eventType}`);
    }
    console.log();
  }

  if (!hasIssues) {
    console.log('All expected Stripe webhook event types are handled.\n');
  }

  console.log('--- Handled event types ---');
  for (const eventType of handledTypes) {
    const status = EXPECTED_WEBHOOK_EVENTS.includes(eventType) ? '✓' : '?';
    console.log(`  ${status} ${eventType}`);
  }
  console.log();

  if (unhandledExpected.length > 0) {
    console.error(`FAIL: ${unhandledExpected.length} expected webhook event type(s) are not handled.`);
    process.exit(1);
  }

  console.log('PASS: Stripe webhook coverage check passed.');
}

main();
