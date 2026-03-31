import { describe, it, expect } from 'vitest';
import {
  createPaymentIntentSchema,
  quickChargeSchema,
  markBookingPaidSchema,
  confirmPaymentSchema,
  cancelPaymentIntentSchema,
  createCustomerSchema,
  chargeSavedCardSchema,
  attachEmailSchema,
  confirmQuickChargeSchema,
  chargeSavedCardPosSchema,
  sendReceiptSchema,
  chargeSubscriptionInvoiceSchema,
} from '../../shared/validators/payments';

describe('createPaymentIntentSchema', () => {
  const valid = {
    email: 'user@example.com',
    amountCents: 1000,
    purpose: 'guest_fee' as const,
    description: 'Guest fee for bay 3',
  };

  it('accepts valid payment intent', () => {
    expect(createPaymentIntentSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts with optional fields', () => {
    expect(createPaymentIntentSchema.safeParse({
      ...valid,
      userId: 'u-1',
      memberName: 'John',
      bookingId: 42,
      sessionId: 7,
      participantFees: [{ id: 1, amountCents: 500 }],
    }).success).toBe(true);
  });

  it('rejects amount below 50 cents', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, amountCents: 49 }).success).toBe(false);
  });

  it('rejects invalid purpose', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, purpose: 'tip' }).success).toBe(false);
  });

  it('rejects empty description', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
  });

  it('rejects description exceeding 500 chars', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, description: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, email: 'bad' }).success).toBe(false);
  });

  it('rejects non-integer bookingId', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, bookingId: 1.5 }).success).toBe(false);
  });

  it('rejects non-positive bookingId', () => {
    expect(createPaymentIntentSchema.safeParse({ ...valid, bookingId: 0 }).success).toBe(false);
  });
});

describe('quickChargeSchema', () => {
  it('accepts minimal valid charge', () => {
    expect(quickChargeSchema.safeParse({ amountCents: 100 }).success).toBe(true);
  });

  it('rejects amount below 50', () => {
    expect(quickChargeSchema.safeParse({ amountCents: 10 }).success).toBe(false);
  });

  it('rejects amount above maximum', () => {
    expect(quickChargeSchema.safeParse({ amountCents: 100000000 }).success).toBe(false);
  });

  it('accepts cart items', () => {
    expect(quickChargeSchema.safeParse({
      amountCents: 500,
      cartItems: [{ productId: 'p1', name: 'Widget', quantity: 2, priceCents: 250 }],
    }).success).toBe(true);
  });

  it('rejects cart item with quantity < 1', () => {
    expect(quickChargeSchema.safeParse({
      amountCents: 500,
      cartItems: [{ productId: 'p1', name: 'Widget', quantity: 0, priceCents: 250 }],
    }).success).toBe(false);
  });

  it('rejects missing amountCents', () => {
    expect(quickChargeSchema.safeParse({}).success).toBe(false);
  });
});

describe('markBookingPaidSchema', () => {
  const valid = { bookingId: 1, participantIds: [1, 2] };

  it('accepts valid input', () => {
    expect(markBookingPaidSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects empty participantIds array', () => {
    expect(markBookingPaidSchema.safeParse({ ...valid, participantIds: [] }).success).toBe(false);
  });

  it('rejects non-positive bookingId', () => {
    expect(markBookingPaidSchema.safeParse({ ...valid, bookingId: 0 }).success).toBe(false);
  });
});

describe('confirmPaymentSchema', () => {
  it('accepts valid paymentIntentId', () => {
    expect(confirmPaymentSchema.safeParse({ paymentIntentId: 'pi_abc123' }).success).toBe(true);
  });

  it('rejects empty paymentIntentId', () => {
    expect(confirmPaymentSchema.safeParse({ paymentIntentId: '' }).success).toBe(false);
  });
});

describe('cancelPaymentIntentSchema', () => {
  it('accepts valid paymentIntentId', () => {
    expect(cancelPaymentIntentSchema.safeParse({ paymentIntentId: 'pi_abc123' }).success).toBe(true);
  });

  it('rejects empty paymentIntentId', () => {
    expect(cancelPaymentIntentSchema.safeParse({ paymentIntentId: '' }).success).toBe(false);
  });
});

describe('createCustomerSchema', () => {
  it('accepts valid customer', () => {
    expect(createCustomerSchema.safeParse({ userId: 'u1', email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects empty userId', () => {
    expect(createCustomerSchema.safeParse({ userId: '', email: 'a@b.com' }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(createCustomerSchema.safeParse({ userId: 'u1', email: 'bad' }).success).toBe(false);
  });
});

describe('chargeSavedCardSchema', () => {
  it('accepts valid input', () => {
    expect(chargeSavedCardSchema.safeParse({
      memberEmail: 'a@b.com',
      participantIds: [1],
    }).success).toBe(true);
  });

  it('rejects empty participantIds', () => {
    expect(chargeSavedCardSchema.safeParse({
      memberEmail: 'a@b.com',
      participantIds: [],
    }).success).toBe(false);
  });
});

describe('attachEmailSchema', () => {
  it('accepts valid input', () => {
    expect(attachEmailSchema.safeParse({ paymentIntentId: 'pi_1', email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(attachEmailSchema.safeParse({ paymentIntentId: 'pi_1', email: 'bad' }).success).toBe(false);
  });
});

describe('confirmQuickChargeSchema', () => {
  it('accepts valid paymentIntentId', () => {
    expect(confirmQuickChargeSchema.safeParse({ paymentIntentId: 'pi_abc123' }).success).toBe(true);
  });

  it('rejects empty paymentIntentId', () => {
    expect(confirmQuickChargeSchema.safeParse({ paymentIntentId: '' }).success).toBe(false);
  });
});

describe('chargeSavedCardPosSchema', () => {
  it('accepts valid POS charge', () => {
    expect(chargeSavedCardPosSchema.safeParse({
      memberEmail: 'a@b.com',
      amountCents: 500,
    }).success).toBe(true);
  });

  it('rejects amount below 50', () => {
    expect(chargeSavedCardPosSchema.safeParse({
      memberEmail: 'a@b.com',
      amountCents: 10,
    }).success).toBe(false);
  });

  it('rejects amount above maximum', () => {
    expect(chargeSavedCardPosSchema.safeParse({
      memberEmail: 'a@b.com',
      amountCents: 100000000,
    }).success).toBe(false);
  });
});

describe('sendReceiptSchema', () => {
  const valid = {
    email: 'a@b.com',
    memberName: 'John',
    items: [{ name: 'Widget', quantity: 1, unitPrice: 10, total: 10 }],
    totalAmount: 10,
  };

  it('accepts valid receipt', () => {
    expect(sendReceiptSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects empty items array', () => {
    expect(sendReceiptSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });

  it('rejects non-positive totalAmount', () => {
    expect(sendReceiptSchema.safeParse({ ...valid, totalAmount: 0 }).success).toBe(false);
  });

  it('rejects empty memberName', () => {
    expect(sendReceiptSchema.safeParse({ ...valid, memberName: '' }).success).toBe(false);
  });
});

describe('chargeSubscriptionInvoiceSchema', () => {
  it('accepts valid input', () => {
    expect(chargeSubscriptionInvoiceSchema.safeParse({
      subscriptionId: 'sub_1',
      userId: 'u1',
    }).success).toBe(true);
  });

  it('rejects empty subscriptionId', () => {
    expect(chargeSubscriptionInvoiceSchema.safeParse({
      subscriptionId: '',
      userId: 'u1',
    }).success).toBe(false);
  });
});
