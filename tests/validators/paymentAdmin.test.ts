import { describe, it, expect } from 'vitest';
import {
  adjustGuestPassesSchema,
  addPaymentNoteSchema,
  retryPaymentSchema,
  cancelPaymentSchema,
  refundPaymentSchema,
  capturePaymentSchema,
  voidAuthorizationSchema,
} from '../../shared/validators/paymentAdmin';

describe('adjustGuestPassesSchema', () => {
  const valid = {
    memberEmail: 'a@b.com',
    adjustment: 5,
    reason: 'Gifted passes',
  };

  it('accepts valid adjustment', () => {
    expect(adjustGuestPassesSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts negative adjustment', () => {
    expect(adjustGuestPassesSchema.safeParse({ ...valid, adjustment: -3 }).success).toBe(true);
  });

  it('rejects zero adjustment', () => {
    expect(adjustGuestPassesSchema.safeParse({ ...valid, adjustment: 0 }).success).toBe(false);
  });

  it('rejects non-integer adjustment', () => {
    expect(adjustGuestPassesSchema.safeParse({ ...valid, adjustment: 1.5 }).success).toBe(false);
  });

  it('rejects empty reason', () => {
    expect(adjustGuestPassesSchema.safeParse({ ...valid, reason: '' }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(adjustGuestPassesSchema.safeParse({ ...valid, memberEmail: 'bad' }).success).toBe(false);
  });
});

describe('addPaymentNoteSchema', () => {
  it('accepts valid input', () => {
    expect(addPaymentNoteSchema.safeParse({
      transactionId: 'txn_1',
      note: 'Refund processed',
    }).success).toBe(true);
  });

  it('rejects empty transactionId', () => {
    expect(addPaymentNoteSchema.safeParse({
      transactionId: '',
      note: 'test',
    }).success).toBe(false);
  });

  it('rejects empty note', () => {
    expect(addPaymentNoteSchema.safeParse({
      transactionId: 'txn_1',
      note: '',
    }).success).toBe(false);
  });

  it('rejects note exceeding 2000 chars', () => {
    expect(addPaymentNoteSchema.safeParse({
      transactionId: 'txn_1',
      note: 'x'.repeat(2001),
    }).success).toBe(false);
  });
});

describe('retryPaymentSchema', () => {
  it('accepts valid pi_ id', () => {
    expect(retryPaymentSchema.safeParse({ paymentIntentId: 'pi_abc' }).success).toBe(true);
  });

  it('rejects id without pi_ prefix', () => {
    expect(retryPaymentSchema.safeParse({ paymentIntentId: 'ch_abc' }).success).toBe(false);
  });
});

describe('cancelPaymentSchema', () => {
  it('accepts valid pi_ id', () => {
    expect(cancelPaymentSchema.safeParse({ paymentIntentId: 'pi_abc' }).success).toBe(true);
  });

  it('rejects id without pi_ prefix', () => {
    expect(cancelPaymentSchema.safeParse({ paymentIntentId: 'abc' }).success).toBe(false);
  });
});

describe('refundPaymentSchema', () => {
  it('accepts minimal valid input', () => {
    expect(refundPaymentSchema.safeParse({ paymentIntentId: 'pi_abc' }).success).toBe(true);
  });

  it('accepts optional amountCents and reason', () => {
    expect(refundPaymentSchema.safeParse({
      paymentIntentId: 'pi_abc',
      amountCents: 500,
      reason: 'Customer request',
    }).success).toBe(true);
  });

  it('rejects non-positive amountCents', () => {
    expect(refundPaymentSchema.safeParse({
      paymentIntentId: 'pi_abc',
      amountCents: 0,
    }).success).toBe(false);
  });

  it('rejects reason exceeding 500 chars', () => {
    expect(refundPaymentSchema.safeParse({
      paymentIntentId: 'pi_abc',
      reason: 'x'.repeat(501),
    }).success).toBe(false);
  });
});

describe('capturePaymentSchema', () => {
  it('accepts valid capture', () => {
    expect(capturePaymentSchema.safeParse({ paymentIntentId: 'pi_abc' }).success).toBe(true);
  });

  it('accepts optional amountCents', () => {
    expect(capturePaymentSchema.safeParse({
      paymentIntentId: 'pi_abc',
      amountCents: 1000,
    }).success).toBe(true);
  });

  it('rejects non-positive amountCents', () => {
    expect(capturePaymentSchema.safeParse({
      paymentIntentId: 'pi_abc',
      amountCents: -1,
    }).success).toBe(false);
  });
});

describe('voidAuthorizationSchema', () => {
  it('accepts valid void', () => {
    expect(voidAuthorizationSchema.safeParse({ paymentIntentId: 'pi_abc' }).success).toBe(true);
  });

  it('accepts optional reason', () => {
    expect(voidAuthorizationSchema.safeParse({
      paymentIntentId: 'pi_abc',
      reason: 'No longer needed',
    }).success).toBe(true);
  });

  it('rejects reason exceeding 500 chars', () => {
    expect(voidAuthorizationSchema.safeParse({
      paymentIntentId: 'pi_abc',
      reason: 'x'.repeat(501),
    }).success).toBe(false);
  });

  it('rejects id without pi_ prefix', () => {
    expect(voidAuthorizationSchema.safeParse({ paymentIntentId: 'abc' }).success).toBe(false);
  });
});
