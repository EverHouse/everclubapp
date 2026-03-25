import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import { isStaffOrAdmin } from '../../core/middleware';
import { importTrackmanBookings, getImportRuns, rescanUnmatchedBookings } from '../../core/trackmanImport';
import { logFromRequest } from '../../core/auditLog';
import { logger, logAndRespond } from '../../core/logger';
import { getErrorMessage } from '../../utils/errorUtils';
import { getSessionUser } from '../../types/session';

const router = Router();

const uploadDir = path.join(process.cwd(), 'uploads', 'trackman');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_\-.]/g, '_');
    cb(null, `trackman_${timestamp}_${safeName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'));
    }
  }
});

router.get('/api/admin/trackman/import-runs', isStaffOrAdmin, async (req, res) => {
  try {
    const runs = await getImportRuns();
    res.json(runs);
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to fetch import runs', error);
  }
});

router.post('/api/admin/trackman/import', isStaffOrAdmin, async (req, res) => {
  try {
    const { filename } = req.body;
    const user = getSessionUser(req)?.email || 'admin';
    
    const safeFilename = path.basename(filename || 'trackman_bookings_1767009308200.csv');
    if (!safeFilename.endsWith('.csv') || !/^[a-zA-Z0-9_\-.]+$/.test(safeFilename)) {
      return logAndRespond(req, res, 400, 'Invalid filename format');
    }
    
    const csvPath = path.join(process.cwd(), 'uploads', 'trackman', safeFilename);
    
    const result = await importTrackmanBookings(csvPath, user);
    
    await logFromRequest(req, 'import_trackman', 'trackman', undefined, 'Trackman CSV Import', {
      filename: safeFilename,
      bookingsImported: result.matchedRows || 0,
      sessionsCreated: result.totalRows || 0
    });
    
    res.json({
      success: true,
      ...result
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to import bookings', error);
  }
});

router.post('/api/admin/trackman/upload', isStaffOrAdmin, upload.single('file'), async (req, res) => {
  let csvPath: string | undefined;
  try {
    if (!req.file) {
      return logAndRespond(req, res, 400, 'No file uploaded');
    }
    
    const user = getSessionUser(req)?.email || 'admin';
    csvPath = req.file.path;
    
    const result = await importTrackmanBookings(csvPath, user);
    
    res.json({
      success: true,
      filename: req.file.filename,
      ...result
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to upload and import bookings', error);
  } finally {
    if (csvPath && fs.existsSync(csvPath)) {
      try {
        fs.unlinkSync(csvPath);
      } catch (cleanupErr) {
        logger.error('Failed to cleanup uploaded file', { extra: { error: getErrorMessage(cleanupErr) } });
      }
    }
  }
});

router.post('/api/admin/trackman/rescan', isStaffOrAdmin, async (req, res) => {
  try {
    const user = getSessionUser(req)?.email || 'admin';
    const result = await rescanUnmatchedBookings(user);
    
    await logFromRequest(req, {
      action: 'trackman_rescan',
      resourceType: 'trackman_booking',
      resourceName: 'Unmatched Bookings Rescan',
      details: { matched: result.matched, lessonsConverted: result.lessonsConverted, scanned: result.scanned }
    });
    
    const parts: string[] = [];
    if (result.matched > 0) parts.push(`Matched ${result.matched} booking(s) to members`);
    if (result.lessonsConverted > 0) parts.push(`Converted ${result.lessonsConverted} lesson(s) to availability blocks`);
    const message = parts.length > 0 ? parts.join('. ') : 'No new matches or lessons found';
    
    res.json({
      success: true,
      message,
      ...result
    });
  } catch (error: unknown) {
    logAndRespond(req, res, 500, 'Failed to rescan unmatched bookings', error);
  }
});

export default router;
