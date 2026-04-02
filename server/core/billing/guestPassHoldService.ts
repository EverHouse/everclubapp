import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { TransactionContext } from '../bookingService/sessionManager';

import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { GuestPassHoldError } from '../errors';
export interface GuestPassHoldResult {
  success: boolean;
  error?: string;
  holdId?: number;
  passesHeld?: number;
  passesAvailable?: number;
}

export async function getAvailableGuestPasses(
  memberEmail: string,
  tierName?: string,
  txCtx?: TransactionContext
): Promise<number> {
  const executor = txCtx || db;
  const emailLower = memberEmail.toLowerCase().trim();
  
  const tierResult = await executor.execute(sql`
    SELECT mt.guest_passes_per_year 
    FROM users u 
    JOIN membership_tiers mt ON u.tier_id = mt.id
    WHERE LOWER(u.email) = ${emailLower}
  `);
  const tierRow = tierResult.rows[0] as Record<string, unknown> | undefined;
  const tierGuestPasses = tierRow?.guest_passes_per_year as number | null;
  if (tierGuestPasses == null) {
    const statusResult = await executor.execute(sql`
      SELECT membership_status FROM users WHERE LOWER(email) = ${emailLower} LIMIT 1
    `);
    const status = (statusResult.rows[0] as Record<string, unknown> | undefined)?.membership_status as string | undefined;
    const isNonMember = !status || status === 'visitor' || status === 'non-member' || status === 'archived';
    if (isNonMember) {
      logger.debug('[GuestPassHoldService] No tier for non-member — 0 guest passes (expected).', { extra: { memberEmail: emailLower, status } });
    } else {
      logger.warn('[GuestPassHoldService] Tier guest_passes_per_year lookup returned null — member may have no tier_id linked. Defaulting to 0 passes (fail-closed).', { extra: { memberEmail: emailLower, status } });
    }
  }
  const effectiveGuestPasses = tierGuestPasses ?? 0;
  
  const guestPassResult = await executor.execute(sql`
    SELECT passes_used, passes_total FROM guest_passes WHERE LOWER(member_email) = ${emailLower}
  `);
  
  let passesUsed = 0;
  let passesTotal = effectiveGuestPasses;
  
  if (guestPassResult.rows.length > 0) {
    const row = guestPassResult.rows[0] as Record<string, unknown>;
    passesUsed = (row.passes_used as number) || 0;
    passesTotal = (row.passes_total as number) || effectiveGuestPasses;
    if (tierGuestPasses != null && effectiveGuestPasses !== passesTotal) {
      const safeTotalValue = Math.max(effectiveGuestPasses, passesUsed);
      if (safeTotalValue !== effectiveGuestPasses) {
        logger.warn('[GuestPassHoldService] Tier allocation lower than current usage — clamping passes_total to passes_used', { extra: { memberEmail: emailLower, tierAllocation: effectiveGuestPasses, passesUsed } });
      }
      await executor.execute(sql`
        UPDATE guest_passes SET passes_total = ${safeTotalValue} WHERE LOWER(member_email) = ${emailLower}
      `);
      passesTotal = safeTotalValue;
    }
  }
  
  const holdsResult = await executor.execute(sql`
    SELECT COALESCE(SUM(passes_held), 0) as total_held 
    FROM guest_pass_holds 
    WHERE LOWER(member_email) = ${emailLower} 
    AND (expires_at IS NULL OR expires_at > NOW())
  `);
  const passesHeld = parseInt(String((holdsResult.rows[0] as Record<string, unknown>)?.total_held || '0'), 10);
  
  const available = Math.max(0, passesTotal - passesUsed - passesHeld);
  return available;
}

export async function createGuestPassHold(
  memberEmail: string,
  bookingId: number,
  passesNeeded: number,
  txCtx?: TransactionContext
): Promise<GuestPassHoldResult> {
  if (passesNeeded <= 0) {
    return { success: true, passesHeld: 0 };
  }
  
  const emailLower = memberEmail.toLowerCase().trim();
  
  const doWork = async (executor: TransactionContext) => {
    await executor.execute(sql`
      INSERT INTO guest_passes (member_email, passes_used, passes_total)
      VALUES (${emailLower}, 0, 0)
      ON CONFLICT (member_email) DO NOTHING
    `);

    await executor.execute(sql`
      SELECT id FROM guest_passes WHERE LOWER(member_email) = ${emailLower} ORDER BY id ASC FOR UPDATE
    `);
    
    const available = await getAvailableGuestPasses(emailLower, undefined, executor);
    const passesToHold = Math.min(passesNeeded, available);
    
    if (passesToHold <= 0 && passesNeeded > 0) {
      throw new GuestPassHoldError(
        `Not enough guest passes available. Requested: ${passesNeeded}, Available: ${available}`,
        available
      );
    }
    
    const expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + 24 * 60 * 60 * 1000);
    
    const insertResult = await executor.execute(sql`
      INSERT INTO guest_pass_holds (member_email, booking_id, passes_held, expires_at)
      VALUES (${emailLower}, ${bookingId}, ${passesToHold}, ${expiresAt})
      RETURNING id
    `);
    
    return {
      success: true,
      holdId: (insertResult.rows[0] as Record<string, unknown>).id as number,
      passesHeld: passesToHold,
      passesAvailable: available - passesToHold
    };
  };

  try {
    if (txCtx) {
      return await doWork(txCtx);
    }
    return await db.transaction(async (tx) => {
      return await doWork(tx);
    });
  } catch (error: unknown) {
    if (error instanceof GuestPassHoldError) {
      throw error;
    }
    logger.error('[GuestPassHoldService] Error creating hold:', { extra: { error: getErrorMessage(error) } });
    return {
      success: false,
      error: getErrorMessage(error)
    };
  }
}

export async function releaseGuestPassHold(
  bookingId: number
): Promise<{ success: boolean; passesReleased: number }> {
  try {
    const result = await db.execute(sql`
      DELETE FROM guest_pass_holds WHERE booking_id = ${bookingId} RETURNING passes_held
    `);
    
    const passesReleased = (result.rows as Array<Record<string, unknown>>).reduce(
      (sum, row) => sum + ((row.passes_held as number) || 0), 0
    );
    logger.info(`[GuestPassHoldService] Released ${passesReleased} guest pass holds for booking ${bookingId}`);
    
    return { success: true, passesReleased };
  } catch (error: unknown) {
    logger.error('[GuestPassHoldService] Error releasing hold:', { extra: { error: getErrorMessage(error) } });
    return { success: false, passesReleased: 0 };
  }
}

export async function convertHoldToUsage(
  bookingId: number,
  memberEmail: string
): Promise<{ success: boolean; passesConverted: number }> {
  const emailLower = memberEmail.toLowerCase().trim();
  
  try {
    return await db.transaction(async (tx) => {
      const holdResult = await tx.execute(sql`
        SELECT id, passes_held FROM guest_pass_holds 
        WHERE booking_id = ${bookingId} AND LOWER(member_email) = ${emailLower}
        FOR UPDATE
      `);
      
      if (holdResult.rows.length === 0) {
        return { success: true, passesConverted: 0 };
      }
      
      const passesToConvert = (holdResult.rows[0] as Record<string, unknown>).passes_held as number;
      
      if (passesToConvert > 0) {
        const updateResult = await tx.execute(sql`
          UPDATE guest_passes 
          SET passes_used = passes_used + ${passesToConvert}
          WHERE LOWER(member_email) = ${emailLower}
        `);
        if ((updateResult.rowCount ?? 0) === 0) {
          const tierResult = await tx.execute(sql`
            SELECT mt.guest_passes_per_year 
            FROM users u JOIN membership_tiers mt ON u.tier_id = mt.id
            WHERE LOWER(u.email) = ${emailLower} LIMIT 1
          `);
          const tierAllocation = (tierResult.rows[0] as Record<string, unknown>)?.guest_passes_per_year as number ?? 4;
          await tx.execute(sql`
            INSERT INTO guest_passes (member_email, passes_total, passes_used)
            VALUES (${emailLower}, ${tierAllocation}, ${passesToConvert})
            ON CONFLICT (member_email) DO UPDATE SET passes_used = guest_passes.passes_used + ${passesToConvert}
          `);
          logger.info(`[GuestPassHoldService] Created guest_passes row for ${emailLower} during hold-to-usage conversion`);
        }
      }
      
      await tx.execute(sql`
        DELETE FROM guest_pass_holds WHERE booking_id = ${bookingId}
      `);
      
      logger.info(`[GuestPassHoldService] Converted ${passesToConvert} held passes to usage for booking ${bookingId}`);
      return { success: true, passesConverted: passesToConvert };
    });
  } catch (error: unknown) {
    logger.error('[GuestPassHoldService] Error converting hold:', { extra: { error: getErrorMessage(error) } });
    return { success: false, passesConverted: 0 };
  }
}

export async function cleanupExpiredHolds(): Promise<number> {
  const BATCH_SIZE = 100;
  let totalDeleted = 0;

  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM guest_pass_holds
      WHERE id IN (
        SELECT id FROM guest_pass_holds WHERE expires_at < NOW() LIMIT ${BATCH_SIZE}
      )
      RETURNING id
    `);

    const batchDeleted = result.rowCount || 0;
    totalDeleted += batchDeleted;

    if (batchDeleted < BATCH_SIZE) break;
  }

  if (totalDeleted > 0) {
    logger.info(`[GuestPassHoldService] Cleaned up ${totalDeleted} expired guest pass holds`);
  }
  return totalDeleted;
}
