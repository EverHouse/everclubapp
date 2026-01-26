import { pool } from '../db';
import { getMemberTierByEmail, getTierLimits } from '../tierService';
import { getDailyUsageFromLedger, getGuestPassInfo, calculateOverageFee } from '../bookingService/usageCalculator';
import { MemberService, isEmail, normalizeEmail, isUUID } from '../memberService';
import { FeeBreakdown, FeeComputeParams, FeeLineItem } from '../../../shared/models/billing';
import { logger } from '../logger';

const OVERAGE_RATE_PER_30_MIN = 25;
const FLAT_GUEST_FEE_CENTS = 2500;

export function getEffectivePlayerCount(declared: number | undefined, actual: number): number {
  const declaredCount = declared && declared > 0 ? declared : 1;
  return Math.max(declaredCount, actual, 1);
}

async function resolveToEmail(identifier: string | undefined): Promise<string> {
  if (!identifier) return '';
  
  if (isEmail(identifier)) {
    return normalizeEmail(identifier);
  }
  
  if (isUUID(identifier)) {
    const member = await MemberService.findById(identifier);
    if (member) {
      return member.normalizedEmail;
    }
  }
  
  return identifier;
}

interface SessionData {
  sessionId: number;
  bookingId: number;
  sessionDate: string;
  sessionDuration: number;
  declaredPlayerCount: number;
  hostEmail: string;
  participants: Array<{
    participantId: number;
    userId?: string;
    email?: string;
    displayName: string;
    participantType: 'owner' | 'member' | 'guest';
  }>;
}

async function loadSessionData(sessionId?: number, bookingId?: number): Promise<SessionData | null> {
  if (!sessionId && !bookingId) return null;
  
  try {
    let query: string;
    let params: any[];
    
    if (sessionId) {
      query = `
        SELECT 
          bs.id as session_id,
          br.id as booking_id,
          bs.session_date,
          br.duration_minutes,
          COALESCE(br.trackman_player_count, br.guest_count + 1, 1) as declared_player_count,
          br.user_email as host_email
        FROM booking_sessions bs
        JOIN booking_requests br ON br.session_id = bs.id
        WHERE bs.id = $1
        LIMIT 1
      `;
      params = [sessionId];
    } else {
      query = `
        SELECT 
          bs.id as session_id,
          br.id as booking_id,
          bs.session_date,
          br.duration_minutes,
          COALESCE(br.trackman_player_count, br.guest_count + 1, 1) as declared_player_count,
          br.user_email as host_email
        FROM booking_requests br
        JOIN booking_sessions bs ON br.session_id = bs.id
        WHERE br.id = $1
        LIMIT 1
      `;
      params = [bookingId];
    }
    
    const sessionResult = await pool.query(query, params);
    if (sessionResult.rows.length === 0) return null;
    
    const session = sessionResult.rows[0];
    
    const participantsResult = await pool.query(
      `SELECT 
        bp.id as participant_id,
        bp.user_id,
        u.email,
        bp.display_name,
        bp.participant_type
       FROM booking_participants bp
       LEFT JOIN users u ON bp.user_id = u.id
       WHERE bp.session_id = $1
       ORDER BY bp.participant_type = 'owner' DESC, bp.created_at ASC`,
      [session.session_id]
    );
    
    return {
      sessionId: session.session_id,
      bookingId: session.booking_id,
      sessionDate: session.session_date,
      sessionDuration: session.duration_minutes,
      declaredPlayerCount: parseInt(session.declared_player_count) || 1,
      hostEmail: session.host_email,
      participants: participantsResult.rows.map(row => ({
        participantId: row.participant_id,
        userId: row.user_id,
        email: row.email,
        displayName: row.display_name,
        participantType: row.participant_type as 'owner' | 'member' | 'guest'
      }))
    };
  } catch (error) {
    logger.error('[UnifiedFeeService] Error loading session data:', { error: error as Error });
    return null;
  }
}

export async function computeFeeBreakdown(params: FeeComputeParams): Promise<FeeBreakdown> {
  let sessionDate: string;
  let sessionDuration: number;
  let declaredPlayerCount: number;
  let hostEmail: string;
  let participants: Array<{
    participantId?: number;
    userId?: string;
    email?: string;
    displayName: string;
    participantType: 'owner' | 'member' | 'guest';
  }>;
  let sessionId: number | undefined;
  
  if (params.sessionId || params.bookingId) {
    const sessionData = await loadSessionData(params.sessionId, params.bookingId);
    if (!sessionData) {
      throw new Error(`Session or booking not found: sessionId=${params.sessionId}, bookingId=${params.bookingId}`);
    }
    sessionDate = sessionData.sessionDate;
    sessionDuration = sessionData.sessionDuration;
    declaredPlayerCount = sessionData.declaredPlayerCount;
    hostEmail = sessionData.hostEmail;
    participants = sessionData.participants;
    sessionId = sessionData.sessionId;
  } else {
    if (!params.sessionDate || !params.sessionDuration || !params.hostEmail || !params.participants) {
      throw new Error('Missing required parameters for fee calculation preview');
    }
    sessionDate = params.sessionDate;
    sessionDuration = params.sessionDuration;
    declaredPlayerCount = params.declaredPlayerCount || 1;
    hostEmail = params.hostEmail;
    participants = params.participants;
    sessionId = undefined;
  }
  
  const actualPlayerCount = participants.length;
  const effectivePlayerCount = getEffectivePlayerCount(declaredPlayerCount, actualPlayerCount);
  
  const minutesPerParticipant = Math.floor(sessionDuration / effectivePlayerCount);
  
  const resolvedHostEmail = await resolveToEmail(hostEmail);
  const hostTier = await getMemberTierByEmail(resolvedHostEmail);
  const hostTierLimits = hostTier ? await getTierLimits(hostTier) : null;
  const guestPassInfo = await getGuestPassInfo(resolvedHostEmail, hostTier || undefined);
  
  let guestPassesRemaining = guestPassInfo.remaining;
  const guestPassesAvailable = guestPassInfo.remaining;
  
  const lineItems: FeeLineItem[] = [];
  let totalOverageCents = 0;
  let totalGuestCents = 0;
  let guestPassesUsed = 0;
  
  for (const participant of participants) {
    const lineItem: FeeLineItem = {
      participantId: (participant as any).participantId,
      userId: participant.userId,
      displayName: participant.displayName,
      participantType: participant.participantType,
      minutesAllocated: 0,
      overageCents: 0,
      guestCents: 0,
      totalCents: 0,
      guestPassUsed: false
    };
    
    if (participant.participantType === 'guest') {
      lineItem.minutesAllocated = minutesPerParticipant;
      
      if (guestPassInfo.hasGuestPassBenefit && guestPassesRemaining > 0) {
        lineItem.guestPassUsed = true;
        guestPassesRemaining--;
        guestPassesUsed++;
        lineItem.guestCents = 0;
      } else {
        lineItem.guestCents = FLAT_GUEST_FEE_CENTS;
        totalGuestCents += FLAT_GUEST_FEE_CENTS;
      }
      
      lineItem.totalCents = lineItem.guestCents;
    } else if (participant.participantType === 'owner') {
      lineItem.minutesAllocated = sessionDuration;
      
      const ownerEmail = await resolveToEmail(participant.email || participant.userId || hostEmail);
      const tierName = await getMemberTierByEmail(ownerEmail);
      const tierLimits = tierName ? await getTierLimits(tierName) : null;
      const dailyAllowance = tierLimits?.daily_sim_minutes ?? 0;
      const unlimitedAccess = tierLimits?.unlimited_access ?? false;
      
      const excludeId = params.excludeSessionFromUsage ? sessionId : undefined;
      const usedMinutesToday = await getDailyUsageFromLedger(ownerEmail, sessionDate, excludeId);
      
      lineItem.tierName = tierName || undefined;
      lineItem.dailyAllowance = dailyAllowance;
      lineItem.usedMinutesToday = usedMinutesToday;
      
      if (!unlimitedAccess && dailyAllowance < 999) {
        const totalAfterSession = usedMinutesToday + sessionDuration;
        const overageResult = calculateOverageFee(totalAfterSession, dailyAllowance);
        const priorOverage = calculateOverageFee(usedMinutesToday, dailyAllowance);
        
        const overageMinutes = Math.max(0, overageResult.overageMinutes - priorOverage.overageMinutes);
        const overageFee = Math.max(0, overageResult.overageFee - priorOverage.overageFee);
        
        lineItem.overageCents = overageFee * 100;
        totalOverageCents += lineItem.overageCents;
      }
      
      lineItem.totalCents = lineItem.overageCents;
    } else {
      lineItem.minutesAllocated = minutesPerParticipant;
      
      const memberEmail = await resolveToEmail(participant.email || participant.userId);
      const tierName = await getMemberTierByEmail(memberEmail);
      const tierLimits = tierName ? await getTierLimits(tierName) : null;
      const dailyAllowance = tierLimits?.daily_sim_minutes ?? 0;
      const unlimitedAccess = tierLimits?.unlimited_access ?? false;
      
      const excludeId = params.excludeSessionFromUsage ? sessionId : undefined;
      const usedMinutesToday = await getDailyUsageFromLedger(memberEmail, sessionDate, excludeId);
      
      lineItem.tierName = tierName || undefined;
      lineItem.dailyAllowance = dailyAllowance;
      lineItem.usedMinutesToday = usedMinutesToday;
      
      if (!unlimitedAccess && dailyAllowance < 999) {
        const totalAfterSession = usedMinutesToday + minutesPerParticipant;
        const overageResult = calculateOverageFee(totalAfterSession, dailyAllowance);
        const priorOverage = calculateOverageFee(usedMinutesToday, dailyAllowance);
        
        const overageMinutes = Math.max(0, overageResult.overageMinutes - priorOverage.overageMinutes);
        const overageFee = Math.max(0, overageResult.overageFee - priorOverage.overageFee);
        
        lineItem.overageCents = overageFee * 100;
        totalOverageCents += lineItem.overageCents;
      }
      
      lineItem.totalCents = lineItem.overageCents;
    }
    
    lineItems.push(lineItem);
  }
  
  return {
    totals: {
      totalCents: totalOverageCents + totalGuestCents,
      overageCents: totalOverageCents,
      guestCents: totalGuestCents,
      guestPassesUsed,
      guestPassesAvailable
    },
    participants: lineItems,
    metadata: {
      effectivePlayerCount,
      declaredPlayerCount,
      actualPlayerCount,
      sessionDuration,
      sessionDate,
      source: params.source
    }
  };
}

export async function applyFeeBreakdownToParticipants(
  sessionId: number,
  breakdown: FeeBreakdown
): Promise<void> {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    for (const participant of breakdown.participants) {
      if (participant.participantId) {
        await client.query(
          `UPDATE booking_participants 
           SET cached_fee_cents = $1
           WHERE id = $2`,
          [participant.totalCents, participant.participantId]
        );
      }
    }
    
    await client.query('COMMIT');
    logger.info('[UnifiedFeeService] Applied fee breakdown to participants', {
      sessionId,
      participantCount: breakdown.participants.length,
      totalCents: breakdown.totals.totalCents
    });
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('[UnifiedFeeService] Error applying fee breakdown:', { error: error as Error });
    throw error;
  } finally {
    client.release();
  }
}

export async function invalidateCachedFees(
  participantIds: number[],
  reason: string
): Promise<void> {
  if (participantIds.length === 0) return;
  
  try {
    await pool.query(
      `UPDATE booking_participants 
       SET cached_fee_cents = 0 
       WHERE id = ANY($1::int[])`,
      [participantIds]
    );
    
    logger.info('[UnifiedFeeService] Invalidated cached fees', {
      participantIds,
      reason
    });
  } catch (error) {
    logger.error('[UnifiedFeeService] Error invalidating cached fees:', { error: error as Error });
  }
}

export async function recalculateSessionFees(
  sessionId: number,
  source: FeeComputeParams['source']
): Promise<FeeBreakdown> {
  const breakdown = await computeFeeBreakdown({
    sessionId,
    source,
    excludeSessionFromUsage: true
  });
  
  await applyFeeBreakdownToParticipants(sessionId, breakdown);
  
  return breakdown;
}
