import { Router } from 'express';
import webhookRouter, { cleanupOldWebhookLogs } from './webhook-index';
import adminRouter from './admin';
import importRouter from './import';
import reconciliationRouter from './reconciliation';

const router = Router();

router.use(webhookRouter);
router.use(adminRouter);
router.use(importRouter);
router.use(reconciliationRouter);

export { cleanupOldWebhookLogs };

export default router;
