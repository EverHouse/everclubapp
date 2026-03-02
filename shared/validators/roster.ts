import { z } from 'zod';

export const addParticipantSchema = z.object({
  type: z.enum(['member', 'guest'], { required_error: 'Participant type is required' }),
  userId: z.string().optional(),
  guest: z.object({
    name: z.string().min(1, 'Guest name is required').max(200),
    email: z.string().email('Valid guest email is required'),
  }).optional(),
  rosterVersion: z.number().int().optional(),
  useGuestPass: z.boolean().optional(),
  deferFeeRecalc: z.boolean().optional(),
}).refine(
  (data) => data.type !== 'guest' || (data.guest && data.guest.name && data.guest.email),
  { message: 'Guest name and email are required for guest participants', path: ['guest'] }
);

const batchOperationSchema = z.object({
  action: z.enum(['add', 'remove']),
  type: z.enum(['member', 'guest']).optional(),
  userId: z.string().optional(),
  participantId: z.number().int().positive().optional(),
  guest: z.object({
    name: z.string().min(1).max(200),
    email: z.string().email(),
  }).optional(),
  useGuestPass: z.boolean().optional(),
});

export const batchRosterSchema = z.object({
  rosterVersion: z.number().int({ required_error: 'rosterVersion is required' }),
  operations: z.array(batchOperationSchema).min(1, 'At least one operation is required').max(20),
});

export type AddParticipantInput = z.infer<typeof addParticipantSchema>;
export type BatchRosterInput = z.infer<typeof batchRosterSchema>;
