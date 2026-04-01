import { Router } from 'express';
import { db } from '../db';
import { bugReports } from '../../shared/schema';
import { eq, desc, SQL } from 'drizzle-orm';
import { isAuthenticated, isStaffOrAdmin } from '../core/middleware';
import { notifyAllStaff, notifyMember } from '../core/notificationService';
import { getSessionUser } from '../types/session';
import { logFromRequest } from '../core/auditLog';
import { logAndRespond, logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';
import { numericIdParam } from '../middleware/paramSchemas';
import { z } from 'zod';
import { validateBody, validateQuery } from '../middleware/validate';
import type { BugReportStatus } from '../../shared/constants/statuses';

const bugReportCreateSchema = z.object({
  description: z.string().min(1, 'Description is required').max(5000),
  screenshotUrl: z.string().url().optional().nullable(),
  pageUrl: z.string().max(2000).optional().nullable(),
});

const bugReportUpdateSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed', 'wont_fix']).optional(),
  staffNotes: z.string().max(5000).optional().nullable(),
});

const bugReportQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.string().regex(/^\d+$/).optional(),
}).passthrough();

const router = Router();

router.post('/api/bug-reports', isAuthenticated, validateBody(bugReportCreateSchema), async (req, res) => {
  try {
    const { description, screenshotUrl, pageUrl } = req.body;
    const user = getSessionUser(req);
    
    if (!user?.email) {
      return logAndRespond(req, res, 401, 'Please log in to submit a bug report');
    }
    
    const [report] = await db.insert(bugReports).values({
      userEmail: user.email,
      userName: user.firstName && user.lastName 
        ? `${user.firstName} ${user.lastName}`.trim() 
        : user.firstName || user.email,
      userRole: user.role || 'member',
      description: description.trim(),
      screenshotUrl: screenshotUrl || null,
      pageUrl: pageUrl || null,
      userAgent: req.headers['user-agent'] || null,
      status: 'open',
    }).returning();
    
    await notifyAllStaff(
      'New Bug Report',
      `${report.userName || report.userEmail} submitted a bug report: "${description.substring(0, 100)}${description.length > 100 ? '...' : ''}"`,
      'system',
      { relatedId: report.id, relatedType: 'bug_report', url: '/admin/bugs' }
    );
    
    res.status(201).json(report);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to submit bug report', error);
  }
});

router.get('/api/admin/bug-reports', isStaffOrAdmin, validateQuery(bugReportQuerySchema), async (req, res) => {
  try {
    const { status, limit: limitParam } = req.query;
    const queryLimit = Math.min(Math.max(parseInt(String(limitParam), 10) || 200, 1), 2000);
    
    const conditions: SQL[] = [];
    
    if (status && typeof status === 'string' && status !== 'all') {
      conditions.push(eq(bugReports.status, status as BugReportStatus));
    }
    
    let query = db.select().from(bugReports);
    if (conditions.length > 0) {
      query = query.where(conditions[0]) as typeof query;
    }
    
    const result = await query.orderBy(desc(bugReports.createdAt)).limit(queryLimit);
    
    res.json(result);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch bug reports', error);
  }
});

router.get('/api/admin/bug-reports/:id', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const idParse = numericIdParam.safeParse(id);
    if (!idParse.success) return res.status(400).json({ error: 'Invalid bug report ID' });
    const parsedId = parseInt(idParse.data, 10);
    if (isNaN(parsedId)) return logAndRespond(req, res, 400, 'Invalid bug report ID');
    
    const [report] = await db.select().from(bugReports)
      .where(eq(bugReports.id, parsedId));
    
    if (!report) {
      return logAndRespond(req, res, 404, 'Bug report not found');
    }
    
    res.json(report);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch bug report', error);
  }
});

router.put('/api/admin/bug-reports/:id', isStaffOrAdmin, validateBody(bugReportUpdateSchema), async (req, res) => {
  try {
    const { id } = req.params;
    const idParse = numericIdParam.safeParse(id);
    if (!idParse.success) return res.status(400).json({ error: 'Invalid bug report ID' });
    const parsedId = parseInt(idParse.data, 10);
    if (isNaN(parsedId)) return logAndRespond(req, res, 400, 'Invalid bug report ID');
    const { status, staffNotes } = req.body;
    const user = getSessionUser(req);
    
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    
    if (status !== undefined) {
      updateData.status = status;
      if (status === 'resolved') {
        updateData.resolvedBy = user?.email;
        updateData.resolvedAt = new Date();
      }
    }
    
    if (staffNotes !== undefined) {
      updateData.staffNotes = staffNotes;
    }
    
    const updated = await db.transaction(async (tx) => {
      const [result] = await tx.update(bugReports)
        .set(updateData)
        .where(eq(bugReports.id, parsedId))
        .returning();
      return result;
    });
    
    if (!updated) {
      return logAndRespond(req, res, 404, 'Bug report not found');
    }

    if (status === 'resolved') {
      const reporterEmail = updated.userEmail;
      if (reporterEmail) {
        notifyMember({
          userEmail: reporterEmail,
          title: 'Bug Report Resolved',
          message: 'Your bug report has been resolved. Thank you for helping us improve!',
          type: 'system',
          relatedId: parsedId,
          relatedType: 'bug_report',
          url: '/member/profile'
        }).catch(err => logger.error('Failed to send bug report resolution notification', { extra: { error: getErrorMessage(err) } }));
      }
    }
    
    logFromRequest(req, 'update_bug_report', 'bug_report', String(id), undefined, { status: req.body.status });
    res.json(updated);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to update bug report', error);
  }
});

router.delete('/api/admin/bug-reports/:id', isStaffOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const idParse = numericIdParam.safeParse(id);
    if (!idParse.success) return res.status(400).json({ error: 'Invalid bug report ID' });
    const parsedId = parseInt(idParse.data, 10);
    if (isNaN(parsedId)) return logAndRespond(req, res, 400, 'Invalid bug report ID');
    
    const [deleted] = await db.delete(bugReports)
      .where(eq(bugReports.id, parsedId))
      .returning();
    
    if (!deleted) {
      return logAndRespond(req, res, 404, 'Bug report not found');
    }
    
    logFromRequest(req, 'delete_bug_report', 'bug_report', String(id), undefined, {});
    res.json({ success: true });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to delete bug report', error);
  }
});

export default router;
