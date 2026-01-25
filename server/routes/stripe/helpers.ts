import { Request } from 'express';
import { getSessionUser } from '../../types/session';

export function getStaffInfo(req: Request) {
  const sessionUser = getSessionUser(req);
  const staffEmail = sessionUser?.email || 'staff';
  const staffName = sessionUser?.firstName && sessionUser?.lastName 
    ? `${sessionUser.firstName} ${sessionUser.lastName}` 
    : sessionUser?.name || 'Staff Member';
  
  return { staffEmail, staffName, sessionUser };
}

export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => ({ 
    '&': '&amp;', 
    '<': '&lt;', 
    '>': '&gt;', 
    '"': '&quot;', 
    "'": '&#039;' 
  }[c] || c));
}

export const MAX_RETRY_ATTEMPTS = 3;
export const GUEST_FEE_CENTS = 2500;
