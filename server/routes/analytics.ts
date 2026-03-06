import { Router, Request, Response } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

const router = Router();

router.get('/api/analytics/booking-stats', isStaffOrAdmin, async (_req: Request, res: Response) => {
  try {
    const peakHoursResult = await db.execute(sql`
      SELECT
        EXTRACT(DOW FROM request_date::date) AS day_of_week,
        EXTRACT(HOUR FROM start_time::time) AS hour_of_day,
        COUNT(*)::int AS booking_count
      FROM booking_requests
      WHERE status NOT IN ('cancelled', 'declined')
        AND request_date IS NOT NULL
        AND start_time IS NOT NULL
      GROUP BY day_of_week, hour_of_day
      ORDER BY day_of_week, hour_of_day
    `);

    const resourceUtilResult = await db.execute(sql`
      SELECT
        r.name AS resource_name,
        COALESCE(SUM(br.duration_minutes), 0)::int AS total_minutes
      FROM resources r
      LEFT JOIN booking_requests br ON br.resource_id = r.id
        AND br.status NOT IN ('cancelled', 'declined')
      GROUP BY r.id, r.name
      ORDER BY total_minutes DESC
    `);

    const topMembersResult = await db.execute(sql`
      SELECT
        COALESCE(br.user_name, br.user_email) AS member_name,
        br.user_email AS member_email,
        SUM(br.duration_minutes)::int AS total_minutes
      FROM booking_requests br
      WHERE br.status NOT IN ('cancelled', 'declined')
        AND br.user_email IS NOT NULL
      GROUP BY br.user_name, br.user_email
      ORDER BY total_minutes DESC
      LIMIT 5
    `);

    const cancellationResult = await db.execute(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
      FROM booking_requests
      WHERE status != 'declined'
    `);

    const avgSessionResult = await db.execute(sql`
      SELECT
        ROUND(AVG(duration_minutes), 1) AS avg_minutes
      FROM booking_requests
      WHERE status NOT IN ('cancelled', 'declined')
        AND duration_minutes IS NOT NULL
        AND duration_minutes > 0
    `);

    const cancRow = cancellationResult.rows[0] as { total: number; cancelled: number };
    const cancellationRate = cancRow.total > 0
      ? Math.round((cancRow.cancelled / cancRow.total) * 1000) / 10
      : 0;

    const avgRow = avgSessionResult.rows[0] as { avg_minutes: string | null };
    const avgSessionMinutes = avgRow.avg_minutes ? parseFloat(avgRow.avg_minutes) : 0;

    res.json({
      peakHours: peakHoursResult.rows as { day_of_week: number; hour_of_day: number; booking_count: number }[],
      resourceUtilization: (resourceUtilResult.rows as { resource_name: string; total_minutes: number }[]).map(r => ({
        resourceName: r.resource_name,
        totalHours: Math.round((r.total_minutes / 60) * 10) / 10,
      })),
      topMembers: (topMembersResult.rows as { member_name: string; member_email: string; total_minutes: number }[]).map(m => ({
        memberName: m.member_name,
        memberEmail: m.member_email,
        totalHours: Math.round((m.total_minutes / 60) * 10) / 10,
      })),
      cancellationRate,
      totalBookings: cancRow.total,
      cancelledBookings: cancRow.cancelled,
      avgSessionMinutes,
    });
  } catch (error) {
    logger.error('Failed to fetch booking analytics', { error: getErrorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch booking analytics' });
  }
});

export default router;
