import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { pool } from '../core/db';

const router = Router();

interface RecentTransaction {
  id: string;
  type: 'offline' | 'stripe' | 'day_pass';
  amount_cents: number;
  description: string;
  member_email: string;
  member_name: string;
  created_at: Date;
  status: string;
}

/**
 * GET /api/financials/recent-transactions
 * Returns unified recent transactions from offline payments, stripe payments, and day passes
 * Requires staff authentication
 */
router.get('/api/financials/recent-transactions', isStaffOrAdmin, async (req: Request, res: Response) => {
  try {
    const query = `
      SELECT 
        'offline' as type, id::text, amount_cents, description, member_email, 
        COALESCE(member_name, 'Unknown') as member_name, created_at, 'completed' as status
      FROM offline_payments
      UNION ALL
      SELECT 
        'stripe' as type, stripe_payment_intent_id as id, amount as amount_cents, description, member_email,
        COALESCE(member_name, 'Unknown') as member_name, created_at, status
      FROM stripe_payment_intents WHERE status = 'succeeded'
      UNION ALL
      SELECT 
        'day_pass' as type, id::text, price_cents as amount_cents, 'Day Pass' as description, email as member_email,
        COALESCE(purchaser_first_name || ' ' || purchaser_last_name, email) as member_name, purchased_at as created_at, 'completed' as status
      FROM day_passes WHERE status = 'active'
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const result = await pool.query(query);
    const transactions: RecentTransaction[] = result.rows.map(row => ({
      id: row.id,
      type: row.type,
      amount_cents: parseInt(row.amount_cents),
      description: row.description,
      member_email: row.member_email,
      member_name: row.member_name,
      created_at: new Date(row.created_at),
      status: row.status
    }));

    res.json({
      success: true,
      count: transactions.length,
      transactions
    });
  } catch (error: any) {
    console.error('[Financials] Error fetching recent transactions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch recent transactions'
    });
  }
});

export default router;
