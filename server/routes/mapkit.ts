import { Router } from 'express';
import * as jose from 'jose';
import rateLimit from 'express-rate-limit';
import { logger } from '../core/logger';

const router = Router();

const APPLE_TEAM_ID = process.env.APPLE_MAPKIT_TEAM_ID;
const MAPKIT_KEY_ID = process.env.APPLE_MAPKIT_KEY_ID;
const MAPKIT_PRIVATE_KEY = process.env.APPLE_MAPKIT_PRIVATE_KEY;
const MAPKIT_SUBJECT = process.env.APPLE_MAPKIT_SUBJECT || 'com.joinever.club';

const mapkitTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token requests, please try again later' },
});

let cachedToken: { jwt: string; expiresAt: number } | null = null;

router.get('/api/mapkit-token', mapkitTokenLimiter, async (_req, res) => {
  try {
    if (!APPLE_TEAM_ID || !MAPKIT_KEY_ID || !MAPKIT_PRIVATE_KEY) {
      return res.status(503).json({ error: 'MapKit JS is not configured' });
    }

    const now = Math.floor(Date.now() / 1000);
    if (cachedToken && cachedToken.expiresAt > now + 60) {
      return res.json({ token: cachedToken.jwt });
    }

    const keyPem = MAPKIT_PRIVATE_KEY.replace(/\\n/g, '\n');
    const privateKey = await jose.importPKCS8(keyPem, 'ES256');

    const expiresAt = now + 30 * 60;
    const token = await new jose.SignJWT({
      origin: process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : process.env.APP_URL || 'https://app.joinever.club',
    })
      .setProtectedHeader({ alg: 'ES256', kid: MAPKIT_KEY_ID, typ: 'JWT' })
      .setIssuer(APPLE_TEAM_ID)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .setSubject(MAPKIT_SUBJECT)
      .sign(privateKey);

    cachedToken = { jwt: token, expiresAt };
    res.json({ token });
  } catch (error: unknown) {
    logger.error('Failed to generate MapKit token', error);
    res.status(500).json({ error: 'Failed to generate MapKit token' });
  }
});

export default router;
