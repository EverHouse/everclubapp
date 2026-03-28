import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TerminalPayment guard logic', () => {
  let onError: ReturnType<typeof vi.fn>;
  let onSuccess: ReturnType<typeof vi.fn>;

  interface GuardCheckParams {
    amount: number;
    isSubscriptionFlow: boolean;
    subscriptionId: string | null | undefined;
    existingPaymentIntentId?: string;
    isSaveCard: boolean;
    cartItems?: Array<{ productId: string; name: string; priceCents: number; quantity: number }>;
  }

  function runGuardCheck(params: GuardCheckParams): boolean {
    const { isSubscriptionFlow, subscriptionId, existingPaymentIntentId, isSaveCard, cartItems } = params;

    if (isSubscriptionFlow && subscriptionId == null && !existingPaymentIntentId && !isSaveCard && !cartItems?.length) {
      onError('Subscription is still being created. Please wait a moment and try again.');
      return false;
    }
    return true;
  }

  beforeEach(() => {
    onError = vi.fn();
    onSuccess = vi.fn();
  });

  describe('booking fee pass-through', () => {
    it('allows booking fee payment with positive amount and null subscriptionId', () => {
      const passed = runGuardCheck({
        amount: 5000,
        isSubscriptionFlow: false,
        subscriptionId: null,
        isSaveCard: false,
      });

      expect(passed).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('allows booking fee payment with zero amount and isSubscriptionFlow=false', () => {
      const passed = runGuardCheck({
        amount: 0,
        isSubscriptionFlow: false,
        subscriptionId: null,
        isSaveCard: false,
      });

      expect(passed).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('allows POS payment with cartItems and no subscriptionId', () => {
      const passed = runGuardCheck({
        amount: 2500,
        isSubscriptionFlow: false,
        subscriptionId: undefined,
        isSaveCard: false,
        cartItems: [{ productId: 'p1', name: 'Item', priceCents: 2500, quantity: 1 }],
      });

      expect(passed).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('allows save-card flow with no subscriptionId', () => {
      const passed = runGuardCheck({
        amount: 0,
        isSubscriptionFlow: false,
        subscriptionId: null,
        isSaveCard: true,
      });

      expect(passed).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe('subscription flow blocking', () => {
    it('blocks subscription flow when subscriptionId is null', () => {
      const passed = runGuardCheck({
        amount: 9900,
        isSubscriptionFlow: true,
        subscriptionId: null,
        isSaveCard: false,
      });

      expect(passed).toBe(false);
      expect(onError).toHaveBeenCalledWith('Subscription is still being created. Please wait a moment and try again.');
    });

    it('blocks subscription flow when subscriptionId is undefined', () => {
      const passed = runGuardCheck({
        amount: 9900,
        isSubscriptionFlow: true,
        subscriptionId: undefined,
        isSaveCard: false,
      });

      expect(passed).toBe(false);
      expect(onError).toHaveBeenCalledWith('Subscription is still being created. Please wait a moment and try again.');
    });

    it('allows subscription flow when subscriptionId is present', () => {
      const passed = runGuardCheck({
        amount: 9900,
        isSubscriptionFlow: true,
        subscriptionId: 'sub_123abc',
        isSaveCard: false,
      });

      expect(passed).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });

    it('allows subscription flow with existingPaymentIntentId even without subscriptionId', () => {
      const passed = runGuardCheck({
        amount: 9900,
        isSubscriptionFlow: true,
        subscriptionId: null,
        existingPaymentIntentId: 'pi_existing123',
        isSaveCard: false,
      });

      expect(passed).toBe(true);
      expect(onError).not.toHaveBeenCalled();
    });
  });
});

describe('cancel-payment 409 recovery', () => {
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

  interface RecoveryResult {
    recovered: boolean;
    successPiId?: string;
  }

  function simulateCancelCatch(err: unknown, currentPiId: string | null): RecoveryResult {
    if (err instanceof Error && 'errorData' in err) {
      const apiErr = err as Error & { errorData?: { alreadySucceeded?: boolean } };
      if (apiErr.errorData?.alreadySucceeded && currentPiId) {
        return { recovered: true, successPiId: currentPiId };
      }
    }
    return { recovered: false };
  }

  it('recovers from 409 with alreadySucceeded=true in errorData', () => {
    const err = new ApiError('Payment cannot be cancelled', 409, { alreadySucceeded: true });
    const result = simulateCancelCatch(err, 'pi_test123');

    expect(result.recovered).toBe(true);
    expect(result.successPiId).toBe('pi_test123');
  });

  it('does not recover from 409 without alreadySucceeded flag', () => {
    const err = new ApiError('Conflict', 409, { someOtherData: true });
    const result = simulateCancelCatch(err, 'pi_test123');

    expect(result.recovered).toBe(false);
  });

  it('does not recover when alreadySucceeded is true but currentPiId is null', () => {
    const err = new ApiError('Payment cannot be cancelled', 409, { alreadySucceeded: true });
    const result = simulateCancelCatch(err, null);

    expect(result.recovered).toBe(false);
  });

  it('does not recover from 500 error', () => {
    const err = new ApiError('Internal Server Error', 500, {});
    const result = simulateCancelCatch(err, 'pi_test123');

    expect(result.recovered).toBe(false);
  });

  it('does not recover from non-ApiError', () => {
    const err = new Error('Network failure');
    const result = simulateCancelCatch(err, 'pi_test123');

    expect(result.recovered).toBe(false);
  });

  it('does not recover from non-Error thrown values', () => {
    const err = 'string error';
    const result = simulateCancelCatch(err, 'pi_test123');

    expect(result.recovered).toBe(false);
  });
});
