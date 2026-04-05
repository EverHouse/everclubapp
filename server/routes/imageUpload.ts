import { Router } from 'express';
import multer from 'multer';
import sharp from 'sharp';
import { isStaffOrAdmin } from '../core/middleware';
import { ObjectStorageService } from '../replit_integrations/object_storage';
import { logger } from '../core/logger';
import { getErrorMessage } from '../utils/errorUtils';

const router = Router();
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type: ${file.mimetype}. Only JPEG, PNG, WebP, GIF, and AVIF are allowed.`));
    }
  }
});

const objectStorageService = new ObjectStorageService();

router.post('/api/admin/upload-image', isStaffOrAdmin, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    const originalName = req.file.originalname.replace(/\.[^/.]+$/, '');
    const timestamp = Date.now();
    const filename = `${originalName}-${timestamp}.webp`;

    const webpBuffer = await sharp(req.file.buffer, { limitInputPixels: 268402689 })
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    
    const uploadResponse = await fetch(uploadURL, {
      method: 'PUT',
      body: webpBuffer,
      headers: { 'Content-Type': 'image/webp' },
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload to storage');
    }

    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const publicUrl = `/objects${objectPath.replace('/objects', '')}`;

    res.json({ 
      success: true, 
      imageUrl: publicUrl,
      objectPath,
      filename,
      originalSize: req.file.size,
      optimizedSize: webpBuffer.length
    });
  } catch (error: unknown) {
    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: error.message });
    }
    const msg = getErrorMessage(error);
    if (msg.includes('Invalid file type')) {
      return res.status(400).json({ error: msg });
    }
    logger.error('Image upload error', { extra: { error: msg } });
    res.status(500).json({ error: 'Failed to upload and convert image' });
  }
});

export default router;
