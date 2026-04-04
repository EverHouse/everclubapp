import { Router } from 'express';
import { isStaffOrAdmin } from '../../core/middleware';
import { logFromRequest, type AuditAction, type ResourceType } from '../../core/auditLog';
import { logAndRespond } from '../../core/logger';
import { getSessionUser } from '../../types/session';
import { validateBody } from '../../middleware/validate';
import { staffManualBookingSchema } from '../../../shared/validators/manualBooking';
import { createStaffManualBooking, ManualBookingValidationError, fireManualBookingPostCommitEffects } from '../../core/resource/staffActions';
import { isConstraintError } from '../../core/db';

const router = Router();

router.post('/api/staff/manual-booking', isStaffOrAdmin, validateBody(staffManualBookingSchema), async (req, res) => {
  try {
    const input = req.body;
    const sessionUser = getSessionUser(req);
    const staffEmail = sessionUser?.email || 'staff';

    let result;
    try {
      result = await createStaffManualBooking(input, staffEmail);
    } catch (error: unknown) {
      if (error instanceof ManualBookingValidationError) {
        return res.status(error.statusCode).json(error.errorBody);
      }
      throw error;
    }

    const { row, dayPassRedeemed } = result;

    res.status(201).json({
      id: row.id,
      user_email: row.userEmail,
      user_name: row.userName,
      resource_id: row.resourceId,
      request_date: row.requestDate,
      start_time: row.startTime,
      duration_minutes: row.durationMinutes,
      end_time: row.endTime,
      status: row.status,
      declared_player_count: row.declaredPlayerCount,
      request_participants: row.requestParticipants,
      trackman_external_id: row.trackmanExternalId,
      origin: row.origin,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      day_pass_redeemed: dayPassRedeemed,
      day_pass_id: dayPassRedeemed ? input.dayPassPurchaseId : undefined
    });

    fireManualBookingPostCommitEffects(
      row,
      dayPassRedeemed,
      input,
      (action: string, entityType: string, entityId: string, entityName: string, metadata: Record<string, unknown>) => {
        logFromRequest(req, action as AuditAction, entityType as ResourceType, entityId, entityName, metadata);
      }
    );
  } catch (error: unknown) {
    const constraint = isConstraintError(error);
    if (constraint.type === 'unique' || constraint.type === 'exclusion') {
      return res.status(409).json({ error: 'This time slot was just booked by someone else. Please refresh and pick a different time.' });
    }
    logAndRespond(req, res, 500, 'Failed to create manual booking', error);
  }
});

export default router;
