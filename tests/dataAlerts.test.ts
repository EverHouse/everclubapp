// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/core/db', () => ({
  isProduction: false,
}));

vi.mock('../server/core/notificationService', () => ({
  notifyAllStaff: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../server/core/settingsHelper', () => ({
  getSettingBoolean: vi.fn().mockResolvedValue(true),
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
}));

vi.mock('../server/utils/dateUtils', () => ({
  getTodayPacific: vi.fn(() => '2026-03-31'),
}));

import { notifyAllStaff } from '../server/core/notificationService';
import { getSettingBoolean } from '../server/core/settingsHelper';

const mockNotify = notifyAllStaff as ReturnType<typeof vi.fn>;
const mockGetSetting = getSettingBoolean as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  mockNotify.mockReset().mockResolvedValue(undefined);
  mockGetSetting.mockReset().mockResolvedValue(true);
});

describe('alertOnImportFailure', () => {
  it('does not alert when there are no errors', async () => {
    const { alertOnImportFailure } = await import('../server/core/dataAlerts');
    await alertOnImportFailure('members', { total: 100, errors: [] });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends notification when import has errors', async () => {
    const { alertOnImportFailure } = await import('../server/core/dataAlerts');
    await alertOnImportFailure('members', {
      total: 100, imported: 90, skipped: 5,
      errors: ['Row 10: invalid email', 'Row 20: duplicate'],
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Members');
    expect(title).toContain('Import Issues');
    expect(message).toContain('2 error(s)');
    expect(message).toContain('invalid email');
  });

  it('truncates error list to 5 and shows count of remaining', async () => {
    const { alertOnImportFailure } = await import('../server/core/dataAlerts');
    const errors = Array.from({ length: 8 }, (_, i) => `Error ${i + 1}`);
    await alertOnImportFailure('sales', { total: 50, errors });

    const [, message] = mockNotify.mock.calls[0];
    expect(message).toContain('8 error(s)');
    expect(message).toContain('+3 more');
  });
});

describe('alertOnLowMatchRate', () => {
  it('does not alert when match rate is above threshold', async () => {
    const { alertOnLowMatchRate } = await import('../server/core/dataAlerts');
    await alertOnLowMatchRate('members', { total: 100, matched: 96, errors: [] });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('does not alert when total is 0', async () => {
    const { alertOnLowMatchRate } = await import('../server/core/dataAlerts');
    await alertOnLowMatchRate('members', { total: 0, matched: 0, errors: [] });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends notification when match rate is below threshold', async () => {
    const { alertOnLowMatchRate } = await import('../server/core/dataAlerts');
    await alertOnLowMatchRate('attendance', { total: 100, matched: 80, errors: [] });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Low Match Rate');
    expect(title).toContain('Attendance');
    expect(message).toContain('80.0%');
    expect(message).toContain('below 95%');
  });

  it('respects custom threshold', async () => {
    const { alertOnLowMatchRate } = await import('../server/core/dataAlerts');
    await alertOnLowMatchRate('members', { total: 100, matched: 85, errors: [] }, 80);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('alertOnCriticalIntegrityIssues', () => {
  const severityMap = {
    'Stripe Subscription Sync': 'critical' as const,
    'Tier Reconciliation': 'high' as const,
    'Members Without Email': 'medium' as const,
  };

  it('does not alert when no critical checks fail', async () => {
    const { alertOnCriticalIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnCriticalIntegrityIssues([
      { checkName: 'Stripe Subscription Sync', status: 'pass', issueCount: 0 },
    ], severityMap);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends notification when critical checks fail', async () => {
    const { alertOnCriticalIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnCriticalIntegrityIssues([
      { checkName: 'Stripe Subscription Sync', status: 'fail', issueCount: 5 },
    ], severityMap);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Critical');
    expect(message).toContain('5 critical issue');
    expect(message).toContain('Stripe Subscription Sync');
  });

  it('does not alert when settings disable integrity alerts', async () => {
    mockGetSetting.mockResolvedValueOnce(false);
    const { alertOnCriticalIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnCriticalIntegrityIssues([
      { checkName: 'Stripe Subscription Sync', status: 'fail', issueCount: 3 },
    ], severityMap);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('deduplicates alerts with same fingerprint within cooldown', async () => {
    const { alertOnCriticalIntegrityIssues } = await import('../server/core/dataAlerts');
    const checks = [
      { checkName: 'Stripe Subscription Sync', status: 'fail' as const, issueCount: 5 },
    ];

    await alertOnCriticalIntegrityIssues(checks, severityMap);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    mockNotify.mockClear();
    await alertOnCriticalIntegrityIssues(checks, severityMap);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends new alert when issues change even within cooldown', async () => {
    const { alertOnCriticalIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnCriticalIntegrityIssues([
      { checkName: 'Stripe Subscription Sync', status: 'fail', issueCount: 5 },
    ], severityMap);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    mockNotify.mockClear();
    await alertOnCriticalIntegrityIssues([
      { checkName: 'Stripe Subscription Sync', status: 'fail', issueCount: 10 },
    ], severityMap);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][1]).toContain('10 critical');
  });

  it('ignores non-critical checks even if they fail', async () => {
    const { alertOnCriticalIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnCriticalIntegrityIssues([
      { checkName: 'Members Without Email', status: 'fail', issueCount: 20 },
    ], severityMap);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('alertOnHighIntegrityIssues', () => {
  const severityMap = {
    'Tier Reconciliation': 'high' as const,
    'Billing Provider Hybrid State': 'high' as const,
  };

  it('does not alert when high-severity issues are below threshold', async () => {
    const { alertOnHighIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnHighIntegrityIssues([
      { checkName: 'Tier Reconciliation', status: 'fail', issueCount: 5 },
    ], severityMap, 10);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends notification when high-severity issues exceed threshold', async () => {
    const { alertOnHighIntegrityIssues } = await import('../server/core/dataAlerts');
    await alertOnHighIntegrityIssues([
      { checkName: 'Tier Reconciliation', status: 'fail', issueCount: 15 },
    ], severityMap, 10);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('High Priority');
    expect(message).toContain('Tier Reconciliation');
  });

  it('deduplicates high-priority alerts with same fingerprint', async () => {
    const { alertOnHighIntegrityIssues } = await import('../server/core/dataAlerts');
    const checks = [
      { checkName: 'Tier Reconciliation', status: 'fail' as const, issueCount: 15 },
    ];

    await alertOnHighIntegrityIssues(checks, severityMap, 10);
    expect(mockNotify).toHaveBeenCalledTimes(1);

    mockNotify.mockClear();
    await alertOnHighIntegrityIssues(checks, severityMap, 10);
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('alertOnSyncFailure', () => {
  it('sends notification for sync failure', async () => {
    const { alertOnSyncFailure } = await import('../server/core/dataAlerts');
    await alertOnSyncFailure('hubspot', 'Contact sync', new Error('API timeout'));

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Hubspot');
    expect(title).toContain('Sync Failed');
    expect(message).toContain('Contact sync failed');
    expect(message).toContain('API timeout');
  });

  it('includes error details and calendar name in notification', async () => {
    const { alertOnSyncFailure } = await import('../server/core/dataAlerts');
    await alertOnSyncFailure('calendar', 'Event sync', 'Auth expired', {
      synced: 5, errors: 2, total: 7, calendarName: 'Main Calendar',
    });

    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Main Calendar');
    expect(message).toContain('2 errors');
  });

  it('rate-limits duplicate sync failure alerts', async () => {
    const { alertOnSyncFailure } = await import('../server/core/dataAlerts');
    await alertOnSyncFailure('hubspot', 'Contact sync', new Error('fail 1'));
    expect(mockNotify).toHaveBeenCalledTimes(1);

    mockNotify.mockClear();
    await alertOnSyncFailure('hubspot', 'Contact sync', new Error('fail 2'));
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('alertOnHubSpotSyncComplete', () => {
  it('does not alert when there are no errors', async () => {
    const { alertOnHubSpotSyncComplete } = await import('../server/core/dataAlerts');
    await alertOnHubSpotSyncComplete(100, 0, 100);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('does not alert for low error count below threshold', async () => {
    const { alertOnHubSpotSyncComplete } = await import('../server/core/dataAlerts');
    await alertOnHubSpotSyncComplete(98, 2, 100);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends notification when error count exceeds threshold', async () => {
    const { alertOnHubSpotSyncComplete } = await import('../server/core/dataAlerts');
    await alertOnHubSpotSyncComplete(90, 10, 100);

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('HubSpot Sync');
    expect(title).toContain('Errors');
    expect(message).toContain('10 failed');
    expect(message).toContain('10.0%');
  });
});

describe('alertOnScheduledTaskFailure', () => {
  it('sends notification for scheduled task failure', async () => {
    const { alertOnScheduledTaskFailure } = await import('../server/core/dataAlerts');
    await alertOnScheduledTaskFailure('Daily Cleanup', new Error('Disk full'));

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Scheduled Task Failed');
    expect(title).toContain('Daily Cleanup');
    expect(message).toContain('Disk full');
  });

  it('includes context details in notification', async () => {
    const { alertOnScheduledTaskFailure } = await import('../server/core/dataAlerts');
    await alertOnScheduledTaskFailure('Member Sync', new Error('Timeout'), {
      context: 'Processing batch 3 of 10',
    });

    const [, message] = mockNotify.mock.calls[0];
    expect(message).toContain('Processing batch 3 of 10');
  });

  it('rate-limits duplicate task failure alerts', async () => {
    const { alertOnScheduledTaskFailure } = await import('../server/core/dataAlerts');
    await alertOnScheduledTaskFailure('Daily Cleanup', new Error('fail 1'));
    expect(mockNotify).toHaveBeenCalledTimes(1);

    mockNotify.mockClear();
    await alertOnScheduledTaskFailure('Daily Cleanup', new Error('fail 2'));
    expect(mockNotify).not.toHaveBeenCalled();
  });
});

describe('alertOnTrackmanImportIssues', () => {
  it('does not alert when no issues', async () => {
    const { alertOnTrackmanImportIssues } = await import('../server/core/dataAlerts');
    await alertOnTrackmanImportIssues({
      totalRows: 100, matchedRows: 100, unmatchedRows: 0, skippedRows: 0, errors: [],
    });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('sends notification for import errors', async () => {
    const { alertOnTrackmanImportIssues } = await import('../server/core/dataAlerts');
    await alertOnTrackmanImportIssues({
      totalRows: 50, matchedRows: 45, unmatchedRows: 3, skippedRows: 2,
      errors: ['Row 5: invalid format', 'Row 12: missing field'],
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Trackman Import');
    expect(message).toContain('2 error(s)');
    expect(message).toContain('invalid format');
  });

  it('sends notification for low match rate', async () => {
    const { alertOnTrackmanImportIssues } = await import('../server/core/dataAlerts');
    await alertOnTrackmanImportIssues({
      totalRows: 100, matchedRows: 70, unmatchedRows: 30, skippedRows: 0, errors: [],
    });

    expect(mockNotify).toHaveBeenCalledTimes(1);
    const [title, message] = mockNotify.mock.calls[0];
    expect(title).toContain('Low Trackman Match Rate');
    expect(message).toContain('70.0%');
    expect(message).toContain('30 of 100');
  });

  it('sends both error and match rate alerts when applicable', async () => {
    const { alertOnTrackmanImportIssues } = await import('../server/core/dataAlerts');
    await alertOnTrackmanImportIssues({
      totalRows: 100, matchedRows: 50, unmatchedRows: 50, skippedRows: 0,
      errors: ['Row 1: bad data'],
    });

    expect(mockNotify).toHaveBeenCalledTimes(2);
  });
});
