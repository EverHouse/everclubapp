import { Router } from 'express';
import { z } from 'zod';
import { isStaffOrAdmin } from '../core/middleware';
import { logFromRequest } from '../core/auditLog';
import { logger } from '../core/logger';
import { getErrorMessage, isStripeResourceMissing } from '../utils/errorUtils';
import { db } from '../db';
import { merchItems } from '../../shared/schema';
import { sql, eq, and, asc } from 'drizzle-orm';
import { getCached, setCache, invalidateCache } from '../core/queryCache';
import { validateBody } from '../middleware/validate';
import { autoPushMerchItemToStripe } from '../core/stripe/autoPush';
import { markAppOriginated } from '../core/stripe/appOriginTracker';

const merchItemSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  description: z.string().optional().default(''),
  type: z.string().min(1, 'Type is required').default('Apparel'),
  icon: z.string().optional().default(''),
  image_url: z.string().optional().default(''),
  is_active: z.boolean().optional().default(true),
  sort_order: z.number().int().optional().default(0),
  stock_quantity: z.number().int().min(0).optional().nullable(),
});

const merchItemUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  price: z.union([z.string(), z.number()]).optional().nullable(),
  description: z.string().optional(),
  type: z.string().min(1).optional(),
  icon: z.string().optional(),
  image_url: z.string().optional(),
  is_active: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  stock_quantity: z.number().int().min(0).optional().nullable(),
});

const MERCH_CACHE_KEY = 'merch_items';
const MERCH_CACHE_TTL = 60_000;

const router = Router();

router.get('/api/merch', async (req, res) => {
  try {
    const { include_inactive } = req.query;
    const sessionUser = (req.session as Record<string, unknown>)?.user as Record<string, unknown> | undefined;
    const userRole = sessionUser?.role as string | undefined;
    const isStaffOrAdminUser = userRole === 'admin' || userRole === 'staff';
    const showInactive = include_inactive === 'true' && isStaffOrAdminUser;

    if (showInactive) {
      res.set('Cache-Control', 'no-store');
    }

    if (!showInactive) {
      const cached = getCached<unknown[]>(MERCH_CACHE_KEY);
      if (cached) {
        res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
        return res.json(cached);
      }
    }

    const conditions = [];
    if (!showInactive) {
      conditions.push(eq(merchItems.isActive, true));
    }

    const result = await db.select().from(merchItems)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(merchItems.sortOrder), asc(merchItems.type), asc(merchItems.name))
      .limit(500);

    if (!showInactive) {
      setCache(MERCH_CACHE_KEY, result, MERCH_CACHE_TTL);
    }

    res.set('Cache-Control', 'private, max-age=60, stale-while-revalidate=300');
    res.json(result);
  } catch (error: unknown) {
    logger.error('Merch items error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch merch items' });
  }
});

router.post('/api/merch', isStaffOrAdmin, validateBody(merchItemSchema), async (req, res) => {
  try {
    const { name, price, description, type, icon, image_url, is_active, sort_order, stock_quantity } = req.body;

    const parsedPrice = parseFloat(String(price ?? 0));
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      return res.status(400).json({ error: 'Price must be a valid non-negative number' });
    }

    const result = await db.insert(merchItems).values({
      name,
      price: String(parsedPrice || 0),
      description: description || '',
      type: type || 'Apparel',
      icon: icon || '',
      imageUrl: image_url || '',
      isActive: is_active !== false,
      sortOrder: sort_order || 0,
      stockQuantity: stock_quantity ?? null,
    }).returning();

    const newItem = result[0];

    let synced = false;
    let syncError: string | undefined;
    try {
      const pushResult = await autoPushMerchItemToStripe({
        id: newItem.id,
        name: newItem.name,
        description: newItem.description,
        price: String(newItem.price),
        type: newItem.type,
        imageUrl: newItem.imageUrl,
        isActive: newItem.isActive ?? true,
        stockQuantity: newItem.stockQuantity ?? 0,
        stripeProductId: null,
        stripePriceId: null,
      });
      synced = pushResult.success;
      if (!pushResult.success) {
        syncError = pushResult.error || 'Stripe sync failed';
        logger.error('[AutoPush] Merch item creation push failed', { extra: { error: getErrorMessage(syncError) } });
      }
    } catch (err) {
      syncError = getErrorMessage(err);
      logger.error('[AutoPush] Merch item creation push exception', { extra: { error: getErrorMessage(syncError) } });
    }

    invalidateCache(MERCH_CACHE_KEY);
    logFromRequest(req, 'create_merch_item', 'merch', String(newItem.id), newItem.name || name, {});
    res.status(201).json({ ...newItem, synced, syncError });
  } catch (error: unknown) {
    logger.error('Merch item creation error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to create merch item' });
  }
});

router.put('/api/merch/:id', isStaffOrAdmin, validateBody(merchItemUpdateSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);
    if (isNaN(numericId)) {
      return res.status(400).json({ error: 'Invalid merch item ID: must be a number' });
    }
    const { name, price, description, type, icon, image_url, is_active, sort_order, stock_quantity } = req.body;

    if (price !== undefined && price !== null) {
      const numericPrice = Number(price);
      if (isNaN(numericPrice) || numericPrice < 0) {
        return res.status(400).json({ error: 'Invalid price: must be a non-negative number' });
      }
    }

    const existing = await db.select({ id: merchItems.id })
      .from(merchItems)
      .where(eq(merchItems.id, numericId));
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Merch item not found' });
    }

    const result = await db.update(merchItems).set({
      name: sql`COALESCE(${name}, ${merchItems.name})`,
      price: sql`COALESCE(${price}, ${merchItems.price})`,
      description: sql`COALESCE(${description}, ${merchItems.description})`,
      type: sql`COALESCE(${type}, ${merchItems.type})`,
      icon: sql`COALESCE(${icon}, ${merchItems.icon})`,
      imageUrl: sql`COALESCE(${image_url}, ${merchItems.imageUrl})`,
      isActive: sql`COALESCE(${is_active}, ${merchItems.isActive})`,
      stockQuantity: sql`COALESCE(${stock_quantity}, ${merchItems.stockQuantity})`,
      sortOrder: sql`COALESCE(${sort_order}, ${merchItems.sortOrder})`,
    }).where(eq(merchItems.id, numericId)).returning();

    const updatedItem = result[0];

    let synced = false;
    let syncError: string | undefined;
    try {
      const pushResult = await autoPushMerchItemToStripe({
        id: updatedItem.id,
        name: updatedItem.name,
        description: updatedItem.description,
        price: String(updatedItem.price),
        type: updatedItem.type,
        imageUrl: updatedItem.imageUrl,
        isActive: updatedItem.isActive ?? true,
        stockQuantity: updatedItem.stockQuantity ?? 0,
        stripeProductId: updatedItem.stripeProductId,
        stripePriceId: updatedItem.stripePriceId,
      });
      synced = pushResult.success;
      if (!pushResult.success) {
        syncError = pushResult.error || 'Stripe sync failed';
        logger.error('[AutoPush] Merch item push failed', { extra: { error: getErrorMessage(syncError) } });
      }
    } catch (err) {
      syncError = getErrorMessage(err);
      logger.error('[AutoPush] Merch item push exception', { extra: { error: getErrorMessage(syncError) } });
    }

    invalidateCache(MERCH_CACHE_KEY);
    logFromRequest(req, 'update_merch_item', 'merch', String(id), name, {});
    res.json({ ...updatedItem, synced, syncError });
  } catch (error: unknown) {
    logger.error('Merch item update error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to update merch item' });
  }
});

router.delete('/api/merch/:id', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const numericId = Number(id);
    if (isNaN(numericId)) {
      return res.status(400).json({ error: 'Invalid merch item ID: must be a number' });
    }

    const existing = await db.select({ stripeProductId: merchItems.stripeProductId, name: merchItems.name, isActive: merchItems.isActive })
      .from(merchItems)
      .where(eq(merchItems.id, numericId));
    if (existing.length === 0) {
      return res.json({ success: true, alreadyDeleted: true });
    }

    if (existing[0].stripeProductId) {
      try {
        const { getStripeClient } = await import('../core/stripe/client');
        const stripe = await getStripeClient();
        const product = await stripe.products.retrieve(existing[0].stripeProductId) as unknown as { active?: boolean; deleted?: boolean };
        if (product && !product.deleted && product.active) {
          markAppOriginated(existing[0].stripeProductId);
          await stripe.products.update(existing[0].stripeProductId, { active: false });
          logger.info(`[Merch] Archived Stripe product ${existing[0].stripeProductId} for merch item "${existing[0].name}"`);
        }
      } catch (stripeErr: unknown) {
        if (isStripeResourceMissing(stripeErr)) {
          logger.info(`[Merch] Stripe product ${existing[0].stripeProductId} not found — proceeding with delete`);
        } else {
          logger.warn(`[Merch] Could not archive Stripe product ${existing[0].stripeProductId} — proceeding with delete anyway`, { extra: { error: getErrorMessage(stripeErr) } });
        }
      }
    }

    await db.delete(merchItems).where(eq(merchItems.id, numericId));
    invalidateCache(MERCH_CACHE_KEY);
    logFromRequest(req, 'delete_merch_item', 'merch', String(id), existing[0].name || undefined, {});
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('Merch item delete error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to delete merch item' });
  }
});

export async function deductMerchStock(cartItems: Array<{ productId?: string; quantity?: number }>, paymentIntentId?: string) {
  const merchCartItems = cartItems.filter(item => item.productId?.startsWith('merch_'));
  if (merchCartItems.length === 0) return;

  if (paymentIntentId) {
    const existing = await db.execute(sql`SELECT 1 FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${paymentIntentId} AND description LIKE '%[stock_deducted]%'`);
    if (existing.rows.length > 0) {
      logger.info('[Merch] Stock already deducted for this payment, skipping', { extra: { paymentIntentId } });
      return;
    }
  }

  let anyDeducted = false;
  for (const item of merchCartItems) {
    const merchId = Number(item.productId!.replace('merch_', ''));
    const qty = item.quantity || 1;
    if (isNaN(merchId)) continue;

    try {
      const result = await db.execute(sql`
        UPDATE merch_items 
        SET stock_quantity = GREATEST(stock_quantity - ${qty}, 0)
        WHERE id = ${merchId} AND stock_quantity IS NOT NULL AND stock_quantity >= ${qty}
      `);
      if (result.rowCount === 0) {
        const check = await db.execute(sql`SELECT stock_quantity FROM merch_items WHERE id = ${merchId}`);
        const currentStock = (check.rows[0] as { stock_quantity: number | null } | undefined)?.stock_quantity;
        if (currentStock === null) {
          logger.info('[Merch] Stock is unlimited (null) for merch item, no deduction needed', { extra: { merchId } });
        } else {
          logger.warn('[Merch] Insufficient stock for deduction', { extra: { merchId, requestedQty: qty, currentStock } });
        }
      } else {
        anyDeducted = true;
      }
    } catch (err: unknown) {
      logger.error('[Merch] Failed to deduct stock', { extra: { merchId, qty, error: getErrorMessage(err) } });
    }
  }

  if (paymentIntentId && anyDeducted) {
    await db.execute(sql`UPDATE stripe_payment_intents SET description = COALESCE(description, '') || ' [stock_deducted]' WHERE stripe_payment_intent_id = ${paymentIntentId}`).catch((err) => {
      logger.warn('[Merch] Failed to mark stock_deducted on payment intent', { extra: { paymentIntentId, error: getErrorMessage(err) } });
    });
  }

  invalidateCache(MERCH_CACHE_KEY);
}

export { restoreMerchStock } from '../core/merch/merchStockService';

export default router;
