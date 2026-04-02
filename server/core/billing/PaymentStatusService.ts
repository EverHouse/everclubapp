import { pool } from '../db';
import { getErrorMessage } from '../../utils/errorUtils';
import { logPaymentAudit } from '../auditLog';
import { logger } from '../logger';
import { db } from '../../db';
import { sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';

interface SnapshotRow {
  id: number;
  session_id: number;
  booking_id: number;
  participant_fees: Array<{ id?: number; amountCents?: number }> | null;
  total_cents: number;
  status: string;
}

interface PaymentIntentRow {
  booking_id: number;
  session_id: number | null;
  amount_cents: number;
}

interface SessionIdRow {
  session_id: number | null;
}

interface PendingParticipantRow {
  id: number;
  cached_fee_cents: number;
}

export interface PaymentStatusUpdate {
  paymentIntentId: string;
  bookingId?: number;
  sessionId?: number;
  feeSnapshotId?: number;
  staffEmail?: string;
  staffName?: string;
  amountCents?: number;
  refundId?: string;
  preValidatedParticipants?: Array<{ id: number; amountCents: number }>;
  persistAmountPaid?: boolean;
  skipSnapshotUpdate?: boolean;
}

export interface PaymentStatusResult {
  success: boolean;
  error?: string;
  participantsUpdated?: number;
  snapshotsUpdated?: number;
}

async function withTransaction<T>(
  externalClient: PoolClient | undefined,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  if (externalClient) {
    return fn(externalClient);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface ApplyPaidStatusParams {
  paymentIntentId: string;
  participantFees: Array<{ id: number; amountCents: number }>;
  bookingId?: number;
  sessionId?: number;
  staffEmail?: string;
  staffName?: string;
  persistAmountPaid?: boolean;
}

export class PaymentStatusService {

  private static async applyPaidStatus(client: PoolClient, params: ApplyPaidStatusParams): Promise<number> {
    const { paymentIntentId, participantFees, bookingId, sessionId, staffEmail, staffName, persistAmountPaid } = params;
    if (participantFees.length === 0) return 0;

    let updatedCount = 0;
    if (persistAmountPaid) {
      for (const pf of participantFees) {
        const result = await client.query(
          `UPDATE booking_participants
           SET payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1,
               cached_fee_cents = 0, amount_paid_cents = $2
           WHERE id = $3 AND payment_status IN ('pending', 'refunded')
           RETURNING id`,
          [paymentIntentId, pf.amountCents, pf.id]
        );
        updatedCount += result.rowCount ?? 0;
      }
    } else {
      const participantIds = participantFees.map(pf => pf.id);
      const result = await client.query(
        `UPDATE booking_participants
         SET payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1, cached_fee_cents = 0
         WHERE id = ANY($2::int[]) AND payment_status IN ('pending', 'refunded')`,
        [paymentIntentId, participantIds]
      );
      updatedCount = result.rowCount ?? participantIds.length;
    }

    for (const pf of participantFees) {
      await logPaymentAudit({
        bookingId: bookingId ?? 0,
        sessionId: sessionId ?? null,
        participantId: pf.id,
        action: 'payment_succeeded',
        staffEmail: staffEmail || 'system',
        staffName: staffName || 'Stripe Webhook',
        amountAffected: pf.amountCents,
        previousStatus: 'pending',
        newStatus: 'paid',
        paymentMethod: 'stripe',
        metadata: { stripePaymentIntentId: paymentIntentId },
      });
    }

    logger.info(`[PaymentStatusService] applyPaidStatus: marked ${updatedCount} participant(s) paid for PI ${paymentIntentId}`);
    return updatedCount;
  }

  static async markPaymentSucceeded(params: PaymentStatusUpdate, client?: PoolClient): Promise<PaymentStatusResult> {
    try {
      return await withTransaction(client, async (qc) => {
        const { paymentIntentId, staffEmail, staffName, preValidatedParticipants, persistAmountPaid, skipSnapshotUpdate } = params;

        if (preValidatedParticipants && preValidatedParticipants.length > 0) {
          if (!skipSnapshotUpdate && params.feeSnapshotId) {
            await qc.query(
              `UPDATE booking_fee_snapshots SET status = 'completed', used_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [params.feeSnapshotId]
            );
          }
          const updated = await PaymentStatusService.applyPaidStatus(qc, {
            paymentIntentId,
            participantFees: preValidatedParticipants,
            bookingId: params.bookingId,
            sessionId: params.sessionId,
            staffEmail,
            staffName,
            persistAmountPaid,
          });
          return { success: true, participantsUpdated: updated, snapshotsUpdated: params.feeSnapshotId ? 1 : 0 } as PaymentStatusResult;
        }

        const snapshotResult = await qc.query(
          `SELECT bfs.id, bfs.session_id, bfs.booking_id, bfs.participant_fees, bfs.total_cents, bfs.status
           FROM booking_fee_snapshots bfs
           WHERE bfs.stripe_payment_intent_id = $1
           FOR UPDATE`,
          [paymentIntentId]
        );

        if (snapshotResult.rows.length === 0) {
          await qc.query(
            `UPDATE stripe_payment_intents SET status = 'succeeded', updated_at = NOW()
             WHERE stripe_payment_intent_id = $1`,
            [paymentIntentId]
          );

          const piLookup = await qc.query(
            `SELECT booking_id, session_id, amount_cents FROM stripe_payment_intents WHERE stripe_payment_intent_id = $1`,
            [paymentIntentId]
          );

          const piRows = piLookup.rows as unknown as PaymentIntentRow[];
          if (piRows.length > 0 && piRows[0].booking_id) {
            const piRow = piRows[0];

            if (piRow.amount_cents == null) {
              logger.warn(`[PaymentStatusService] No-snapshot fallback: amount_cents is null for PI ${paymentIntentId} — skipping participant auto-update`);
              return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 } as PaymentStatusResult;
            }

            const sessionLookup = await qc.query(
              `SELECT session_id FROM booking_requests WHERE id = $1`,
              [piRow.booking_id]
            );
            const resolvedSessionId = piRow.session_id || (sessionLookup.rows as unknown as SessionIdRow[])[0]?.session_id;

            if (resolvedSessionId) {
              const pendingResult = await qc.query(
                `SELECT id, cached_fee_cents FROM booking_participants
                 WHERE session_id = $1 AND payment_status IN ('pending', 'refunded') AND cached_fee_cents > 0
                 AND stripe_payment_intent_id IS NULL
                 ORDER BY id ASC
                 FOR UPDATE`,
                [resolvedSessionId]
              );

              const pendingRows = pendingResult.rows as unknown as PendingParticipantRow[];
              if (pendingRows.length > 0) {
                const totalPendingCents = pendingRows.reduce((sum, row) => sum + (row.cached_fee_cents || 0), 0);
                const tolerance = 5;

                if (Math.abs(totalPendingCents - piRow.amount_cents) > tolerance) {
                  logger.warn(`[PaymentStatusService] No-snapshot fallback: amount mismatch for booking ${piRow.booking_id} (pending=${totalPendingCents}c, paid=${piRow.amount_cents}c, diff=${Math.abs(totalPendingCents - piRow.amount_cents)}c) - skipping update`);
                  return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 } as PaymentStatusResult;
                }

                const pendingIds = pendingRows.map((r) => r.id);
                await qc.query(
                  `UPDATE booking_participants
                   SET payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1, cached_fee_cents = 0
                   WHERE id = ANY($2::int[])`,
                  [paymentIntentId, pendingIds]
                );

                for (const row of pendingRows) {
                  await logPaymentAudit({
                    bookingId: piRow.booking_id,
                    sessionId: resolvedSessionId,
                    participantId: row.id,
                    action: 'payment_succeeded',
                    staffEmail: staffEmail || 'system',
                    staffName: staffName || 'Auto-sync',
                    amountAffected: row.cached_fee_cents || 0,
                    previousStatus: 'pending',
                    newStatus: 'paid',
                    paymentMethod: 'stripe',
                    metadata: { stripePaymentIntentId: paymentIntentId },
                  });
                }

                logger.info(`[PaymentStatusService] No-snapshot fallback: updated ${pendingRows.length} participant(s) for booking ${piRow.booking_id}`);
                return { success: true, participantsUpdated: pendingRows.length, snapshotsUpdated: 0 } as PaymentStatusResult;
              }
            }
          }

          return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 } as PaymentStatusResult;
        }

        const snapshot = snapshotResult.rows[0] as unknown as SnapshotRow;

        await qc.query(
          `UPDATE stripe_payment_intents SET status = 'succeeded', updated_at = NOW()
           WHERE stripe_payment_intent_id = $1`,
          [paymentIntentId]
        );

        if (snapshot.status === 'completed' || snapshot.status === 'paid') {
          return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 } as PaymentStatusResult;
        }

        if (snapshot.session_id != null) {
          const existingCompleted = await qc.query(
            `SELECT id FROM booking_fee_snapshots
             WHERE session_id = $1 AND status = 'completed' AND id != $2
             LIMIT 1`,
            [snapshot.session_id, snapshot.id]
          );
          if (existingCompleted.rows.length > 0) {
            await qc.query(
              `UPDATE booking_fee_snapshots SET status = 'superseded', used_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [snapshot.id]
            );
            logger.info(`[PaymentStatusService] Snapshot ${snapshot.id} superseded — session ${snapshot.session_id} already has completed snapshot ${(existingCompleted.rows[0] as Record<string, unknown>).id}`);
            return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 } as PaymentStatusResult;
          }
        }

        await qc.query(
          `UPDATE booking_fee_snapshots SET status = 'completed', used_at = NOW(), updated_at = NOW() WHERE id = $1`,
          [snapshot.id]
        );

        let participantsUpdated = 0;
        const participantFees = snapshot.participant_fees;

        if (participantFees && Array.isArray(participantFees)) {
          const participantIds = participantFees.map((f: { id?: number; amountCents?: number }) => f.id).filter((id): id is number => id != null);

          if (participantIds.length > 0) {
            await qc.query(
              `UPDATE booking_participants
               SET payment_status = 'paid', paid_at = NOW(), stripe_payment_intent_id = $1, cached_fee_cents = 0
               WHERE id = ANY($2::int[]) AND payment_status IN ('pending', 'refunded')`,
              [paymentIntentId, participantIds]
            );
            participantsUpdated = participantIds.length;

            for (const fee of participantFees) {
              const participantId = fee.id;
              if (participantId) {
                await logPaymentAudit({
                  bookingId: snapshot.booking_id,
                  sessionId: snapshot.session_id,
                  participantId,
                  action: 'payment_succeeded',
                  staffEmail: staffEmail || 'system',
                  staffName: staffName || 'Auto-sync',
                  amountAffected: fee.amountCents || 0,
                  previousStatus: 'pending',
                  newStatus: 'paid',
                  paymentMethod: 'stripe',
                  metadata: { stripePaymentIntentId: paymentIntentId },
                });
              }
            }
          }
        }

        logger.info(`[PaymentStatusService] Marked payment ${paymentIntentId} as succeeded, updated ${participantsUpdated} participants`);

        return { success: true, participantsUpdated, snapshotsUpdated: 1 } as PaymentStatusResult;
      });
    } catch (error: unknown) {
      logger.error('[PaymentStatusService] Error marking payment succeeded:', { extra: { error: getErrorMessage(error) } });
      if (client) throw error;
      return { success: false, error: getErrorMessage(error) };
    }
  }

  static async markPaymentRefunded(params: PaymentStatusUpdate, client?: PoolClient): Promise<PaymentStatusResult> {
    try {
      return await withTransaction(client, async (qc) => {
        const { paymentIntentId, staffEmail, staffName, amountCents } = params;

        const snapshotResult = await qc.query(
          `SELECT bfs.id, bfs.session_id, bfs.booking_id, bfs.participant_fees, bfs.total_cents, bfs.status
           FROM booking_fee_snapshots bfs
           WHERE bfs.stripe_payment_intent_id = $1
           FOR UPDATE`,
          [paymentIntentId]
        );

        await qc.query(
          `UPDATE stripe_payment_intents SET status = 'refunded', updated_at = NOW()
           WHERE stripe_payment_intent_id = $1`,
          [paymentIntentId]
        );

        if (snapshotResult.rows.length > 0) {
          const snapshot = snapshotResult.rows[0] as unknown as SnapshotRow;

          await qc.query(
            `UPDATE booking_fee_snapshots SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
            [snapshot.id]
          );

          const participantFees = snapshot.participant_fees;
          if (participantFees && Array.isArray(participantFees)) {
            const participantIds = participantFees.map((f: { id?: number; amountCents?: number }) => f.id).filter((id): id is number => id != null);

            if (participantIds.length > 0) {
              const refundedResult = await qc.query(
                `UPDATE booking_participants
                 SET payment_status = 'refunded'
                 WHERE id = ANY($1::int[])
                 AND payment_status = 'paid'
                 RETURNING id`,
                [participantIds]
              );

              const refundedIds = new Set((refundedResult.rows as unknown as { id: number }[]).map(r => r.id));
              for (const fee of participantFees) {
                const participantId = fee.id;
                if (participantId && refundedIds.has(participantId)) {
                  await logPaymentAudit({
                    bookingId: snapshot.booking_id,
                    sessionId: snapshot.session_id,
                    participantId,
                    action: 'payment_refunded',
                    staffEmail: staffEmail || 'system',
                    staffName: staffName || 'Refund',
                    amountAffected: fee.amountCents || 0,
                    previousStatus: 'paid',
                    newStatus: 'refunded',
                    paymentMethod: 'stripe',
                    metadata: { stripePaymentIntentId: paymentIntentId },
                  });
                }
              }
            }
          }
        } else {
          const fallbackResult = await qc.query(
            `SELECT bp.id, bp.session_id FROM booking_participants bp
             WHERE bp.stripe_payment_intent_id = $1 AND bp.payment_status = 'paid'
             ORDER BY bp.id ASC
             FOR UPDATE`,
            [paymentIntentId]
          );
          const fallbackRows = fallbackResult.rows as unknown as { id: number; session_id: number | null }[];
          if (fallbackRows.length > 0) {
            const fallbackIds = fallbackRows.map(r => r.id);
            await qc.query(
              `UPDATE booking_participants SET payment_status = 'refunded'
               WHERE id = ANY($1::int[])
               AND payment_status = 'paid'`,
              [fallbackIds]
            );
            for (const row of fallbackRows) {
              await logPaymentAudit({
                bookingId: null,
                sessionId: row.session_id,
                participantId: row.id,
                action: 'payment_refunded',
                staffEmail: staffEmail || 'system',
                staffName: staffName || 'Refund',
                amountAffected: amountCents || 0,
                previousStatus: 'paid',
                newStatus: 'refunded',
                paymentMethod: 'stripe',
                metadata: { stripePaymentIntentId: paymentIntentId },
              });
            }
            logger.info(`[PaymentStatusService] No-snapshot refund fallback: updated ${fallbackRows.length} participant(s) for PI ${paymentIntentId}`);
          } else {
            logger.warn(`[PaymentStatusService] No snapshot and no participants found for refunded PI ${paymentIntentId}`);
          }
        }

        logger.info(`[PaymentStatusService] Marked payment ${paymentIntentId} as refunded`);

        return { success: true, snapshotsUpdated: snapshotResult.rows.length } as PaymentStatusResult;
      });
    } catch (error: unknown) {
      logger.error('[PaymentStatusService] Error marking payment refunded:', { extra: { error: getErrorMessage(error) } });
      if (client) throw error;
      return { success: false, error: getErrorMessage(error) };
    }
  }

  static async markPaymentCancelled(params: PaymentStatusUpdate, client?: PoolClient): Promise<PaymentStatusResult> {
    try {
      return await withTransaction(client, async (qc) => {
        const { paymentIntentId } = params;

        const snapshotResult = await qc.query(
          `SELECT bfs.id FROM booking_fee_snapshots bfs
           WHERE bfs.stripe_payment_intent_id = $1
           FOR UPDATE`,
          [paymentIntentId]
        );

        if (snapshotResult.rows.length > 0) {
          await qc.query(
            `UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW()
             WHERE stripe_payment_intent_id = $1`,
            [paymentIntentId]
          );
        }

        await qc.query(
          `UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW()
           WHERE stripe_payment_intent_id = $1`,
          [paymentIntentId]
        );

        logger.info(`[PaymentStatusService] Marked payment ${paymentIntentId} as cancelled`);

        return { success: true, snapshotsUpdated: snapshotResult.rows.length } as PaymentStatusResult;
      });
    } catch (error: unknown) {
      logger.error('[PaymentStatusService] Error marking payment cancelled:', { extra: { error: getErrorMessage(error) } });
      if (client) throw error;
      return { success: false, error: getErrorMessage(error) };
    }
  }

  static async syncFromStripe(paymentIntentId: string, stripeStatus: string, staffEmail: string = 'system'): Promise<PaymentStatusResult> {
    if (stripeStatus === 'succeeded') {
      return this.markPaymentSucceeded({ paymentIntentId, staffEmail, staffName: 'Stripe Sync' });
    } else if (stripeStatus === 'canceled') {
      return this.markPaymentCancelled({ paymentIntentId });
    }
    await db.execute(
      sql`UPDATE stripe_payment_intents SET status = ${stripeStatus}, updated_at = NOW() WHERE stripe_payment_intent_id = ${paymentIntentId}`
    );
    return { success: true };
  }
}

export const markPaymentSucceeded = PaymentStatusService.markPaymentSucceeded.bind(PaymentStatusService);
export const markPaymentRefunded = PaymentStatusService.markPaymentRefunded.bind(PaymentStatusService);
export const markPaymentCancelled = PaymentStatusService.markPaymentCancelled.bind(PaymentStatusService);
export const syncPaymentFromStripe = PaymentStatusService.syncFromStripe.bind(PaymentStatusService);
