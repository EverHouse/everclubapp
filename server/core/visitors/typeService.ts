import { db } from '../../db';
import { sql } from 'drizzle-orm';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';

export type VisitorType = 'classpass' | 'sim_walkin' | 'private_lesson' | 'guest' | 'day_pass' | 'golfnow' | 'private_event';
export type ActivitySource = 'day_pass_purchase' | 'guest_booking' | 'booking_participant' | 'trackman_auto_match';

interface UpdateVisitorTypeParams {
  email: string;
  type: VisitorType;
  activitySource: ActivitySource;
  activityDate?: Date;
}

export async function updateVisitorType({
  email,
  type,
  activitySource,
  activityDate = new Date()
}: UpdateVisitorTypeParams): Promise<boolean> {
  if (!email) return false;
  
  const normalizedEmail = email.toLowerCase().trim();
  
  try {
    let result;
    
    if (type === 'day_pass') {
      result = await db.execute(sql`
        UPDATE users
        SET 
          visitor_type = 'day_pass',
          last_activity_at = ${activityDate},
          last_activity_source = ${activitySource},
          updated_at = NOW()
        WHERE LOWER(email) = ${normalizedEmail}
          AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
          AND role NOT IN ('admin', 'staff', 'member')
          AND tier IS NULL
        RETURNING id
      `);
    } else if (type === 'guest') {
      result = await db.execute(sql`
        UPDATE users
        SET 
          visitor_type = 'guest',
          last_activity_at = ${activityDate},
          last_activity_source = ${activitySource},
          updated_at = NOW()
        WHERE LOWER(email) = ${normalizedEmail}
          AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
          AND role NOT IN ('admin', 'staff', 'member')
          AND tier IS NULL
          AND (visitor_type IS NULL OR visitor_type IN ('lead', 'NEW'))
        RETURNING id
      `);
    } else {
      result = await db.execute(sql`
        UPDATE users
        SET 
          visitor_type = ${type},
          last_activity_at = ${activityDate},
          last_activity_source = ${activitySource},
          updated_at = NOW()
        WHERE LOWER(email) = ${normalizedEmail}
          AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
          AND role NOT IN ('admin', 'staff', 'member')
          AND tier IS NULL
          AND (visitor_type IS NULL OR visitor_type IN ('lead', 'NEW') OR visitor_type = 'guest')
        RETURNING id
      `);
    }
    
    if (result.rowCount && result.rowCount > 0) {
      process.stderr.write(`[VisitorType] Updated ${normalizedEmail} to type '${type}' (source: ${activitySource})\n`);
      return true;
    }
    
    return false;
  } catch (error: unknown) {
    logger.error('[VisitorType] Error updating visitor type:', { error: getErrorMessage(error) });
    return false;
  }
}

export async function updateVisitorTypeByUserId(
  userId: string | number,
  type: VisitorType,
  activitySource: ActivitySource,
  activityDate: Date = new Date()
): Promise<boolean> {
  try {
    let result;
    
    if (type === 'day_pass') {
      result = await db.execute(sql`
        UPDATE users
        SET 
          visitor_type = 'day_pass',
          last_activity_at = ${activityDate},
          last_activity_source = ${activitySource},
          updated_at = NOW()
        WHERE id = ${userId}
          AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
          AND role NOT IN ('admin', 'staff', 'member')
          AND tier IS NULL
        RETURNING id
      `);
    } else if (type === 'guest') {
      result = await db.execute(sql`
        UPDATE users
        SET 
          visitor_type = 'guest',
          last_activity_at = ${activityDate},
          last_activity_source = ${activitySource},
          updated_at = NOW()
        WHERE id = ${userId}
          AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
          AND role NOT IN ('admin', 'staff', 'member')
          AND tier IS NULL
          AND (visitor_type IS NULL OR visitor_type IN ('lead', 'NEW'))
        RETURNING id
      `);
    } else {
      result = await db.execute(sql`
        UPDATE users
        SET 
          visitor_type = ${type},
          last_activity_at = ${activityDate},
          last_activity_source = ${activitySource},
          updated_at = NOW()
        WHERE id = ${userId}
          AND (role = 'visitor' OR membership_status IN ('visitor', 'non-member'))
          AND role NOT IN ('admin', 'staff', 'member')
          AND tier IS NULL
          AND (visitor_type IS NULL OR visitor_type IN ('lead', 'NEW') OR visitor_type = 'guest')
        RETURNING id
      `);
    }
    
    if (result.rowCount && result.rowCount > 0) {
      process.stderr.write(`[VisitorType] Updated user ${userId} to type '${type}' (source: ${activitySource})\n`);
      return true;
    }
    
    return false;
  } catch (error: unknown) {
    logger.error('[VisitorType] Error updating visitor type by ID:', { error: getErrorMessage(error) });
    return false;
  }
}

export async function calculateVisitorTypeFromHistory(email: string): Promise<VisitorType | null> {
  if (!email) return null;
  
  const normalizedEmail = email.toLowerCase().trim();
  
  try {
    const [dayPassResult, guestResult] = await Promise.all([
      db.execute(sql`
        SELECT 1
        FROM day_pass_purchases
        WHERE LOWER(purchaser_email) = ${normalizedEmail}
        LIMIT 1
      `),
      db.execute(sql`
        SELECT 
          bs.session_date::timestamp as activity_date
        FROM booking_participants bp
        JOIN guests g ON bp.guest_id = g.id
        JOIN booking_sessions bs ON bp.session_id = bs.id
        WHERE LOWER(g.email) = ${normalizedEmail}
          AND bp.participant_type = 'guest'
        ORDER BY bs.session_date DESC
        LIMIT 1
      `)
    ]);
    
    const hasDayPassPurchase = dayPassResult.rows.length > 0;
    const lastGuestAppearance = guestResult.rows[0];
    
    if (hasDayPassPurchase) {
      return 'day_pass';
    }
    
    if (lastGuestAppearance) {
      return 'guest';
    }
    
    return null;
  } catch (error: unknown) {
    logger.error('[VisitorType] Error calculating visitor type from history:', { error: getErrorMessage(error) });
    return null;
  }
}
