import { Router } from 'express';
import { isStaffOrAdmin } from '../../core/middleware';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';

const router = Router();

router.get('/api/admin/applications', isStaffOrAdmin, async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT 
        fs.id, fs.first_name, fs.last_name, fs.email, fs.phone,
        fs.message, fs.metadata, fs.status, fs.notes,
        fs.created_at, fs.updated_at,
        u.id as user_id, u.membership_status, u.tier, u.first_login_at
      FROM form_submissions fs
      LEFT JOIN users u ON LOWER(u.email) = LOWER(fs.email)
      WHERE fs.form_type = 'membership'
      ORDER BY 
        CASE fs.status 
          WHEN 'new' THEN 1
          WHEN 'read' THEN 2
          WHEN 'reviewing' THEN 3
          WHEN 'approved' THEN 4
          WHEN 'invited' THEN 5
          WHEN 'converted' THEN 6
          WHEN 'declined' THEN 7
          WHEN 'archived' THEN 8
        END,
        fs.created_at DESC
      LIMIT 500
    `);

    res.json(result.rows);
  } catch (error: unknown) {
    logger.error('[Applications] Failed to fetch pipeline', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

router.put('/api/admin/applications/:id/status', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;

    const validStatuses = ['new', 'read', 'reviewing', 'approved', 'invited', 'converted', 'declined', 'archived'];

    if (status !== undefined && !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    if (!status && notes === undefined) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    if (status) {
      await db.execute(sql`UPDATE form_submissions SET status = ${status}, notes = COALESCE(${notes || null}, notes), updated_at = NOW() WHERE id = ${id} AND form_type = 'membership'`);
    } else {
      await db.execute(sql`UPDATE form_submissions SET notes = ${notes || null}, updated_at = NOW() WHERE id = ${id} AND form_type = 'membership'`);
    }

    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('[Applications] Failed to update status', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to update application status' });
  }
});

router.post('/api/admin/applications/:id/send-invite', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { tierId } = req.body;

    if (!tierId) return res.status(400).json({ error: 'Tier ID required' });

    const parsedTierId = Number(tierId);
    if (!Number.isInteger(parsedTierId) || parsedTierId <= 0) {
      return res.status(400).json({ error: 'Invalid tier ID' });
    }

    const appResult = await db.execute(sql`SELECT id, email, first_name, last_name FROM form_submissions WHERE id = ${id} AND form_type = 'membership'`);

    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: 'Application not found' });
    }

    const app = appResult.rows[0] as { id: number; email: string; first_name: string | null; last_name: string | null };

    const { createMembershipInvite } = await import('../../core/membershipInviteService');
    const result = await createMembershipInvite({
      email: String(app.email).trim().toLowerCase(),
      firstName: app.first_name || '',
      lastName: app.last_name || '',
      tierId: parsedTierId,
    });

    if (!result.success) {
      const statusMap: Record<string, number> = {
        TIER_NOT_FOUND: 404,
        NO_STRIPE_PRICE: 400,
        CHECKOUT_FAILED: 500,
        STRIPE_ERROR: 500,
      };
      const status = (result.errorCode && statusMap[result.errorCode]) || 500;
      return res.status(status).json({ error: result.error });
    }

    await db.execute(sql`UPDATE form_submissions SET status = 'invited', updated_at = NOW() WHERE id = ${id}`);

    res.json({ success: true, checkoutUrl: result.checkoutUrl });
  } catch (error: unknown) {
    logger.error('[Applications] Failed to send invite', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

export default router;
