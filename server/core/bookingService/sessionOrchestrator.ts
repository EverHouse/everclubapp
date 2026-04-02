import { db } from '../../db';
  import { getErrorMessage } from '../../utils/errorUtils';
  import { toIntArrayLiteral } from '../../utils/sqlArrayLiteral';
  import { pool, safeRelease } from '../db';
  import type { PoolClient } from 'pg';
  import {
    users,
    BookingSession,
    BookingParticipant,
  } from '../../../shared/schema';
  import { eq, sql } from 'drizzle-orm';
  import { logger } from '../logger';
  import { enforceSocialTierRules, getMemberTier, type ParticipantForValidation } from './tierRules';
  import {
    calculateFullSessionBilling,
    type Participant as UsageParticipant
  } from './usageCalculator';
  import type {
    TransactionContext,
    BookingSource,
    ParticipantInput,
  } from './sessionTypes';
  import {
    createSession,
    recordUsage,
    linkParticipants,
  } from './sessionCore';

  async function resolveYearlyAllocation(tierName?: string): Promise<number> {
    const { getTierLimits } = await import('../tierService');
    const tierLimits = tierName ? await getTierLimits(tierName) : null;
    return tierLimits?.guest_passes_per_year ?? 0;
  }

  async function resolveUserIdToEmail(userId: string): Promise<string | null> {
  // If it's already an email format (contains @), return it directly
  if (userId.includes('@')) {
    return userId;
  }
  
  try {
    const [user] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    
    return user?.email || null;
  } catch (error: unknown) {
    logger.error('[resolveUserIdToEmail] Error resolving user ID', { 
      extra: { error: getErrorMessage(error), userId }
    });
    return null;
  }
}

export interface OrchestratedSessionRequest {
  ownerEmail: string;
  resourceId: number;
  sessionDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  participants: ParticipantInput[];
  trackmanBookingId?: string;
  declaredPlayerCount?: number;
  bookingId?: number;
}

export interface OrchestratedSessionResult {
  success: boolean;
  session?: BookingSession;
  participants?: BookingParticipant[];
  usageLedgerEntries?: number;
  error?: string;
  errorType?: 'social_tier_blocked' | 'validation_failed' | 'database_error';
}

/**
 * Orchestrated session creation that:
 * 1. Enforces Social tier rules (blocks guests for Social hosts)
 * 2. Creates the session with linked participants
 * 3. Computes usage allocation across all participants
 * 4. Uses assignGuestTimeToHost for guest-minute reassignment with overage calculation
 * 5. Records usage ledger entries
 * 
 * Note: userId in ParticipantInput can be either a UUID or email.
 * This function resolves UUIDs to emails for tier lookups and ledger writes.
 * usage_ledger.member_id stores emails for consistency with existing data.
 */
export async function createSessionWithUsageTracking(
  request: OrchestratedSessionRequest,
  source: BookingSource = 'member_request',
  externalTx?: TransactionContext
): Promise<OrchestratedSessionResult> {
  try {
    // Step 1: Get owner's tier and enforce Social tier rules (pre-transaction validation)
    const ownerTier = await getMemberTier(request.ownerEmail);
    
    if (ownerTier) {
      const participantsForValidation: ParticipantForValidation[] = request.participants.map(p => ({
        type: p.participantType,
        displayName: p.displayName
      }));
      
      const socialCheck = await enforceSocialTierRules(ownerTier, participantsForValidation);
      
      if (!socialCheck.allowed) {
        return {
          success: false,
          error: socialCheck.reason,
          errorType: 'social_tier_blocked'
        };
      }
    }
    
    // Step 2: Resolve all participant user IDs to emails for tier lookups (pre-transaction)
    const userIdToEmail = new Map<string, string>();
    for (const p of request.participants) {
      if (p.userId) {
        const email = await resolveUserIdToEmail(p.userId);
        if (email) {
          userIdToEmail.set(p.userId, email);
        }
      }
    }
    
    // Step 3: Build participants for billing calculation (pre-transaction)
    const billingParticipants: UsageParticipant[] = request.participants.map(p => ({
      userId: p.userId,
      email: p.userId ? userIdToEmail.get(p.userId) : undefined,
      guestId: p.guestId,
      participantType: p.participantType,
      displayName: p.displayName
    }));
    
    const resourceResult = await db.execute(sql`SELECT type FROM resources WHERE id = ${request.resourceId}`);
    const resourceType = String((resourceResult.rows[0] as { type?: string })?.type || 'simulator');

    // Step 4+5: Acquire a user-level advisory lock to serialize billing reads and
    // session writes for the same member on the same day. Without this lock, two
    // concurrent bookings can both read 0 prior usage and skip overage fees.
    const userLockKey = `usage::${request.ownerEmail.toLowerCase()}::${request.sessionDate}`;
    let userLockHash = 0;
    for (let i = 0; i < userLockKey.length; i++) {
      userLockHash = ((userLockHash << 5) - userLockHash + userLockKey.charCodeAt(i)) | 0;
    }

    // When an externalTx is provided, the caller owns the transaction. Use a
    // transaction-scoped lock on that connection so it stays held until the
    // caller commits. When we manage the transaction ourselves, use a
    // session-level lock on a separate client so it spans both the billing
    // read and the write transaction.
    if (externalTx) {
      await externalTx.execute(sql`SELECT pg_advisory_xact_lock(${userLockHash})`);
    }

    const lockClient = externalTx ? null : await pool.connect();
    try {
    if (lockClient) {
      await lockClient.query(`SELECT pg_advisory_lock($1)`, [userLockHash]);
    }
    try {

    const billingResult = await calculateFullSessionBilling(
      request.sessionDate,
      request.durationMinutes,
      billingParticipants,
      request.ownerEmail,
      request.declaredPlayerCount || request.participants.length,
      { resourceType }
    );
    
    const executeDbWrites = async (tx: TransactionContext) => {
      const result = await createSession(
        {
          resourceId: request.resourceId,
          sessionDate: request.sessionDate,
          startTime: request.startTime,
          endTime: request.endTime,
          trackmanBookingId: request.trackmanBookingId,
          createdBy: request.ownerEmail
        },
        request.participants,
        source,
        tx
      );
      const session = result.session;
      const linkedParticipants = result.participants;
      
      // Record usage ledger entries within the same transaction
      // IMPORTANT: Aggregate fees per member to avoid idempotency guard blocking valid entries
      const feesByMember = new Map<string, {
        minutesCharged: number;
        overageFee: number;
        guestFee: number;
        tierName?: string;
      }>();

      for (const billing of billingResult.billingBreakdown) {
        if (billing.participantType === 'guest') {
          if (billing.guestFee > 0) {
            const key = request.ownerEmail;
            const existing = feesByMember.get(key) || { minutesCharged: 0, overageFee: 0, guestFee: 0, tierName: ownerTier || undefined };
            existing.guestFee += billing.guestFee;
            feesByMember.set(key, existing);
          }
        } else {
          const memberEmail = billing.email || billing.userId || '';
          const key = memberEmail;
          const existing = feesByMember.get(key) || { minutesCharged: 0, overageFee: 0, guestFee: 0, tierName: billing.tierName || undefined };
          existing.minutesCharged += billing.minutesAllocated;
          existing.overageFee += billing.overageFee;
          feesByMember.set(key, existing);
        }
      }

      let ledgerEntriesCreated = 0;
      for (const [memberId, fees] of feesByMember) {
        await recordUsage(session.id, {
          memberId,
          minutesCharged: fees.minutesCharged,
          overageFee: fees.overageFee,
          guestFee: fees.guestFee,
          tierAtBooking: fees.tierName,
          paymentMethod: 'unpaid'
        }, source, tx);
        ledgerEntriesCreated++;
      }
      
      // Step 5c: Deduct guest passes INSIDE the transaction for atomicity
      let actualPassesDeducted = 0;
      if (billingResult.guestPassesUsed > 0) {
        const emailLower = request.ownerEmail.toLowerCase().trim();
        const passesNeeded = billingResult.guestPassesUsed;
        
        if (request.bookingId) {
          // Path 1: Booking request flow - convert holds to usage
          const holdResult = await tx.execute(sql`
            SELECT id, passes_held FROM guest_pass_holds 
            WHERE booking_id = ${request.bookingId} AND LOWER(member_email) = ${emailLower}
            FOR UPDATE
          `);
          
          if (holdResult.rows && holdResult.rows.length > 0) {
            const passesHeld = (holdResult.rows[0] as { passes_held: number }).passes_held as number || 0;
            const passesToConvert = Math.min(passesHeld, billingResult.guestPassesUsed);
            
            if (passesToConvert > 0) {
              // Verify we don't exceed total passes available
              const passCheck = await tx.execute(sql`
                SELECT passes_total, passes_used FROM guest_passes 
                WHERE LOWER(member_email) = ${emailLower}
                FOR UPDATE
              `);
              
              if (passCheck.rows && passCheck.rows.length > 0) {
                const passRow = passCheck.rows[0] as { passes_total: number; passes_used: number };
                const tierAlloc = ownerTier ? await resolveYearlyAllocation(ownerTier) : null;
                const passes_total = tierAlloc ?? (passRow.passes_total as number);
                const passes_used = passRow.passes_used as number;
                if (passes_used + passesToConvert > passes_total) {
                  logger.warn('[createSessionWithUsageTracking] Insufficient guest passes for hold conversion, extra guests will be charged as paid', {
                    extra: { ownerEmail: request.ownerEmail, available: passes_total - passes_used, needed: passesToConvert }
                  });
                  const canConvert = Math.max(0, passes_total - passes_used);
                  if (canConvert > 0) {
                    await tx.execute(sql`
                      UPDATE guest_passes 
                      SET passes_used = ${passes_total}
                      WHERE LOWER(member_email) = ${emailLower}
                    `);
                    actualPassesDeducted = canConvert;
                  }
                } else {
                  await tx.execute(sql`
                    UPDATE guest_passes 
                    SET passes_used = passes_used + ${passesToConvert}
                    WHERE LOWER(member_email) = ${emailLower}
                  `);
                  actualPassesDeducted = passesToConvert;
                }
              } else {
                const tierResult = await tx.execute(sql`
                  SELECT mt.guest_passes_per_year 
                  FROM users u 
                  JOIN membership_tiers mt ON u.tier_id = mt.id 
                  WHERE LOWER(u.email) = ${emailLower}
                `);
                const yearlyAllocation = tierResult.rows?.[0] 
                  ? (tierResult.rows[0] as { guest_passes_per_year: number }).guest_passes_per_year as number || 0 
                  : 0;
                
                if (yearlyAllocation < passesToConvert) {
                  logger.warn('[createSessionWithUsageTracking] Member tier has insufficient guest pass allocation for hold conversion, extra guests will be charged as paid', {
                    extra: { ownerEmail: request.ownerEmail, yearlyAllocation, passesToConvert }
                  });
                  if (yearlyAllocation > 0) {
                    await tx.execute(sql`
                      INSERT INTO guest_passes (member_email, passes_total, passes_used)
                      VALUES (${emailLower}, ${yearlyAllocation}, ${yearlyAllocation})
                    `);
                    actualPassesDeducted = yearlyAllocation;
                  }
                } else {
                  await tx.execute(sql`
                    INSERT INTO guest_passes (member_email, passes_total, passes_used)
                    VALUES (${emailLower}, ${yearlyAllocation}, ${passesToConvert})
                  `);
                  actualPassesDeducted = passesToConvert;
                  logger.info('[createSessionWithUsageTracking] Created guest pass record for first-time user (hold conversion)', {
                    extra: { ownerEmail: request.ownerEmail, yearlyAllocation, passesToConvert }
                  });
                }
              }
            }
            
            // Delete the hold
            await tx.execute(sql`
              DELETE FROM guest_pass_holds WHERE booking_id = ${request.bookingId}
            `);
            
            if (passesToConvert < billingResult.guestPassesUsed) {
              logger.warn('[createSessionWithUsageTracking] Guest pass hold shortfall — extra guests will be charged as paid', {
                extra: { bookingId: request.bookingId, ownerEmail: request.ownerEmail, passesHeld, guestPassesUsed: billingResult.guestPassesUsed, passesConverted: passesToConvert }
              });
            }
            
            logger.info('[createSessionWithUsageTracking] Converted guest pass holds to usage (atomic)', {
              extra: { bookingId: request.bookingId, ownerEmail: request.ownerEmail, passesConverted: passesToConvert }
            });
          } else {
            // Hold was lost (transient DB error during booking creation) — fall back to direct deduction
            logger.warn('[createSessionWithUsageTracking] No guest pass holds found, falling back to direct deduction', {
              extra: { bookingId: request.bookingId, passesNeeded }
            });
            
            const passCheck = await tx.execute(sql`
              SELECT id, passes_total, passes_used FROM guest_passes 
              WHERE LOWER(member_email) = ${emailLower}
              FOR UPDATE
            `);
            
            if (passCheck.rows && passCheck.rows.length > 0) {
              const passRow = passCheck.rows[0] as { id: number; passes_total: number; passes_used: number };
              const tierAllocFallback = ownerTier ? await resolveYearlyAllocation(ownerTier) : null;
              const passes_total = tierAllocFallback ?? (passRow.passes_total as number);
              const passes_used = passRow.passes_used as number;
              const available = passes_total - passes_used;
              
              if (available < passesNeeded) {
                logger.warn('[createSessionWithUsageTracking] Insufficient guest passes for direct deduction (hold fallback), extra guests will be charged as paid', {
                  extra: { ownerEmail: request.ownerEmail, available, needed: passesNeeded }
                });
                const canDeduct = Math.max(0, available);
                if (canDeduct > 0) {
                  await tx.execute(sql`
                    UPDATE guest_passes 
                    SET passes_used = ${passes_total}
                    WHERE LOWER(member_email) = ${emailLower}
                  `);
                  actualPassesDeducted = canDeduct;
                }
              } else {
                await tx.execute(sql`
                  UPDATE guest_passes 
                  SET passes_used = passes_used + ${passesNeeded}
                  WHERE LOWER(member_email) = ${emailLower}
                `);
                actualPassesDeducted = passesNeeded;
              }
              
              logger.info('[createSessionWithUsageTracking] Directly deducted guest passes (hold fallback)', {
                extra: { bookingId: request.bookingId, ownerEmail: request.ownerEmail, passesDeducted: actualPassesDeducted, passesNeeded }
              });
            } else {
              // First-time guest pass user (hold fallback) — create record with tier allocation
              const tierResult = await tx.execute(sql`
                SELECT mt.guest_passes_per_year 
                FROM users u 
                JOIN membership_tiers mt ON u.tier_id = mt.id 
                WHERE LOWER(u.email) = ${emailLower}
              `);
              const yearlyAllocation = tierResult.rows?.[0] 
                ? (tierResult.rows[0] as { guest_passes_per_year: number }).guest_passes_per_year as number || 0 
                : 0;
              
              if (yearlyAllocation < passesNeeded) {
                logger.info('[createSessionWithUsageTracking] Member tier has insufficient guest pass allocation, guests will be charged as paid', {
                  extra: { ownerEmail: request.ownerEmail, yearlyAllocation, passesNeeded }
                });
                // Don't throw — guests will be billed via fee calculator as paid guests
              } else {
                await tx.execute(sql`
                  INSERT INTO guest_passes (member_email, passes_total, passes_used)
                  VALUES (${emailLower}, ${yearlyAllocation}, ${passesNeeded})
                `);
                actualPassesDeducted = passesNeeded;
                
                logger.info('[createSessionWithUsageTracking] Created guest pass record for first-time user (hold fallback)', {
                  extra: { ownerEmail: request.ownerEmail, yearlyAllocation, passesDeducted: passesNeeded }
                });
              }
            }
          }
        } else {
          // Path 2: Staff/Trackman flow without holds - direct atomic deduction
          const passCheck = await tx.execute(sql`
            SELECT id, passes_total, passes_used FROM guest_passes 
            WHERE LOWER(member_email) = ${emailLower}
            FOR UPDATE
          `);
          
          if (passCheck.rows && passCheck.rows.length > 0) {
            const passRow = passCheck.rows[0] as { id: number; passes_total: number; passes_used: number };
            const tierAllocDirect = ownerTier ? await resolveYearlyAllocation(ownerTier) : null;
            const passes_total = tierAllocDirect ?? (passRow.passes_total as number);
            const passes_used = passRow.passes_used as number;
            const available = passes_total - passes_used;
            
            if (available < passesNeeded) {
              logger.warn('[createSessionWithUsageTracking] Insufficient guest passes for direct deduction, extra guests will be charged as paid', {
                extra: { ownerEmail: request.ownerEmail, available, needed: passesNeeded }
              });
              const canDeduct = Math.max(0, available);
              if (canDeduct > 0) {
                await tx.execute(sql`
                  UPDATE guest_passes 
                  SET passes_used = ${passes_total}
                  WHERE LOWER(member_email) = ${emailLower}
                `);
                actualPassesDeducted = canDeduct;
              }
            } else {
              await tx.execute(sql`
                UPDATE guest_passes 
                SET passes_used = passes_used + ${passesNeeded}
                WHERE LOWER(member_email) = ${emailLower}
              `);
              actualPassesDeducted = passesNeeded;
            }
            
            logger.info('[createSessionWithUsageTracking] Deducted guest passes (atomic, no holds)', {
              extra: { ownerEmail: request.ownerEmail, passesDeducted: actualPassesDeducted, passesNeeded }
            });
          } else {
            // First-time guest pass user — create record with tier allocation
            const tierResult = await tx.execute(sql`
              SELECT mt.guest_passes_per_year 
              FROM users u 
              JOIN membership_tiers mt ON u.tier_id = mt.id 
              WHERE LOWER(u.email) = ${emailLower}
            `);
            const yearlyAllocation = tierResult.rows?.[0] 
              ? (tierResult.rows[0] as { guest_passes_per_year: number }).guest_passes_per_year as number || 0 
              : 0;
            
            if (yearlyAllocation < passesNeeded) {
              logger.info('[createSessionWithUsageTracking] Member tier has insufficient guest pass allocation, guests will be charged as paid', {
                extra: { ownerEmail: request.ownerEmail, yearlyAllocation, passesNeeded }
              });
              // Don't throw — guests will be billed via fee calculator as paid guests
            } else {
              await tx.execute(sql`
                INSERT INTO guest_passes (member_email, passes_total, passes_used)
                VALUES (${emailLower}, ${yearlyAllocation}, ${passesNeeded})
              `);
              actualPassesDeducted = passesNeeded;
              
              logger.info('[createSessionWithUsageTracking] Created guest pass record for first-time user', {
                extra: { ownerEmail: request.ownerEmail, yearlyAllocation, passesDeducted: passesNeeded }
              });
            }
          }
        }
      }
      
      if (actualPassesDeducted > 0) {
        const guestParticipantIds = linkedParticipants
          .filter(p => p.participantType === 'guest')
          .slice(0, actualPassesDeducted)
          .map(p => p.id);
        
        if (guestParticipantIds.length > 0) {
          // BYPASS: PaymentStatusService — guest pass consumption marks guest participants paid without Stripe PI
          await tx.execute(sql`
            UPDATE booking_participants 
            SET used_guest_pass = true, payment_status = 'paid', cached_fee_cents = 0
            WHERE id = ANY(${toIntArrayLiteral(guestParticipantIds)}::int[])
          `);
          
          logger.info('[createSessionWithUsageTracking] Marked guest participants with used_guest_pass=true', {
            extra: { sessionId: session.id, guestParticipantIds, count: guestParticipantIds.length }
          });
        }
      }

      if (request.bookingId) {
        await tx.execute(
          sql`UPDATE booking_requests SET session_id = ${session.id}, updated_at = NOW() WHERE id = ${request.bookingId}`
        );
      }

      return { session, linkedParticipants, ledgerEntriesCreated };
    };
    
    // Step 5: Execute database writes - either within external transaction or our own
    const txResult = externalTx 
      ? await executeDbWrites(externalTx)
      : await db.transaction(executeDbWrites);
    
    logger.info('[createSessionWithUsageTracking] Session created with new billing', {
      extra: {
        sessionId: txResult.session.id,
        totalOverageFees: billingResult.totalOverageFees,
        totalGuestFees: billingResult.totalGuestFees,
        guestPassesUsed: billingResult.guestPassesUsed
      }
    });
    
    logger.info('[createSessionWithUsageTracking] Session created with usage tracking', {
      extra: {
        sessionId: txResult.session.id,
        participantCount: txResult.linkedParticipants.length,
        ledgerEntries: txResult.ledgerEntriesCreated,
        source
      }
    });

    const result = {
      success: true as const,
      session: txResult.session,
      participants: txResult.linkedParticipants,
      usageLedgerEntries: txResult.ledgerEntriesCreated
    };

    return result;

    } finally {
      if (lockClient) {
        await lockClient.query(`SELECT pg_advisory_unlock($1)`, [userLockHash]).catch((unlockErr: unknown) => { logger.error('[SessionManager] Advisory lock release failed — lock may remain held until session ends', { extra: { error: getErrorMessage(unlockErr), lockHash: userLockHash } }); });
      }
    }
    } finally {
      if (lockClient) {
        safeRelease(lockClient);
      }
    }
  } catch (error: unknown) {
    logger.error('[createSessionWithUsageTracking] Error:', { extra: { error: getErrorMessage(error) } });
    return {
      success: false,
      error: getErrorMessage(error),
      errorType: 'database_error'
    };
  }
}

  