import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    let body = req.body === undefined || req.body === null ? {} : req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        return res.status(400).json({ error: 'Invalid JSON in request body' });
      }
    }
    const result = schema.safeParse(body);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      return res.status(400).json({ error: formatted });
    }
    req.body = result.data;
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      return res.status(400).json({ error: formatted });
    }
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}

function formatZodError(error: ZodError): string {
  const issues = error.issues;
  if (issues.length === 0) return 'Invalid input';
  const first = issues[0];
  const path = first.path.length > 0 ? first.path.join('.') : undefined;
  return path ? `${path}: ${first.message}` : first.message;
}
