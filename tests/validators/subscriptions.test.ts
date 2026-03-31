import { describe, it, expect } from 'vitest';
import {
  createSubscriptionSchema,
  createSubscriptionForMemberSchema,
  createNewMemberSubscriptionSchema,
  confirmInlinePaymentSchema,
  sendActivationLinkSchema,
  confirmTrialSetupSchema,
} from '../../shared/validators/subscriptions';

describe('createSubscriptionSchema', () => {
  it('accepts valid input', () => {
    expect(createSubscriptionSchema.safeParse({
      customerId: 'cus_123',
      priceId: 'price_456',
    }).success).toBe(true);
  });

  it('accepts optional memberEmail', () => {
    expect(createSubscriptionSchema.safeParse({
      customerId: 'cus_123',
      priceId: 'price_456',
      memberEmail: 'a@b.com',
    }).success).toBe(true);
  });

  it('rejects empty customerId', () => {
    expect(createSubscriptionSchema.safeParse({ customerId: '', priceId: 'price_1' }).success).toBe(false);
  });

  it('rejects empty priceId', () => {
    expect(createSubscriptionSchema.safeParse({ customerId: 'cus_1', priceId: '' }).success).toBe(false);
  });

  it('rejects invalid memberEmail', () => {
    expect(createSubscriptionSchema.safeParse({
      customerId: 'cus_1',
      priceId: 'price_1',
      memberEmail: 'not-email',
    }).success).toBe(false);
  });
});

describe('createSubscriptionForMemberSchema', () => {
  it('accepts valid input', () => {
    expect(createSubscriptionForMemberSchema.safeParse({
      memberEmail: 'a@b.com',
      tierName: 'gold',
    }).success).toBe(true);
  });

  it('rejects empty tierName', () => {
    expect(createSubscriptionForMemberSchema.safeParse({
      memberEmail: 'a@b.com',
      tierName: '',
    }).success).toBe(false);
  });

  it('accepts optional couponId', () => {
    expect(createSubscriptionForMemberSchema.safeParse({
      memberEmail: 'a@b.com',
      tierName: 'gold',
      couponId: 'coupon_10off',
    }).success).toBe(true);
  });
});

describe('createNewMemberSubscriptionSchema', () => {
  const valid = {
    email: 'new@member.com',
    tierSlug: 'premium',
  };

  it('accepts minimal valid input', () => {
    expect(createNewMemberSubscriptionSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts all optional fields', () => {
    expect(createNewMemberSubscriptionSchema.safeParse({
      ...valid,
      firstName: 'John',
      lastName: 'Doe',
      phone: '555-0100',
      dob: '1990-01-01',
      couponId: 'SAVE10',
      trialPeriodDays: 14,
      streetAddress: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701',
    }).success).toBe(true);
  });

  it('rejects empty tierSlug', () => {
    expect(createNewMemberSubscriptionSchema.safeParse({ ...valid, tierSlug: '' }).success).toBe(false);
  });

  it('rejects invalid email', () => {
    expect(createNewMemberSubscriptionSchema.safeParse({ ...valid, email: 'bad' }).success).toBe(false);
  });

  it('rejects trialPeriodDays below 1', () => {
    expect(createNewMemberSubscriptionSchema.safeParse({ ...valid, trialPeriodDays: 0 }).success).toBe(false);
  });

  it('rejects trialPeriodDays above 730', () => {
    expect(createNewMemberSubscriptionSchema.safeParse({ ...valid, trialPeriodDays: 731 }).success).toBe(false);
  });

  it('rejects trialEnd in the past', () => {
    const result = createNewMemberSubscriptionSchema.safeParse({
      ...valid,
      trialEnd: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(result.success).toBe(false);
  });

  it('accepts trialEnd in the future', () => {
    const result = createNewMemberSubscriptionSchema.safeParse({
      ...valid,
      trialEnd: Math.floor(Date.now() / 1000) + 86400,
    });
    expect(result.success).toBe(true);
  });

  it('rejects firstName exceeding 100 chars', () => {
    expect(createNewMemberSubscriptionSchema.safeParse({ ...valid, firstName: 'x'.repeat(101) }).success).toBe(false);
  });
});

describe('confirmInlinePaymentSchema', () => {
  it('accepts valid input', () => {
    expect(confirmInlinePaymentSchema.safeParse({ paymentIntentId: 'pi_123' }).success).toBe(true);
  });

  it('rejects empty paymentIntentId', () => {
    expect(confirmInlinePaymentSchema.safeParse({ paymentIntentId: '' }).success).toBe(false);
  });

  it('accepts optional subscriptionId and userId', () => {
    expect(confirmInlinePaymentSchema.safeParse({
      paymentIntentId: 'pi_123',
      subscriptionId: 'sub_1',
      userId: 'u1',
    }).success).toBe(true);
  });
});

describe('sendActivationLinkSchema', () => {
  it('accepts valid input', () => {
    expect(sendActivationLinkSchema.safeParse({
      email: 'a@b.com',
      tierSlug: 'basic',
    }).success).toBe(true);
  });

  it('rejects empty email', () => {
    expect(sendActivationLinkSchema.safeParse({ email: '', tierSlug: 'basic' }).success).toBe(false);
  });

  it('rejects empty tierSlug', () => {
    expect(sendActivationLinkSchema.safeParse({ email: 'a@b.com', tierSlug: '' }).success).toBe(false);
  });
});

describe('confirmTrialSetupSchema', () => {
  it('accepts valid input', () => {
    expect(confirmTrialSetupSchema.safeParse({ setupIntentId: 'seti_123' }).success).toBe(true);
  });

  it('rejects empty setupIntentId', () => {
    expect(confirmTrialSetupSchema.safeParse({ setupIntentId: '' }).success).toBe(false);
  });
});
