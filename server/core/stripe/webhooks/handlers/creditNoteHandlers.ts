import Stripe from 'stripe';
  import { db } from '../../../../db';
  import { sql } from 'drizzle-orm';
  import { logger } from '../../../logger';
  import type { PoolClient } from 'pg';
  import type { DeferredAction } from '../types';
  import { upsertTransactionCache } from '../framework';
  import { getErrorMessage } from '../../../../utils/errorUtils';
  
export async function handleCreditNoteCreated(client: PoolClient, creditNote: Stripe.CreditNote): Promise<DeferredAction[]> {
  const deferredActions: DeferredAction[] = [];
  
  const { id, number, invoice, customer, total, currency, status, created, reason, memo, lines: _lines } = creditNote;
  
  logger.info(`[Stripe Webhook] Credit note created: ${id} (${number}), total: $${(total / 100).toFixed(2)}, reason: ${reason || 'none'}`);
  
  const customerId = typeof customer === 'string' ? customer : customer?.id;
  const invoiceId = typeof invoice === 'string' ? invoice : invoice?.id;
  
  deferredActions.push(async () => {
    await upsertTransactionCache({
      stripeId: id,
      objectType: 'refund',
      amountCents: total,
      currency: currency || 'usd',
      status: status || 'issued',
      createdAt: new Date(created * 1000),
      customerId,
      invoiceId,
      description: memo ?? `Credit note ${number ?? id}`,
      metadata: { type: 'credit_note', reason: reason ?? '', number: number ?? '' },
      source: 'webhook',
    });
  });
  
  if (customerId) {
    const memberResult = await client.query(
      `SELECT email, COALESCE(NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''), email) AS display_name FROM users WHERE stripe_customer_id = $1 LIMIT 1`,
      [customerId]
    );
    
    if (memberResult.rows.length > 0) {
      const member = memberResult.rows[0];
      const amountStr = `$${(total / 100).toFixed(2)}`;
      
      deferredActions.push(async () => {
        try {
          await db.execute(
            sql`INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
             VALUES (${member.email.toLowerCase()}, ${'Credit Applied'}, ${`A credit of ${amountStr} has been applied to your account${reason ? ` (${reason.replace(/_/g, ' ')})` : ''}.`}, ${'billing'}, ${'payment'}, NOW())`
          );
        } catch (err: unknown) {
          logger.error('[Stripe Webhook] Failed to create credit note notification:', { extra: { error: getErrorMessage(err) } });
        }
      });
      
      logger.info(`[Stripe Webhook] Credit note ${id} for member ${member.email}: ${amountStr}`);
    }
  }
  
  return deferredActions;
}
