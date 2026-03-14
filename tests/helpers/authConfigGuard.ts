import type { Request, Response, NextFunction } from 'express';

export function createGoogleConfigGuard(clientId: string | undefined) {
  return function requireGoogleConfig(_req: Request, res: Response, next: NextFunction) {
    if (!clientId) {
      return res.status(503).json({ error: 'Google authentication is not configured' });
    }
    next();
  };
}

export function createAppleConfigGuard(serviceId: string | undefined) {
  return function requireAppleConfig(_req: Request, res: Response, next: NextFunction) {
    if (!serviceId) {
      return res.status(503).json({ error: 'Apple authentication is not configured' });
    }
    next();
  };
}
