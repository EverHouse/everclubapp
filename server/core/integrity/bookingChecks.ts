import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../../utils/errorUtils';
import { logger } from '../logger';
import { getTodayPacific, formatDateFromDb } from '../../utils/dateUtils';
import type {
  IntegrityCheckResult,
  IntegrityIssue,
  UnmatchedBookingRow,
  CountRow,
  ParticipantUserRow,
  ReviewItemRow,
  InvalidBookingRow,
  InvalidSessionRow,
  StaleTourRow,
  GhostBookingRow,
  EmptySessionRow,
  OverlapRow,
  GuestPassOverUsedRow,
  OrphanHoldRow,
  ExpiredHoldRow,
  StaleBookingRow,
  StuckUnpaidBookingRow,
  OvercapacitySessionRow,
  WalletPassSyncRow,
  SessionOverlapRow,
  WellnessBlockGapRow,
} from './core';

export async function checkUnmatchedTrackmanBookings(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const unmatchedBookings = await db.execute(sql`
      SELECT tub.id, tub.trackman_booking_id, tub.user_name, tub.original_email, tub.booking_date, tub.bay_number, tub.start_time, tub.end_time, tub.notes
      FROM trackman_unmatched_bookings tub
      WHERE tub.resolved_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM booking_requests br 
          WHERE br.trackman_booking_id = tub.trackman_booking_id::text
        )
      ORDER BY tub.booking_date DESC
      LIMIT 100
    `);

    const totalCount = await db.execute(sql`
      SELECT COUNT(*)::int as count 
      FROM trackman_unmatched_bookings tub
      WHERE tub.resolved_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM booking_requests br 
          WHERE br.trackman_booking_id = tub.trackman_booking_id::text
        )
    `);
    const total = (totalCount.rows[0] as unknown as CountRow)?.count || 0;

    for (const row of unmatchedBookings.rows as unknown as UnmatchedBookingRow[]) {
      issues.push({
        category: 'sync_mismatch',
        severity: 'warning',
        table: 'trackman_unmatched_bookings',
        recordId: row.id,
        description: `Trackman booking for "${row.user_name || 'Unknown'}" (${row.original_email || 'no email'}) on ${row.booking_date} has no matching member`,
        suggestion: 'Use the Trackman Unmatched Bookings section to link this booking to a member or create a visitor record',
        context: {
          trackmanBookingId: row.trackman_booking_id || undefined,
          userName: row.user_name || undefined,
          userEmail: row.original_email || undefined,
          bookingDate: row.booking_date || undefined,
          bayNumber: row.bay_number || undefined,
          startTime: row.start_time || undefined,
          endTime: row.end_time || undefined,
          importedName: row.user_name || undefined,
          notes: row.notes || undefined,
          originalEmail: row.original_email || undefined
        }
      });
    }

    return {
      checkName: 'Unmatched Trackman Bookings',
      status: Number(total) === 0 ? 'pass' : Number(total) > 50 ? 'fail' : 'warning',
      issueCount: Number(total),
      issues,
      lastRun: new Date()
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking unmatched Trackman bookings:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Unmatched Trackman Bookings',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'trackman_unmatched_bookings',
        recordId: 'check_error',
        description: `Failed to check unmatched Trackman bookings: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

export async function checkParticipantUserRelationships(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  const invalidUsers = await db.execute(sql`
    SELECT bp.id, bp.user_id, bp.display_name, bp.session_id,
           bs.session_date, bs.start_time, r.name as resource_name
    FROM booking_participants bp
    LEFT JOIN users u ON bp.user_id = u.id
    LEFT JOIN booking_sessions bs ON bp.session_id = bs.id
    LEFT JOIN resources r ON bs.resource_id = r.id
    WHERE bp.user_id IS NOT NULL AND bp.user_id != '' AND u.id IS NULL
  `);

  for (const row of invalidUsers.rows as unknown as ParticipantUserRow[]) {
    issues.push({
      category: 'missing_relationship',
      severity: 'warning',
      table: 'booking_participants',
      recordId: row.id,
      description: `Participant "${row.display_name}" references non-existent user (user_id: ${row.user_id})`,
      suggestion: 'Update participant to reference a valid user or mark as guest',
      context: {
        memberName: row.display_name || undefined,
        bookingDate: row.session_date || undefined,
        startTime: row.start_time || undefined,
        resourceName: row.resource_name || undefined
      }
    });
  }

  return {
    checkName: 'Participant User Relationships',
    status: issues.length === 0 ? 'pass' : issues.length > 10 ? 'fail' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date()
  };
}

export async function checkNeedsReviewItems(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  const eventsNeedingReview = await db.execute(sql`
    SELECT id, title, event_date, start_time FROM events WHERE needs_review = true
  `);

  const wellnessNeedingReview = await db.execute(sql`
    SELECT id, title, date, instructor, time AS start_time FROM wellness_classes WHERE needs_review = true
  `);

  for (const row of eventsNeedingReview.rows as unknown as ReviewItemRow[]) {
    issues.push({
      category: 'sync_mismatch',
      severity: 'info',
      table: 'events',
      recordId: row.id,
      description: `Event "${row.title}" on ${row.event_date} needs review`,
      suggestion: 'Review and approve the event in admin panel',
      context: {
        eventTitle: row.title || undefined,
        eventDate: row.event_date || undefined,
        startTime: row.start_time || undefined
      }
    });
  }

  for (const row of wellnessNeedingReview.rows as unknown as ReviewItemRow[]) {
    issues.push({
      category: 'sync_mismatch',
      severity: 'info',
      table: 'wellness_classes',
      recordId: row.id,
      description: `Wellness class "${row.title}" on ${row.date} needs review`,
      suggestion: 'Review and approve the class in admin panel',
      context: {
        className: row.title || undefined,
        classDate: row.date || undefined,
        instructor: row.instructor || undefined,
        startTime: row.start_time || undefined
      }
    });
  }

  return {
    checkName: 'Items Needing Review',
    status: issues.length === 0 ? 'pass' : 'info',
    issueCount: issues.length,
    issues,
    lastRun: new Date()
  };
}

export async function checkBookingTimeValidity(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  const invalidBookings = await db.execute(sql`
    SELECT br.id, br.user_email, br.user_name, br.request_date, br.start_time, br.end_time, r.name as resource_name
    FROM booking_requests br
    LEFT JOIN resources r ON br.resource_id = r.id
    WHERE br.end_time < br.start_time
    AND NOT (br.start_time >= '20:00:00' AND br.end_time <= '06:00:00')
  `);

  for (const row of invalidBookings.rows as unknown as InvalidBookingRow[]) {
    issues.push({
      category: 'data_quality',
      severity: 'error',
      table: 'booking_requests',
      recordId: row.id,
      description: `Booking by ${row.user_email} on ${row.request_date} has end_time (${row.end_time}) before start_time (${row.start_time})`,
      suggestion: 'Fix the booking times or delete the invalid booking',
      context: {
        memberName: row.user_name || undefined,
        memberEmail: row.user_email || undefined,
        bookingDate: row.request_date || undefined,
        startTime: row.start_time || undefined,
        endTime: row.end_time || undefined,
        resourceName: row.resource_name || undefined
      }
    });
  }

  const invalidSessions = await db.execute(sql`
    SELECT bs.id, bs.session_date, bs.start_time, bs.end_time, r.name as resource_name
    FROM booking_sessions bs
    LEFT JOIN resources r ON bs.resource_id = r.id
    WHERE bs.end_time < bs.start_time
    AND NOT (bs.start_time >= '20:00:00' AND bs.end_time <= '06:00:00')
  `);

  for (const row of invalidSessions.rows as unknown as InvalidSessionRow[]) {
    issues.push({
      category: 'data_quality',
      severity: 'error',
      table: 'booking_sessions',
      recordId: row.id,
      description: `Booking session on ${row.session_date} has end_time (${row.end_time}) before start_time (${row.start_time})`,
      suggestion: 'Fix the session times or delete the invalid session',
      context: {
        bookingDate: row.session_date || undefined,
        startTime: row.start_time || undefined,
        endTime: row.end_time || undefined,
        resourceName: row.resource_name || undefined
      }
    });
  }

  return {
    checkName: 'Booking Time Validity',
    status: issues.length === 0 ? 'pass' : 'fail',
    issueCount: issues.length,
    issues,
    lastRun: new Date()
  };
}

export async function checkStalePastTours(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const today = getTodayPacific();

  const autoFixResult = await db.execute(sql`
    UPDATE tours 
    SET status = 'no_show', updated_at = NOW()
    WHERE tour_date < ${today}::date - INTERVAL '7 days'
    AND status IN ('pending', 'scheduled')
    RETURNING id
  `);

  if (autoFixResult.rows.length > 0) {
    logger.info(`[DataIntegrity] Auto-fixed ${autoFixResult.rows.length} stale tours older than 7 days to 'no_show'`);
  }

  const staleTours = await db.execute(sql`
    SELECT id, title, tour_date, status, guest_name, guest_email, start_time
    FROM tours
    WHERE tour_date < ${today}
    AND status IN ('pending', 'scheduled')
  `);

  for (const row of staleTours.rows as unknown as StaleTourRow[]) {
    issues.push({
      category: 'data_quality',
      severity: 'warning',
      table: 'tours',
      recordId: row.id,
      description: `Tour "${row.title}" for ${row.guest_name || 'unknown guest'} on ${row.tour_date} is in the past but still marked as "${row.status}"`,
      suggestion: 'DB trigger auto-expires tours >7 days old. This tour is 1–7 days past — update status to completed, no-show, or cancelled.',
      context: {
        guestName: row.guest_name || undefined,
        memberEmail: row.guest_email || undefined,
        tourDate: row.tour_date || undefined,
        startTime: row.start_time || undefined
      }
    });
  }

  return {
    checkName: 'Stale Past Tours',
    status: issues.length === 0 ? 'pass' : issues.length > 10 ? 'fail' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date()
  };
}

export async function checkBookingsWithoutSessions(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;

  const ghostsResult = await db.execute(sql`
    SELECT br.id, br.user_email, br.request_date, br.status, br.trackman_booking_id, br.resource_id,
           br.start_time, br.end_time, br.notes,
           r.name as resource_name,
           u.first_name, u.last_name, u.id as user_id
    FROM booking_requests br
    LEFT JOIN booking_sessions bs ON br.session_id = bs.id
    LEFT JOIN resources r ON br.resource_id = r.id
    LEFT JOIN users u ON br.user_id = u.id
    WHERE br.status IN ('approved', 'attended', 'confirmed')
      AND (br.session_id IS NULL OR bs.id IS NULL)
      AND (br.is_unmatched = false OR br.is_unmatched IS NULL)
      AND br.user_email IS NOT NULL AND br.user_email != ''
      AND br.user_email NOT LIKE 'private-event@%'
      AND br.is_event IS NOT TRUE
      AND (
        br.status = 'attended'
        OR br.request_date < ${getTodayPacific()}
      )
    ORDER BY br.request_date DESC
    LIMIT 100
  `);
  const ghosts = ghostsResult.rows as unknown as (GhostBookingRow & { user_id?: string })[];

  for (const row of ghosts) {
    const dateStr = row.request_date ? formatDateFromDb(row.request_date) : 'unknown';
    const memberName = row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : undefined;

    if (shouldAutoFix && row.resource_id && row.start_time && row.end_time && row.request_date) {
      try {
        const sessionResult = await db.execute(sql`
          INSERT INTO booking_sessions (resource_id, session_date, start_time, end_time, trackman_booking_id, created_at)
          VALUES (${row.resource_id}, ${row.request_date}::date, ${row.start_time}::time, ${row.end_time}::time, ${row.trackman_booking_id || null}, NOW())
          ON CONFLICT DO NOTHING
          RETURNING id
        `);
        if (sessionResult.rows.length > 0) {
          const sessionId = (sessionResult.rows[0] as { id: number }).id;
          await db.execute(sql`UPDATE booking_requests SET session_id = ${sessionId}, updated_at = NOW() WHERE id = ${row.id} AND session_id IS NULL`);
          if (row.user_id) {
            await db.execute(sql`
              INSERT INTO booking_participants (session_id, user_id, display_name, participant_type)
              VALUES (${sessionId}, ${row.user_id}, ${memberName || row.user_email}, 'owner')
              ON CONFLICT DO NOTHING
            `);
          }
          autoFixedCount++;
          logger.info(`[AutoHeal] Created session #${sessionId} for ghost booking #${row.id} (${row.user_email} on ${dateStr})`);
          continue;
        }
      } catch (fixErr: unknown) {
        logger.error('[AutoHeal] Failed to create session for ghost booking', {
          extra: { bookingId: row.id, error: getErrorMessage(fixErr) }
        });
      }
    }

    issues.push({
      category: 'data_quality',
      severity: 'error',
      table: 'booking_requests',
      recordId: row.id,
      description: `Active booking #${row.id} (${row.status}) for ${row.user_email} on ${dateStr} has NO SESSION. Billing is not being tracked.`,
      suggestion: 'Run "Backfill Sessions" tool in Admin -> Data Tools, or manually create a session for this booking.',
      context: {
        bookingDate: dateStr,
        memberEmail: row.user_email,
        memberName: memberName,
        trackmanBookingId: row.trackman_booking_id,
        resourceId: Number(row.resource_id),
        resourceName: row.resource_name,
        startTime: row.start_time,
        endTime: row.end_time,
        notes: row.notes,
        importedName: memberName || String(row.user_email || '').split('@')[0],
        status: row.status
      }
    });
  }

  return {
    checkName: 'Active Bookings Without Sessions',
    status: issues.length === 0 ? 'pass' : 'fail',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
    autoFixedCount,
    autoFixSummary: autoFixedCount > 0 ? `Created ${autoFixedCount} missing sessions` : undefined
  };
}

export async function checkSessionsWithoutParticipants(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  const emptySessions = await db.execute(sql`
    SELECT bs.id, bs.session_date, bs.resource_id, bs.start_time, bs.end_time, bs.created_at,
           bs.trackman_booking_id,
           r.name as resource_name,
           br.id as linked_booking_id,
           br.trackman_booking_id as booking_trackman_id
    FROM booking_sessions bs
    LEFT JOIN booking_participants bp ON bp.session_id = bs.id
    LEFT JOIN resources r ON bs.resource_id = r.id
    LEFT JOIN booking_requests br ON br.session_id = bs.id
    WHERE bp.id IS NULL
      AND bs.session_date >= ${getTodayPacific()}::date - INTERVAL '30 days'
    LIMIT 100
  `);

  for (const row of emptySessions.rows as unknown as EmptySessionRow[]) {
    issues.push({
      category: 'orphan_record',
      severity: 'warning',
      table: 'booking_sessions',
      recordId: row.id,
      description: `Session on ${row.session_date} at ${row.start_time}–${row.end_time} (${row.resource_name || 'unknown resource'}) has zero participants`,
      suggestion: 'Review session and add participants or remove empty session',
      context: {
        sessionId: row.id || undefined,
        bookingDate: row.session_date || undefined,
        startTime: row.start_time || undefined,
        endTime: row.end_time || undefined,
        resourceName: row.resource_name || undefined,
        resourceId: row.resource_id || undefined,
        linkedBookingId: row.linked_booking_id || undefined,
        trackmanBookingId: row.trackman_booking_id || row.booking_trackman_id || undefined
      }
    });
  }

  return {
    checkName: 'Sessions Without Participants',
    status: issues.length === 0 ? 'pass' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date()
  };
}

export async function checkOverlappingBookings(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;
  const today = getTodayPacific();

  try {
    const overlapsResult = await db.execute(sql`
      SELECT bs1.id as session1_id, bs2.id as session2_id, bs1.resource_id, bs1.session_date,
             bs1.start_time, bs1.end_time, bs2.start_time as overlap_start, bs2.end_time as overlap_end,
             br1.id as booking1_id, br1.status as booking1_status,
             br2.id as booking2_id, br2.status as booking2_status,
             u1.email as member1_email, u1.first_name as member1_first, u1.last_name as member1_last,
             u2.email as member2_email, u2.first_name as member2_first, u2.last_name as member2_last,
             r.name as resource_name
      FROM booking_sessions bs1
      JOIN booking_sessions bs2 ON bs1.resource_id = bs2.resource_id
        AND bs1.session_date = bs2.session_date
        AND bs1.id < bs2.id
        AND bs1.start_time < bs2.end_time
        AND bs2.start_time < bs1.end_time
      JOIN booking_requests br1 ON br1.session_id = bs1.id AND br1.status IN ('approved', 'confirmed', 'attended')
      JOIN booking_requests br2 ON br2.session_id = bs2.id AND br2.status IN ('approved', 'confirmed', 'attended')
      LEFT JOIN users u1 ON br1.user_id = u1.id
      LEFT JOIN users u2 ON br2.user_id = u2.id
      LEFT JOIN resources r ON bs1.resource_id = r.id
      WHERE bs1.session_date >= ${today}::date - INTERVAL '30 days'
    `);

    for (const row of overlapsResult.rows as unknown as OverlapRow[]) {
      const isPast = row.session_date && String(row.session_date) < today;
      if (shouldAutoFix && isPast) {
        autoFixedCount++;
        continue;
      }

      issues.push({
        category: 'booking_issue',
        severity: 'warning',
        table: 'booking_sessions',
        recordId: `${row.session1_id}-${row.session2_id}`,
        description: `Sessions #${row.session1_id} and #${row.session2_id} overlap on resource ${row.resource_id} on ${row.session_date} (${row.start_time}-${row.end_time} vs ${row.overlap_start}-${row.overlap_end})`,
        suggestion: 'Informational: DB trigger prevents new overlaps. This may be a legacy overlap or an edge case that slipped through.',
        context: {
          resourceId: Number(row.resource_id),
          resourceName: row.resource_name || undefined,
          startTime: row.start_time || undefined,
          endTime: row.end_time || undefined,
          bookingDate: row.session_date || undefined,
          booking1Id: Number(row.booking1_id),
          booking1Status: row.booking1_status || undefined,
          member1Email: row.member1_email || undefined,
          member1Name: [row.member1_first, row.member1_last].filter(Boolean).join(' ') || undefined,
          booking2Id: Number(row.booking2_id),
          booking2Status: row.booking2_status || undefined,
          member2Email: row.member2_email || undefined,
          member2Name: [row.member2_first, row.member2_last].filter(Boolean).join(' ') || undefined,
        }
      });
    }
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking overlapping bookings:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Overlapping Bookings',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_sessions',
        recordId: 'check_error',
        description: `Failed to check overlapping bookings: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }

  return {
    checkName: 'Overlapping Bookings',
    status: issues.length === 0 ? 'pass' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
    autoFixedCount,
    autoFixSummary: autoFixedCount > 0 ? `Auto-acknowledged ${autoFixedCount} historical overlaps` : undefined
  };
}

export async function checkGuestPassAccountingDrift(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;

  try {
    const overUsedResult = await db.execute(sql`
      SELECT id, member_email, passes_used, passes_total
      FROM guest_passes
      WHERE passes_used > passes_total
    `);

    for (const row of overUsedResult.rows as unknown as GuestPassOverUsedRow[]) {
      issues.push({
        category: 'billing_issue',
        severity: 'error',
        table: 'guest_passes',
        recordId: row.id,
        description: `Guest pass #${row.id} for ${row.member_email} has passes_used (${row.passes_used}) > passes_total (${row.passes_total})`,
        suggestion: 'Legacy data: DB constraint now prevents new over-consumption. Review and correct this existing pass balance.',
        context: {
          memberEmail: row.member_email || undefined
        }
      });
    }

    const orphanHoldsResult = await db.execute(sql`
      SELECT gph.id, gph.member_email, gph.booking_id, gph.passes_held
      FROM guest_pass_holds gph
      WHERE NOT EXISTS (SELECT 1 FROM booking_requests br WHERE br.id = gph.booking_id)
    `);

    for (const row of orphanHoldsResult.rows as unknown as OrphanHoldRow[]) {
      if (shouldAutoFix) {
        try {
          await db.execute(sql`DELETE FROM guest_pass_holds WHERE id = ${row.id}`);
          autoFixedCount++;
          logger.info(`[AutoHeal] Deleted orphan guest pass hold #${row.id} for ${row.member_email} (booking #${row.booking_id} no longer exists)`);
          continue;
        } catch (fixErr: unknown) {
          logger.error('[AutoHeal] Failed to delete orphan guest pass hold', { extra: { holdId: row.id, error: getErrorMessage(fixErr) } });
        }
      }
      issues.push({
        category: 'orphan_record',
        severity: 'warning',
        table: 'guest_pass_holds',
        recordId: row.id,
        description: `Guest pass hold #${row.id} for ${row.member_email} references non-existent booking #${row.booking_id} (${row.passes_held} passes held)`,
        suggestion: 'Release the held passes and delete the orphan hold record.',
        context: {
          memberEmail: row.member_email || undefined
        }
      });
    }

    const expiredHoldsResult = await db.execute(sql`
      SELECT id, member_email, booking_id, passes_held, expires_at
      FROM guest_pass_holds
      WHERE expires_at < NOW()
    `);

    for (const row of expiredHoldsResult.rows as unknown as ExpiredHoldRow[]) {
      if (shouldAutoFix) {
        try {
          await db.execute(sql`DELETE FROM guest_pass_holds WHERE id = ${row.id}`);
          autoFixedCount++;
          logger.info(`[AutoHeal] Cleaned up expired guest pass hold #${row.id} for ${row.member_email}`);
          continue;
        } catch (fixErr: unknown) {
          logger.error('[AutoHeal] Failed to clean expired guest pass hold', { extra: { holdId: row.id, error: getErrorMessage(fixErr) } });
        }
      }
      issues.push({
        category: 'orphan_record',
        severity: 'warning',
        table: 'guest_pass_holds',
        recordId: row.id,
        description: `Guest pass hold #${row.id} for ${row.member_email} expired at ${row.expires_at} but was not cleaned up (${row.passes_held} passes still held)`,
        suggestion: 'Release expired hold and return passes to the member balance.',
        context: {
          memberEmail: row.member_email || undefined
        }
      });
    }
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking guest pass accounting drift:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Guest Pass Accounting Drift',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'guest_passes',
        recordId: 'check_error',
        description: `Failed to check guest pass accounting drift: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }

  return {
    checkName: 'Guest Pass Accounting Drift',
    status: issues.length === 0 ? 'pass' : issues.some(i => i.severity === 'error') ? 'fail' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
    autoFixedCount,
    autoFixSummary: autoFixedCount > 0 ? `Cleaned ${autoFixedCount} orphan/expired guest pass holds` : undefined
  };
}

export async function checkStaleExpiredGuestPassHolds(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const staleHoldsResult = await db.execute(sql`
      SELECT id, member_email, booking_id, passes_held, expires_at
      FROM guest_pass_holds
      WHERE expires_at < NOW() - INTERVAL '48 hours'
    `);

    for (const row of staleHoldsResult.rows as unknown as ExpiredHoldRow[]) {
      issues.push({
        category: 'orphan_record',
        severity: 'error',
        table: 'guest_pass_holds',
        recordId: row.id,
        description: `Guest pass hold #${row.id} for ${row.member_email} expired at ${row.expires_at} and has not been cleaned up for >48 hours (${row.passes_held} passes still held). This indicates the cleanup scheduler may not be running.`,
        suggestion: 'Verify that the guest pass hold cleanup scheduler is running. Manually delete this hold to release passes.',
        context: {
          memberEmail: row.member_email || undefined,
          bookingId: row.booking_id || undefined,
        }
      });
    }

    return {
      checkName: 'Stale Expired Guest Pass Holds',
      status: issues.length === 0 ? 'pass' : 'fail',
      issueCount: issues.length,
      issues,
      lastRun: new Date()
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking stale expired guest pass holds:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Stale Expired Guest Pass Holds',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'guest_pass_holds',
        recordId: 'check_error',
        description: `Failed to check stale expired guest pass holds: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

export async function checkStuckUnpaidBookings(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const today = getTodayPacific();

  try {
    const totalCountResult = await db.execute(sql`
      SELECT COUNT(DISTINCT br.id)::int AS count
      FROM booking_requests br
      JOIN booking_participants bp ON bp.session_id = br.session_id
        AND bp.cached_fee_cents > 0
        AND bp.payment_status = 'pending'
      WHERE br.status IN ('approved', 'confirmed')
        AND br.request_date < ${today}::date
        AND br.request_date >= ${today}::date - INTERVAL '14 days'
        AND br.session_id IS NOT NULL
    `);
    const totalStuck = (totalCountResult.rows[0] as unknown as CountRow)?.count || 0;

    const stuckResult = await db.execute(sql`
      SELECT br.id, br.user_email, br.user_name, br.request_date, br.start_time, br.end_time,
             r.name as resource_name,
             EXTRACT(EPOCH FROM (NOW() - (br.request_date + COALESCE(br.end_time, br.start_time)::time))) / 3600 AS stuck_hours,
             COALESCE(SUM(bp.cached_fee_cents), 0)::int AS unpaid_cents
      FROM booking_requests br
      JOIN booking_participants bp ON bp.session_id = br.session_id
        AND bp.cached_fee_cents > 0
        AND bp.payment_status = 'pending'
      LEFT JOIN resources r ON br.resource_id = r.id
      WHERE br.status IN ('approved', 'confirmed')
        AND br.request_date < ${today}::date
        AND br.request_date >= ${today}::date - INTERVAL '14 days'
        AND br.session_id IS NOT NULL
      GROUP BY br.id, br.user_email, br.user_name, br.request_date, br.start_time, br.end_time, r.name
      ORDER BY br.request_date ASC
      LIMIT 50
    `);

    for (const row of stuckResult.rows as unknown as StuckUnpaidBookingRow[]) {
      const hours = Math.round(Number(row.stuck_hours));
      const durationStr = hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h`;
      const unpaidDollars = (Number(row.unpaid_cents) / 100).toFixed(2);

      issues.push({
        category: 'billing_issue',
        severity: hours >= 24 ? 'error' : 'warning',
        table: 'booking_requests',
        recordId: row.id,
        description: `Booking #${row.id} for ${row.user_name || row.user_email} (${row.user_email}) on ${row.request_date} is stuck — $${unpaidDollars} unpaid fees blocking auto-complete for ${durationStr}`,
        suggestion: 'Collect payment from the member or waive the fees to allow this booking to complete. Go to the booking details to take action.',
        context: {
          memberEmail: row.user_email || undefined,
          memberName: row.user_name || undefined,
          bookingDate: row.request_date || undefined,
          startTime: row.start_time || undefined,
          endTime: row.end_time || undefined,
          resourceName: row.resource_name || undefined,
        }
      });
    }

    return {
      checkName: 'Stuck Unpaid Bookings',
      status: Number(totalStuck) === 0 ? 'pass' : issues.some(i => i.severity === 'error') ? 'fail' : 'warning',
      issueCount: Number(totalStuck),
      issues,
      lastRun: new Date()
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking stuck unpaid bookings:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Stuck Unpaid Bookings',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_requests',
        recordId: 'check_error',
        description: `Failed to check stuck unpaid bookings: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

export async function checkStalePendingBookings(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const staleResult = await db.execute(sql`
      SELECT br.id, br.user_email, br.request_date, br.start_time, br.status, br.resource_id
      FROM booking_requests br
      WHERE br.status IN ('pending', 'approved')
        AND (br.request_date + br.start_time::time) < ((NOW() AT TIME ZONE 'America/Los_Angeles') - INTERVAL '24 hours')
        AND br.request_date >= ${getTodayPacific()}::date - INTERVAL '7 days'
        AND br.user_email NOT LIKE '%@trackman.local'
      ORDER BY br.request_date DESC
    `);

    const totalStale = staleResult.rows.length;
    const maxDetailedIssues = 25;

    for (const row of (staleResult.rows as unknown as StaleBookingRow[]).slice(0, maxDetailedIssues)) {
      issues.push({
        category: 'booking_issue',
        severity: 'warning',
        table: 'booking_requests',
        recordId: row.id,
        description: `Booking #${row.id} for ${row.user_email} on ${row.request_date} at ${row.start_time} is still "${row.status}" but past its start time`,
        suggestion: 'This booking is past its start time but still in pending/approved status. It should be confirmed, cancelled, or marked as no-show.',
        context: {
          memberEmail: row.user_email || undefined,
          bookingDate: row.request_date || undefined,
          startTime: row.start_time || undefined,
          status: row.status || undefined,
          resourceId: row.resource_id ? Number(row.resource_id) : undefined
        }
      });
    }

    if (totalStale > maxDetailedIssues) {
      issues.push({
        category: 'booking_issue',
        severity: 'info',
        table: 'booking_requests',
        recordId: 'stale_summary',
        description: `${totalStale - maxDetailedIssues} additional stale bookings not shown. Total: ${totalStale} bookings in pending/approved status past their start time in the last 7 days.`,
        suggestion: 'Consider bulk-cancelling old approved bookings or implementing auto-no-show after 24 hours.'
      });
    }

    return {
      checkName: 'Stale Pending Bookings',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: totalStale,
      issues,
      lastRun: new Date()
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking stale pending bookings:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Stale Pending Bookings',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_requests',
        recordId: 'check_error',
        description: `Failed to check stale pending bookings: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

export async function checkStaleCheckedInBookings(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const staleResult = await db.execute(sql`
      SELECT br.id, br.user_email, br.request_date, br.start_time, br.status, br.resource_id
      FROM booking_requests br
      WHERE br.status = 'checked_in'
        AND (br.request_date + COALESCE(br.end_time, br.start_time)::time) < ((NOW() AT TIME ZONE 'America/Los_Angeles') - INTERVAL '24 hours')
        AND br.request_date >= ${getTodayPacific()}::date - INTERVAL '14 days'
      ORDER BY br.request_date DESC
    `);

    const totalStale = staleResult.rows.length;
    const maxDetailedIssues = 25;

    for (const row of (staleResult.rows as unknown as StaleBookingRow[]).slice(0, maxDetailedIssues)) {
      issues.push({
        category: 'booking_issue',
        severity: 'warning',
        table: 'booking_requests',
        recordId: row.id,
        description: `Booking #${row.id} for ${row.user_email} on ${row.request_date} at ${row.start_time} has been in "checked_in" status for over 24 hours past its end time`,
        suggestion: 'This booking was checked in but never completed. Staff should review and mark as attended or resolve any outstanding fees.',
        context: {
          memberEmail: row.user_email || undefined,
          bookingDate: row.request_date || undefined,
          startTime: row.start_time || undefined,
          status: row.status || undefined,
          resourceId: row.resource_id ? Number(row.resource_id) : undefined
        }
      });
    }

    if (totalStale > maxDetailedIssues) {
      issues.push({
        category: 'booking_issue',
        severity: 'info',
        table: 'booking_requests',
        recordId: 'stale_checked_in_summary',
        description: `${totalStale - maxDetailedIssues} additional stale checked-in bookings not shown. Total: ${totalStale} bookings stuck in checked_in status for over 24 hours.`,
        suggestion: 'Consider bulk-completing old checked-in bookings or investigating why they were not completed.'
      });
    }

    return {
      checkName: 'Stale Checked-In Bookings',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: totalStale,
      issues,
      lastRun: new Date()
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking stale checked-in bookings:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Stale Checked-In Bookings',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_requests',
        recordId: 'check_error',
        description: `Failed to check stale checked-in bookings: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

interface UsageLedgerGapRow {
  session_id: number;
  session_date: string;
  start_time: string;
  end_time: string;
  resource_name: string;
  participant_count: number;
  ledger_count: number;
}

export async function checkUsageLedgerGaps(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;

  try {
    const gapSessions = await db.execute(sql`
      SELECT
        bs.id as session_id,
        bs.session_date,
        bs.start_time,
        bs.end_time,
        COALESCE(r.name, 'Unknown') as resource_name,
        (SELECT COUNT(*)::int FROM booking_participants bp WHERE bp.session_id = bs.id AND bp.participant_type IN ('owner', 'member')) as participant_count,
        (SELECT COUNT(*)::int FROM usage_ledger ul WHERE ul.session_id = bs.id) as ledger_count
      FROM booking_sessions bs
      LEFT JOIN resources r ON bs.resource_id = r.id
      WHERE bs.session_date < ${getTodayPacific()}
        AND EXISTS (SELECT 1 FROM booking_participants bp WHERE bp.session_id = bs.id AND bp.participant_type IN ('owner', 'member'))
        AND NOT EXISTS (SELECT 1 FROM usage_ledger ul WHERE ul.session_id = bs.id)
        AND EXISTS (SELECT 1 FROM booking_requests br WHERE br.session_id = bs.id AND br.status = 'attended')
        AND bs.created_at::date - bs.session_date <= 2
      ORDER BY bs.session_date DESC
      LIMIT 1000
    `);

    const today = getTodayPacific();
    const totalCount = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM booking_sessions bs
      WHERE bs.session_date < ${today}
        AND EXISTS (SELECT 1 FROM booking_participants bp WHERE bp.session_id = bs.id AND bp.participant_type IN ('owner', 'member'))
        AND NOT EXISTS (SELECT 1 FROM usage_ledger ul WHERE ul.session_id = bs.id)
        AND EXISTS (SELECT 1 FROM booking_requests br WHERE br.session_id = bs.id AND br.status = 'attended')
        AND bs.created_at::date - bs.session_date <= 2
    `);
    const total = (totalCount.rows[0] as unknown as CountRow)?.count || 0;

    for (const row of gapSessions.rows as unknown as UsageLedgerGapRow[]) {
      const wasFixed = shouldAutoFix
        ? await autoFixUsageLedgerGap(row)
        : false;

      if (wasFixed) {
        autoFixedCount++;
      }

      if (!wasFixed) {
        issues.push({
          category: 'billing_issue',
          severity: 'error',
          table: 'usage_ledger',
          recordId: row.session_id,
          description: `Session #${row.session_id} on ${row.session_date} (${row.resource_name}) has ${row.participant_count} member participant(s) but no usage ledger entries`,
          suggestion: 'Run fee recalculation for this session to generate missing usage records',
          context: {
            sessionId: row.session_id,
            sessionDate: row.session_date,
            resourceName: row.resource_name,
            participantCount: row.participant_count,
            ledgerCount: row.ledger_count,
          }
        });
      }
    }

    if (autoFixedCount > 0) {
      logger.info(`[DataIntegrity] Auto-fixed ${autoFixedCount} of ${Number(total)} usage ledger gaps with placeholder entries`);
    }

    const detectedCount = Number(total);
    const remainingCount = detectedCount - autoFixedCount;

    return {
      checkName: 'Usage Ledger Gaps',
      status: remainingCount <= 0 ? 'pass' : remainingCount > 20 ? 'fail' : 'warning',
      issueCount: Math.max(0, remainingCount),
      issues,
      lastRun: new Date(),
      autoFixedCount: autoFixedCount > 0 ? autoFixedCount : undefined,
      autoFixSummary: autoFixedCount > 0 ? `Auto-created ${autoFixedCount} missing usage ledger entries` : undefined
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking usage ledger gaps:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Usage Ledger Gaps',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'usage_ledger',
        recordId: 'check_error',
        description: `Failed to check usage ledger gaps: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

async function autoFixUsageLedgerGap(row: UsageLedgerGapRow): Promise<boolean> {
  try {
    const participants = await db.execute(sql`
      SELECT bp.user_id, bp.display_name, bp.participant_type, u.email
      FROM booking_participants bp
      LEFT JOIN users u ON bp.user_id = u.id
      WHERE bp.session_id = ${row.session_id}
        AND bp.participant_type IN ('owner', 'member')
        AND bp.user_id IS NOT NULL
    `);

    if (participants.rows.length === 0) {
      return false;
    }

    const { recordUsage } = await import('../bookingService/sessionCore');
    const { logIntegrityAudit } = await import('../auditLog');

    let createdCount = 0;
    let failedCount = 0;

    for (const p of participants.rows as unknown as Array<{ user_id: string; display_name: string; participant_type: string; email: string | null }>) {
      const memberId = p.email || p.user_id;
      if (!memberId) continue;

      try {
        const result = await recordUsage(
          row.session_id,
          {
            memberId,
            minutesCharged: 0,
            overageFee: 0,
            guestFee: 0,
            tierAtBooking: undefined,
            paymentMethod: 'unpaid',
          },
          'staff_manual',
        );

        if (result.success && !result.alreadyRecorded) {
          createdCount++;
        } else if (result.success && result.alreadyRecorded) {
          createdCount++;
        }
      } catch (recordErr: unknown) {
        failedCount++;
        logger.error('[DataIntegrity] Auto-fix: failed to create placeholder usage entry', {
          extra: { sessionId: row.session_id, memberId, error: getErrorMessage(recordErr) }
        });
      }
    }

    const allFixed = failedCount === 0 && createdCount > 0;

    if (createdCount > 0) {
      await logIntegrityAudit({
        issueKey: `usage_ledger_${row.session_id}`,
        action: 'auto-fix',
        actionBy: 'system',
        resolutionMethod: 'auto-fix',
        notes: `Created placeholder zero-fee usage ledger entries for session #${row.session_id} on ${row.session_date} (${row.resource_name}) with ${row.participant_count} participant(s)`,
      }).catch((auditErr: unknown) => {
        logger.error('[DataIntegrity] Auto-fix: failed to log audit entry', {
          extra: { sessionId: row.session_id, error: getErrorMessage(auditErr) }
        });
      });
    }

    return allFixed;
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Auto-fix usage ledger gap failed for session', {
      extra: { sessionId: row.session_id, error: getErrorMessage(error) }
    });
    return false;
  }
}

interface InactiveMemberBookingRow {
  id: number;
  user_email: string;
  user_name: string;
  status: string;
  request_date: string;
  start_time: string;
  membership_status: string;
}

export async function checkApprovedBookingsForInactiveMembers(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;

  try {
    const today = getTodayPacific();
    const staleBookings = await db.execute(sql`
      SELECT br.id, br.user_email, br.user_name, br.status, br.request_date, br.start_time, u.membership_status
      FROM booking_requests br
      JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
      WHERE br.status IN ('approved', 'confirmed')
        AND br.request_date >= ${today}
        AND u.membership_status IN ('inactive', 'suspended', 'cancelled', 'terminated', 'archived')
      ORDER BY br.request_date ASC
      LIMIT 100
    `);

    const totalCount = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM booking_requests br
      JOIN users u ON LOWER(u.email) = LOWER(br.user_email)
      WHERE br.status IN ('approved', 'confirmed')
        AND br.request_date >= ${today}
        AND u.membership_status IN ('inactive', 'suspended', 'cancelled', 'terminated', 'archived')
    `);
    const total = (totalCount.rows[0] as unknown as CountRow)?.count || 0;

    if (shouldAutoFix && Number(total) > 0) {
      const { BookingStateService } = await import('../bookingService/bookingStateService');
      for (const row of staleBookings.rows as unknown as InactiveMemberBookingRow[]) {
        try {
          const result = await BookingStateService.cancelBooking({
            bookingId: row.id,
            source: 'system',
            staffNotes: `Auto-cancelled: member status is ${row.membership_status}`,
            cancelledBy: 'system_integrity_check',
          });
          if (result.success) {
            autoFixedCount++;
          } else {
            logger.error('[DataIntegrity] Auto-cancel returned failure for inactive member booking', {
              extra: { bookingId: row.id, error: result.error, statusCode: result.statusCode }
            });
          }
        } catch (cancelErr: unknown) {
          logger.error('[DataIntegrity] Failed to auto-cancel booking for inactive member', {
            extra: { bookingId: row.id, error: getErrorMessage(cancelErr) }
          });
        }
      }

      if (autoFixedCount > 0) {
        try {
          const { notifyAllStaff } = await import('../notificationService');
          await notifyAllStaff(
            'Inactive Members — Bookings Auto-Cancelled',
            `${autoFixedCount} of ${total} approved/confirmed booking(s) for inactive/suspended/cancelled members were auto-cancelled.`,
            'system',
            { url: '/admin/data-integrity' }
          );
        } catch (alertError: unknown) {
          logger.error('[DataIntegrity] Failed to send staff alert for inactive member bookings', { extra: { detail: getErrorMessage(alertError) } });
        }
      }
    }

    for (const row of staleBookings.rows as unknown as InactiveMemberBookingRow[]) {
      if (!shouldAutoFix) {
        issues.push({
          category: 'booking_issue',
          severity: 'warning',
          table: 'booking_requests',
          recordId: row.id,
          description: `Booking #${row.id} for "${row.user_name || row.user_email}" is ${row.status} but member status is "${row.membership_status}"`,
          suggestion: 'Review and cancel this booking or reactivate the membership',
          context: {
            bookingId: row.id,
            userEmail: row.user_email,
            bookingStatus: row.status,
            membershipStatus: row.membership_status,
            requestDate: row.request_date,
            startTime: row.start_time,
          }
        });
      }
    }

    const remainingCount = shouldAutoFix ? Math.max(0, Number(total) - autoFixedCount) : Number(total);

    return {
      checkName: 'Approved Bookings for Inactive Members',
      status: remainingCount === 0 ? 'pass' : 'warning',
      issueCount: remainingCount,
      issues,
      lastRun: new Date(),
      autoFixedCount: autoFixedCount > 0 ? autoFixedCount : undefined,
      autoFixSummary: autoFixedCount > 0 ? `Auto-cancelled ${autoFixedCount} booking(s) for inactive members` : undefined
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking approved bookings for inactive members:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Approved Bookings for Inactive Members',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_requests',
        recordId: 'check_error',
        description: `Failed to check approved bookings for inactive members: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}

export async function checkSessionsExceedingResourceCapacity(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const overcapacityResult = await db.execute(sql`
      SELECT bs.id as session_id, bs.session_date, bs.start_time, bs.end_time,
             r.name as resource_name, r.capacity as resource_capacity,
             COUNT(bp.id)::int as participant_count
      FROM booking_sessions bs
      JOIN resources r ON bs.resource_id = r.id
      JOIN booking_participants bp ON bp.session_id = bs.id
      WHERE r.capacity IS NOT NULL
      GROUP BY bs.id, bs.session_date, bs.start_time, bs.end_time, r.name, r.capacity
      HAVING COUNT(bp.id) > r.capacity
      ORDER BY bs.session_date DESC
      LIMIT 100
    `);

    for (const row of overcapacityResult.rows as unknown as OvercapacitySessionRow[]) {
      issues.push({
        category: 'data_quality',
        severity: 'warning',
        table: 'booking_sessions',
        recordId: row.session_id,
        description: `Session #${row.session_id} on ${row.session_date} (${row.resource_name}) has ${row.participant_count} participants but resource capacity is ${row.resource_capacity}`,
        suggestion: 'Review participant roster and remove excess participants, or increase resource capacity if appropriate. DB trigger now prevents new overcapacity inserts.',
        context: {
          sessionId: row.session_id,
          bookingDate: row.session_date,
          startTime: row.start_time,
          endTime: row.end_time,
          resourceName: row.resource_name,
          resourceCapacity: row.resource_capacity,
          participantCount: row.participant_count
        }
      });
    }

    return {
      checkName: 'Sessions Exceeding Resource Capacity',
      status: issues.length === 0 ? 'pass' : 'warning',
      issueCount: issues.length,
      issues,
      lastRun: new Date()
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking sessions exceeding resource capacity:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Sessions Exceeding Resource Capacity',
      status: 'fail',
      issueCount: 0,
      issues: [],
      lastRun: new Date()
    };
  }
}

export async function checkSessionOverlaps(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;
  const today = getTodayPacific();

  try {
    const overlaps = await db.execute(sql`
      WITH session_ranges AS (
        SELECT
          bs.id,
          bs.resource_id,
          bs.session_date,
          bs.start_time,
          bs.end_time,
          (bs.session_date + bs.start_time)::timestamp AS range_start,
          CASE WHEN bs.end_time <= bs.start_time
            THEN (bs.session_date + bs.end_time + INTERVAL '1 day')::timestamp
            ELSE (bs.session_date + bs.end_time)::timestamp
          END AS range_end
        FROM booking_sessions bs
        WHERE bs.start_time != bs.end_time
          AND bs.session_date >= ${getTodayPacific()}::date - INTERVAL '90 days'
      )
      SELECT
        sr1.id AS session1_id,
        sr2.id AS session2_id,
        sr1.resource_id,
        r.name AS resource_name,
        COALESCE(r.type, 'simulator') AS resource_type,
        sr1.session_date,
        sr1.start_time AS s1_start,
        sr1.end_time AS s1_end,
        sr2.start_time AS s2_start,
        sr2.end_time AS s2_end
      FROM session_ranges sr1
      JOIN session_ranges sr2
        ON sr1.resource_id = sr2.resource_id
        AND sr1.id < sr2.id
        AND ABS(sr1.session_date - sr2.session_date) <= 1
        AND tsrange(sr1.range_start, sr1.range_end, '[)')
           && tsrange(sr2.range_start, sr2.range_end, '[)')
      LEFT JOIN resources r ON sr1.resource_id = r.id
      LIMIT 200
    `);

    for (const row of overlaps.rows as unknown as SessionOverlapRow[]) {
      const isPast = row.session_date && String(row.session_date) < today;
      if (shouldAutoFix && isPast) {
        autoFixedCount++;
        continue;
      }

      issues.push({
        category: 'booking_issue',
        severity: 'error',
        table: 'booking_sessions',
        recordId: `${row.session1_id}-${row.session2_id}`,
        description: `Sessions #${row.session1_id} and #${row.session2_id} overlap on ${row.resource_type} "${row.resource_name || row.resource_id}" on ${row.session_date} (${row.s1_start}–${row.s1_end} vs ${row.s2_start}–${row.s2_end})`,
        suggestion: 'Investigate and resolve the double-booking. The DB trigger should prevent new overlaps; this may be legacy data or an edge case.',
        context: {
          resourceId: Number(row.resource_id),
          resourceName: row.resource_name || undefined,
          resourceType: row.resource_type || undefined,
          bookingDate: row.session_date || undefined,
          startTime: row.s1_start || undefined,
          endTime: row.s1_end || undefined,
          session1Id: Number(row.session1_id),
          session2Id: Number(row.session2_id),
          s2Start: row.s2_start || undefined,
          s2End: row.s2_end || undefined,
        }
      });
    }
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking session overlaps:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Session Overlaps (All Resources)',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_sessions',
        recordId: 'check_error',
        description: `Failed to check session overlaps: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
  return {
    checkName: 'Session Overlaps (All Resources)',
    status: issues.length === 0 ? 'pass' : 'fail',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
    autoFixedCount,
    autoFixSummary: autoFixedCount > 0 ? `Auto-acknowledged ${autoFixedCount} historical session overlaps` : undefined
  };
}

export async function checkWellnessBlockGaps(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;

  try {
    const gaps = await db.execute(sql`
      WITH expected_blocks AS (
        SELECT
          wc.id AS class_id,
          wc.title AS class_title,
          wc.date AS class_date,
          wc.time AS class_time,
          (wc.time::time + (wc.duration || ' minutes')::interval)::time AS class_end_time,
          wc.duration,
          r.id AS resource_id,
          r.name AS resource_name
        FROM wellness_classes wc
        CROSS JOIN resources r
        WHERE wc.is_active = true
          AND wc.date >= ${getTodayPacific()}
          AND (
            (wc.block_simulators = true AND r.type = 'simulator')
            OR (wc.block_conference_room = true AND r.type = 'conference_room')
          )
      ),
      block_coverage AS (
        SELECT
          eb.class_id,
          eb.resource_id,
          MIN(ab.start_time) AS earliest_block_start,
          MAX(ab.end_time) AS latest_block_end,
          COUNT(ab.id) AS block_count
        FROM expected_blocks eb
        LEFT JOIN availability_blocks ab
          ON ab.wellness_class_id = eb.class_id
          AND ab.resource_id = eb.resource_id
          AND ab.block_date = eb.class_date::date
        GROUP BY eb.class_id, eb.resource_id
      )
      SELECT
        eb.class_id,
        eb.class_title,
        eb.class_date,
        eb.class_time,
        eb.class_end_time,
        eb.duration,
        eb.resource_id,
        eb.resource_name,
        bc.earliest_block_start AS block_start,
        bc.latest_block_end AS block_end
      FROM expected_blocks eb
      JOIN block_coverage bc ON bc.class_id = eb.class_id AND bc.resource_id = eb.resource_id
      WHERE bc.block_count = 0
        OR bc.earliest_block_start > eb.class_time::time
        OR bc.latest_block_end < eb.class_end_time::time
      ORDER BY eb.class_date, eb.class_time
      LIMIT 200
    `);

    for (const row of gaps.rows as unknown as WellnessBlockGapRow[]) {
      const hasNoBlock = row.block_start === null;

      if (shouldAutoFix && hasNoBlock && row.class_date && row.class_time && row.class_end_time) {
        try {
          await db.execute(sql`
            INSERT INTO availability_blocks (resource_id, block_date, start_time, end_time, block_type, wellness_class_id, created_at)
            VALUES (${row.resource_id}, ${row.class_date}::date, ${row.class_time}::time, ${row.class_end_time}::time, 'wellness', ${row.class_id}, NOW())
            ON CONFLICT DO NOTHING
          `);
          autoFixedCount++;
          logger.info(`[AutoHeal] Created availability block for wellness class "${row.class_title}" on ${row.class_date} for resource "${row.resource_name}"`);
          continue;
        } catch (fixErr: unknown) {
          logger.error('[AutoHeal] Failed to create wellness availability block', {
            extra: { classId: row.class_id, resourceId: row.resource_id, error: getErrorMessage(fixErr) }
          });
        }
      }

      const gapDetail = hasNoBlock
        ? 'has NO availability block'
        : `has block coverage (${row.block_start}–${row.block_end}) that doesn't fully cover the class (${row.class_time}–${row.class_end_time})`;

      issues.push({
        category: 'booking_issue',
        severity: 'error',
        table: 'wellness_classes',
        recordId: `${row.class_id}-${row.resource_id}`,
        description: `Wellness class "${row.class_title}" on ${row.class_date} (${row.class_time}–${row.class_end_time}) ${gapDetail} on resource "${row.resource_name}"`,
        suggestion: 'Re-save the wellness class to regenerate availability blocks, or manually create the missing block.',
        context: {
          classId: row.class_id,
          classTitle: row.class_title || undefined,
          classDate: row.class_date || undefined,
          startTime: row.class_time || undefined,
          endTime: row.class_end_time || undefined,
          resourceId: Number(row.resource_id),
          resourceName: row.resource_name || undefined,
        }
      });
    }
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking wellness block gaps:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Wellness Block Coverage',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'wellness_classes',
        recordId: 'check_error',
        description: `Failed to check wellness block gaps: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }

  return {
    checkName: 'Wellness Block Coverage',
    status: issues.length === 0 ? 'pass' : 'fail',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
    autoFixedCount,
    autoFixSummary: autoFixedCount > 0 ? `Created ${autoFixedCount} missing wellness availability blocks` : undefined
  };
}

export async function checkWalletPassBookingSync(options?: { autoFix?: boolean }): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const shouldAutoFix = options?.autoFix ?? false;
  let autoFixedCount = 0;

  try {
    const unvoidedForTerminal = await db.execute(sql`
      SELECT bwp.id as pass_id, bwp.serial_number, bwp.booking_id, bwp.member_id,
             bwp.voided_at, br.status as booking_status,
             br.user_email, br.user_name, br.request_date
      FROM booking_wallet_passes bwp
      JOIN booking_requests br ON bwp.booking_id = br.id
      WHERE bwp.voided_at IS NULL
        AND br.status IN ('cancelled', 'declined', 'expired', 'cancellation_pending')
      ORDER BY br.request_date DESC
      LIMIT 100
    `);

    if (shouldAutoFix && unvoidedForTerminal.rows.length > 0) {
      const { voidBookingPass } = await import('../../walletPass/bookingPassService');
      for (const row of unvoidedForTerminal.rows as unknown as WalletPassSyncRow[]) {
        try {
          await voidBookingPass(row.booking_id);
          const [verifyRow] = (await db.execute(sql`
            SELECT voided_at FROM booking_wallet_passes WHERE id = ${row.pass_id}
          `)).rows as unknown as Array<{ voided_at: Date | null }>;
          if (verifyRow?.voided_at) {
            autoFixedCount++;
            logger.info('[DataIntegrity] Auto-fixed: voided wallet pass for terminal booking', {
              extra: { bookingId: row.booking_id, serialNumber: row.serial_number, bookingStatus: row.booking_status }
            });
          } else {
            logger.warn('[DataIntegrity] voidBookingPass completed but pass still not voided', {
              extra: { bookingId: row.booking_id, serialNumber: row.serial_number, passId: row.pass_id }
            });
          }
        } catch (fixErr: unknown) {
          logger.error('[DataIntegrity] Failed to auto-void wallet pass for terminal booking', {
            extra: { bookingId: row.booking_id, serialNumber: row.serial_number, error: getErrorMessage(fixErr) }
          });
        }
      }
    }

    if (!shouldAutoFix) {
      for (const row of unvoidedForTerminal.rows as unknown as WalletPassSyncRow[]) {
        issues.push({
          category: 'sync_mismatch',
          severity: 'warning',
          table: 'booking_wallet_passes',
          recordId: row.pass_id,
          description: `Wallet pass "${row.serial_number}" for booking #${row.booking_id} is still active but booking is "${row.booking_status}"`,
          suggestion: 'Void the pass and re-trigger a push update to the member\'s device',
          context: {
            serialNumber: row.serial_number,
            bookingId: row.booking_id,
            bookingStatus: row.booking_status,
            memberEmail: row.user_email || undefined,
            memberName: row.user_name || undefined,
            bookingDate: row.request_date || undefined,
            passId: row.pass_id,
          }
        });
      }
    }

    const voidedForActive = await db.execute(sql`
      SELECT bwp.id as pass_id, bwp.serial_number, bwp.booking_id, bwp.member_id,
             bwp.voided_at, br.status as booking_status,
             br.user_email, br.user_name, br.request_date
      FROM booking_wallet_passes bwp
      JOIN booking_requests br ON bwp.booking_id = br.id
      WHERE bwp.voided_at IS NOT NULL
        AND br.status IN ('approved', 'confirmed', 'attended', 'checked_in')
      ORDER BY br.request_date DESC
      LIMIT 100
    `);

    for (const row of voidedForActive.rows as unknown as WalletPassSyncRow[]) {
      issues.push({
        category: 'sync_mismatch',
        severity: 'warning',
        table: 'booking_wallet_passes',
        recordId: row.pass_id,
        description: `Wallet pass "${row.serial_number}" for booking #${row.booking_id} was voided but booking is still "${row.booking_status}"`,
        suggestion: 'Review and un-void the pass manually or verify the booking status is correct',
        context: {
          serialNumber: row.serial_number,
          bookingId: row.booking_id,
          bookingStatus: row.booking_status,
          memberEmail: row.user_email || undefined,
          memberName: row.user_name || undefined,
          bookingDate: row.request_date || undefined,
          passId: row.pass_id,
          voidedAt: row.voided_at || undefined,
        }
      });
    }

    return {
      checkName: 'Wallet Pass Booking Sync',
      status: issues.length === 0 ? 'pass' : issues.length > 10 ? 'fail' : 'warning',
      issueCount: issues.length,
      issues,
      lastRun: new Date(),
      autoFixedCount: autoFixedCount > 0 ? autoFixedCount : undefined,
      autoFixSummary: autoFixedCount > 0 ? `Auto-fixed ${autoFixedCount} wallet pass sync issues` : undefined
    };
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Error checking wallet pass booking sync:', { extra: { detail: getErrorMessage(error) } });
    return {
      checkName: 'Wallet Pass Booking Sync',
      status: 'warning',
      issueCount: 1,
      issues: [{
        category: 'system_error',
        severity: 'error',
        table: 'booking_wallet_passes',
        recordId: 'check_error',
        description: `Failed to check wallet pass booking sync: ${getErrorMessage(error)}`,
        suggestion: 'Review server logs for details and retry'
      }],
      lastRun: new Date()
    };
  }
}
