import { db } from '../db';
import { sql } from 'drizzle-orm';
import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { retryWithBackoff } from './startupUtils';

export function buildPostStripeTasks(): Array<() => Promise<void>> {
  return [
    async () => {
      try {
        const backfillResult = await db.execute(sql`
          UPDATE users u
          SET first_login_at = sub.first_booking,
              updated_at = NOW()
          FROM (
            SELECT br.user_id, MIN(br.created_at) as first_booking
            FROM booking_requests br
            WHERE br.user_id IS NOT NULL
              AND br.origin IS NULL
            GROUP BY br.user_id
          ) sub
          WHERE u.id = sub.user_id
            AND u.first_login_at IS NULL
        `);
        const count = (backfillResult as { rowCount?: number })?.rowCount || 0;
        if (count > 0) {
          logger.info(`[Startup] Backfilled first_login_at for ${count} members from self-requested booking history`);
        }
      } catch (err: unknown) { logger.warn('[Startup] first_login_at backfill failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const tierBackfill = await db.execute(sql`
          UPDATE users
          SET last_tier = tier, updated_at = NOW()
          WHERE membership_status IN ('cancelled', 'expired', 'paused', 'inactive', 'terminated', 'suspended', 'frozen', 'declined', 'churned', 'former_member')
            AND tier IS NOT NULL AND tier != ''
            AND (last_tier IS NULL OR last_tier = '')
        `);
        const count = (tierBackfill as { rowCount?: number })?.rowCount || 0;
        if (count > 0) {
          logger.info(`[Startup] Backfilled last_tier for ${count} former members`);
        }
      } catch (err: unknown) { logger.warn('[Startup] last_tier backfill failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const paymentUserBackfill = await db.execute(sql`
          UPDATE stripe_payment_intents spi
          SET user_id = u.email,
              updated_at = NOW()
          FROM users u
          WHERE spi.stripe_customer_id IS NOT NULL
            AND spi.stripe_customer_id = u.stripe_customer_id
            AND (spi.user_id IS NULL OR spi.user_id = '')
        `);
        const count = (paymentUserBackfill as { rowCount?: number })?.rowCount || 0;
        if (count > 0) {
          logger.info(`[Startup] Backfilled user_id for ${count} payment intents from stripe_customer_id`);
        }
      } catch (err: unknown) { logger.warn('[Startup] payment intent user_id backfill failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const passReconcile = await db.execute(sql`
          UPDATE guest_passes gp
          SET passes_used = COALESCE(actual.used_count, 0),
              passes_total = GREATEST(gp.passes_total, COALESCE(actual.used_count, 0))
          FROM (
            SELECT LOWER(gp2.member_email) as email, COUNT(bp.id) as used_count
            FROM guest_passes gp2
            LEFT JOIN booking_requests br ON LOWER(br.user_email) = LOWER(gp2.member_email)
              AND br.status NOT IN ('cancelled', 'rejected', 'deleted')
            LEFT JOIN booking_sessions bs ON br.session_id = bs.id
            LEFT JOIN booking_participants bp ON bp.session_id = bs.id
              AND bp.participant_type = 'guest'
              AND bp.used_guest_pass = true
            GROUP BY LOWER(gp2.member_email)
          ) actual
          WHERE LOWER(gp.member_email) = actual.email
            AND gp.passes_used != COALESCE(actual.used_count, 0)
        `);
        const reconciled = (passReconcile as { rowCount?: number })?.rowCount || 0;
        if (reconciled > 0) {
          logger.info(`[Startup] Reconciled guest pass counters for ${reconciled} members`);
        }
      } catch (err: unknown) { logger.warn('[Startup] Guest pass reconciliation failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const orphanedDeductions = await db.execute(sql`
          SELECT stripe_payment_intent_id, stripe_customer_id, amount_cents, user_id, status
          FROM stripe_payment_intents
          WHERE status IN ('balance_pending', 'balance_deducted')
            AND created_at < NOW() - INTERVAL '5 minutes'
        `);
        const orphanRows = orphanedDeductions.rows as unknown as { stripe_payment_intent_id: string; stripe_customer_id: string; amount_cents: number; user_id: string; status: string }[];
        if (orphanRows.length > 0) {
          const { getStripeClient } = await import('../core/stripe/client.js');
          const stripe = await getStripeClient();
          for (const row of orphanRows) {
            if (row.status === 'balance_deducted') {
              try {
                await stripe.customers.createBalanceTransaction(row.stripe_customer_id, {
                  amount: -row.amount_cents,
                  currency: 'usd',
                  description: 'Startup recovery: rollback orphaned balance deduction',
                });
                logger.info(`[Startup] Rolled back orphaned balance deduction: $${(row.amount_cents / 100).toFixed(2)} for customer ${row.stripe_customer_id}`);
              } catch (rollbackErr: unknown) {
                logger.error(`[Startup] Failed to roll back orphaned balance deduction for ${row.stripe_customer_id}`, { extra: { error: getErrorMessage(rollbackErr) } });
              }
            }
            await db.execute(sql`DELETE FROM stripe_payment_intents WHERE stripe_payment_intent_id = ${row.stripe_payment_intent_id}`);
          }
          logger.info(`[Startup] Cleaned up ${orphanRows.length} orphaned balance deduction record(s)`);
        }
      } catch (err: unknown) { logger.warn('[Startup] Orphaned balance deduction cleanup failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const mismatchedSessions = await db.execute(sql`
          SELECT active_br.session_id,
                 active_br.user_id AS correct_user_id,
                 active_br.user_name AS correct_user_name,
                 active_br.user_email AS correct_user_email,
                 active_br.request_participants,
                 active_br.start_time,
                 active_br.end_time
          FROM booking_requests active_br
          JOIN booking_participants bp
            ON bp.session_id = active_br.session_id
            AND bp.participant_type = 'owner'
          WHERE active_br.status NOT IN ('cancelled', 'deleted', 'declined')
            AND bp.user_id IS DISTINCT FROM active_br.user_id
            AND active_br.user_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM booking_requests cancelled_br
              WHERE cancelled_br.session_id = active_br.session_id
                AND cancelled_br.status IN ('cancelled', 'deleted', 'declined')
                AND cancelled_br.id != active_br.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM booking_requests other_active
              WHERE other_active.session_id = active_br.session_id
                AND other_active.status NOT IN ('cancelled', 'deleted', 'declined')
                AND other_active.id != active_br.id
            )
        `);

        const rows = mismatchedSessions.rows as Array<{
          session_id: number;
          correct_user_id: string;
          correct_user_name: string;
          correct_user_email: string;
          request_participants: Array<{ email?: string; type?: string; name?: string; userId?: string }> | null;
          start_time: string;
          end_time: string;
        }>;

        if (rows.length > 0) {
          let fixedCount = 0;
          for (const row of rows) {
            try {
              await db.transaction(async (tx) => {
                await tx.execute(sql`DELETE FROM booking_participants WHERE session_id = ${row.session_id}`);

                let slotDuration = 60;
                try {
                  const [sH, sM] = row.start_time.split(':').map(Number);
                  const [eH, eM] = row.end_time.split(':').map(Number);
                  slotDuration = (eH * 60 + eM) - (sH * 60 + sM);
                  if (slotDuration <= 0) slotDuration = 60;
                } catch (_) { /* slot duration calculation: non-critical, fallback to 60 min */ }

                await tx.execute(sql`
                  INSERT INTO booking_participants (session_id, user_id, participant_type, display_name, slot_duration, payment_status, invited_at)
                  VALUES (${row.session_id}, ${row.correct_user_id}, 'owner', ${row.correct_user_name || row.correct_user_email}, ${slotDuration}, 'pending', NOW())
                `);

                const requestParticipants = row.request_participants;
                if (requestParticipants && Array.isArray(requestParticipants)) {
                  const ownerEmail = row.correct_user_email?.toLowerCase();
                  for (const rp of requestParticipants) {
                    if (!rp || typeof rp !== 'object') continue;
                    const rpEmail = rp.email?.toLowerCase()?.trim() || '';
                    if (rpEmail && rpEmail === ownerEmail) continue;
                    if (rp.userId && rp.userId === row.correct_user_id) continue;

                    const participantType = rp.type === 'member' ? 'member' : 'guest';
                    const displayName = rp.name || rpEmail || 'Participant';
                    const userId = rp.userId || null;

                    await tx.execute(sql`
                      INSERT INTO booking_participants (session_id, user_id, participant_type, display_name, slot_duration, payment_status, invited_at)
                      VALUES (${row.session_id}, ${userId}, ${participantType}, ${displayName}, ${slotDuration}, 'pending', NOW())
                    `);
                  }
                }
              });
              fixedCount++;
            } catch (fixErr: unknown) {
              logger.error(`[Startup] Failed to fix mismatched session owner for session ${row.session_id}`, { extra: { error: getErrorMessage(fixErr) } });
            }
          }
          if (fixedCount > 0) {
            logger.info(`[Startup] Fixed ${fixedCount}/${rows.length} mismatched session owners`);
          }
        }
      } catch (err: unknown) { logger.warn('[Startup] Mismatched session owner fix failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        await retryWithBackoff(async () => {
          const result = await db.execute(sql`
            UPDATE booking_requests br
            SET user_id = u.id, updated_at = NOW()
            FROM users u
            WHERE br.user_id IS NULL
              AND br.user_email IS NOT NULL
              AND LOWER(br.user_email) = LOWER(u.email)
              AND br.status NOT IN ('cancelled', 'deleted', 'declined')
            RETURNING br.id
          `);
          const fixedCount = result.rows.length;
          if (fixedCount > 0) {
            logger.info(`[Startup] Backfilled user_id for ${fixedCount} booking requests from email match`);
          }
        }, 'Booking user_id backfill');
      } catch (err: unknown) { logger.warn('[Startup] Booking user_id backfill failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const { cleanupLessonClosures } = await import('../core/databaseCleanup');
        const deactivated = await cleanupLessonClosures();
        if (deactivated > 0) {
          logger.info(`[Startup] Deactivated ${deactivated} past lesson closures`);
        }
      } catch (err: unknown) { logger.warn('[Startup] Lesson closures cleanup failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const deadItems = await db.execute(sql`
          SELECT id, payload FROM hubspot_sync_queue
          WHERE status = 'dead' AND operation = 'sync_tier'
            AND last_error LIKE '%was not one of the allowed options%'
        `);
        const rows = (deadItems as unknown as { rows: Array<{ id: number; payload: string }> }).rows;
        if (rows.length > 0) {
          const { enqueueHubSpotSync } = await import('../core/hubspot/queue');
          for (const row of rows) {
            try {
              const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
              if (!payload?.email || typeof payload.email !== 'string') {
                logger.warn(`[Startup] Dead HubSpot job #${row.id} has no valid email in payload, skipping`);
                continue;
              }
              const emailKey = (payload.email as string).toLowerCase();
              const newJobId = await enqueueHubSpotSync('sync_tier', payload, {
                priority: 2,
                idempotencyKey: `requeue_dead_tier_sync_${emailKey}_${row.id}`,
                maxRetries: 5
              });
              if (newJobId !== null) {
                await db.execute(sql`UPDATE hubspot_sync_queue SET status = 'superseded', completed_at = NOW() WHERE id = ${row.id}`);
                logger.info(`[Startup] Re-queued dead HubSpot sync_tier job #${row.id} as #${newJobId} for ${emailKey}`);
              } else {
                logger.info(`[Startup] Dead HubSpot sync_tier job #${row.id} already re-queued, marking superseded`);
                await db.execute(sql`UPDATE hubspot_sync_queue SET status = 'superseded', completed_at = NOW() WHERE id = ${row.id}`);
              }
            } catch (rowErr: unknown) {
              logger.warn(`[Startup] Failed to re-queue dead HubSpot job #${row.id}, leaving as dead for manual review`, { extra: { error: getErrorMessage(rowErr) } });
            }
          }
        }
      } catch (err: unknown) { logger.warn('[Startup] HubSpot dead queue re-queue failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },

    async () => {
      try {
        const ginExists = await db.execute(sql`
          SELECT 1 FROM pg_indexes WHERE indexname = 'idx_users_manually_linked_emails_gin' LIMIT 1
        `);
        if (ginExists.rows.length === 0) {
          await db.execute(sql`
            CREATE INDEX IF NOT EXISTS idx_users_manually_linked_emails_gin ON users USING GIN (manually_linked_emails)
          `);
        }
      } catch (err: unknown) { logger.debug('[Startup] GIN index on manually_linked_emails already exists or failed: ' + getErrorMessage(err)); }
      try {
        const linkedResult = await db.execute(sql`
          UPDATE booking_requests br
          SET 
            user_email = u.email,
            user_id = u.id,
            updated_at = NOW()
          FROM user_linked_emails ule
          JOIN users u ON LOWER(u.email) = LOWER(ule.primary_email) AND u.archived_at IS NULL
          WHERE LOWER(br.user_email) = LOWER(ule.linked_email)
            AND LOWER(br.user_email) != LOWER(u.email)
            AND br.created_at >= NOW() - INTERVAL '90 days'
          RETURNING br.id, br.user_email AS new_email, ule.linked_email AS old_email
        `);
        const manualResult = await db.execute(sql`
          UPDATE booking_requests br
          SET
            user_email = u.email,
            user_id = u.id,
            updated_at = NOW()
          FROM users u
          WHERE u.archived_at IS NULL
            AND u.manually_linked_emails IS NOT NULL
            AND u.manually_linked_emails @> to_jsonb(LOWER(br.user_email))
            AND LOWER(br.user_email) != LOWER(u.email)
            AND br.created_at >= NOW() - INTERVAL '90 days'
          RETURNING br.id, br.user_email AS new_email
        `);
        const totalFixed = (linkedResult.rows?.length || 0) + (manualResult.rows?.length || 0);
        if (totalFixed > 0) {
          logger.info(`[Startup] Repaired ${totalFixed} bookings stored under linked emails`, { extra: { linkedFixed: linkedResult.rows?.length || 0, manualFixed: manualResult.rows?.length || 0 } });
        }
      } catch (err: unknown) { logger.warn('[Startup] Linked email booking repair failed (non-critical)', { extra: { error: getErrorMessage(err) } }); }
    },
  ];
}
