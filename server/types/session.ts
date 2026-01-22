import type { Session, SessionData } from 'express-session';

export interface SessionUser {
  id?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  role?: string;
  tier?: string;
  tierId?: number;
  phone?: string;
  tags?: string[];
  mindbodyClientId?: string;
  status?: string;
  expires_at?: number;
  isTestUser?: boolean;
  dateOfBirth?: string | null;
  isStaff?: boolean;
}

export interface StaffUser {
  email: string;
  name: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
      staffUser?: StaffUser;
    }
  }
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
  }
}

export function getSessionUser(req: { session?: Session & Partial<SessionData> }): SessionUser | undefined {
  return req.session?.user;
}
