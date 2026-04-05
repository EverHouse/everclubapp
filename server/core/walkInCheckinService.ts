import { db } from '../db';
import { sql } from 'drizzle-orm';
import { logger } from './logger';
import { broadcastMemberStatsUpdated, broadcastToStaff } from './websocket';
import { notifyMember } from './notificationService';
import { updateHubSpotContactVisitCount } from './memberSync';
import { sendFirstVisitConfirmationEmail } from '../emails/firstVisitEmail';
import { getErrorMessage } from '../utils/errorUtils';
import { invalidateCache } from './queryCache';
import { getTodayPacific } from '../utils/dateUtils';

interface MemberRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  membership_status: string | null;
  tier: string | null;
  hubspot_id: string | null;
  lifetime_visits: number | null;
  wellhub_status: string | null;
}

interface RecentCheckinRow {
  id: number;
  created_at: string;
}

interface VisitCountRow {
  lifetime_visits: number;
}

interface PinnedNoteRow {
  content: string;
  created_by_name: string | null;
}

export interface WalkInCheckinParams {
  memberId: string;
  checkedInBy: string;
  checkedInByName: string | null;
  source: 'qr' | 'nfc' | 'kiosk' | 'wellhub';
  isWellhub?: boolean;
}

export interface WalkInCheckinResult {
  success: boolean;
  memberName: string;
  memberEmail: string;
  tier: string | null;
  lifetimeVisits: number;
  pinnedNotes: Array<{ content: string; createdBy: string }>;
  membershipStatus: string | null;
  alreadyCheckedIn?: boolean;
  error?: string;
}

export async function processWalkInCheckin(params: WalkInCheckinParams): Promise<WalkInCheckinResult> {
  try {
    const today = getTodayPacific();
    const closureResult = await db.execute(sql`
      SELECT title FROM facility_closures
      WHERE is_active = true AND start_date <= ${today} AND end_date >= ${today}
        AND start_time IS NULL AND end_time IS NULL
      LIMIT 1
    `);
    if (closureResult.rows.length > 0) {
      const closureTitle = (closureResult.rows[0] as { title?: string }).title || 'facility closure';
      return { success: false, memberName: '', memberEmail: '', tier: null, lifetimeVisits: 0, pinnedNotes: [], membershipStatus: null, error: `Club is closed today: ${closureTitle}` };
    }

    const memberResult = await db.execute(sql`
      SELECT u.id, u.email, u.first_name, u.last_name, u.membership_status, u.tier, u.hubspot_id, u.lifetime_visits, u.wellhub_status
      FROM users u
      WHERE u.id = ${params.memberId}
      LIMIT 1
    `);

    if (memberResult.rows.length === 0) {
      return { success: false, memberName: '', memberEmail: '', tier: null, lifetimeVisits: 0, pinnedNotes: [], membershipStatus: null, error: 'Member not found' };
    }

    const member = (memberResult.rows as unknown as MemberRow[])[0];
    const displayName = [member.first_name, member.last_name].filter(Boolean).join(' ') || member.email.split('@')[0];

    const newVisitCount = await db.transaction(async (tx) => {
      const lockedUser = await tx.execute(sql`SELECT id FROM users WHERE id = ${params.memberId} FOR UPDATE`);
      if (lockedUser.rows.length === 0) throw new Error('Member not found');

      const recentCheckin = await tx.execute(sql`SELECT id FROM walk_in_visits WHERE member_email = ${member.email} AND created_at > NOW() - INTERVAL '2 minutes' LIMIT 1`);
      if ((recentCheckin.rows as unknown as RecentCheckinRow[]).length > 0) {
        return null;
      }

      await tx.execute(sql`INSERT INTO walk_in_visits (member_email, member_id, checked_in_by, checked_in_by_name, source, created_at)
         VALUES (${member.email}, ${String(member.id)}, ${params.checkedInBy}, ${params.checkedInByName}, ${params.source}, NOW())`);

      const updateResult = await tx.execute(sql`UPDATE users SET lifetime_visits = COALESCE(lifetime_visits, 0) + 1 WHERE id = ${params.memberId} RETURNING lifetime_visits`);
      const visitRows = updateResult.rows as unknown as VisitCountRow[];
      return visitRows[0]?.lifetime_visits || 1;
    });

    if (newVisitCount === null) {
      return { success: false, memberName: displayName, memberEmail: member.email, tier: member.tier, lifetimeVisits: member.lifetime_visits || 0, pinnedNotes: [], membershipStatus: member.membership_status, alreadyCheckedIn: true, error: 'This member was already checked in less than 2 minutes ago' };
    }

    invalidateCache('members_directory');

    if (member.hubspot_id) {
      updateHubSpotContactVisitCount(String(member.hubspot_id), newVisitCount)
        .catch(err => logger.error(`[WalkInCheckin] Failed to sync visit count to HubSpot:`, { extra: { error: getErrorMessage(err) } }));
    }

    try { broadcastMemberStatsUpdated(member.email, { lifetimeVisits: newVisitCount }); } catch (err: unknown) {logger.error('[Broadcast] Stats update error:', { extra: { error: getErrorMessage(err) } }); }

    notifyMember({
      userEmail: member.email,
      title: 'Check-In Complete',
      message: "Welcome back! You've been checked in by staff.",
      type: 'booking',
      relatedType: 'booking'
    }).catch(err => logger.error(`[WalkInCheckin] Failed to send notification:`, { extra: { error: getErrorMessage(err) } }));

    if (newVisitCount === 1 && member.membership_status?.toLowerCase() === 'trialing') {
      sendFirstVisitConfirmationEmail(String(member.email), { firstName: member.first_name || undefined })
        .then(() => logger.info(`[WalkInCheckin] Sent first visit confirmation email to trial member:`, { extra: { email: member.email } }))
        .catch(err => logger.error(`[WalkInCheckin] Failed to send first visit confirmation email:`, { extra: { error: getErrorMessage(err) } }));
    }

    const pinnedNotesResult = await db.execute(sql`SELECT content, created_by_name FROM member_notes WHERE member_email = ${member.email} AND is_pinned = true ORDER BY created_at DESC`);
    const noteRows = pinnedNotesResult.rows as unknown as PinnedNoteRow[];
    const pinnedNotes = noteRows.map(n => ({
      content: String(n.content),
      createdBy: n.created_by_name || 'Staff'
    }));

    broadcastToStaff({
      type: 'walkin_checkin',
      data: {
        memberName: displayName,
        memberEmail: member.email,
        tier: member.tier,
        lifetimeVisits: newVisitCount,
        pinnedNotes,
        membershipStatus: member.membership_status,
        source: params.source,
        isWellhub: params.isWellhub || false,
        wellhubStatus: member.wellhub_status || null
      }
    });

    logger.info(`[WalkInCheckin] Walk-in check-in: ${displayName} by ${params.checkedInBy}. Visit #${newVisitCount}`, { extra: { displayName, memberEmail: member.email, checkedInBy: params.checkedInBy, newVisitCount, source: params.source } });

    return {
      success: true,
      memberName: displayName,
      memberEmail: member.email,
      tier: member.tier,
      lifetimeVisits: newVisitCount,
      pinnedNotes,
      membershipStatus: member.membership_status
    };
  } catch (error: unknown) {
    logger.error(`[WalkInCheckin] Failed to process walk-in check-in:`, { extra: { memberId: params.memberId, source: params.source, error: getErrorMessage(error) } });
    return { success: false, memberName: '', memberEmail: '', tier: null, lifetimeVisits: 0, pinnedNotes: [], membershipStatus: null, error: 'Unable to complete check-in. Please try again or ask staff for help.' };
  }
}
