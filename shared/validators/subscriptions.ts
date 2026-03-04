import { z } from 'zod';

export const createSubscriptionSchema = z.object({
  customerId: z.string().min(1, 'customerId is required'),
  priceId: z.string().min(1, 'priceId is required'),
  memberEmail: z.string().email().optional(),
});

export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;

export const createSubscriptionForMemberSchema = z.object({
  memberEmail: z.string().email('Valid email is required'),
  tierName: z.string().min(1, 'tierName is required'),
  couponId: z.string().optional(),
});

export type CreateSubscriptionForMemberInput = z.infer<typeof createSubscriptionForMemberSchema>;

export const createNewMemberSubscriptionSchema = z.object({
  email: z.string().email('Valid email is required'),
  tierSlug: z.string().min(1, 'tierSlug is required'),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  dob: z.string().optional(),
  couponId: z.string().optional(),
  streetAddress: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
});

export type CreateNewMemberSubscriptionInput = z.infer<typeof createNewMemberSubscriptionSchema>;

export const confirmInlinePaymentSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
  subscriptionId: z.string().optional(),
  userId: z.string().optional(),
});

export type ConfirmInlinePaymentInput = z.infer<typeof confirmInlinePaymentSchema>;

export const sendActivationLinkSchema = z.object({
  email: z.string().email('Valid email is required'),
  tierSlug: z.string().min(1, 'tierSlug is required'),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  dob: z.string().optional(),
  couponId: z.string().optional(),
  streetAddress: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
});

export type SendActivationLinkInput = z.infer<typeof sendActivationLinkSchema>;
