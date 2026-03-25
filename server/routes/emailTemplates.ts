import { Router } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { getAllTemplates, renderTemplatePreview } from '../core/emailTemplatePreview';
import { logFromRequest } from '../core/auditLog';
import { logAndRespond } from '../core/logger';

const router = Router();

router.get('/api/admin/email-templates', isStaffOrAdmin, async (req, res) => {
  try {
    const templates = getAllTemplates();
    res.json({ templates });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch email templates', error);
  }
});

router.get('/api/admin/email-templates/:templateId/preview', isStaffOrAdmin, async (req, res) => {
  try {
    const { templateId } = req.params;
    const html = await renderTemplatePreview(templateId as string);

    if (!html) {
      return res.status(404).json({ error: 'Template not found' });
    }

    logFromRequest(req, 'view_email_template', 'system', templateId as string, `Email template preview: ${templateId}`);

    res.json({ html });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to render template preview', error);
  }
});

export default router;
