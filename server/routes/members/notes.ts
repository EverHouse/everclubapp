import { Router } from 'express';
import { eq, sql, desc, and } from 'drizzle-orm';
import { db } from '../../db';
import { memberNotes } from '../../../shared/schema';
import { isStaffOrAdmin } from '../../core/middleware';
import { getSessionUser } from '../../types/session';
import { logFromRequest } from '../../core/auditLog';
import { logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { numericIdParam, requiredStringParam } from '../../middleware/paramSchemas';

const router = Router();

router.get('/api/members/:email/notes', isStaffOrAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const emailParse = requiredStringParam.safeParse(email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const normalizedEmail = decodeURIComponent(emailParse.data).trim().toLowerCase();
    
    const notes = await db.select()
      .from(memberNotes)
      .where(sql`LOWER(${memberNotes.memberEmail}) = ${normalizedEmail}`)
      .orderBy(desc(memberNotes.isPinned), desc(memberNotes.createdAt))
      .limit(200);
    
    res.json(notes);
  } catch (error: unknown) {
    logger.error('Member notes error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch member notes' });
  }
});

router.post('/api/members/:email/notes', isStaffOrAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const { content, isPinned } = req.body;
    const sessionUser = getSessionUser(req);
    
    if (!content?.trim()) {
      return res.status(400).json({ error: 'Note content is required' });
    }
    
    const emailParse = requiredStringParam.safeParse(email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const normalizedEmail = decodeURIComponent(emailParse.data).trim().toLowerCase();
    
    const result = await db.insert(memberNotes)
      .values({
        memberEmail: normalizedEmail,
        content: content.trim(),
        createdBy: sessionUser?.email || 'unknown',
        createdByName: sessionUser?.firstName 
          ? `${sessionUser.firstName} ${sessionUser.lastName || ''}`.trim() 
          : sessionUser?.email?.split('@')[0] || 'Staff',
        isPinned: isPinned || false,
      })
      .returning();
    
    logFromRequest(req, 'create_note', 'note', String(result[0].id), normalizedEmail);
    res.status(201).json(result[0]);
  } catch (error: unknown) {
    logger.error('Create note error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to create note' });
  }
});

router.put('/api/members/:email/notes/:noteId', isStaffOrAdmin, async (req, res) => {
  try {
    const { email, noteId } = req.params;
    const noteIdParse = numericIdParam.safeParse(noteId);
    if (!noteIdParse.success) return res.status(400).json({ error: 'Invalid note ID' });
    const parsedNoteId = parseInt(noteIdParse.data, 10);
    const { content, isPinned } = req.body;
    const emailParse = requiredStringParam.safeParse(email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const normalizedEmail = decodeURIComponent(emailParse.data).trim().toLowerCase();
    
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (content !== undefined) updateData.content = content.trim();
    if (isPinned !== undefined) updateData.isPinned = isPinned;
    
    const result = await db.update(memberNotes)
      .set(updateData)
      .where(and(
        eq(memberNotes.id, parsedNoteId),
        sql`LOWER(${memberNotes.memberEmail}) = ${normalizedEmail}`
      ))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Note not found' });
    }
    
    logFromRequest(req, 'update_note', 'note', noteIdParse.data, normalizedEmail);
    res.json(result[0]);
  } catch (error: unknown) {
    logger.error('Update note error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to update note' });
  }
});

router.delete('/api/members/:email/notes/:noteId', isStaffOrAdmin, async (req, res) => {
  try {
    const { email, noteId } = req.params;
    const noteIdParse = numericIdParam.safeParse(noteId);
    if (!noteIdParse.success) return res.status(400).json({ error: 'Invalid note ID' });
    const parsedNoteId = parseInt(noteIdParse.data, 10);
    const emailParse = requiredStringParam.safeParse(email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const normalizedEmail = decodeURIComponent(emailParse.data).trim().toLowerCase();
    
    const result = await db.delete(memberNotes)
      .where(and(
        eq(memberNotes.id, parsedNoteId),
        sql`LOWER(${memberNotes.memberEmail}) = ${normalizedEmail}`
      ))
      .returning();
    
    if (result.length === 0) {
      return res.status(404).json({ error: 'Note not found for this member' });
    }
    
    logFromRequest(req, 'delete_note', 'note', noteIdParse.data, normalizedEmail);
    res.json({ success: true });
  } catch (error: unknown) {
    logger.error('Delete note error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

export default router;
