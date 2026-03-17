import { z } from 'zod';

const trackmanIdField = z.union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform(v => v != null ? String(v) : v)
  .refine(v => v == null || /^\d+$/.test(v), {
    message: 'Trackman Booking ID must be a number (e.g., 19510379). UUIDs and other formats are not valid Trackman IDs.'
  });

const participantSchema = z.object({
  email: z.string().optional().default(''),
  type: z.enum(['member', 'guest']).default('guest'),
  userId: z.union([z.string(), z.number()]).optional().transform(v => v != null ? String(v) : undefined),
  name: z.string().optional(),
});

export const staffManualBookingSchema = z.object({
  user_email: z.string().min(1, 'Missing required field: user_email'),
  user_name: z.string().optional().nullable(),
  resource_id: z.number().int().positive().optional().nullable(),
  request_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time must be in HH:MM or HH:MM:SS format'),
  duration_minutes: z.number().int().min(1, 'Duration must be at least 1 minute').max(480, 'Duration cannot exceed 480 minutes'),
  declared_player_count: z.number().int().min(1).max(4).optional().nullable(),
  request_participants: z.array(participantSchema).optional().nullable(),
  dayPassPurchaseId: z.union([z.string(), z.number()]).optional().nullable(),
  paymentStatus: z.string().optional().nullable(),
  trackman_booking_id: trackmanIdField,
  trackman_external_id: trackmanIdField,
}).refine(data => !!(data.trackman_booking_id || data.trackman_external_id), {
  message: 'Missing required field: trackman_booking_id (or trackman_external_id)',
  path: ['trackman_booking_id'],
});

export type StaffManualBookingInput = z.infer<typeof staffManualBookingSchema>;
