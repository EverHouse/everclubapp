import { describe, it, expect } from 'vitest';
import {
  profileUpdateSchema,
  smsPreferencesSchema,
  tierChangeSchema,
  createMemberSchema,
} from '../../shared/validators/members';

describe('profileUpdateSchema', () => {
  const valid = { firstName: 'John', lastName: 'Doe', phone: '555-0100' };

  it('accepts valid profile data', () => {
    expect(profileUpdateSchema.safeParse(valid).success).toBe(true);
  });

  it('trims whitespace from fields', () => {
    const result = profileUpdateSchema.parse({ firstName: '  John  ', lastName: '  Doe  ', phone: ' 555 ' });
    expect(result.firstName).toBe('John');
    expect(result.lastName).toBe('Doe');
    expect(result.phone).toBe('555');
  });

  it('rejects empty first name', () => {
    expect(profileUpdateSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false);
  });

  it('rejects empty last name', () => {
    expect(profileUpdateSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false);
  });

  it('rejects empty phone', () => {
    expect(profileUpdateSchema.safeParse({ ...valid, phone: '' }).success).toBe(false);
  });

  it('rejects first name exceeding 100 chars', () => {
    expect(profileUpdateSchema.safeParse({ ...valid, firstName: 'a'.repeat(101) }).success).toBe(false);
  });

  it('rejects phone exceeding 30 chars', () => {
    expect(profileUpdateSchema.safeParse({ ...valid, phone: '5'.repeat(31) }).success).toBe(false);
  });

  it('rejects missing fields', () => {
    expect(profileUpdateSchema.safeParse({}).success).toBe(false);
    expect(profileUpdateSchema.safeParse({ firstName: 'John' }).success).toBe(false);
  });
});

describe('smsPreferencesSchema', () => {
  it('accepts all boolean preferences', () => {
    const result = smsPreferencesSchema.safeParse({
      smsPromoOptIn: true,
      smsTransactionalOptIn: false,
      smsRemindersOptIn: true,
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    expect(smsPreferencesSchema.safeParse({}).success).toBe(true);
  });

  it('rejects non-boolean values', () => {
    expect(smsPreferencesSchema.safeParse({ smsPromoOptIn: 'yes' }).success).toBe(false);
  });
});

describe('tierChangeSchema', () => {
  it('accepts valid tier change', () => {
    expect(tierChangeSchema.safeParse({ tier: 'gold', immediate: true }).success).toBe(true);
  });

  it('accepts null tier (removal)', () => {
    expect(tierChangeSchema.safeParse({ tier: null }).success).toBe(true);
  });

  it('accepts empty object (all optional)', () => {
    expect(tierChangeSchema.safeParse({}).success).toBe(true);
  });
});

describe('createMemberSchema', () => {
  const valid = {
    firstName: 'Jane',
    lastName: 'Smith',
    email: 'jane@example.com',
    tier: 'gold',
  };

  it('accepts valid member creation', () => {
    const result = createMemberSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('lowercases and trims email', () => {
    const result = createMemberSchema.parse({ ...valid, email: 'JANE@Example.COM' });
    expect(result.email).toBe('jane@example.com');
  });

  it('accepts optional fields', () => {
    const result = createMemberSchema.safeParse({
      ...valid,
      phone: '555-0100',
      startDate: '2025-01-01',
      discountReason: 'Early signup',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid email', () => {
    expect(createMemberSchema.safeParse({ ...valid, email: 'bad' }).success).toBe(false);
  });

  it('rejects empty tier', () => {
    expect(createMemberSchema.safeParse({ ...valid, tier: '' }).success).toBe(false);
  });

  it('rejects invalid startDate format', () => {
    expect(createMemberSchema.safeParse({ ...valid, startDate: '01-01-2025' }).success).toBe(false);
  });

  it('rejects empty first name', () => {
    expect(createMemberSchema.safeParse({ ...valid, firstName: '' }).success).toBe(false);
  });

  it('rejects discountReason exceeding 500 chars', () => {
    expect(createMemberSchema.safeParse({ ...valid, discountReason: 'x'.repeat(501) }).success).toBe(false);
  });

  it('rejects XSS in email field', () => {
    expect(createMemberSchema.safeParse({ ...valid, email: '<script>alert(1)</script>' }).success).toBe(false);
  });
});
