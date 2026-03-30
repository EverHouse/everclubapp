import { z } from 'zod';

export const numericIdParam = z.string().regex(/^\d+$/);
export const requiredStringParam = z.string().min(1);
