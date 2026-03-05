import { isProduction } from '../core/db';

const PRODUCTION_URL = 'https://everclub.app';

export function getAppBaseUrl(): string {
  if (isProduction) return PRODUCTION_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  return 'http://localhost:5000';
}
