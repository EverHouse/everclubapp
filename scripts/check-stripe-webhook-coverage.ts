import * as path from 'path';
import { fileURLToPath } from 'url';
import { checkWebhookCoverage } from '../server/core/stripe/webhooks/coverageCheck';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WEBHOOK_DISPATCHER_PATH = path.resolve(__dirname, '../server/core/stripe/webhooks/index.ts');

function main(): void {
  let result;
  try {
    result = checkWebhookCoverage(WEBHOOK_DISPATCHER_PATH);
  } catch (err) {
    console.error(`ERROR: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`\n=== Stripe Webhook Coverage Check ===\n`);
  console.log(`Handled event types in dispatcher: ${result.handledCount}`);
  console.log(`Expected event types: ${result.expectedCount}\n`);

  if (result.unhandledExpected.length > 0) {
    console.warn(`WARNING: MISSING HANDLERS (${result.unhandledExpected.length} expected events not handled in dispatcher):`);
    for (const eventType of result.unhandledExpected) {
      console.warn(`  - ${eventType}`);
    }
    console.log();
  }

  if (result.unexpectedHandled.length > 0) {
    console.log(`EXTRA HANDLERS (${result.unexpectedHandled.length} handled events not in expected list):`);
    for (const eventType of result.unexpectedHandled) {
      console.log(`  + ${eventType}`);
    }
    console.log();
  }

  if (result.unhandledExpected.length === 0 && result.unexpectedHandled.length === 0) {
    console.log('All expected Stripe webhook event types are handled.\n');
  }

  console.log('--- Handled event types ---');
  for (const eventType of result.handledTypes) {
    const expected = result.unexpectedHandled.includes(eventType) ? '?' : '✓';
    console.log(`  ${expected} ${eventType}`);
  }
  console.log();

  if (result.unhandledExpected.length > 0) {
    console.warn(`WARNING: ${result.unhandledExpected.length} expected webhook event type(s) are not handled. This may be intentional — review and add handlers if needed.`);
  } else {
    console.log('PASS: Stripe webhook coverage check passed.');
  }
}

main();
