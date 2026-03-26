import { db } from '../../db';
import { sql } from 'drizzle-orm';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';

export type VisitorType = 'guest' | 'day_pass';
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
    } else {
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
    } else {
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
