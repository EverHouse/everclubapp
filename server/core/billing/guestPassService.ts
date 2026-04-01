import { eq, sql, and, lt } from 'drizzle-orm';
import { db } from '../../db';
import { guestPasses } from '../../../shared/schema';
import { getTierLimits } from '../tierService';
import { broadcastMemberStatsUpdated } from '../websocket';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { isSyntheticEmail, notifyMember } from '../notificationService';
import { isPlaceholderGuestName } from './pricingConfig';
import { sendPassUpdateForMemberByEmail } from '../../walletPass/apnPushService';

export async function useGuestPass(
  memberEmail: string, 
  guestName?: string,
  sendNotification: boolean = true
): Promise<{ success: boolean; error?: string; remaining?: number }> {
  if (isPlaceholderGuestName(guestName)) {
    return { success: false, error: `Cannot use guest pass for placeholder "${guestName}". Assign a real guest first.` };
  }
  
  try {
    const normalizedEmail = memberEmail.toLowerCase();
    
    const { data: _data, remaining, notificationMessage } = await db.transaction(async (tx) => {
      const lockResult = await tx.execute(
        sql`SELECT id, passes_used, passes_total FROM guest_passes WHERE LOWER(member_email) = ${normalizedEmail} ORDER BY id ASC FOR UPDATE`
      );
      if (lockResult.rows.length === 0) {
        throw new Error('No guest passes remaining');
      }
      const row = lockResult.rows[0] as { id: number; passes_used: number; passes_total: number };

      const holdsResult = await tx.execute(
        sql`SELECT COALESCE(SUM(passes_held), 0) as total_held FROM guest_pass_holds WHERE LOWER(member_email) = ${normalizedEmail} AND (expires_at IS NULL OR expires_at > NOW())`
      );
      const passesHeld = parseInt(String((holdsResult.rows[0] as Record<string, unknown>)?.total_held || '0'), 10);
      const available = row.passes_total - row.passes_used - passesHeld;

      if (available <= 0) {
        throw new Error('No guest passes remaining');
      }

      const result = await tx.update(guestPasses)
        .set({ passesUsed: sql`${guestPasses.passesUsed} + 1` })
        .where(and(
          sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`,
          lt(guestPasses.passesUsed, guestPasses.passesTotal)
        ))
        .returning();
      
      if (result.length === 0) {
        throw new Error('No guest passes remaining');
      }
      
      const data = result[0];
      const remaining = Math.max(0, data.passesTotal - data.passesUsed - passesHeld);
      
      let notificationMessage: string | null = null;
      if (sendNotification) {
        const message = guestName 
          ? `Guest pass used for ${guestName}. You have ${remaining} pass${remaining !== 1 ? 'es' : ''} remaining this year.`
          : `Guest pass used. You have ${remaining} pass${remaining !== 1 ? 'es' : ''} remaining this year.`;
        notificationMessage = message;
      }
      
      return { data, remaining, notificationMessage };
    });
    
    if (notificationMessage) {
      notifyMember({
        userEmail: normalizedEmail,
        title: 'Guest Pass Used',
        message: notificationMessage,
        type: 'guest_pass',
        relatedType: 'guest_pass',
        url: '/member/profile'
      }).catch(err => logger.error('Guest pass notification failed', { extra: { error: getErrorMessage(err) } }));
    }
    
    try { broadcastMemberStatsUpdated(normalizedEmail, { guestPasses: remaining }); } catch (err: unknown) { logger.error('[Broadcast] Stats update error', { extra: { error: getErrorMessage(err) } }); }
    
    return { success: true, remaining };
  } catch (error: unknown) {
    const msg = getErrorMessage(error) || 'Failed to use guest pass';
    if (msg === 'No guest passes remaining') {
      return { success: false, error: msg };
    }
    logger.error('[useGuestPass] Error', { extra: { error: getErrorMessage(error) } });
    return { success: false, error: 'Failed to use guest pass' };
  }
}

export async function refundGuestPass(
  memberEmail: string,
  guestName?: string,
  sendNotification: boolean = true,
  txClient?: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<{ success: boolean; error?: string; remaining?: number }> {
  try {
    const normalizedEmail = memberEmail.toLowerCase();
    
    const executeRefund = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
      const result = await tx.update(guestPasses)
        .set({ passesUsed: sql`GREATEST(0, ${guestPasses.passesUsed} - 1)` })
        .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`)
        .returning();
      
      if (result.length === 0) {
        throw new Error('Member guest pass record not found');
      }
      
      const data = result[0];
      const remaining = data.passesTotal - data.passesUsed;
      
      let notificationMessage: string | null = null;
      if (sendNotification) {
        const message = guestName 
          ? `Guest pass refunded for ${guestName}. You now have ${remaining} pass${remaining !== 1 ? 'es' : ''} remaining this year.`
          : `Guest pass refunded. You now have ${remaining} pass${remaining !== 1 ? 'es' : ''} remaining this year.`;
        notificationMessage = message;
      }
      
      return { data, remaining, notificationMessage };
    };

    const { data: _data, remaining, notificationMessage } = txClient
      ? await executeRefund(txClient)
      : await db.transaction(async (tx) => executeRefund(tx));
    
    if (notificationMessage) {
      notifyMember({
        userEmail: normalizedEmail,
        title: 'Guest Pass Refunded',
        message: notificationMessage,
        type: 'guest_pass',
        relatedType: 'guest_pass',
        url: '/member/profile'
      }).catch(err => logger.error('Guest pass refund notification failed', { extra: { error: getErrorMessage(err) } }));
    }
    
    try { broadcastMemberStatsUpdated(normalizedEmail, { guestPasses: remaining }); } catch (err: unknown) { logger.error('[Broadcast] Stats update error', { extra: { error: getErrorMessage(err) } }); }

    sendPassUpdateForMemberByEmail(normalizedEmail).catch(err =>
      logger.warn('[refundGuestPass] Wallet pass push failed (non-fatal)', { extra: { email: normalizedEmail, error: getErrorMessage(err) } })
    );

    return { success: true, remaining };
  } catch (error: unknown) {
    const msg = getErrorMessage(error) || 'Failed to refund guest pass';
    if (msg === 'Member guest pass record not found') {
      return { success: false, error: msg };
    }
    logger.error('[refundGuestPass] Error', { extra: { error: getErrorMessage(error) } });
    return { success: false, error: 'Failed to refund guest pass' };
  }
}

export async function getGuestPassesRemaining(memberEmail: string, tier?: string): Promise<number> {
  try {
    const normalizedEmail = memberEmail.toLowerCase();
    
    const tierLimits = tier ? await getTierLimits(tier) : null;
    const tierTotal = tierLimits?.guest_passes_per_year ?? null;
    
    const result = await db.select()
      .from(guestPasses)
      .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`);
    
    if (result.length === 0) {
      return tierTotal ?? 0;
    }
    
    const effectiveTotal = tierTotal ?? result[0].passesTotal;
    return Math.max(0, effectiveTotal - result[0].passesUsed);
  } catch (error: unknown) {
    logger.error('[getGuestPassesRemaining] Error', { extra: { error: getErrorMessage(error) } });
    return 0;
  }
}

export async function ensureGuestPassRecord(memberEmail: string, tier?: string): Promise<void> {
  try {
    const normalizedEmail = memberEmail.toLowerCase();
    
    const tierLimits = tier ? await getTierLimits(tier) : null;
    const passesTotal = tierLimits?.guest_passes_per_year ?? 0;
    
    const existing = await db.select()
      .from(guestPasses)
      .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`);
    
    if (existing.length === 0) {
      await db.insert(guestPasses)
        .values({
          memberEmail: normalizedEmail,
          passesUsed: 0,
          passesTotal
        })
        .onConflictDoNothing();
    }
  } catch (error: unknown) {
    logger.error('[ensureGuestPassRecord] Error', { extra: { error: getErrorMessage(error) } });
  }
}
