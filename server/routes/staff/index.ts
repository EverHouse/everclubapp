import { Router } from 'express';
import { pool } from '../../core/db';
import { isStaffOrAdmin } from '../../core/middleware';
import { getPacificMidnightUTC } from '../../utils/dateUtils';

const router = Router();

/**
 * GET /api/admin/dashboard-summary
 * Returns summary data for the admin dashboard home page
 * Used for prefetching to speed up dashboard load
 */
router.get('/api/admin/dashboard-summary', isStaffOrAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    
    // Parallel queries for dashboard summary
    const [pendingBookings, todaysBookings, activeMembers, pendingTours] = await Promise.all([
      pool.query(`
        SELECT COUNT(*) as count 
        FROM booking_requests 
        WHERE status = 'pending'
      `),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM booking_requests 
        WHERE booking_date = $1 AND status = 'approved'
      `, [today]),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM users 
        WHERE membership_status = 'active' AND archived_at IS NULL
      `),
      pool.query(`
        SELECT COUNT(*) as count 
        FROM tours 
        WHERE status = 'pending'
      `)
    ]);
    
    res.json({
      pendingBookingsCount: parseInt(pendingBookings.rows[0]?.count || '0'),
      todaysBookingsCount: parseInt(todaysBookings.rows[0]?.count || '0'),
      activeMembersCount: parseInt(activeMembers.rows[0]?.count || '0'),
      pendingToursCount: parseInt(pendingTours.rows[0]?.count || '0'),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching dashboard summary:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard summary' });
  }
});

/**
 * GET /api/admin/financials/summary
 * Returns summary financial data for the financials tab
 * Used for prefetching to speed up financials page load
 */
router.get('/api/admin/financials/summary', isStaffOrAdmin, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const startOfDay = Math.floor(getPacificMidnightUTC(today).getTime() / 1000);
    const endOfDay = startOfDay + 86400;
    
    // Parallel queries for financials summary
    const [todayRevenue, overdueCount, failedPayments, pendingAuths] = await Promise.all([
      pool.query(`
        SELECT COALESCE(SUM(amount_cents), 0) as total_cents
        FROM stripe_transaction_cache
        WHERE status IN ('succeeded', 'paid')
        AND created_at >= to_timestamp($1)
        AND created_at < to_timestamp($2)
      `, [startOfDay, endOfDay]),
      pool.query(`
        SELECT COUNT(DISTINCT bs.booking_id) as count
        FROM booking_sessions bs
        JOIN booking_requests br ON br.id = bs.booking_id
        WHERE bs.payment_status IN ('outstanding', 'partially_paid')
        AND bs.cancelled_at IS NULL
        AND bs.fee_status = 'finalized'
        AND br.status NOT IN ('cancelled', 'declined')
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM failed_payments
        WHERE status = 'pending_retry' OR status = 'requires_card_update'
      `),
      pool.query(`
        SELECT COUNT(*) as count
        FROM pending_authorizations
        WHERE expires_at > NOW()
      `)
    ]);
    
    res.json({
      todayRevenueCents: parseInt(todayRevenue.rows[0]?.total_cents || '0'),
      overduePaymentsCount: parseInt(overdueCount.rows[0]?.count || '0'),
      failedPaymentsCount: parseInt(failedPayments.rows[0]?.count || '0'),
      pendingAuthorizationsCount: parseInt(pendingAuths.rows[0]?.count || '0'),
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Error fetching financials summary:', error);
    res.status(500).json({ error: 'Failed to fetch financials summary' });
  }
});

router.get('/api/staff/list', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT su.id, su.email, su.first_name, su.last_name, su.role,
             u.id as user_id
      FROM staff_users su
      INNER JOIN users u ON LOWER(u.email) = LOWER(su.email)
      WHERE su.is_active = true AND u.archived_at IS NULL
      ORDER BY 
        CASE su.role 
          WHEN 'golf_instructor' THEN 1 
          WHEN 'admin' THEN 2 
          WHEN 'staff' THEN 3 
          ELSE 4 
        END,
        su.first_name
    `);
    res.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching staff list:', error);
    res.status(500).json({ error: 'Failed to fetch staff list' });
  }
});

router.get('/api/directory/team', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        su.id as staff_id,
        su.email,
        su.first_name,
        su.last_name,
        su.phone,
        su.job_title,
        su.role,
        su.is_active,
        u.id as user_id,
        u.tier,
        u.membership_status,
        u.stripe_customer_id,
        u.hubspot_id
      FROM staff_users su
      LEFT JOIN users u ON LOWER(u.email) = LOWER(su.email)
      WHERE su.is_active = true
      ORDER BY 
        CASE su.role 
          WHEN 'golf_instructor' THEN 1 
          WHEN 'admin' THEN 2 
          WHEN 'staff' THEN 3 
          ELSE 4 
        END,
        su.first_name,
        su.last_name
    `);
    res.json(result.rows);
  } catch (error: any) {
    console.error('Error fetching directory team:', error);
    res.status(500).json({ error: 'Failed to fetch team directory' });
  }
});

export default router;
