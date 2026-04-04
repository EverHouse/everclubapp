import { Router } from 'express';
import { isStaffOrAdmin } from '../../core/middleware';
import { getConsentHistory, backfillConsentBaseline } from '../../core/consentService';
import { logger } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { requiredStringParam } from '../../middleware/paramSchemas';
import { sensitiveActionRateLimiter, memberLookupRateLimiter } from '../../middleware/rateLimiting';

const router = Router();

router.get('/api/members/:email/consent-history', memberLookupRateLimiter, isStaffOrAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const emailParse = requiredStringParam.safeParse(email);
    if (!emailParse.success) return res.status(400).json({ error: 'Invalid email parameter' });
    const normalizedEmail = decodeURIComponent(emailParse.data).trim().toLowerCase();

    const history = await getConsentHistory(normalizedEmail);
    res.json(history);
  } catch (error: unknown) {
    logger.error('Consent history fetch error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Failed to fetch consent history' });
  }
});

router.post('/api/admin/consent/backfill', sensitiveActionRateLimiter, isStaffOrAdmin, async (req, res) => {
  try {
    const result = await backfillConsentBaseline();
    res.json({ success: true, ...result });
  } catch (error: unknown) {
    logger.error('Consent backfill error', { extra: { error: getErrorMessage(error) } });
    res.status(500).json({ error: 'Backfill failed' });
  }
});

export default router;
