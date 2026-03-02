import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  email: z.string().email('Valid email is required'),
  amountCents: z.number().int().min(50, 'Amount must be at least 50 cents'),
  purpose: z.enum(['guest_fee', 'overage_fee', 'one_time_purchase'], {
    required_error: 'Purpose is required',
  }),
  description: z.string().min(1, 'Description is required').max(500),
  userId: z.string().optional(),
  memberName: z.string().max(200).optional(),
  bookingId: z.number().int().positive().optional().nullable(),
  sessionId: z.number().int().positive().optional().nullable(),
  participantFees: z.array(z.object({
    id: z.number().int().positive(),
    amountCents: z.number().int().min(0).optional(),
  })).optional(),
});

export const quickChargeSchema = z.object({
  memberEmail: z.string().optional(),
  memberName: z.string().max(200).optional(),
  amountCents: z.number({ required_error: 'amountCents is required' }).min(50, 'Minimum charge amount is $0.50').max(99999999, 'Amount exceeds maximum allowed'),
  description: z.string().max(500).optional(),
  productId: z.string().optional(),
  isNewCustomer: z.boolean().optional(),
  firstName: z.string().max(100).optional(),
  lastName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  dob: z.string().optional(),
  tierSlug: z.string().optional(),
  tierName: z.string().optional(),
  createUser: z.boolean().optional(),
  streetAddress: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  state: z.string().max(50).optional(),
  zipCode: z.string().max(20).optional(),
  cartItems: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    quantity: z.number().int().min(1),
    unitAmountCents: z.number().int().min(0),
  })).optional(),
  guestCheckout: z.boolean().optional(),
});

export const markBookingPaidSchema = z.object({
  bookingId: z.number().int().positive('bookingId is required'),
  sessionId: z.number().int().positive().optional(),
  participantIds: z.array(z.number().int().positive()).min(1, 'At least one participantId is required'),
  paymentMethod: z.string().max(50).optional(),
});

export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
export type QuickChargeInput = z.infer<typeof quickChargeSchema>;
export type MarkBookingPaidInput = z.infer<typeof markBookingPaidSchema>;
