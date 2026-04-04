import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    let body = req.body === undefined || req.body === null ? {} : req.body;
    if (typeof body === 'string') {
      return res.status(400).json({ error: 'Request body must be parsed JSON, not a raw string' });
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
  return issues.map(issue => {
    const path = issue.path.length > 0 ? issue.path.join('.') : undefined;
    return path ? `${path}: ${issue.message}` : issue.message;
  }).join(', ');
}
