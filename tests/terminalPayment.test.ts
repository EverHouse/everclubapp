// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  shouldBlockForPendingSubscription,
  isCancelAlreadySucceeded,
} from '../src/components/staff-command-center/TerminalPayment';

describe('shouldBlockForPendingSubscription', () => {
  describe('booking fee pass-through (isSubscriptionFlow=false)', () => {
    it('allows booking fee payment with positive amount and null subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: false,
        subscriptionId: null,
        isSaveCard: false,
      })).toBe(false);
    });

    it('allows booking fee payment with undefined subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: false,
        subscriptionId: undefined,
        isSaveCard: false,
      })).toBe(false);
    });

    it('allows POS payment with cartItems and no subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: false,
        subscriptionId: undefined,
        isSaveCard: false,
        cartItems: [{ productId: 'p1', name: 'Item', priceCents: 2500, quantity: 1 }],
      })).toBe(false);
    });

    it('allows save-card flow with no subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: false,
        subscriptionId: null,
        isSaveCard: true,
      })).toBe(false);
    });
  });

  describe('subscription flow blocking (isSubscriptionFlow=true)', () => {
    it('blocks when subscriptionId is null', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: true,
        subscriptionId: null,
        isSaveCard: false,
      })).toBe(true);
    });

    it('blocks when subscriptionId is undefined', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: true,
        subscriptionId: undefined,
        isSaveCard: false,
      })).toBe(true);
    });

    it('allows when subscriptionId is present', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: true,
        subscriptionId: 'sub_123abc',
        isSaveCard: false,
      })).toBe(false);
    });

    it('allows with existingPaymentIntentId even without subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: true,
        subscriptionId: null,
        existingPaymentIntentId: 'pi_existing123',
        isSaveCard: false,
      })).toBe(false);
    });

    it('allows with isSaveCard=true even without subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: true,
        subscriptionId: null,
        isSaveCard: true,
      })).toBe(false);
    });

    it('allows with cartItems even without subscriptionId', () => {
      expect(shouldBlockForPendingSubscription({
        isSubscriptionFlow: true,
        subscriptionId: null,
        isSaveCard: false,
        cartItems: [{ productId: 'p1', name: 'Item', priceCents: 1000, quantity: 1 }],
      })).toBe(false);
    });
  });
});

describe('isCancelAlreadySucceeded', () => {
  class ApiError extends Error {
    status: number;
    errorData: Record<string, unknown>;
    constructor(message: string, status: number, errorData: Record<string, unknown> = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.errorData = errorData;
    }
  }

  it('returns true for ApiError with alreadySucceeded=true', () => {
    const err = new ApiError('Payment cannot be cancelled', 409, { alreadySucceeded: true });
    expect(isCancelAlreadySucceeded(err)).toBe(true);
  });

  it('returns false for ApiError without alreadySucceeded flag', () => {
    const err = new ApiError('Conflict', 409, { someOtherData: true });
    expect(isCancelAlreadySucceeded(err)).toBe(false);
  });

  it('returns false for ApiError with alreadySucceeded=false', () => {
    const err = new ApiError('Conflict', 409, { alreadySucceeded: false });
    expect(isCancelAlreadySucceeded(err)).toBe(false);
  });

  it('returns false for plain Error without errorData', () => {
    const err = new Error('Network failure');
    expect(isCancelAlreadySucceeded(err)).toBe(false);
  });

  it('returns false for non-Error values', () => {
    expect(isCancelAlreadySucceeded('string error')).toBe(false);
    expect(isCancelAlreadySucceeded(null)).toBe(false);
    expect(isCancelAlreadySucceeded(undefined)).toBe(false);
    expect(isCancelAlreadySucceeded(42)).toBe(false);
  });
});
