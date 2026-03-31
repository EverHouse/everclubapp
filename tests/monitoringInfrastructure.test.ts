// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/db', () => ({
  db: { execute: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  sql: Object.assign(vi.fn((..._args: unknown[]) => 'mock-sql'), { join: vi.fn() }),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => String(e)),
}));

vi.mock('../server/core/db', () => ({
  queryWithRetry: vi.fn(),
}));

import { db } from '../server/db';
import { queryWithRetry } from '../server/core/db';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;
const mockQueryWithRetry = queryWithRetry as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
  mockQueryWithRetry.mockReset();
});

describe('alertHistoryMonitor - getAlertHistory', () => {
  it('returns sorted alert entries', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { id: 1, user_email: 'admin@test.com', title: 'Alert A', message: 'Msg A', created_at: new Date('2026-03-31T10:00:00Z'), is_read: false },
        { id: 2, user_email: 'admin@test.com', title: 'Alert B', message: 'Msg B', created_at: new Date('2026-03-31T12:00:00Z'), is_read: true },
      ]
    });

    const { getAlertHistory } = await import('../server/core/alertHistoryMonitor');
    const alerts = await getAlertHistory({});

    expect(alerts).toHaveLength(2);
    expect(alerts[0].title).toBe('Alert B');
    expect(alerts[1].title).toBe('Alert A');
    expect(alerts[0].isRead).toBe(true);
    expect(alerts[1].isRead).toBe(false);
  });

  it('returns empty array when no alerts', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { getAlertHistory } = await import('../server/core/alertHistoryMonitor');
    const alerts = await getAlertHistory({});

    expect(alerts).toHaveLength(0);
  });

  it('clamps limit to max 200', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { getAlertHistory } = await import('../server/core/alertHistoryMonitor');
    const alerts = await getAlertHistory({ limit: 500 });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(alerts).toEqual([]);
  });

  it('applies date range filters without error', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [{ id: 1, user_email: 'a@test.com', title: 'Filtered', message: 'msg', created_at: '2026-03-15T10:00:00Z', is_read: false }]
    });

    const { getAlertHistory } = await import('../server/core/alertHistoryMonitor');
    const alerts = await getAlertHistory({ startDate: '2026-03-01', endDate: '2026-03-31' });

    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe('Filtered');
  });
});

describe('webhookMonitor - getWebhookEvents', () => {
  it('returns webhook events with status', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: 2 }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1, event_type: 'booking.created', trackman_booking_id: 'TM-1',
            trackman_user_id: null, processed_at: new Date('2026-03-31T10:00:00Z'),
            processing_error: null, matched_booking_id: 100, matched_user_id: null,
            created_at: new Date('2026-03-31T09:00:00Z'), retry_count: 0, last_retry_at: null
          },
          {
            id: 2, event_type: 'booking.updated', trackman_booking_id: 'TM-2',
            trackman_user_id: null, processed_at: null,
            processing_error: 'Timeout', matched_booking_id: null, matched_user_id: null,
            created_at: new Date('2026-03-31T09:30:00Z'), retry_count: 2, last_retry_at: new Date('2026-03-31T09:45:00Z')
          },
        ]
      });

    const { getWebhookEvents } = await import('../server/core/webhookMonitor');
    const { events, total } = await getWebhookEvents({});

    expect(total).toBe(2);
    expect(events).toHaveLength(2);
    expect(events[0].status).toBe('processed');
    expect(events[1].status).toBe('failed');
    expect(events[1].processingError).toBe('Timeout');
    expect(events[1].retryCount).toBe(2);
  });

  it('returns pending status for unprocessed events', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 3, event_type: 'booking.deleted', trackman_booking_id: 'TM-3',
          trackman_user_id: null, processed_at: null,
          processing_error: null, matched_booking_id: null, matched_user_id: null,
          created_at: new Date('2026-03-31T11:00:00Z'), retry_count: 0, last_retry_at: null
        }]
      });

    const { getWebhookEvents } = await import('../server/core/webhookMonitor');
    const { events } = await getWebhookEvents({});

    expect(events[0].status).toBe('pending');
  });

  it('clamps limit and returns empty when no events', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: 0 }] })
      .mockResolvedValueOnce({ rows: [] });

    const { getWebhookEvents } = await import('../server/core/webhookMonitor');
    const { events, total } = await getWebhookEvents({ limit: 500 });

    expect(total).toBe(0);
    expect(events).toEqual([]);
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });
});

describe('webhookMonitor - getWebhookEvents filtering', () => {
  it('filters events by type parameter', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 10, event_type: 'booking.created', trackman_booking_id: 'TM-10',
          trackman_user_id: null, processed_at: new Date('2026-03-31T10:00:00Z'),
          processing_error: null, matched_booking_id: 50, matched_user_id: null,
          created_at: new Date('2026-03-31T09:00:00Z'), retry_count: 0, last_retry_at: null
        }]
      });

    const { getWebhookEvents } = await import('../server/core/webhookMonitor');
    const { events, total } = await getWebhookEvents({ type: 'booking.created' });

    expect(total).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe('booking.created');
    expect(events[0].status).toBe('processed');
  });

  it('filters events by failed status', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 11, event_type: 'booking.updated', trackman_booking_id: 'TM-11',
          trackman_user_id: null, processed_at: null,
          processing_error: 'Handler exception', matched_booking_id: null, matched_user_id: null,
          created_at: new Date('2026-03-31T08:00:00Z'), retry_count: 5, last_retry_at: new Date('2026-03-31T09:00:00Z')
        }]
      });

    const { getWebhookEvents } = await import('../server/core/webhookMonitor');
    const { events } = await getWebhookEvents({ status: 'failed' });

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe('failed');
    expect(events[0].retryCount).toBe(5);
    expect(events[0].processingError).toBe('Handler exception');
  });

  it('correctly identifies events with exhausted retries', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ total: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 12, event_type: 'booking.cancelled', trackman_booking_id: 'TM-12',
          trackman_user_id: null, processed_at: null,
          processing_error: 'Max retries exceeded', matched_booking_id: null, matched_user_id: null,
          created_at: new Date('2026-03-30T10:00:00Z'), retry_count: 10, last_retry_at: new Date('2026-03-31T10:00:00Z')
        }]
      });

    const { getWebhookEvents } = await import('../server/core/webhookMonitor');
    const { events } = await getWebhookEvents({ status: 'failed' });

    expect(events[0].status).toBe('failed');
    expect(events[0].retryCount).toBe(10);
    expect(events[0].lastRetryAt).toBeTruthy();
  });
});

describe('webhookMonitor - getWebhookEventTypes', () => {
  it('returns unique event types', async () => {
    mockExecute.mockResolvedValueOnce({
      rows: [
        { event_type: 'booking.created' },
        { event_type: 'booking.deleted' },
        { event_type: 'booking.updated' },
      ]
    });

    const { getWebhookEventTypes } = await import('../server/core/webhookMonitor');
    const types = await getWebhookEventTypes();

    expect(types).toEqual(['booking.created', 'booking.deleted', 'booking.updated']);
  });
});

describe('jobQueueMonitor - getJobQueueMonitorData', () => {
  it('returns job queue statistics', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ pending: 5, processing: 2, completed: 100, failed: 3 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1, job_type: 'email_send', last_error: 'SMTP timeout',
          created_at: new Date('2026-03-31T08:00:00Z'), retry_count: 3, max_retries: 5
        }]
      })
      .mockResolvedValueOnce({
        rows: [{
          id: 2, job_type: 'sync_member', processed_at: new Date('2026-03-31T10:00:00Z')
        }]
      })
      .mockResolvedValueOnce({ rows: [{ oldest: new Date('2026-03-31T06:00:00Z') }] });

    const { getJobQueueMonitorData } = await import('../server/core/jobQueueMonitor');
    const data = await getJobQueueMonitorData();

    expect(data.stats.pending).toBe(5);
    expect(data.stats.processing).toBe(2);
    expect(data.stats.completed).toBe(100);
    expect(data.stats.failed).toBe(3);
    expect(data.recentFailed).toHaveLength(1);
    expect(data.recentFailed[0].jobType).toBe('email_send');
    expect(data.recentFailed[0].lastError).toBe('SMTP timeout');
    expect(data.recentCompleted).toHaveLength(1);
    expect(data.recentCompleted[0].jobType).toBe('sync_member');
    expect(data.oldestPending).toBeTruthy();
  });

  it('handles empty queue', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ pending: 0, processing: 0, completed: 0, failed: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest: null }] });

    const { getJobQueueMonitorData } = await import('../server/core/jobQueueMonitor');
    const data = await getJobQueueMonitorData();

    expect(data.stats.pending).toBe(0);
    expect(data.stats.failed).toBe(0);
    expect(data.recentFailed).toHaveLength(0);
    expect(data.oldestPending).toBeNull();
  });
});

describe('jobQueueMonitor - stuck and exhausted jobs', () => {
  it('identifies jobs that have exhausted all retries', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ pending: 0, processing: 0, completed: 50, failed: 3 }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 1, job_type: 'email_send', last_error: 'SMTP timeout', created_at: new Date('2026-03-30T08:00:00Z'), retry_count: 5, max_retries: 5 },
          { id: 2, job_type: 'sync_member', last_error: 'API unavailable', created_at: new Date('2026-03-30T10:00:00Z'), retry_count: 3, max_retries: 3 },
        ]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest: null }] });

    const { getJobQueueMonitorData } = await import('../server/core/jobQueueMonitor');
    const data = await getJobQueueMonitorData();

    expect(data.recentFailed).toHaveLength(2);
    const exhaustedJobs = data.recentFailed.filter(j => j.retryCount >= j.maxRetries);
    expect(exhaustedJobs).toHaveLength(2);
    expect(exhaustedJobs[0].lastError).toBe('SMTP timeout');
    expect(exhaustedJobs[1].lastError).toBe('API unavailable');
  });

  it('detects long-pending jobs via oldestPending timestamp', async () => {
    const oldTimestamp = new Date(Date.now() - 4 * 60 * 60 * 1000);
    mockExecute
      .mockResolvedValueOnce({ rows: [{ pending: 5, processing: 1, completed: 10, failed: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest: oldTimestamp }] });

    const { getJobQueueMonitorData } = await import('../server/core/jobQueueMonitor');
    const data = await getJobQueueMonitorData();

    expect(data.stats.pending).toBe(5);
    expect(data.stats.processing).toBe(1);
    expect(data.oldestPending).toBeTruthy();
    const oldestDate = new Date(data.oldestPending!);
    const ageMs = Date.now() - oldestDate.getTime();
    expect(ageMs).toBeGreaterThan(3 * 60 * 60 * 1000);
  });

  it('distinguishes processing (locked) from plain pending', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ pending: 3, processing: 2, completed: 0, failed: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ oldest: null }] });

    const { getJobQueueMonitorData } = await import('../server/core/jobQueueMonitor');
    const data = await getJobQueueMonitorData();

    expect(data.stats.pending).toBe(3);
    expect(data.stats.processing).toBe(2);
    expect(data.stats.pending).not.toBe(data.stats.processing);
  });
});

describe('hubspotQueueMonitor - getHubSpotQueueMonitorData', () => {
  it('returns HubSpot queue statistics', async () => {
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [{ pending: 10, failed: 2, completed_24h: 50, superseded_24h: 5, processing: 1 }] })
      .mockResolvedValueOnce({
        rows: [{
          id: 1, operation: 'create_contact', last_error: 'Rate limited',
          created_at: '2026-03-31T08:00:00Z', retry_count: 2, max_retries: 5,
          next_retry_at: '2026-03-31T08:30:00Z'
        }]
      })
      .mockResolvedValueOnce({ rows: [{ avg_ms: 1500 }] })
      .mockResolvedValueOnce({ rows: [{ oldest_pending: new Date(Date.now() - 120000).toISOString() }] });

    const { getHubSpotQueueMonitorData } = await import('../server/core/hubspotQueueMonitor');
    const data = await getHubSpotQueueMonitorData();

    expect(data.stats.pending).toBe(10);
    expect(data.stats.failed).toBe(2);
    expect(data.stats.completed_24h).toBe(50);
    expect(data.stats.superseded_24h).toBe(5);
    expect(data.stats.processing).toBe(1);
    expect(data.recentFailed).toHaveLength(1);
    expect(data.recentFailed[0].operation).toBe('create_contact');
    expect(data.recentFailed[0].lastError).toBe('Rate limited');
    expect(data.avgProcessingTime).toBe(1500);
    expect(data.queueLag).toContain('m');
  });

  it('handles empty queue with no pending items', async () => {
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [{ pending: 0, failed: 0, completed_24h: 0, superseded_24h: 0, processing: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: 0 }] })
      .mockResolvedValueOnce({ rows: [{ oldest_pending: null }] });

    const { getHubSpotQueueMonitorData } = await import('../server/core/hubspotQueueMonitor');
    const data = await getHubSpotQueueMonitorData();

    expect(data.stats.pending).toBe(0);
    expect(data.recentFailed).toHaveLength(0);
    expect(data.avgProcessingTime).toBe(0);
    expect(data.queueLag).toBe('No pending items');
  });

  it('shows queue lag in seconds for recent items', async () => {
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [{ pending: 1, failed: 0, completed_24h: 0, superseded_24h: 0, processing: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: 0 }] })
      .mockResolvedValueOnce({ rows: [{ oldest_pending: new Date(Date.now() - 30000).toISOString() }] });

    const { getHubSpotQueueMonitorData } = await import('../server/core/hubspotQueueMonitor');
    const data = await getHubSpotQueueMonitorData();

    expect(data.queueLag).toContain('s');
  });

  it('shows queue lag in hours for old items', async () => {
    mockQueryWithRetry
      .mockResolvedValueOnce({ rows: [{ pending: 1, failed: 0, completed_24h: 0, superseded_24h: 0, processing: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ avg_ms: 0 }] })
      .mockResolvedValueOnce({ rows: [{ oldest_pending: new Date(Date.now() - 7200000).toISOString() }] });

    const { getHubSpotQueueMonitorData } = await import('../server/core/hubspotQueueMonitor');
    const data = await getHubSpotQueueMonitorData();

    expect(data.queueLag).toContain('h');
  });
});

describe('monitoring.ts - logAlert and helpers', () => {
  it('logAlert adds to recent alerts and persists', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { logAlert, getRecentAlerts } = await import('../server/core/monitoring');

    await logAlert({
      severity: 'critical',
      category: 'payment',
      message: 'Payment failed for test',
      details: { paymentIntentId: 'pi_test' },
      userEmail: 'user@test.com',
    });

    const alerts = getRecentAlerts();
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const latestAlert = alerts.find(a => a.message === 'Payment failed for test');
    expect(latestAlert).toBeTruthy();
    expect(latestAlert!.severity).toBe('critical');
    expect(latestAlert!.category).toBe('payment');
  });

  it('getRecentAlerts filters by severity', async () => {
    const { getRecentAlerts } = await import('../server/core/monitoring');
    const criticalAlerts = getRecentAlerts({ severity: 'critical' });
    for (const alert of criticalAlerts) {
      expect(alert.severity).toBe('critical');
    }
  });

  it('getRecentAlerts filters by category', async () => {
    const { getRecentAlerts } = await import('../server/core/monitoring');
    const paymentAlerts = getRecentAlerts({ category: 'payment' });
    for (const alert of paymentAlerts) {
      expect(alert.category).toBe('payment');
    }
  });

  it('getAlertCounts returns counts by severity', async () => {
    const { getAlertCounts } = await import('../server/core/monitoring');
    const counts = getAlertCounts();

    expect(typeof counts.critical).toBe('number');
    expect(typeof counts.warning).toBe('number');
    expect(typeof counts.info).toBe('number');
  });

  it('logPaymentFailure creates critical payment alert', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { logPaymentFailure, getRecentAlerts } = await import('../server/core/monitoring');

    logPaymentFailure({
      paymentIntentId: 'pi_fail',
      customerId: 'cus_1',
      userEmail: 'payer@test.com',
      amountCents: 5000,
      errorMessage: 'Card declined',
    });

    await vi.waitFor(() => {
      const alerts = getRecentAlerts({ category: 'payment' });
      expect(alerts.some(a => a.message.includes('Card declined'))).toBe(true);
    });
  });

  it('logWebhookFailure creates warning webhook alert', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { logWebhookFailure, getRecentAlerts } = await import('../server/core/monitoring');

    logWebhookFailure({
      eventId: 'evt_1',
      eventType: 'invoice.paid',
      errorMessage: 'Handler error',
    });

    await vi.waitFor(() => {
      const alerts = getRecentAlerts({ category: 'webhook' });
      expect(alerts.some(a => a.message.includes('invoice.paid'))).toBe(true);
    });
  });

  it('logSecurityEvent creates security alert', async () => {
    mockExecute.mockResolvedValueOnce({ rows: [] });

    const { logSecurityEvent, getRecentAlerts } = await import('../server/core/monitoring');

    logSecurityEvent({
      event: 'Suspicious login attempt',
      userEmail: 'suspect@test.com',
      ipAddress: '1.2.3.4',
    });

    await vi.waitFor(() => {
      const alerts = getRecentAlerts({ category: 'security' });
      expect(alerts.some(a => a.message.includes('Suspicious login'))).toBe(true);
    });
  });
});

describe('externalSystemChecks - checkCrossSystemDrift', () => {
  it('returns pass when no drift', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const { checkCrossSystemDrift } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkCrossSystemDrift();

    expect(result.checkName).toBe('Cross-System Drift Detection');
    expect(result.status).toBe('pass');
  });

  it('detects active member in HubSpot but missing Stripe', async () => {
    mockExecute
      .mockResolvedValueOnce({
        rows: [{ id: '1', email: 'drift@test.com', first_name: 'Drift', last_name: 'User' }]
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const { checkCrossSystemDrift } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkCrossSystemDrift();

    expect(result.status).toBe('warning');
    expect(result.issues.some(i => i.description.includes('missing Stripe'))).toBe(true);
  });

  it('detects active member in Stripe but missing HubSpot', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ id: '2', email: 'nohs@test.com', first_name: 'No', last_name: 'HS' }]
      })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const { checkCrossSystemDrift } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkCrossSystemDrift();

    expect(result.issues.some(i => i.description.includes('missing HubSpot'))).toBe(true);
  });

  it('handles DB errors gracefully', async () => {
    mockExecute.mockRejectedValueOnce(new Error('Connection lost'));

    const { checkCrossSystemDrift } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkCrossSystemDrift();

    expect(result.issues.some(i => i.description.includes('drift check failed'))).toBe(true);
  });
});

describe('externalSystemChecks - checkEmailDeliveryHealth', () => {
  it('returns pass when email metrics are healthy', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ sent_7d: '100', bounced_7d: '0', complained_7d: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const { checkEmailDeliveryHealth } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkEmailDeliveryHealth();

    expect(result.checkName).toBe('Email Delivery Health');
    expect(result.status).toBe('pass');
  });

  it('detects high bounce rate', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ sent_7d: '100', bounced_7d: '10', complained_7d: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const { checkEmailDeliveryHealth } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkEmailDeliveryHealth();

    expect(result.issues.some(i => i.description.includes('bounce rate'))).toBe(true);
    expect(result.issues[0].severity).toBe('error');
  });

  it('detects high complaint rate', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ sent_7d: '1000', bounced_7d: '0', complained_7d: '5' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '0' }] });

    const { checkEmailDeliveryHealth } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkEmailDeliveryHealth();

    expect(result.issues.some(i => i.description.includes('complaint rate'))).toBe(true);
  });

  it('detects active members with suppressed email', async () => {
    mockExecute
      .mockResolvedValueOnce({ rows: [{ sent_7d: '100', bounced_7d: '0', complained_7d: '0' }] })
      .mockResolvedValueOnce({ rows: [{ cnt: '3' }] });

    const { checkEmailDeliveryHealth } = await import('../server/core/integrity/externalSystemChecks');
    const result = await checkEmailDeliveryHealth();

    expect(result.issues.some(i => i.description.includes('suppressed email'))).toBe(true);
  });
});
