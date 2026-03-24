import { z } from 'zod';

export const selfServeCheckoutSchema = z.object({
  email: z.string().email('Valid email is required'),
  firstName: z.string().min(1, 'First name is required').max(100),
  lastName: z.string().min(1, 'Last name is required').max(100),
  tierSlug: z.string().min(1, 'Tier selection is required'),
  promoCode: z.string().max(100).optional(),
});

export type SelfServeCheckoutInput = z.infer<typeof selfServeCheckoutSchema>;
