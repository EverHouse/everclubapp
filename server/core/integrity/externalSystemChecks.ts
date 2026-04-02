import { db } from '../../db';
import { sql } from 'drizzle-orm';
import { logger } from '../logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { enqueueHubSpotSync } from '../hubspot/queue';
import type { IntegrityCheckResult, IntegrityIssue } from './core';

export async function checkUnreportedWellhubEvents(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM wellhub_checkins
      WHERE validation_status = 'validated'
        AND event_reported_at IS NULL
        AND created_at > NOW() - INTERVAL '35 days'
    `);
    const unreportedCount = (result.rows[0] as { count: number }).count;

    if (unreportedCount > 0) {
      const recentResult = await db.execute(sql`
        SELECT id, wellhub_user_id, created_at
        FROM wellhub_checkins
        WHERE validation_status = 'validated'
          AND event_reported_at IS NULL
          AND created_at > NOW() - INTERVAL '35 days'
        ORDER BY created_at ASC
        LIMIT 10
      `);

      for (const row of recentResult.rows as unknown as Array<{ id: number; wellhub_user_id: string; created_at: string }>) {
        issues.push({
          category: 'sync_mismatch',
          severity: 'warning',
          table: 'wellhub_checkins',
          recordId: String(row.id),
          description: `Wellhub check-in #${row.id} (user ${row.wellhub_user_id}) validated but usage event not reported to Wellhub Events API`,
          suggestion: 'Run the Wellhub event reconciliation or investigate API connectivity',
          context: {
            checkinId: row.id,
            wellhubUserId: row.wellhub_user_id,
            createdAt: row.created_at,
            totalUnreported: unreportedCount,
          }
        });
      }
    }

    return {
      checkName: 'Unreported Wellhub Events',
      status: unreportedCount === 0 ? 'pass' : 'warning',
      issueCount: unreportedCount,
      issues,
      lastRun: new Date(),
    };
  } catch (error: unknown) {
    logger.error('[Integrity] Unreported Wellhub Events check failed', { extra: { error: getErrorMessage(error) } });
    return {
      checkName: 'Unreported Wellhub Events',
      status: 'error',
      issueCount: 0,
      issues: [],
      lastRun: new Date(),
      error: getErrorMessage(error),
    };
  }
}

export async function checkCrossSystemDrift(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  interface DriftRow {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
  }

  try {
    const activeNoStripeResult = await db.execute(sql`
      SELECT u.id, u.email, u.first_name, u.last_name
      FROM users u
      WHERE u.membership_status = 'active'
        AND u.stripe_customer_id IS NULL
        AND u.hubspot_id IS NOT NULL
        AND u.archived_at IS NULL
        AND u.role = 'member'
        AND (u.billing_provider IS NULL OR u.billing_provider = 'stripe')
      ORDER BY u.email
      LIMIT 25
    `);

    for (const member of activeNoStripeResult.rows as unknown as DriftRow[]) {
      const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Unknown';
      issues.push({
        category: 'sync_mismatch',
        severity: 'warning',
        table: 'users',
        recordId: member.id,
        description: `Member "${memberName}" (${member.email}) is active with HubSpot contact but missing Stripe customer ID — billing may not be configured`,
        suggestion: 'Verify billing status and ensure Stripe customer exists',
        context: {
          memberName,
          memberEmail: member.email,
          syncType: 'cross_system',
          userId: member.id,
        }
      });
    }

    const activeNoHubSpotResult = await db.execute(sql`
      SELECT u.id, u.email, u.first_name, u.last_name
      FROM users u
      WHERE u.membership_status = 'active'
        AND u.hubspot_id IS NULL
        AND u.stripe_customer_id IS NOT NULL
        AND u.archived_at IS NULL
        AND u.role = 'member'
        AND (u.billing_provider IS NULL OR u.billing_provider NOT IN ('mindbody', 'family_addon', 'comped'))
      ORDER BY u.email
      LIMIT 25
    `);

    for (const member of activeNoHubSpotResult.rows as unknown as DriftRow[]) {
      const memberName = [member.first_name, member.last_name].filter(Boolean).join(' ') || 'Unknown';
      issues.push({
        category: 'sync_mismatch',
        severity: 'warning',
        table: 'users',
        recordId: member.id,
        description: `Member "${memberName}" (${member.email}) is active with Stripe customer but missing HubSpot contact ID — CRM sync may be drifting`,
        suggestion: 'Run HubSpot contact sync to associate this member',
        context: {
          memberName,
          memberEmail: member.email,
          syncType: 'cross_system',
          userId: member.id,
        }
      });
    }

    const orphanedStripeResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM users
      WHERE stripe_customer_id IS NOT NULL
        AND hubspot_id IS NULL
        AND membership_status = 'active'
        AND archived_at IS NULL
        AND role = 'member'
        AND (billing_provider IS NULL OR billing_provider NOT IN ('mindbody', 'family_addon', 'comped'))
    `);
    const orphanedStripeCount = Number((orphanedStripeResult.rows[0] as Record<string, string>)?.cnt) || 0;

    if (orphanedStripeCount > 5) {
      issues.push({
        category: 'sync_mismatch',
        severity: 'warning',
        table: 'users',
        recordId: 'cross_system_stripe_hubspot',
        description: `${orphanedStripeCount} active Stripe-billed members have no HubSpot contact ID — CRM sync may be drifting`,
        suggestion: 'Run HubSpot contact sync to associate missing contacts',
      });
    }

    const orphanedHubSpotResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM users
      WHERE hubspot_id IS NOT NULL
        AND stripe_customer_id IS NULL
        AND membership_status = 'active'
        AND archived_at IS NULL
        AND role = 'member'
        AND (billing_provider IS NULL OR billing_provider = 'stripe')
    `);
    const orphanedHubSpotCount = Number((orphanedHubSpotResult.rows[0] as Record<string, string>)?.cnt) || 0;

    if (orphanedHubSpotCount > 5) {
      issues.push({
        category: 'sync_mismatch',
        severity: 'warning',
        table: 'users',
        recordId: 'cross_system_hubspot_stripe',
        description: `${orphanedHubSpotCount} active members with HubSpot contact but no Stripe customer — billing may not be configured`,
        suggestion: 'Review these members to ensure billing is set up correctly',
      });
    }
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Cross-system drift check error:', { extra: { error: getErrorMessage(error) } });
    issues.push({
      category: 'sync_mismatch',
      severity: 'info',
      table: 'cross_system',
      recordId: 'drift_check_error',
      description: `Cross-system drift check failed: ${getErrorMessage(error)}`,
      suggestion: 'Retry the integrity check',
    });
  }

  return {
    checkName: 'Cross-System Drift Detection',
    status: issues.length === 0 ? 'pass' : issues.some(i => i.severity === 'error') ? 'fail' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
  };
}

export async function checkEmailDeliveryHealth(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const statsResult = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'email.sent' AND event_id LIKE 'local-%' AND created_at >= NOW() - INTERVAL '7 days') AS sent_7d,
        COUNT(*) FILTER (WHERE event_type = 'email.bounced' AND created_at >= NOW() - INTERVAL '7 days') AS bounced_7d,
        COUNT(*) FILTER (WHERE event_type = 'email.complained' AND created_at >= NOW() - INTERVAL '7 days') AS complained_7d
      FROM email_events
    `);

    const raw = statsResult.rows[0] as Record<string, string> | undefined;
    const sent7d = Number(raw?.sent_7d) || 0;
    const bounced7d = Number(raw?.bounced_7d) || 0;
    const complained7d = Number(raw?.complained_7d) || 0;

    if (sent7d > 0) {
      const bounceRate = (bounced7d / sent7d) * 100;
      if (bounceRate > 5) {
        issues.push({
          category: 'data_quality',
          severity: 'error',
          table: 'email_events',
          recordId: 'bounce_rate_7d',
          description: `Email bounce rate is ${bounceRate.toFixed(1)}% over last 7 days (${bounced7d} bounces / ${sent7d} sent) — exceeds 5% threshold`,
          suggestion: 'Review bounced email addresses and clean up contact list. High bounce rates can damage sender reputation.',
        });
      } else if (bounceRate > 2) {
        issues.push({
          category: 'data_quality',
          severity: 'warning',
          table: 'email_events',
          recordId: 'bounce_rate_7d',
          description: `Email bounce rate is ${bounceRate.toFixed(1)}% over last 7 days (${bounced7d} bounces / ${sent7d} sent) — approaching threshold`,
          suggestion: 'Monitor bounce rate and review bounced addresses proactively.',
        });
      }

      const complaintRate = (complained7d / sent7d) * 100;
      if (complaintRate > 0.1) {
        issues.push({
          category: 'data_quality',
          severity: 'error',
          table: 'email_events',
          recordId: 'complaint_rate_7d',
          description: `Email complaint rate is ${complaintRate.toFixed(2)}% over last 7 days (${complained7d} complaints / ${sent7d} sent) — exceeds 0.1% threshold`,
          suggestion: 'Review email content and frequency. High complaint rates can lead to email service suspension.',
        });
      }
    }

    const suppressedResult = await db.execute(sql`
      SELECT COUNT(*) as cnt FROM users
      WHERE email_delivery_status IN ('bounced', 'complained')
        AND archived_at IS NULL
        AND membership_status = 'active'
    `);
    const activesSuppressed = Number((suppressedResult.rows[0] as Record<string, string>)?.cnt) || 0;

    if (activesSuppressed > 0) {
      issues.push({
        category: 'data_quality',
        severity: 'warning',
        table: 'users',
        recordId: 'active_members_suppressed',
        description: `${activesSuppressed} active member(s) have suppressed email delivery (bounced/complained) — they will not receive transactional emails`,
        suggestion: 'Contact these members to verify their email addresses.',
      });
    }
  } catch (error: unknown) {
    logger.error('[DataIntegrity] Email delivery health check error:', { extra: { error: getErrorMessage(error) } });
  }

  return {
    checkName: 'Email Delivery Health',
    status: issues.length === 0 ? 'pass' : issues.some(i => i.severity === 'error') ? 'fail' : 'warning',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
  };
}

export async function reconcileRecentlyActivatedHubSpotSync(): Promise<{
  checked: number;
  enqueued: number;
  errors: string[];
}> {
  const result = { checked: 0, enqueued: 0, errors: [] as string[] };

  try {
    interface RecentlyActivatedRow {
      id: number;
      email: string;
      first_name: string | null;
      last_name: string | null;
      tier: string | null;
    }

    const recentlyActivatedResult = await db.execute(sql`
      SELECT u.id, u.email, u.first_name, u.last_name, u.tier
      FROM users u
      WHERE u.membership_status = 'active'
        AND u.hubspot_id IS NULL
        AND u.archived_at IS NULL
        AND u.role = 'member'
        AND (u.billing_provider IS NULL OR u.billing_provider NOT IN ('mindbody', 'family_addon', 'comped'))
        AND u.membership_status_changed_at >= NOW() - INTERVAL '48 hours'
        AND u.email IS NOT NULL
        AND u.email != ''
      ORDER BY u.membership_status_changed_at DESC
      LIMIT 50
    `);

    const members = recentlyActivatedResult.rows as unknown as RecentlyActivatedRow[];
    result.checked = members.length;

    if (members.length === 0) {
      return result;
    }

    logger.info(`[HubSpot Reconciliation] Found ${members.length} recently-activated members without HubSpot contact`);

    for (const member of members) {
      try {
        const existingJob = await db.execute(sql`
          SELECT id FROM hubspot_sync_queue
          WHERE operation = 'create_contact'
            AND payload::text LIKE ${'%' + member.email + '%'}
            AND status IN ('pending', 'processing', 'failed')
            AND created_at >= NOW() - INTERVAL '48 hours'
          LIMIT 1
        `);

        if (existingJob.rows.length > 0) {
          continue;
        }

        const jobId = await enqueueHubSpotSync('create_contact', {
          email: member.email,
          firstName: member.first_name || '',
          lastName: member.last_name || '',
          phone: '',
          tier: member.tier || undefined,
        }, {
          idempotencyKey: `reconcile_active_hubspot_${member.id}`,
          priority: 7,
        });

        if (jobId !== null) {
          result.enqueued++;
          logger.info(`[HubSpot Reconciliation] Enqueued contact creation for recently-activated member`, {
            extra: { memberId: member.id, email: member.email, jobId }
          });
        }
      } catch (memberErr: unknown) {
        const errMsg = `${member.email}: ${getErrorMessage(memberErr)}`;
        result.errors.push(errMsg);
        logger.error(`[HubSpot Reconciliation] Failed to enqueue member`, {
          extra: { error: getErrorMessage(memberErr), memberId: member.id, email: member.email }
        });
      }
    }

    if (result.enqueued > 0) {
      logger.info(`[HubSpot Reconciliation] Enqueued ${result.enqueued} contact creation jobs for recently-activated members`);
    }
  } catch (error: unknown) {
    logger.error('[HubSpot Reconciliation] Reconciliation check failed:', { extra: { error: getErrorMessage(error) } });
    result.errors.push(`Reconciliation failed: ${getErrorMessage(error)}`);
  }

  return result;
}

export async function checkStuckPushNotifications(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];

  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int as count
      FROM notifications
      WHERE push_delivery_status = 'pending'
        AND created_at < NOW() - INTERVAL '24 hours'
    `);
    const stuckCount = (result.rows[0] as { count: number }).count;

    if (stuckCount > 0) {
      const stuckRows = await db.execute(sql`
        SELECT id, user_email, type, title, created_at
        FROM notifications
        WHERE push_delivery_status = 'pending'
          AND created_at < NOW() - INTERVAL '24 hours'
        ORDER BY created_at ASC
        LIMIT 10
      `);

      for (const row of stuckRows.rows as unknown as Array<{ id: number; user_email: string; type: string; title: string; created_at: string }>) {
        issues.push({
          category: 'system_error',
          severity: 'warning',
          table: 'notifications',
          recordId: String(row.id),
          description: `Notification #${row.id} for ${row.user_email} (${row.type}: "${row.title}") stuck in pending push delivery for >24h`,
          suggestion: 'Investigate push delivery pipeline — notification was created but push was never attempted or status was never updated',
          context: {
            userEmail: row.user_email,
            issueType: 'stuck_push_delivery',
            createdAt: row.created_at,
            count: stuckCount,
          }
        });
      }
    }

    return {
      checkName: 'Stuck Push Notifications',
      status: stuckCount === 0 ? 'pass' : 'warning',
      issueCount: stuckCount,
      issues,
      lastRun: new Date(),
    };
  } catch (error: unknown) {
    logger.error('[Integrity] Stuck Push Notifications check failed', { extra: { error: getErrorMessage(error) } });
    return {
      checkName: 'Stuck Push Notifications',
      status: 'error',
      issueCount: 0,
      issues: [],
      lastRun: new Date(),
      error: getErrorMessage(error),
    };
  }
}

export async function checkStalePushSubscriptions(): Promise<IntegrityCheckResult> {
  const issues: IntegrityIssue[] = [];
  const STALE_DAYS = 90;

  try {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM push_subscriptions
      WHERE last_active_at < NOW() - CAST(${STALE_DAYS + ' days'} AS INTERVAL)
    `);
    const staleCount = (result.rows[0] as { count: number }).count;

    if (staleCount > 0) {
      issues.push({
        category: 'data_quality',
        severity: 'info',
        table: 'push_subscriptions',
        recordId: 'stale_subscriptions',
        description: `${staleCount} push subscription(s) have not been active in over ${STALE_DAYS} days and will be cleaned up by the notification cleanup scheduler`,
        suggestion: 'No action needed — stale subscriptions are automatically removed by the scheduled cleanup.',
        context: { count: staleCount },
      });
    }
  } catch (error: unknown) {
    logger.error('[Integrity] Stale push subscription check failed:', { extra: { error: getErrorMessage(error) } });
    issues.push({
      category: 'system_error',
      severity: 'error',
      table: 'push_subscriptions',
      recordId: 'check_error',
      description: `Failed to check stale push subscriptions: ${getErrorMessage(error)}`,
    });
  }

  const hasError = issues.some(i => i.category === 'system_error');
  return {
    checkName: 'Stale Push Subscriptions',
    status: hasError ? 'warning' : issues.length === 0 ? 'pass' : 'info',
    issueCount: issues.length,
    issues,
    lastRun: new Date(),
  };
}
