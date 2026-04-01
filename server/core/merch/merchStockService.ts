import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { invalidateCache } from '../queryCache';

const MERCH_CACHE_KEY = 'merch_items';

export async function restoreMerchStock(cartItems: Array<{ productId?: string; quantity?: number }>, paymentIntentId?: string) {
  const merchCartItems = cartItems.filter(item => item.productId?.startsWith('merch_'));
  if (merchCartItems.length === 0) return;

  if (paymentIntentId) {
    const piCheck = await db.execute(sql`SELECT description FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${paymentIntentId}`);
    if (piCheck.rows.length > 0) {
      const desc = (piCheck.rows[0] as { description?: string })?.description || '';
      if (desc.includes('[stock_restored]')) {
        logger.info('[Merch] Stock already restored for this refund, skipping', { extra: { paymentIntentId } });
        return;
      }
      if (!desc.includes('[stock_deducted]')) {
        logger.warn('[Merch] Stock was never deducted for this payment, skipping restoration to prevent over-counting', { extra: { paymentIntentId } });
        return;
      }
    } else {
      logger.warn('[Merch] No payment intent record found, proceeding with restoration as safety fallback', { extra: { paymentIntentId } });
    }
  }

  const itemMap = new Map<number, number>();
  for (const item of merchCartItems) {
    const merchId = Number(item.productId!.replace('merch_', ''));
    const qty = item.quantity || 1;
    if (!isNaN(merchId)) itemMap.set(merchId, (itemMap.get(merchId) || 0) + qty);
  }
  const validItems = Array.from(itemMap.entries()).map(([merchId, qty]) => ({ merchId, qty }));
  if (validItems.length === 0) return;

  try {
    const valuesClause = sql.join(
      validItems.map(v => sql`(${v.merchId}::int, ${v.qty}::int)`),
      sql`, `
    );
    await db.execute(sql`
      WITH restorations(item_id, qty) AS (VALUES ${valuesClause})
      UPDATE merch_items mi
      SET stock_quantity = mi.stock_quantity + r.qty
      FROM restorations r
      WHERE mi.id = r.item_id AND mi.stock_quantity IS NOT NULL
    `);
  } catch (err: unknown) {
    logger.error('[Merch] Failed to restore stock in bulk', { extra: { items: validItems, error: getErrorMessage(err) } });
  }

  if (paymentIntentId) {
    await db.execute(sql`UPDATE stripe_payment_intents SET description = COALESCE(description, '') || ' [stock_restored]' WHERE stripe_payment_intent_id = ${paymentIntentId}`).catch((err) => {
      logger.warn('[Merch] Failed to mark stock_restored on payment intent', { extra: { paymentIntentId, error: getErrorMessage(err) } });
    });
  }

  invalidateCache(MERCH_CACHE_KEY);
}
