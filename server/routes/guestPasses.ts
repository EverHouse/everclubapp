import { Router } from 'express';
import { isAuthenticated, isStaffOrAdmin } from '../core/middleware';
import { eq, sql, and, lt, inArray } from 'drizzle-orm';
import { db } from '../db';
import { guestPasses, staffUsers, bookingRequests } from '../../shared/schema';
import { getTierLimits } from '../core/tierService';
import { broadcastMemberStatsUpdated } from '../core/websocket';
import { logAndRespond, logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';
import { isSyntheticEmail, notifyMember } from '../core/notificationService';
import { isPlaceholderGuestName } from '../core/billing/pricingConfig';
import { withRetry } from '../core/retry';
import { getSessionUser } from '../types/session';
import { logFromRequest } from '../core/auditLog';
import { requiredStringParam } from '../middleware/paramSchemas';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate';

const guestPassUseSchema = z.object({
  guest_name: z.string().optional(),
});

const guestPassUpdateSchema = z.object({
  passes_total: z.number().int().min(0),
});

const guestPassQuerySchema = z.object({
  tier: z.string().optional(),
}).passthrough();

const router = Router();

async function isStaffOrAdminCheck(email: string): Promise<boolean> {
  const { getAlternateDomainEmail } = await import('../core/utils/emailNormalization');
  const alt = getAlternateDomainEmail(email);
  const emails = alt ? [email.toLowerCase(), alt.toLowerCase()] : [email.toLowerCase()];
  const [staff] = await db.select({ id: staffUsers.id })
    .from(staffUsers)
    .where(and(
      sql`LOWER(${staffUsers.email}) IN (${sql.join(emails.map(e => sql`LOWER(${e})`), sql`, `)})`,
      eq(staffUsers.isActive, true)
    ))
    .limit(1);
  return !!staff;
}

router.get('/api/guest-passes/:email', isAuthenticated, validateQuery(guestPassQuerySchema), async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const emailParse = requiredStringParam.safeParse(req.params.email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const email = decodeURIComponent(emailParse.data).trim().toLowerCase();
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    const requestedEmail = email.toLowerCase();
    
    const isStaff = await isStaffOrAdminCheck(sessionEmail);
    
    if (sessionEmail !== requestedEmail) {
      if (!isStaff) {
        return res.status(403).json({ error: 'You can only view your own guest passes' });
      }
    }
    
    // Get the member's actual tier from the database - don't trust client-provided tier
    // Staff can optionally override with query param, but members must use their actual tier
    let actualTier: string | null = null;
    const { tier: clientTier } = req.query;
    
    if (isStaff && clientTier) {
      // Staff can specify a tier for testing/override purposes
      actualTier = clientTier as string;
    } else {
      // Look up the member's actual tier from the users table - don't trust client input
      const userResult = await withRetry(() =>
        db.execute(sql`SELECT tier FROM users WHERE LOWER(email) = LOWER(${requestedEmail}) LIMIT 1`)
      );
      actualTier = (userResult as { rows?: Array<{ tier?: string }> }).rows?.[0]?.tier || null;
    }
    
    const tierLimits = actualTier ? await getTierLimits(actualTier) : null;
    const passesTotal = tierLimits?.guest_passes_per_year ?? 0;
    
    // Always use lowercase email for guest passes to prevent case-sensitivity issues
    const normalizedEmail = requestedEmail.toLowerCase();
    
    let result = await withRetry(() => 
      db.select()
        .from(guestPasses)
        .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`)
    );
    
    if (result.length === 0) {
      await withRetry(() =>
        db.insert(guestPasses)
          .values({
            memberEmail: normalizedEmail,
            passesUsed: 0,
            passesTotal: passesTotal
          })
          .onConflictDoNothing()
      );
      result = await withRetry(() =>
        db.select()
          .from(guestPasses)
          .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`)
      );
    } else if (result[0].passesTotal !== passesTotal) {
      // Update passes_total to match tier config (handles both upgrades AND downgrades)
      // Also clamp passes_used to not exceed new total
      const newPassesUsed = Math.min(result[0].passesUsed, passesTotal);
      await withRetry(() =>
        db.update(guestPasses)
          .set({ passesTotal: passesTotal, passesUsed: newPassesUsed })
          .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`)
      );
      result[0].passesTotal = passesTotal;
      result[0].passesUsed = newPassesUsed;
    }
    
    const data = result[0];
    
    // Count guests in pending/approved booking requests (not yet attended/completed)
    // These represent "reserved" guest passes that haven't been officially consumed yet
    let pendingGuestCount = 0;
    try {
      const pendingBookings = await db.select({
        requestParticipants: bookingRequests.requestParticipants
      })
        .from(bookingRequests)
        .where(and(
          eq(sql`LOWER(${bookingRequests.userEmail})`, requestedEmail),
          inArray(bookingRequests.status, ['pending', 'pending_approval', 'approved', 'confirmed'])
        ));
      
      for (const booking of pendingBookings) {
        const participants = booking.requestParticipants;
        if (Array.isArray(participants)) {
          // Count guests that have either email OR userId (directory-selected guests)
          pendingGuestCount += participants.filter((p: Record<string, unknown>) => 
            p.type === 'guest' && (p.email || p.userId)
          ).length;
        }
      }
    } catch (err: unknown) {
      logger.error('[GuestPasses] Error counting pending guests', { extra: { error: getErrorMessage(err) } });
    }
    
    const passesRemaining = data.passesTotal - data.passesUsed;
    const conservativeRemaining = Math.max(0, passesRemaining - pendingGuestCount);
    
    res.json({
      passes_used: data.passesUsed,
      passes_total: data.passesTotal,
      passes_remaining: passesRemaining,
      passes_pending: pendingGuestCount,
      passes_remaining_conservative: conservativeRemaining
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch guest passes', error, 'GUEST_PASSES_FETCH_ERROR');
  }
});

router.post('/api/guest-passes/:email/use', isAuthenticated, validateBody(guestPassUseSchema), async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const emailParse = requiredStringParam.safeParse(req.params.email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const email = decodeURIComponent(emailParse.data).trim().toLowerCase();
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    const requestedEmail = email.toLowerCase();
    
    if (sessionEmail !== requestedEmail) {
      const hasStaffAccess = await isStaffOrAdminCheck(sessionEmail);
      if (!hasStaffAccess) {
        return res.status(403).json({ error: 'You can only use your own guest passes' });
      }
    }
    
    const { guest_name } = req.body;
    
    if (isPlaceholderGuestName(guest_name)) {
      return res.status(400).json({ error: `Cannot use guest pass for placeholder "${guest_name}". Assign a real guest first.` });
    }
    
    // Use lowercase for consistent matching
    const normalizedEmail = requestedEmail.toLowerCase();
    
    const result = await db.update(guestPasses)
      .set({ passesUsed: sql`${guestPasses.passesUsed} + 1` })
      .where(and(
        sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`,
        lt(guestPasses.passesUsed, guestPasses.passesTotal)
      ))
      .returning();
    
    if (result.length === 0) {
      return res.status(400).json({ error: 'No guest passes remaining' });
    }
    
    const data = result[0];
    const remaining = data.passesTotal - data.passesUsed;
    const message = guest_name 
      ? `Guest pass used for ${guest_name}. You have ${remaining} pass${remaining !== 1 ? 'es' : ''} remaining this year.`
      : `Guest pass used. You have ${remaining} pass${remaining !== 1 ? 'es' : ''} remaining this year.`;
    
    if (!isSyntheticEmail(normalizedEmail)) {
      notifyMember({
        userEmail: normalizedEmail,
        title: 'Guest Pass Used',
        message: message,
        type: 'guest_pass',
        relatedType: 'guest_pass',
        url: '/member/profile'
      }).catch(err => logger.error('Guest pass notification failed', { extra: { error: getErrorMessage(err) } }));
    }
    
    try { broadcastMemberStatsUpdated(normalizedEmail, { guestPasses: remaining }); } catch (err: unknown) { logger.error('[Broadcast] Stats update error', { extra: { error: getErrorMessage(err) } }); }
    
    res.json({
      passes_used: data.passesUsed,
      passes_total: data.passesTotal,
      passes_remaining: remaining
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to use guest pass', error, 'GUEST_PASS_USE_ERROR');
  }
});

router.put('/api/guest-passes/:email', isStaffOrAdmin, validateBody(guestPassUpdateSchema), async (req, res) => {
  try {
    const sessionUser = getSessionUser(req);
    if (!sessionUser) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    const sessionEmail = sessionUser.email?.toLowerCase() || '';
    const hasStaffAccess = await isStaffOrAdminCheck(sessionEmail);
    if (!hasStaffAccess) {
      return res.status(403).json({ error: 'Staff access required to modify guest passes' });
    }
    
    const emailParse = requiredStringParam.safeParse(req.params.email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const email = decodeURIComponent(emailParse.data).trim().toLowerCase();
    const normalizedEmail = email.toLowerCase();
    const { passes_total } = req.body;
    
    const result = await db.update(guestPasses)
      .set({ passesTotal: passes_total })
      .where(sql`LOWER(${guestPasses.memberEmail}) = ${normalizedEmail}`)
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    
    const data = result[0];
    const passesRemaining = data.passesTotal - data.passesUsed;
    
    try { broadcastMemberStatsUpdated(normalizedEmail, { guestPasses: passesRemaining }); } catch (err: unknown) { logger.error('[Broadcast] Stats update error', { extra: { error: getErrorMessage(err) } }); }
    
    logFromRequest(req, 'update_guest_passes', 'guest_pass', normalizedEmail, undefined, { passes_total: passes_total });
    res.json({
      passes_used: data.passesUsed,
      passes_total: data.passesTotal,
      passes_remaining: passesRemaining
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to update guest passes', error, 'GUEST_PASS_UPDATE_ERROR');
  }
});

export { useGuestPass, refundGuestPass, getGuestPassesRemaining, ensureGuestPassRecord } from '../core/billing/guestPassService';

export default router;
