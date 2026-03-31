// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { selfServeCheckoutSchema } from '../../shared/validators/membershipCheckout';

describe('selfServeCheckoutSchema', () => {
  const valid = {
    email: 'new@member.com',
    firstName: 'John',
    lastName: 'Doe',
    tierSlug: 'premium',
  };

  it('accepts valid checkout data', () => {
    expect(selfServeCheckoutSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts with optional promoCode', () => {
    expect(selfServeCheckoutSchema.safeParse({
      ...valid,
      promoCode: 'SAVE20',
    }).success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, email: 'bad' }).success).toBe(false);
  });

  it('rejects empty email', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, email: '' }).success).toBe(false);
  });

  it('rejects empty firstName', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false);
  });

  it('rejects empty lastName', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false);
  });

  it('rejects empty tierSlug', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, tierSlug: '' }).success).toBe(false);
  });

  it('rejects firstName exceeding 100 chars', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, firstName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects lastName exceeding 100 chars', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, lastName: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects promoCode exceeding 100 chars', () => {
    expect(selfServeCheckoutSchema.safeParse({ ...valid, promoCode: 'x'.repeat(101) }).success).toBe(false);
  });

  it('rejects missing required fields', () => {
    expect(selfServeCheckoutSchema.safeParse({}).success).toBe(false);
    expect(selfServeCheckoutSchema.safeParse({ email: 'a@b.com' }).success).toBe(false);
  });

  it('rejects XSS in email field', () => {
    const result = selfServeCheckoutSchema.safeParse({
      ...valid,
      email: '<script>alert(1)</script>',
    });
    expect(result.success).toBe(false);
  });

  it('rejects SQL injection in email', () => {
    expect(selfServeCheckoutSchema.safeParse({
      ...valid,
      email: "'; DROP TABLE users; --",
    }).success).toBe(false);
  });
});
