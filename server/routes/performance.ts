import { Router } from 'express';
import { isStaffOrAdmin } from '../core/middleware';
import { getPerformanceSummary, clearPerformanceData } from '../core/performanceCollector';

const router = Router();

router.get('/api/admin/performance', isStaffOrAdmin, (req, res) => {
  const sinceMinutes = parseInt(req.query.since as string, 10);
  const sinceMs = !isNaN(sinceMinutes) && sinceMinutes > 0
    ? Date.now() - sinceMinutes * 60_000
    : undefined;

  const summary = getPerformanceSummary(sinceMs);
  res.json(summary);
});

router.post('/api/admin/performance/clear', isStaffOrAdmin, (_req, res) => {
  clearPerformanceData();
  res.json({ cleared: true });
});

export default router;
