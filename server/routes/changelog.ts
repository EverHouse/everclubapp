import { Router } from 'express';
import { isStaffOrAdmin } from '../core/middleware';

const router = Router();

let cachedChangelog: Array<{
  version: string;
  date: string;
  title: string;
  isMajor?: boolean;
  changes: string[];
}> | null = null;

async function loadChangelog() {
  if (cachedChangelog) return cachedChangelog;
  const { changelog } = await import('../../src/data/changelog');
  cachedChangelog = changelog;
  return cachedChangelog;
}

router.get('/api/changelog', isStaffOrAdmin, async (_req, res) => {
  try {
    const data = await loadChangelog();
    res.json({ entries: data });
  } catch (err) {
    console.error('[Changelog] Failed to load changelog data:', err);
    res.status(500).json({ error: 'Failed to load changelog' });
  }
});

export default router;
