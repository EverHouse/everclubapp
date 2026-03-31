// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
  getErrorMessage: vi.fn((e: unknown) => e instanceof Error ? e.message : String(e)),
}));

const mockSend = vi.fn().mockResolvedValue({ id: 'email_1' });

vi.mock('../server/utils/resend', () => ({
  getResendClient: vi.fn().mockResolvedValue({
    client: { emails: { send: mockSend } },
    fromEmail: 'test@test.com',
  }),
}));

import { db } from '../server/db';

const mockExecute = db.execute as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  mockExecute.mockReset().mockResolvedValue({ rows: [] });
  mockSend.mockReset().mockResolvedValue({ id: 'email_1' });
});

afterEach(() => {
  vi.useRealTimers();
});

async function importAfterGracePeriod() {
  const mod = await import('../server/core/errorAlerts');
  vi.advanceTimersByTime(6 * 60 * 1000);
  return mod;
}

describe('sendErrorAlert', () => {
  it('skips alerts during startup grace period', async () => {
    const { sendErrorAlert } = await import('../server/core/errorAlerts');

    const result = await sendErrorAlert({
      type: 'server_error',
      title: 'Server Error',
      message: 'Something broke',
    });

    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends an alert email after grace period', async () => {
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result = await sendErrorAlert({
      type: 'server_error',
      title: 'Server Error',
      message: 'Something broke badly',
      context: '/api/members',
    });

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalled();
  });

  it('skips transient errors for non-critical types', async () => {
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result = await sendErrorAlert({
      type: 'server_error',
      title: 'Network Error',
      message: 'ECONNRESET: connection reset by peer',
    });

    expect(result).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('does not skip transient errors for payment failures', async () => {
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result = await sendErrorAlert({
      type: 'payment_failure',
      title: 'Payment Failed',
      message: 'ECONNRESET during payment processing',
    });

    expect(result).toBe(true);
    expect(mockSend).toHaveBeenCalled();
  });

  it('does not skip transient errors for security alerts', async () => {
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result = await sendErrorAlert({
      type: 'security_alert',
      title: 'Suspicious Activity',
      message: 'Rate limited login attempt',
    });

    expect(result).toBe(true);
  });

  it('rate-limits alerts with same key', async () => {
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result1 = await sendErrorAlert({
      type: 'database_error',
      title: 'DB Error',
      message: 'Connection pool exhausted',
    });
    expect(result1).toBe(true);

    const result2 = await sendErrorAlert({
      type: 'database_error',
      title: 'DB Error',
      message: 'Connection pool exhausted again',
    });
    expect(result2).toBe(false);
  });

  it('enforces daily alert limit of 3', async () => {
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result1 = await sendErrorAlert({
      type: 'database_error',
      title: 'DB Error 1',
      message: 'Error one',
    });
    expect(result1).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 60 * 1000);

    const result2 = await sendErrorAlert({
      type: 'booking_failure',
      title: 'Booking Error',
      message: 'Booking failed',
      context: 'booking',
    });
    expect(result2).toBe(true);

    vi.advanceTimersByTime(5 * 60 * 60 * 1000);

    const result3 = await sendErrorAlert({
      type: 'payment_failure',
      title: 'Payment Error',
      message: 'Payment failed',
    });
    expect(result3).toBe(true);

    const result4 = await sendErrorAlert({
      type: 'security_alert',
      title: 'Security Alert',
      message: 'Unusual access',
    });
    expect(result4).toBe(false);
  });

  it('handles email send failure gracefully', async () => {
    mockSend.mockRejectedValueOnce(new Error('SMTP down'));
    const { sendErrorAlert } = await importAfterGracePeriod();

    const result = await sendErrorAlert({
      type: 'server_error',
      title: 'Error',
      message: 'Something happened',
    });

    expect(result).toBe(false);
  });
});

describe('alertOnExternalServiceError', () => {
  it('skips transient external service errors', async () => {
    const { alertOnExternalServiceError } = await importAfterGracePeriod();

    await alertOnExternalServiceError('HubSpot', new Error('ECONNRESET'), 'sync contacts');

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends alert for non-transient external service errors', async () => {
    const { alertOnExternalServiceError } = await importAfterGracePeriod();

    await alertOnExternalServiceError('HubSpot', new Error('Invalid API key'), 'sync contacts');

    expect(mockSend).toHaveBeenCalled();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toContain('HubSpot');
  });
});

describe('alertOnServerError', () => {
  it('sends alert for server error with context', async () => {
    const { alertOnServerError } = await importAfterGracePeriod();

    await alertOnServerError(new Error('Cannot destructure undefined'), {
      path: '/api/booking/create',
      method: 'POST',
      userEmail: 'member@test.com',
    });

    expect(mockSend).toHaveBeenCalled();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.html).toContain('Golf Simulator Bookings');
  });
});
