import { z } from 'zod';

export const adjustGuestPassesSchema = z.object({
  memberEmail: z.string().email('Valid email is required'),
  adjustment: z.number().int('Adjustment must be an integer').refine(val => val !== 0, 'Adjustment cannot be zero'),
  reason: z.string().min(1, 'Reason is required'),
  memberId: z.string().optional(),
  memberName: z.string().max(200).optional(),
});

export const addPaymentNoteSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
  note: z.string().min(1, 'Note is required').max(2000),
  performedBy: z.string().optional(),
  performedByName: z.string().optional(),
});

export const retryPaymentSchema = z.object({
  paymentIntentId: z.string().startsWith('pi_', 'paymentIntentId must start with "pi_"'),
});

export const cancelPaymentSchema = z.object({
  paymentIntentId: z.string().startsWith('pi_', 'paymentIntentId must start with "pi_"'),
});

export const refundPaymentSchema = z.object({
  paymentIntentId: z.string().startsWith('pi_', 'paymentIntentId must start with "pi_"'),
  amountCents: z.number().int().positive().optional(),
  reason: z.string().max(500).optional(),
});

export const capturePaymentSchema = z.object({
  paymentIntentId: z.string().startsWith('pi_', 'paymentIntentId must start with "pi_"'),
  amountCents: z.number().int().positive().optional(),
});

export const voidAuthorizationSchema = z.object({
  paymentIntentId: z.string().startsWith('pi_', 'paymentIntentId must start with "pi_"'),
  reason: z.string().max(500).optional(),
});

export type AdjustGuestPassesInput = z.infer<typeof adjustGuestPassesSchema>;
export type AddPaymentNoteInput = z.infer<typeof addPaymentNoteSchema>;
export type RetryPaymentInput = z.infer<typeof retryPaymentSchema>;
export type CancelPaymentInput = z.infer<typeof cancelPaymentSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type CapturePaymentInput = z.infer<typeof capturePaymentSchema>;
export type VoidAuthorizationInput = z.infer<typeof voidAuthorizationSchema>;
