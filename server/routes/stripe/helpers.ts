import { Request } from 'express';
import { getSessionUser } from '../../types/session';
import { PRICING } from '../../core/billing/pricingConfig';

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

const syncCooldowns = new Map<string, number>();

export const SYNC_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

export function checkSyncCooldown(operationName: string): { allowed: boolean; remainingSeconds?: number; lastRunAt?: string } {
  const lastRun = syncCooldowns.get(operationName);
  const now = Date.now();
  
  if (lastRun && (now - lastRun) < SYNC_COOLDOWN_MS) {
    const remainingMs = SYNC_COOLDOWN_MS - (now - lastRun);
    return { 
      allowed: false, 
      remainingSeconds: Math.ceil(remainingMs / 1000),
      lastRunAt: new Date(lastRun).toISOString()
    };
  }
  
  syncCooldowns.set(operationName, now);
  return { allowed: true };
}

export const MAX_RETRY_ATTEMPTS = 3;
export const GUEST_FEE_CENTS = PRICING.GUEST_FEE_CENTS;
export const SAVED_CARD_APPROVAL_THRESHOLD_CENTS = 50000; // $500 - charges above this require admin approval
