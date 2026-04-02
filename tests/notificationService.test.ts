// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../server/core/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../server/utils/errorUtils', () => ({
  getErrorMessage: vi.fn((e: unknown) => (e instanceof Error ? e.message : String(e))),
  getErrorStatusCode: vi.fn((e: unknown) => (e as Record<string, unknown>)?.statusCode ?? null),
}));

const { mockExecute, mockSelect, mockInsert, mockDelete, mockSelectDistinct } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockSelect: vi.fn(),
  mockInsert: vi.fn(),
  mockDelete: vi.fn(),
  mockSelectDistinct: vi.fn(),
}));

vi.mock('../server/db', () => ({
  db: {
    execute: mockExecute,
    select: mockSelect,
    insert: mockInsert,
    delete: mockDelete,
    selectDistinct: mockSelectDistinct,
  },
}));

vi.mock('drizzle-orm', () => {
  const sqlTagFn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const result: Record<string, unknown> = { __sqlStrings: Array.from(strings), __sqlValues: values };
    result.as = vi.fn().mockReturnValue(result);
    return result;
  };
  sqlTagFn.join = vi.fn();
  return {
    sql: sqlTagFn,
    eq: vi.fn(),
    and: vi.fn(),
    or: vi.fn(),
    inArray: vi.fn(),
    isNull: vi.fn(),
    isNotNull: vi.fn(),
  };
});

vi.mock('../shared/schema', () => ({
  notifications: { id: 'id', userEmail: 'userEmail', title: 'title', message: 'message', type: 'type', relatedId: 'relatedId', relatedType: 'relatedType', isRead: 'isRead', url: 'url', createdAt: 'createdAt' },
  users: { id: 'id', email: 'email', role: 'role' },
  staffUsers: { email: 'email', isActive: 'isActive' },
  pushSubscriptions: { id: 'id', userEmail: 'userEmail', endpoint: 'endpoint', p256dh: 'p256dh', auth: 'auth' },
  walletPassDeviceRegistrations: { id: 'id', serialNumber: 'serialNumber' },
}));

const mockSendNotification = vi.fn();
const mockSetVapidDetails = vi.fn();
vi.mock('web-push', () => ({
  default: {
    sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    setVapidDetails: (...args: unknown[]) => mockSetVapidDetails(...args),
  },
}));

const mockSendNotificationToUser = vi.fn().mockReturnValue({ sentCount: 1, connectionCount: 1, hasActiveSocket: true });
const mockBroadcastToStaff = vi.fn();
vi.mock('../server/core/websocket', () => ({
  sendNotificationToUser: (...args: unknown[]) => mockSendNotificationToUser(...args),
  broadcastToStaff: (...args: unknown[]) => mockBroadcastToStaff(...args),
}));

vi.mock('../server/utils/resend', () => ({
  getResendClient: vi.fn().mockResolvedValue({
    client: { emails: { send: vi.fn().mockResolvedValue({ id: 'email-1' }) } },
    fromEmail: 'test@test.com',
  }),
}));

import {
  notifyMember,
  notifyAllStaff,
  isSyntheticEmail,
  isNotifiableEmail,
  notifyPaymentSuccess,
  notifyPaymentFailed,
  notifyFeeWaived,
  notifyOutstandingBalance,
} from '../server/core/notificationService';

describe('Notification Service - notifyMember', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  it('returns error for invalid payload with missing fields', async () => {
    const result = await notifyMember({
      userEmail: '',
      title: '',
      message: '',
      type: 'info',
    });

    expect(result.allSucceeded).toBe(false);
    expect(result.deliveryResults[0].channel).toBe('database');
    expect(result.deliveryResults[0].success).toBe(false);
  });

  it('skips notifications for synthetic emails', async () => {
    const result = await notifyMember({
      userEmail: 'user@trackman.local',
      title: 'Test',
      message: 'Test message',
      type: 'info',
    });

    expect(result.allSucceeded).toBe(true);
    expect(result.deliveryResults[0].error).toContain('synthetic');
  });

  it('inserts notification to database and delivers via WebSocket', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 42 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockSendNotificationToUser.mockReturnValue({ sentCount: 1, connectionCount: 1, hasActiveSocket: true });

    const result = await notifyMember({
      userEmail: 'member@test.com',
      title: 'Booking Approved',
      message: 'Your booking has been approved',
      type: 'booking_approved',
      relatedId: 100,
      relatedType: 'booking',
    });

    expect(result.notificationId).toBe(42);
    expect(result.deliveryResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'database', success: true }),
        expect.objectContaining({ channel: 'websocket', success: true }),
      ])
    );
  });

  it('delivers via push when VAPID keys are configured', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 43 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          return [
            { endpoint: 'https://push.example.com/sub1', p256dh: 'key1', auth: 'auth1' },
          ];
        }),
      }),
    }));

    mockSendNotification.mockResolvedValue(undefined);

    const result = await notifyMember({
      userEmail: 'member@test.com',
      title: 'Test Push',
      message: 'Push message',
      type: 'info',
    });

    expect(result.deliveryResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'push', success: true }),
      ])
    );
  });

  it('suppresses duplicate notifications within 60 seconds', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 99 }]),
        }),
      }),
    });

    const result = await notifyMember({
      userEmail: 'member@test.com',
      title: 'Duplicate',
      message: 'Should be suppressed',
      type: 'booking_approved',
      relatedId: 100,
      relatedType: 'booking',
    });

    expect(result.allSucceeded).toBe(true);
    expect(result.deliveryResults[0].details).toEqual(
      expect.objectContaining({ skipped: 'duplicate' })
    );
  });

  it('handles email delivery when sendEmail is true', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 44 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }));

    mockSendNotificationToUser.mockReturnValue({ sentCount: 0, connectionCount: 0, hasActiveSocket: false });

    const { getResendClient } = await import('../server/utils/resend');
    (getResendClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      client: { emails: { send: vi.fn().mockResolvedValue({ id: 'email-1' }) } },
      fromEmail: 'test@test.com',
    });

    const result = await notifyMember(
      {
        userEmail: 'member@test.com',
        title: 'Payment Received',
        message: 'Your payment was received',
        type: 'payment_success',
      },
      {
        sendEmail: true,
        emailSubject: 'Payment Confirmation',
        emailHtml: '<h1>Payment Received</h1>',
      }
    );

    expect(result.deliveryResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'email', success: true }),
      ])
    );
  });

  it('cleans up stale push subscriptions on 410 response', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 45 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    const whereMock = vi.fn().mockResolvedValue(undefined);
    mockDelete.mockReturnValue({ where: whereMock });

    let selectCallIdx = 0;
    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockImplementation(() => {
          selectCallIdx++;
          if (selectCallIdx <= 1) {
            return [
              { endpoint: 'https://push.example.com/stale', p256dh: 'key1', auth: 'auth1' },
            ];
          }
          return [];
        }),
      }),
    }));

    const staleError = new Error('Gone');
    (staleError as Record<string, unknown>).statusCode = 410;
    mockSendNotification.mockRejectedValue(staleError);

    const { getErrorStatusCode } = await import('../server/utils/errorUtils');
    (getErrorStatusCode as ReturnType<typeof vi.fn>).mockReturnValue(410);

    await notifyMember({
      userEmail: 'member@test.com',
      title: 'Stale Test',
      message: 'Test stale cleanup',
      type: 'info',
    });

    expect(mockDelete).toHaveBeenCalled();
  });
});

describe('Notification Service - notifyAllStaff', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  it('returns error for invalid payload', async () => {
    const result = await notifyAllStaff('', '', 'info');

    expect(result.staffCount).toBe(0);
    expect(result.deliveryResults[0].success).toBe(false);
  });

  it('returns empty result when no active staff found', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await notifyAllStaff('Test', 'Test message', 'info');

    expect(result.staffCount).toBe(0);
  });

  it('inserts notifications for all staff and broadcasts via WebSocket', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { email: 'staff1@test.com' },
            { email: 'staff2@test.com' },
          ]),
        }),
      }),
    });

    const returningMock = vi.fn().mockResolvedValue([{ id: 101 }, { id: 102 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelectDistinct.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await notifyAllStaff('New Booking', 'A new booking was created', 'booking_request', {
      relatedId: 42,
      relatedType: 'booking',
      sendPush: true,
      sendWebSocket: true,
    });

    expect(result.staffCount).toBe(2);
    expect(result.deliveryResults).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channel: 'database', success: true }),
      ])
    );
    expect(mockBroadcastToStaff).toHaveBeenCalled();
  });

  it('routes staff notifications to correct admin URLs', async () => {
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([
            { email: 'staff@test.com' },
          ]),
        }),
      }),
    });

    const returningMock = vi.fn().mockResolvedValue([{ id: 201 }]);
    const valuesMock = vi.fn().mockImplementation((values: Array<{ url: string }>) => {
      expect(values[0].url).toBe('/admin/bookings');
      return { returning: returningMock };
    });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelectDistinct.mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    });

    await notifyAllStaff('Cancellation Pending', 'A booking needs review', 'cancellation_pending', {
      sendPush: false,
      sendWebSocket: false,
    });

    expect(valuesMock).toHaveBeenCalled();
  });
});

describe('Notification Service - Synthetic Email Detection', () => {
  it('identifies trackman local emails as synthetic', () => {
    expect(isSyntheticEmail('user@trackman.local')).toBe(true);
  });

  it('identifies trackman import emails as synthetic', () => {
    expect(isSyntheticEmail('import@trackman.import')).toBe(true);
  });

  it('identifies visitor emails as synthetic', () => {
    expect(isSyntheticEmail('visitor@visitors.evenhouse.club')).toBe(true);
    expect(isSyntheticEmail('guest@visitors.everclub.co')).toBe(true);
  });

  it('identifies private event emails as synthetic', () => {
    expect(isSyntheticEmail('private-event@example.com')).toBe(true);
  });

  it('identifies unmatched emails as synthetic', () => {
    expect(isSyntheticEmail('unmatched-123@test.com')).toBe(true);
    expect(isSyntheticEmail('unmatched@test.com')).toBe(true);
  });

  it('identifies golfnow and classpass emails as synthetic', () => {
    expect(isSyntheticEmail('golfnow-12345@test.com')).toBe(true);
    expect(isSyntheticEmail('classpass-abc@test.com')).toBe(true);
  });

  it('returns false for real email addresses', () => {
    expect(isSyntheticEmail('john@gmail.com')).toBe(false);
    expect(isSyntheticEmail('member@everclub.app')).toBe(false);
  });
});

describe('Notification Service - isNotifiableEmail', () => {
  it('rejects null and undefined emails', () => {
    expect(isNotifiableEmail(null)).toBe(false);
    expect(isNotifiableEmail(undefined)).toBe(false);
  });

  it('rejects empty strings', () => {
    expect(isNotifiableEmail('')).toBe(false);
    expect(isNotifiableEmail('   ')).toBe(false);
  });

  it('rejects strings without @', () => {
    expect(isNotifiableEmail('notanemail')).toBe(false);
  });

  it('rejects synthetic emails', () => {
    expect(isNotifiableEmail('user@trackman.local')).toBe(false);
  });

  it('accepts valid real emails', () => {
    expect(isNotifiableEmail('user@test.com')).toBe(true);
  });
});

describe('Notification Service - Convenience Functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  it('notifyPaymentSuccess formats amount correctly', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 50 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await notifyPaymentSuccess('member@test.com', 75.00, 'Simulator session', { bookingId: 1 });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Payment Successful',
        message: expect.stringContaining('$75.00'),
      })
    );
  });

  it('notifyPaymentFailed includes reason', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 51 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await notifyPaymentFailed('member@test.com', 50.00, 'Card declined');

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Payment Failed',
        message: expect.stringContaining('Card declined'),
      })
    );
  });

  it('notifyFeeWaived includes amount and reason', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 52 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await notifyFeeWaived('member@test.com', 25.00, 'Courtesy', 42);

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Fee Waived',
        message: expect.stringContaining('$25.00'),
      })
    );
  });

  it('notifyOutstandingBalance formats correctly', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 53 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    await notifyOutstandingBalance('member@test.com', 100.00, 'Monthly dues');

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Outstanding Balance',
        message: expect.stringContaining('$100.00'),
      })
    );
  });
});

describe('Notification Service - WebSocket Delivery', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  it('reports success when WebSocket delivery succeeds', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 60 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockSendNotificationToUser.mockReturnValue({ sentCount: 2, connectionCount: 2, hasActiveSocket: true });

    const result = await notifyMember({
      userEmail: 'online@test.com',
      title: 'WebSocket Test',
      message: 'This should be delivered',
      type: 'info',
    });

    const wsResult = result.deliveryResults.find(r => r.channel === 'websocket');
    expect(wsResult?.success).toBe(true);
    expect(wsResult?.details).toEqual(expect.objectContaining({ connectionsSent: 2 }));
  });

  it('reports no active connection when user is offline', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 61 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockSendNotificationToUser.mockReturnValue({ sentCount: 0, connectionCount: 0, hasActiveSocket: false });

    const result = await notifyMember({
      userEmail: 'offline@test.com',
      title: 'Offline Test',
      message: 'User is offline',
      type: 'info',
    });

    const wsResult = result.deliveryResults.find(r => r.channel === 'websocket');
    expect(wsResult?.success).toBe(false);
  });

  it('handles WebSocket delivery errors gracefully', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 62 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });
    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    mockSendNotificationToUser.mockImplementation(() => { throw new Error('WebSocket error'); });

    const result = await notifyMember({
      userEmail: 'error@test.com',
      title: 'Error Test',
      message: 'WS should fail gracefully',
      type: 'info',
    });

    const wsResult = result.deliveryResults.find(r => r.channel === 'websocket');
    expect(wsResult?.success).toBe(false);
    expect(wsResult?.error).toContain('WebSocket error');
  });
});

describe('Notification Service - Push Subscription Lifecycle', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.VAPID_PUBLIC_KEY = 'test-public-key';
    process.env.VAPID_PRIVATE_KEY = 'test-private-key';
  });

  it('reports no_subscriptions when user has no push subscriptions', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 70 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }));

    const result = await notifyMember({
      userEmail: 'nosub@test.com',
      title: 'No Sub',
      message: 'No push subscriptions',
      type: 'info',
    });

    const pushResult = result.deliveryResults.find(r => r.channel === 'push');
    expect(pushResult?.success).toBe(true);
    expect(pushResult?.details).toEqual(expect.objectContaining({ reason: 'no_subscriptions' }));
  });

  it('skips push when VAPID keys are not configured', async () => {
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const returningMock = vi.fn().mockResolvedValue([{ id: 71 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelect.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    });

    const result = await notifyMember({
      userEmail: 'novapid@test.com',
      title: 'No VAPID',
      message: 'Should skip push',
      type: 'info',
    });

    const pushResult = result.deliveryResults.find(r => r.channel === 'push');
    expect(pushResult?.success).toBe(false);
    expect(pushResult?.error).toContain('VAPID');
  });

  it('delivers to multiple push subscriptions', async () => {
    const returningMock = vi.fn().mockResolvedValue([{ id: 72 }]);
    const valuesMock = vi.fn().mockReturnValue({ returning: returningMock });
    mockInsert.mockReturnValue({ values: valuesMock });

    mockSelect.mockImplementation(() => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue([
          { endpoint: 'https://push.example.com/sub1', p256dh: 'key1', auth: 'auth1' },
          { endpoint: 'https://push.example.com/sub2', p256dh: 'key2', auth: 'auth2' },
        ]),
      }),
    }));

    mockSendNotification.mockResolvedValue(undefined);

    const result = await notifyMember({
      userEmail: 'multi@test.com',
      title: 'Multi Push',
      message: 'Two subscriptions',
      type: 'info',
    });

    const pushResult = result.deliveryResults.find(r => r.channel === 'push');
    expect(pushResult?.success).toBe(true);
    expect(mockSendNotification).toHaveBeenCalledTimes(2);
  });
});
