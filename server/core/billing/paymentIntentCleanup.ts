import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { cancelPaymentIntent } from '../stripe';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';

export async function cancelPendingPaymentIntentsForBooking(bookingId: number): Promise<void> {
  try {
    const pendingIntents = await db.execute(
      sql`SELECT stripe_payment_intent_id 
       FROM stripe_payment_intents 
       WHERE booking_id = ${bookingId} AND status IN ('pending', 'requires_payment_method', 'requires_action', 'requires_confirmation', 'requires_capture')`
    );
    for (const row of pendingIntents.rows) {
      try {
        await cancelPaymentIntent(row.stripe_payment_intent_id as string);
        logger.info(`Cancelled payment intent ${row.stripe_payment_intent_id}`);
      } catch (cancelErr: unknown) {
        logger.warn(`Failed to cancel payment intent ${row.stripe_payment_intent_id}: ${getErrorMessage(cancelErr)}`);
      }
    }
  } catch (e: unknown) {
    logger.warn('[Payment Intent Cleanup] Non-critical cleanup failed:', e);
  }
}
