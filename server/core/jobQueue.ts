import { db } from '../db';
import { queryWithRetry, queryWithRetryDirect } from './db';
import { getErrorMessage } from '../utils/errorUtils';
import { sql } from 'drizzle-orm';
import { schedulerTracker } from './schedulerTracker';
import type { PoolClient } from 'pg';
import { broadcastBillingUpdate, broadcastDayPassUpdate, sendNotificationToUser, broadcastToStaff } from './websocket';
import { notifyPaymentSuccess, notifyPaymentFailed, notifyStaffPaymentFailed, notifyMember, notifyAllStaff, isNotifiableEmail } from './notificationService';
import { sendPaymentReceiptEmail, sendPaymentFailedEmail } from '../emails/paymentEmails';
import { sendMembershipRenewalEmail, sendMembershipFailedEmail } from '../emails/membershipEmails';
import { sendPassWithQrEmail } from '../emails/passEmails';
import { syncCompanyToHubSpot } from './hubspot';
import type { CacheTransactionParams } from './stripe/webhooks/types';

import { logger } from './logger';

interface JobIdRow {
  id: number;
}

interface JobRow {
  id: number;
  job_type: string;
  payload: Record<string, unknown>;
  retry_count: number;
  max_retries: number;
}

interface JobStatusCountRow {
  status: string;
  count: number;
}

const WORKER_ID = `worker-${process.pid}-${Date.now()}`;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;
const BATCH_SIZE = 5;

export type JobType = 
  | 'send_payment_receipt'
  | 'send_payment_failed_email'
  | 'send_membership_renewal_email'
  | 'send_membership_failed_email'
  | 'send_pass_with_qr_email'
  | 'notify_payment_success'
  | 'notify_payment_failed'
  | 'notify_staff_payment_failed'
  | 'notify_member'
  | 'notify_all_staff'
  | 'broadcast_billing_update'
  | 'broadcast_day_pass_update'
  | 'send_notification_to_user'
  | 'sync_company_to_hubspot'
  | 'upsert_transaction_cache'
  | 'update_member_tier'
  | 'stripe_credit_refund'
  | 'stripe_credit_consume'
  | 'stripe_auto_refund'
  | 'stripe_balance_refund'
  | 'stripe_cancel_payment_intent'
  | 'wellhub_report_event'
  | 'tier_change_reconciliation'
  | 'booking_cleanup_alert'
  | 'generic_async_task';

interface QueueJobOptions {
  priority?: number;
  maxRetries?: number;
  scheduledFor?: Date;
  webhookEventId?: string;
}

export async function queueJob(
  jobType: JobType,
  payload: Record<string, unknown>,
  options: QueueJobOptions = {}
): Promise<number> {
  const { priority = 0, maxRetries = 3, scheduledFor = new Date(), webhookEventId } = options;
  const scheduledForIso = scheduledFor.toISOString();
  
  const result = await db.execute(sql`INSERT INTO job_queue (job_type, payload, priority, max_retries, scheduled_for, webhook_event_id)
     VALUES (${jobType}, ${JSON.stringify(payload)}, ${priority}, ${maxRetries}, ${scheduledForIso}::timestamptz, ${webhookEventId ?? null})
     RETURNING id`);
  
  return (result.rows[0] as unknown as JobIdRow).id;
}

export async function queueJobInTransaction(
  client: PoolClient,
  jobType: JobType,
  payload: Record<string, unknown>,
  options: QueueJobOptions = {}
): Promise<number> {
  const { priority = 0, maxRetries = 3, scheduledFor = new Date(), webhookEventId } = options;
  
  const result = await client.query(
    `INSERT INTO job_queue (job_type, payload, priority, max_retries, scheduled_for, webhook_event_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [jobType, JSON.stringify(payload), priority, maxRetries, scheduledFor, webhookEventId]
  );
  
  return result.rows[0].id;
}

export async function queueJobs(
  jobs: Array<{ jobType: JobType; payload: Record<string, unknown>; options?: QueueJobOptions }>
): Promise<number[]> {
  if (jobs.length === 0) return [];
  
  const valuesSql = jobs.map(job => {
    const { priority = 0, maxRetries = 3, scheduledFor = new Date(), webhookEventId } = job.options || {};
    const scheduledForIso = scheduledFor.toISOString();
    return sql`(${job.jobType}, ${JSON.stringify(job.payload)}, ${priority}, ${maxRetries}, ${scheduledForIso}::timestamptz, ${webhookEventId ?? null})`;
  });
  
  const result = await db.execute(sql`INSERT INTO job_queue (job_type, payload, priority, max_retries, scheduled_for, webhook_event_id)
     VALUES ${sql.join(valuesSql, sql`, `)}
     RETURNING id`);
  
  return result.rows.map((r: Record<string, unknown>) => r.id as number);
}

async function claimJobs(): Promise<Array<{ id: number; jobType: string; payload: Record<string, unknown>; retryCount: number; maxRetries: number }>> {
  const nowIso = new Date().toISOString();
  const lockExpiryIso = new Date(Date.now() - LOCK_TIMEOUT_MS).toISOString();
  const claimQuery = `UPDATE job_queue
     SET locked_at = $1::timestamptz, locked_by = $2
     WHERE id IN (
       SELECT id FROM job_queue
       WHERE status = 'pending'
         AND scheduled_for <= $3::timestamptz
         AND (locked_at IS NULL OR locked_at < $4::timestamptz)
       ORDER BY priority DESC, scheduled_for ASC
       LIMIT $5
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, job_type, payload, retry_count, max_retries`;
  const claimParams = [nowIso, WORKER_ID, nowIso, lockExpiryIso, BATCH_SIZE];

  let result;
  try {
    result = await queryWithRetry(claimQuery, claimParams, 3);
  } catch (primaryErr: unknown) {
    const errMsg = getErrorMessage(primaryErr);
    const isPoolIssue = errMsg.includes('timeout') || errMsg.includes('ECONNRESET') ||
      errMsg.includes('ETIMEDOUT') || errMsg.includes('pool') || errMsg.includes('connection');
    if (isPoolIssue) {
      logger.warn('[JobQueue] Primary pool failed for claim, falling back to direct pool', { extra: { error: errMsg } });
      result = await queryWithRetryDirect(claimQuery, claimParams, 2);
    } else {
      throw primaryErr;
    }
  }
  
  return result.rows.map((r) => {
    const row = r as unknown as JobRow;
    return {
      id: row.id,
      jobType: row.job_type,
      payload: row.payload,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
    };
  });
}

async function markJobCompleted(jobId: number): Promise<void> {
  try {
    await queryWithRetry(
      `UPDATE job_queue SET status = 'completed', processed_at = NOW(), locked_at = NULL, locked_by = NULL WHERE id = $1`,
      [jobId],
      3
    );
  } catch (primaryErr) {
    logger.warn('[JobQueue] markJobCompleted failed on primary pool, falling back to direct pool', { extra: { jobId, error: getErrorMessage(primaryErr) } });
    await queryWithRetryDirect(
      `UPDATE job_queue SET status = 'completed', processed_at = NOW(), locked_at = NULL, locked_by = NULL WHERE id = $1`,
      [jobId],
      2
    );
  }
}

async function markJobFailed(jobId: number, error: string, retryCount: number, maxRetries: number): Promise<void> {
  const doUpdate = async (queryFn: typeof queryWithRetry) => {
    if (retryCount + 1 >= maxRetries) {
      await queryFn(
        `UPDATE job_queue SET status = 'failed', last_error = $1, retry_count = retry_count + 1, locked_at = NULL, locked_by = NULL WHERE id = $2`,
        [error, jobId],
        3
      );
    } else {
      const backoffMs = Math.min(60000 * Math.pow(2, retryCount), 3600000);
      const nextScheduledIso = new Date(Date.now() + backoffMs).toISOString();
      await queryFn(
        `UPDATE job_queue SET last_error = $1, retry_count = retry_count + 1, scheduled_for = $2::timestamptz, locked_at = NULL, locked_by = NULL WHERE id = $3`,
        [error, nextScheduledIso, jobId],
        3
      );
    }
  };
  try {
    await doUpdate(queryWithRetry);
  } catch (primaryErr) {
    logger.warn('[JobQueue] markJobFailed failed on primary pool, falling back to direct pool', { extra: { jobId, error: getErrorMessage(primaryErr) } });
    await doUpdate(queryWithRetryDirect);
  }
}

async function executeJob(job: { id: number; jobType: string; payload: Record<string, unknown>; retryCount: number; maxRetries: number }): Promise<void> {
  const { id: jobId, jobType, payload } = job;
  
  try {
    switch (jobType) {
      case 'send_payment_receipt':
        await sendPaymentReceiptEmail(payload.to as string, { memberName: payload.memberName as string, amount: Number(payload.amount), date: new Date(payload.date as string), description: payload.description as string, transactionId: payload.paymentMethod as string });
        break;
      case 'send_payment_failed_email':
        await sendPaymentFailedEmail(payload.to as string, { memberName: payload.memberName as string, amount: Number(payload.amount), reason: payload.reason as string, updateCardUrl: payload.retryDate as string });
        break;
      case 'send_membership_renewal_email':
        await sendMembershipRenewalEmail(payload.to as string, { memberName: payload.memberName as string, planName: payload.tier as string, nextBillingDate: new Date(payload.nextBillingDate as string), amount: Number(payload.amount) });
        break;
      case 'send_membership_failed_email':
        await sendMembershipFailedEmail(payload.to as string, { memberName: payload.memberName as string, planName: payload.tier as string, reason: payload.reason as string, amount: Number(payload.amount) || 0 });
        break;
      case 'send_pass_with_qr_email':
        await sendPassWithQrEmail(payload.to as string, payload.passPurchase as unknown as { passId: number; type: string; quantity: number; purchaseDate: Date });
        break;
      case 'notify_payment_success':
        await notifyPaymentSuccess(payload.userEmail as string, Number(payload.amount), payload.description as string);
        break;
      case 'notify_payment_failed':
        await notifyPaymentFailed(payload.userEmail as string, Number(payload.amount), payload.reason as string);
        break;
      case 'notify_staff_payment_failed':
        await notifyStaffPaymentFailed(payload.memberEmail as string, payload.memberName as string, Number(payload.amount), payload.reason as string);
        break;
      case 'notify_member':
        if (isNotifiableEmail(payload.userEmail as string)) {
          await notifyMember({
            userEmail: payload.userEmail as string,
            title: payload.title as string,
            message: payload.message as string,
            type: payload.type as 'info' | 'success' | 'warning' | 'error' | 'system' | 'booking' | 'booking_approved' | 'booking_declined' | 'booking_reminder' | 'booking_cancelled',
            relatedId: payload.relatedId as number,
            relatedType: payload.relatedType as string,
          });
        } else {
          logger.warn('[JobQueue] Skipping notify_member job — missing or invalid userEmail', { extra: { userEmail: payload.userEmail } });
        }
        break;
      case 'notify_all_staff':
        await notifyAllStaff(payload.title as string, payload.message as string, payload.type as 'info' | 'success' | 'warning' | 'error' | 'system' | 'booking' | 'booking_approved' | 'booking_declined' | 'booking_reminder' | 'booking_cancelled', {
          relatedId: payload.relatedId as number,
          relatedType: payload.relatedType as string,
          url: payload.actionUrl as string,
        });
        break;
      case 'broadcast_billing_update':
        broadcastBillingUpdate(payload as unknown as Parameters<typeof broadcastBillingUpdate>[0]);
        break;
      case 'broadcast_day_pass_update':
        broadcastDayPassUpdate(payload as unknown as Parameters<typeof broadcastDayPassUpdate>[0]);
        break;
      case 'send_notification_to_user':
        if (isNotifiableEmail(payload.userEmail as string)) {
          sendNotificationToUser(payload.userEmail as string, payload.notification as unknown as { type: string; title: string; message: string; data?: Record<string, unknown> });
        } else {
          logger.warn('[JobQueue] Skipping send_notification_to_user — missing or invalid userEmail', { extra: { userEmail: payload.userEmail } });
        }
        break;
      case 'sync_company_to_hubspot':
        await syncCompanyToHubSpot(payload as unknown as Parameters<typeof syncCompanyToHubSpot>[0]);
        break;
      case 'upsert_transaction_cache': {
        const { upsertTransactionCache } = await import('./stripe/webhooks/framework');
        await upsertTransactionCache(payload as unknown as CacheTransactionParams);
        break;
          }
      case 'stripe_credit_refund': {
        const { getStripeClient } = await import('./stripe/client');
        const stripeRefund = await getStripeClient();
        await stripeRefund.refunds.create({
          payment_intent: payload.paymentIntentId as string,
          amount: payload.amountCents as number,
          reason: 'requested_by_customer',
          metadata: {
            type: 'account_credit_applied',
            originalPaymentIntent: payload.paymentIntentId as string,
            email: payload.email as string
          }
        }, {
          idempotencyKey: `job_${jobId}_credit_refund_${payload.paymentIntentId}_${payload.amountCents}`
        });
        logger.info(`[JobQueue] Applied credit refund of $${(Number(payload.amountCents) / 100).toFixed(2)} for ${payload.email}`);
        break;
      }
      case 'stripe_credit_consume': {
        const { getStripeClient: getStripeForConsume } = await import('./stripe/client');
        const stripeConsume = await getStripeForConsume();
        await stripeConsume.customers.createBalanceTransaction(
          payload.customerId as string,
          {
            amount: payload.amountCents as number,
            currency: 'usd',
            description: `Account credit applied to payment ${payload.paymentIntentId}`,
          },
          {
            idempotencyKey: `job_${jobId}_credit_consume_${payload.paymentIntentId}_${payload.amountCents}`
          }
        );
        logger.info(`[JobQueue] Consumed account credit of $${(Number(payload.amountCents) / 100).toFixed(2)} for ${payload.email}`);
        break;
      }
      case 'stripe_auto_refund': {
        const { getStripeClient: getStripeForRefund } = await import('./stripe/client');
        const stripeRefund = await getStripeForRefund();
        try {
          const refundCreateParams: { payment_intent: string; reason: 'duplicate' | 'fraudulent' | 'requested_by_customer'; metadata: Record<string, string>; amount?: number } = {
            payment_intent: payload.paymentIntentId as string,
            reason: ((payload.reason as string) || 'duplicate') as 'duplicate' | 'fraudulent' | 'requested_by_customer',
            metadata: payload.metadata as Record<string, string>,
          };
          if (payload.amountCents) {
            refundCreateParams.amount = payload.amountCents as number;
          }
          const refund = await stripeRefund.refunds.create(
            refundCreateParams,
            { idempotencyKey: `job_${jobId}_${payload.paymentIntentId}` }
          );
          logger.info(`[JobQueue] Auto-refund issued: ${refund.id} for PI ${payload.paymentIntentId}, amount: ${payload.amountCents || 'full'}`);

          try {
            const { markPaymentRefunded } = await import('./billing/PaymentStatusService');
            await markPaymentRefunded({
              paymentIntentId: payload.paymentIntentId as string,
              refundId: refund.id,
              amountCents: payload.amountCents as number | undefined,
            });
          } catch (statusErr: unknown) {
            logger.warn(`[JobQueue] Non-blocking: failed to mark payment refunded for PI ${payload.paymentIntentId}`, { extra: { error: getErrorMessage(statusErr) } });
          }
        } catch (refundError: unknown) {
          logger.error(`[JobQueue] Auto-refund failed for PI ${payload.paymentIntentId} — flagging for manual review`, { extra: { error: getErrorMessage(refundError) } });
          if (payload.sessionId) {
            await queryWithRetry(
              `UPDATE booking_sessions SET needs_review = true, review_reason = $1 WHERE id = $2`,
              [payload.reviewReason as string, Number(payload.sessionId)],
              3
            );
          }
          throw refundError;
        }
        break;
      }
      case 'stripe_balance_refund': {
        const { getStripeClient: getStripeForBalance } = await import('./stripe/client');
        const stripeBalance = await getStripeForBalance();
        const balanceTxn = await stripeBalance.customers.createBalanceTransaction(
          payload.stripeCustomerId as string,
          {
            amount: -(payload.amountCents as number),
            currency: 'usd',
            description: payload.description as string,
          },
          { idempotencyKey: `job_${jobId}_balance_refund_${payload.stripeCustomerId}_${payload.amountCents}` }
        );
        logger.info(`[JobQueue] Balance refund issued: ${balanceTxn.id} for customer ${payload.stripeCustomerId}, amount: $${((payload.amountCents as number) / 100).toFixed(2)}`);
        if (payload.balanceRecordId) {
          const { markPaymentRefunded } = await import('./billing/PaymentStatusService');
          await markPaymentRefunded({
            paymentIntentId: payload.balanceRecordId as string,
            refundId: balanceTxn.id,
            amountCents: payload.amountCents as number | undefined,
          });

          await queryWithRetry(
            `UPDATE stripe_payment_intents SET description = COALESCE(description, '') || $1, updated_at = NOW() WHERE stripe_payment_intent_id = $2`,
            [` [Refund: ${balanceTxn.id}]`, payload.balanceRecordId as string],
            3
          );
        }
        break;
      }
      case 'stripe_cancel_payment_intent': {
        const { cancelPaymentIntent } = await import('./stripe/payments');
        const cancelResult = await cancelPaymentIntent(payload.paymentIntentId as string);
        if (cancelResult.success) {
          logger.info(`[JobQueue] Cancelled payment intent: ${payload.paymentIntentId}`);
        } else if (cancelResult.error?.includes('already succeeded') || cancelResult.error?.includes('use refund instead')) {
          logger.warn(`[JobQueue] PI already succeeded, queuing refund instead: ${payload.paymentIntentId}`);
          await queueJob('stripe_auto_refund', {
            paymentIntentId: payload.paymentIntentId,
            reason: 'requested_by_customer',
            metadata: { reason: 'booking_cancellation_pi_succeeded_race' },
          }, { maxRetries: 5 });
        } else {
          logger.error(`[JobQueue] Failed to cancel payment intent: ${payload.paymentIntentId}`, { extra: { error: cancelResult.error } });
        }
        if (payload.markParticipantsRefunded) {
          // BYPASS: PaymentStatusService — job queue refund finalization after Stripe refund is confirmed
          await queryWithRetry(
            `UPDATE booking_participants SET payment_status = 'refunded', refunded_at = NOW() WHERE stripe_payment_intent_id = $1 AND payment_status = 'refund_pending'`,
            [payload.paymentIntentId as string],
            3
          );
        }
        break;
      }
      case 'update_member_tier': {
        const { processMemberTierUpdate } = await import('./memberTierUpdateProcessor');
        await processMemberTierUpdate(payload as unknown as Parameters<typeof processMemberTierUpdate>[0]);
        break;
          }
      case 'wellhub_report_event': {
        const { reportWellhubUsageEvent, markEventReported } = await import('./wellhubEventsService');
        const reportResult = await reportWellhubUsageEvent(
          payload.wellhubUserId as string,
          payload.eventType as string,
          new Date(payload.eventTimestamp as string)
        );
        if (reportResult.success) {
          if (payload.checkinId && Number(payload.checkinId) > 0) {
            await markEventReported(payload.checkinId as number);
          }
          logger.info(`[JobQueue] Wellhub usage event reported for checkin ${payload.checkinId}`);
        } else if (reportResult.rateLimited) {
          throw new Error('Wellhub rate limited — will retry');
        } else {
          throw new Error(reportResult.error || 'Unknown error reporting Wellhub event');
        }
        break;
      }
      case 'tier_change_reconciliation': {
        const email = payload.memberEmail as string;
        const expectedTier = payload.expectedTier as string;
        const subscriptionId = payload.subscriptionId as string;
        const staffEmail = payload.staffEmail as string;
        const isImmediate = payload.immediate as boolean;
        logger.info(`[JobQueue] Reconciling tier change for ${email} → ${expectedTier} (immediate=${isImmediate})`);
        const { memberNotes } = await import('../../shared/schema');

        if (isImmediate) {
          const userRow = await db.execute(sql`SELECT tier FROM users WHERE LOWER(email) = LOWER(${email})`);
          const currentTier = userRow.rows.length > 0 ? (userRow.rows[0] as { tier: string }).tier : null;
          if (currentTier !== expectedTier) {
            await db.execute(
              sql`UPDATE users SET tier = ${expectedTier}, updated_at = NOW() WHERE LOWER(email) = LOWER(${email})`
            );
            logger.info(`[JobQueue] Tier reconciliation corrected ${email}: ${currentTier} → ${expectedTier}`);
          } else {
            logger.info(`[JobQueue] Tier reconciliation skipped for ${email}: already at ${expectedTier}`);
          }
        }

        const reconciliationNote = `[Auto-Reconciliation] ${isImmediate ? `Tier corrected to ${expectedTier}` : `Audit note restored for scheduled change to ${expectedTier}`} after failed DB transaction. Stripe subscription ${subscriptionId} was already updated. Original change by: ${staffEmail}`;
        const existingNote = await db.execute(
          sql`SELECT id FROM member_notes WHERE LOWER(member_email) = LOWER(${email}) AND content = ${reconciliationNote} LIMIT 1`
        );
        if (existingNote.rows.length === 0) {
          await db.insert(memberNotes).values({
            memberEmail: email.toLowerCase(),
            content: reconciliationNote,
            createdBy: 'system',
            createdByName: 'System Reconciliation',
            isPinned: false,
          });
        }
        logger.info(`[JobQueue] Tier reconciliation completed for ${email}`);
        break;
      }
      case 'booking_cleanup_alert': {
        const cleanupBookingId = payload.bookingId as number;
        const cleanupResult = await db.execute(sql`
          SELECT br.id, br.status, br.cleanup_notified_at, br.request_date, br.start_time, br.end_time,
                 br.user_email, br.user_name, br.resource_id,
                 COALESCE(r.name, 'Unknown') as resource_name,
                 COALESCE(r.type, 'simulator') as resource_type
          FROM booking_requests br
          LEFT JOIN resources r ON r.id = br.resource_id
          WHERE br.id = ${cleanupBookingId}
        `);
        if (cleanupResult.rows.length === 0) {
          logger.info(`[JobQueue] Cleanup alert skipped — booking ${cleanupBookingId} not found`);
          break;
        }
        const cleanupBooking = cleanupResult.rows[0] as {
          id: number; status: string; cleanup_notified_at: Date | null;
          request_date: string; start_time: string; end_time: string;
          user_email: string; user_name: string | null; resource_id: number;
          resource_name: string; resource_type: string;
        };
        if (!['approved', 'confirmed', 'attended', 'checked_in'].includes(cleanupBooking.status)) {
          logger.info(`[JobQueue] Cleanup alert skipped — booking ${cleanupBookingId} status is ${cleanupBooking.status}`);
          break;
        }
        if (cleanupBooking.cleanup_notified_at) {
          logger.info(`[JobQueue] Cleanup alert skipped — booking ${cleanupBookingId} already notified`);
          break;
        }
        const endTimeParts = cleanupBooking.end_time.split(':').map(Number);
        const adjacencyLimitMinutes = Math.min((endTimeParts[0] || 0) * 60 + (endTimeParts[1] || 0) + 5, 23 * 60 + 59);
        const adjacencyLimitHours = Math.floor(adjacencyLimitMinutes / 60);
        const adjacencyLimitMins = adjacencyLimitMinutes % 60;
        const adjacencyLimitTime = `${String(adjacencyLimitHours).padStart(2, '0')}:${String(adjacencyLimitMins).padStart(2, '0')}`;

        const nextBookingResult = await db.execute(sql`
          SELECT br.id, br.user_name, br.user_email, br.start_time
          FROM booking_requests br
          WHERE br.resource_id = ${cleanupBooking.resource_id}
            AND br.request_date = ${cleanupBooking.request_date}
            AND br.start_time >= ${cleanupBooking.end_time}
            AND br.start_time <= ${adjacencyLimitTime}
            AND br.id != ${cleanupBookingId}
            AND br.status IN ('approved', 'confirmed', 'attended', 'checked_in')
          ORDER BY br.start_time ASC
          LIMIT 1
        `);
        const hasNextBooking = nextBookingResult.rows.length > 0;
        const nextBookingInfo = hasNextBooking ? (nextBookingResult.rows[0] as { user_name: string | null; user_email: string; start_time: string }) : null;

        const cleanupTitle = 'Session Ending Soon';
        const isConferenceRoom = cleanupBooking.resource_type === 'conference';
        const cleanupInstruction = isConferenceRoom
          ? 'Please remind the booking owner their session is about to end, then clean up the area and reset chairs.'
          : 'Please clear drinks, reset the balls, and organize the tees.';
        const cleanupMessage = `${cleanupBooking.resource_name} — ${cleanupBooking.user_name || cleanupBooking.user_email} — ends in 10 minutes. ${cleanupInstruction}${hasNextBooking ? ` Next: ${nextBookingInfo?.user_name || nextBookingInfo?.user_email} at ${nextBookingInfo?.start_time?.substring(0, 5)}.` : ''}`;

        await notifyAllStaff(cleanupTitle, cleanupMessage, 'booking_reminder', {
          relatedId: cleanupBookingId,
          relatedType: 'booking',
          url: '/admin/bookings',
        });

        broadcastToStaff({
          type: 'booking_cleanup_alert',
          bookingId: cleanupBookingId,
          resourceName: cleanupBooking.resource_name,
          resourceType: cleanupBooking.resource_type,
          memberName: cleanupBooking.user_name || cleanupBooking.user_email,
          endTime: cleanupBooking.end_time,
          hasNextBooking,
          nextBookingMember: nextBookingInfo ? (nextBookingInfo.user_name || nextBookingInfo.user_email) : null,
          nextBookingStartTime: nextBookingInfo?.start_time || null,
        });

        await db.execute(sql`UPDATE booking_requests SET cleanup_notified_at = NOW() WHERE id = ${cleanupBookingId} AND cleanup_notified_at IS NULL`);

        logger.info(`[JobQueue] Cleanup alert sent for booking ${cleanupBookingId} (${cleanupBooking.resource_name})`);
        break;
      }
      case 'generic_async_task':
        logger.info(`[JobQueue] Executing generic task: ${payload.description || 'no description'}`);
        break;
      default:
        logger.warn(`[JobQueue] Unknown job type: ${jobType}`);
    }
    
    await markJobCompleted(job.id);
  } catch (error: unknown) {
    logger.error(`[JobQueue] Job ${job.id} (${jobType}) failed:`, { extra: { error: getErrorMessage(error) } });
    await markJobFailed(job.id, getErrorMessage(error), job.retryCount, job.maxRetries);
  }
}

let processingInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let isProcessingJobs = false;
let consecutiveFailures = 0;
const MAX_BACKOFF_MULTIPLIER = 6;

export async function processJobs(): Promise<number> {
  const jobs = await claimJobs();
  
  if (jobs.length === 0) return 0;
  
  logger.info(`[JobQueue] Processing ${jobs.length} job(s)`);
  
  for (const job of jobs) {
    await executeJob(job);
  }
  
  return jobs.length;
}

export function startJobProcessor(intervalMs: number = 5000): void {
  if (processingInterval || startupTimeout) {
    logger.info('[JobQueue] Processor already running');
    return;
  }
  
  logger.info(`[Startup] Job queue processor enabled (runs every ${intervalMs / 1000}s, starting after 15s warmup)`);
  
  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    processJobs().catch(err => {
      logger.error('[JobQueue] Initial job scan error:', { extra: { error: getErrorMessage(err) } });
    });
    
    processingInterval = setInterval(async () => {
      if (isProcessingJobs) {
        return;
      }

      if (consecutiveFailures > 0) {
        const skipCycles = Math.min(consecutiveFailures, MAX_BACKOFF_MULTIPLIER);
        const shouldSkip = Math.random() > (1 / (skipCycles + 1));
        if (shouldSkip) {
          return;
        }
      }

      isProcessingJobs = true;
      try {
        await processJobs();
        schedulerTracker.recordRun('Job Queue Processor', true);
        if (consecutiveFailures > 0) {
          logger.info(`[JobQueue] Recovered after ${consecutiveFailures} consecutive failure(s)`);
          consecutiveFailures = 0;
        }
      } catch (error: unknown) {
        consecutiveFailures++;
        const errMsg = getErrorMessage(error);
        const isConnectionIssue = errMsg.includes('timeout') || errMsg.includes('ECONNRESET') ||
          errMsg.includes('connection') || errMsg.includes('ETIMEDOUT') || errMsg.includes('pool');
        if (isConnectionIssue && consecutiveFailures <= 3) {
          logger.warn(`[JobQueue] Connection issue (attempt ${consecutiveFailures}), backing off:`, { extra: { error: errMsg } });
        } else {
          logger.error('[JobQueue] Processing error:', { extra: { error: errMsg } });
        }
        schedulerTracker.recordRun('Job Queue Processor', false, getErrorMessage(error));
      } finally {
        isProcessingJobs = false;
      }
    }, intervalMs);
  }, 15000);
}

export function stopJobProcessor(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (processingInterval) {
    clearInterval(processingInterval);
    processingInterval = null;
    logger.info('[JobQueue] Processor stopped');
  }
}

export async function cleanupOldJobs(daysToKeep: number = 7): Promise<number> {
  const result = await queryWithRetry(
    `WITH to_delete AS (
       SELECT id FROM job_queue
       WHERE status IN ('completed', 'failed')
         AND processed_at < NOW() - INTERVAL '1 day' * $1
       LIMIT 5000
     )
     DELETE FROM job_queue
     WHERE id IN (SELECT id FROM to_delete)
     RETURNING id`,
    [daysToKeep],
    3
  );
  
  if (result.rowCount && result.rowCount > 0) {
    logger.info(`[JobQueue] Cleaned up ${result.rowCount} old jobs`);
  }
  
  return result.rowCount || 0;
}

export async function getJobQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const result = await queryWithRetry(
    `SELECT status, COUNT(*)::int as count FROM job_queue GROUP BY status`,
    [],
    3
  );
  
  const stats = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const _row of result.rows) {
    const row = _row as unknown as JobStatusCountRow;
    if (row.status === 'pending') stats.pending = row.count;
    else if (row.status === 'processing') stats.processing = row.count;
    else if (row.status === 'completed') stats.completed = row.count;
    else if (row.status === 'failed') stats.failed = row.count;
  }
  
  return stats;
}
