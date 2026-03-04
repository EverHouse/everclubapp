import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  email: z.string().email('Valid email is required'),
  amountCents: z.number().int().min(50, 'Amount must be at least 50 cents'),
  purpose: z.enum(['guest_fee', 'overage_fee', 'one_time_purchase'], {
    message: 'Purpose is required',
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
  amountCents: z.number({ message: 'amountCents is required' }).min(50, 'Minimum charge amount is $0.50').max(99999999, 'Amount exceeds maximum allowed'),
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

export const confirmPaymentSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
});

export const cancelPaymentIntentSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
});

export const createCustomerSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  email: z.string().email('Valid email is required'),
  name: z.string().max(200).optional(),
});

export const chargeSavedCardSchema = z.object({
  memberEmail: z.string().email('Valid email is required'),
  bookingId: z.number().int().positive().optional(),
  sessionId: z.number().int().positive().optional(),
  participantIds: z.array(z.number().int()).min(1, 'At least one participantId is required'),
});

export const attachEmailSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
  email: z.string().email('Valid email is required'),
});

export const confirmQuickChargeSchema = z.object({
  paymentIntentId: z.string().min(1, 'paymentIntentId is required'),
});

export const chargeSavedCardPosSchema = z.object({
  memberEmail: z.string().email('Valid email is required'),
  amountCents: z.number().int().min(50, 'Amount must be at least 50 cents').max(99999999, 'Amount exceeds maximum allowed'),
  memberName: z.string().optional(),
  description: z.string().max(500).optional(),
  productId: z.string().optional(),
  cartItems: z.array(z.object({
    productId: z.string(),
    name: z.string(),
    quantity: z.number().int().min(1),
    unitAmountCents: z.number().int().min(0),
  })).optional(),
});

export const sendReceiptSchema = z.object({
  email: z.string().email('Valid email is required'),
  memberName: z.string().min(1, 'memberName is required').max(200),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
    total: z.number(),
  })).min(1, 'At least one item is required'),
  totalAmount: z.number().positive('totalAmount must be a positive number'),
  paymentMethod: z.string().optional(),
  paymentIntentId: z.string().optional(),
});

export const chargeSubscriptionInvoiceSchema = z.object({
  subscriptionId: z.string().min(1, 'subscriptionId is required'),
  userId: z.string().min(1, 'userId is required'),
});

export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
export type QuickChargeInput = z.infer<typeof quickChargeSchema>;
export type MarkBookingPaidInput = z.infer<typeof markBookingPaidSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
export type CancelPaymentIntentInput = z.infer<typeof cancelPaymentIntentSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type ChargeSavedCardInput = z.infer<typeof chargeSavedCardSchema>;
export type AttachEmailInput = z.infer<typeof attachEmailSchema>;
export type ConfirmQuickChargeInput = z.infer<typeof confirmQuickChargeSchema>;
export type ChargeSavedCardPosInput = z.infer<typeof chargeSavedCardPosSchema>;
export type SendReceiptInput = z.infer<typeof sendReceiptSchema>;
export type ChargeSubscriptionInvoiceInput = z.infer<typeof chargeSubscriptionInvoiceSchema>;
