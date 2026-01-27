import { pool } from '../db';
import { PoolClient } from 'pg';

export interface PaymentStatusUpdate {
  paymentIntentId: string;
  bookingId?: number;
  sessionId?: number;
  feeSnapshotId?: number;
  staffEmail?: string;
  staffName?: string;
  amountCents?: number;
  refundId?: string;
}

export interface PaymentStatusResult {
  success: boolean;
  error?: string;
  participantsUpdated?: number;
  snapshotsUpdated?: number;
}

/**
 * Centralized service for updating payment statuses across all related tables.
 * All payment status changes should flow through this service to ensure consistency.
 */
export class PaymentStatusService {
  
  /**
   * Mark a payment as succeeded and update all related records atomically.
   */
  static async markPaymentSucceeded(params: PaymentStatusUpdate): Promise<PaymentStatusResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const { paymentIntentId, staffEmail, staffName } = params;
      
      // Find the fee snapshot for this payment intent
      const snapshotResult = await client.query(
        `SELECT bfs.id, bfs.session_id, bfs.booking_id, bfs.participant_fees, bfs.total_cents, bfs.status
         FROM booking_fee_snapshots bfs
         WHERE bfs.stripe_payment_intent_id = $1
         FOR UPDATE`,
        [paymentIntentId]
      );
      
      if (snapshotResult.rows.length === 0) {
        // No snapshot found - might be a non-booking payment, just update stripe_payment_intents
        await client.query(
          `UPDATE stripe_payment_intents SET status = 'succeeded', updated_at = NOW() 
           WHERE stripe_payment_intent_id = $1`,
          [paymentIntentId]
        );
        await client.query('COMMIT');
        return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 };
      }
      
      const snapshot = snapshotResult.rows[0];
      
      if (snapshot.status === 'paid') {
        // Already processed
        await client.query('COMMIT');
        return { success: true, participantsUpdated: 0, snapshotsUpdated: 0 };
      }
      
      // Update fee snapshot status
      await client.query(
        `UPDATE booking_fee_snapshots SET status = 'paid', updated_at = NOW() WHERE id = $1`,
        [snapshot.id]
      );
      
      // Update stripe_payment_intents table
      await client.query(
        `UPDATE stripe_payment_intents SET status = 'succeeded', updated_at = NOW() 
         WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );
      
      // Parse participant fees and update each participant's payment status
      let participantsUpdated = 0;
      const participantFees = snapshot.participant_fees;
      
      if (participantFees && Array.isArray(participantFees)) {
        for (const fee of participantFees) {
          const participantId = fee.id;
          if (participantId) {
            await client.query(
              `UPDATE booking_participants SET payment_status = 'paid' WHERE id = $1 AND payment_status = 'pending'`,
              [participantId]
            );
            participantsUpdated++;
            
            // Create audit log entry
            await client.query(
              `INSERT INTO booking_payment_audit 
                (booking_id, session_id, participant_id, action, staff_email, staff_name, amount_affected, previous_status, new_status, stripe_payment_intent_id)
               VALUES ($1, $2, $3, 'payment_succeeded', $4, $5, $6, 'pending', 'paid', $7)`,
              [snapshot.booking_id, snapshot.session_id, participantId, staffEmail || 'system', staffName || 'Auto-sync', fee.amountCents || 0, paymentIntentId]
            );
          }
        }
      }
      
      await client.query('COMMIT');
      console.log(`[PaymentStatusService] Marked payment ${paymentIntentId} as succeeded, updated ${participantsUpdated} participants`);
      
      return { success: true, participantsUpdated, snapshotsUpdated: 1 };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('[PaymentStatusService] Error marking payment succeeded:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
  
  /**
   * Mark a payment as refunded and update all related records atomically.
   */
  static async markPaymentRefunded(params: PaymentStatusUpdate): Promise<PaymentStatusResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const { paymentIntentId, refundId, staffEmail, staffName, amountCents } = params;
      
      // Find the fee snapshot for this payment intent
      const snapshotResult = await client.query(
        `SELECT bfs.id, bfs.session_id, bfs.booking_id, bfs.participant_fees, bfs.total_cents, bfs.status
         FROM booking_fee_snapshots bfs
         WHERE bfs.stripe_payment_intent_id = $1
         FOR UPDATE`,
        [paymentIntentId]
      );
      
      // Update fee snapshot status
      if (snapshotResult.rows.length > 0) {
        const snapshot = snapshotResult.rows[0];
        
        await client.query(
          `UPDATE booking_fee_snapshots SET status = 'refunded', updated_at = NOW() WHERE id = $1`,
          [snapshot.id]
        );
        
        // Update participant payment statuses
        const participantFees = snapshot.participant_fees;
        if (participantFees && Array.isArray(participantFees)) {
          for (const fee of participantFees) {
            const participantId = fee.id;
            if (participantId) {
              await client.query(
                `UPDATE booking_participants SET payment_status = 'refunded' WHERE id = $1`,
                [participantId]
              );
              
              // Create audit log entry
              await client.query(
                `INSERT INTO booking_payment_audit 
                  (booking_id, session_id, participant_id, action, staff_email, staff_name, amount_affected, previous_status, new_status, stripe_payment_intent_id)
                 VALUES ($1, $2, $3, 'payment_refunded', $4, $5, $6, 'paid', 'refunded', $7)`,
                [snapshot.booking_id, snapshot.session_id, participantId, staffEmail || 'system', staffName || 'Refund', fee.amountCents || 0, paymentIntentId]
              );
            }
          }
        }
      }
      
      // Update stripe_payment_intents table
      await client.query(
        `UPDATE stripe_payment_intents SET status = 'refunded', updated_at = NOW() 
         WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );
      
      await client.query('COMMIT');
      console.log(`[PaymentStatusService] Marked payment ${paymentIntentId} as refunded`);
      
      return { success: true, snapshotsUpdated: snapshotResult.rows.length };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('[PaymentStatusService] Error marking payment refunded:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
  
  /**
   * Mark a payment as cancelled and update all related records atomically.
   */
  static async markPaymentCancelled(params: PaymentStatusUpdate): Promise<PaymentStatusResult> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const { paymentIntentId } = params;
      
      // Find the fee snapshot for this payment intent
      const snapshotResult = await client.query(
        `SELECT bfs.id FROM booking_fee_snapshots bfs
         WHERE bfs.stripe_payment_intent_id = $1
         FOR UPDATE`,
        [paymentIntentId]
      );
      
      // Update fee snapshot status
      if (snapshotResult.rows.length > 0) {
        await client.query(
          `UPDATE booking_fee_snapshots SET status = 'cancelled', updated_at = NOW() 
           WHERE stripe_payment_intent_id = $1`,
          [paymentIntentId]
        );
      }
      
      // Update stripe_payment_intents table
      await client.query(
        `UPDATE stripe_payment_intents SET status = 'canceled', updated_at = NOW() 
         WHERE stripe_payment_intent_id = $1`,
        [paymentIntentId]
      );
      
      await client.query('COMMIT');
      console.log(`[PaymentStatusService] Marked payment ${paymentIntentId} as cancelled`);
      
      return { success: true, snapshotsUpdated: snapshotResult.rows.length };
    } catch (error: any) {
      await client.query('ROLLBACK');
      console.error('[PaymentStatusService] Error marking payment cancelled:', error);
      return { success: false, error: error.message };
    } finally {
      client.release();
    }
  }
  
  /**
   * Sync payment status from Stripe to database for a specific payment intent.
   * Used by reconciliation job and manual sync.
   */
  static async syncFromStripe(paymentIntentId: string, stripeStatus: string, staffEmail: string = 'system'): Promise<PaymentStatusResult> {
    if (stripeStatus === 'succeeded') {
      return this.markPaymentSucceeded({ paymentIntentId, staffEmail, staffName: 'Stripe Sync' });
    } else if (stripeStatus === 'canceled') {
      return this.markPaymentCancelled({ paymentIntentId });
    }
    // For other statuses (requires_payment_method, etc.), just update the stripe_payment_intents table
    await pool.query(
      `UPDATE stripe_payment_intents SET status = $1, updated_at = NOW() WHERE stripe_payment_intent_id = $2`,
      [stripeStatus, paymentIntentId]
    );
    return { success: true };
  }
}

// Export convenience functions
export const markPaymentSucceeded = PaymentStatusService.markPaymentSucceeded.bind(PaymentStatusService);
export const markPaymentRefunded = PaymentStatusService.markPaymentRefunded.bind(PaymentStatusService);
export const markPaymentCancelled = PaymentStatusService.markPaymentCancelled.bind(PaymentStatusService);
export const syncPaymentFromStripe = PaymentStatusService.syncFromStripe.bind(PaymentStatusService);
