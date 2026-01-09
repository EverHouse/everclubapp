import { getResendClient } from '../utils/resend';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';

const ALERT_EMAIL = process.env.ALERT_EMAIL || 'nick@evenhouse.club';
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes between same-type alerts (increased from 5)
const MAX_ALERTS_PER_HOUR = 4; // Reduced from 10
const MAX_ALERTS_PER_DAY = 20; // New daily limit to prevent overnight floods
const RATE_LIMIT_FILE = '/tmp/alert_rate_limits.json';

interface AlertRecord {
  lastSent: number;
  count: number;
}

interface RateLimitState {
  alertHistory: Record<string, AlertRecord>;
  alertsThisHour: number;
  alertsToday: number;
  hourStart: number;
  dayStart: number;
}

function loadRateLimitState(): RateLimitState {
  try {
    if (fs.existsSync(RATE_LIMIT_FILE)) {
      const data = JSON.parse(fs.readFileSync(RATE_LIMIT_FILE, 'utf-8'));
      return {
        alertHistory: data.alertHistory || {},
        alertsThisHour: data.alertsThisHour || 0,
        alertsToday: data.alertsToday || 0,
        hourStart: data.hourStart || Date.now(),
        dayStart: data.dayStart || Date.now(),
      };
    }
  } catch (error) {
    logger.warn('[ErrorAlert] Failed to load rate limit state, using defaults');
  }
  return {
    alertHistory: {},
    alertsThisHour: 0,
    alertsToday: 0,
    hourStart: Date.now(),
    dayStart: Date.now(),
  };
}

function saveRateLimitState(state: RateLimitState): void {
  try {
    fs.writeFileSync(RATE_LIMIT_FILE, JSON.stringify(state, null, 2));
  } catch (error) {
    logger.warn('[ErrorAlert] Failed to save rate limit state');
  }
}

let state = loadRateLimitState();

function getAlertKey(type: string, context?: string): string {
  return `${type}:${context || 'general'}`;
}

function canSendAlert(key: string): boolean {
  const now = Date.now();
  
  // Reset hourly counter
  if (now - state.hourStart > 60 * 60 * 1000) {
    state.hourStart = now;
    state.alertsThisHour = 0;
  }
  
  // Reset daily counter
  if (now - state.dayStart > 24 * 60 * 60 * 1000) {
    state.dayStart = now;
    state.alertsToday = 0;
  }
  
  // Check daily limit first
  if (state.alertsToday >= MAX_ALERTS_PER_DAY) {
    logger.info('[ErrorAlert] Daily limit reached, skipping alert', {
      extra: { event: 'error_alert.daily_limit', alertsToday: state.alertsToday }
    });
    return false;
  }
  
  // Check hourly limit
  if (state.alertsThisHour >= MAX_ALERTS_PER_HOUR) {
    return false;
  }
  
  // Check per-key cooldown
  const record = state.alertHistory[key];
  if (record && (now - record.lastSent) < ALERT_COOLDOWN_MS) {
    return false;
  }
  
  return true;
}

function recordAlertSent(key: string): void {
  const now = Date.now();
  const existing = state.alertHistory[key];
  
  state.alertHistory[key] = {
    lastSent: now,
    count: (existing?.count || 0) + 1
  };
  
  state.alertsThisHour++;
  state.alertsToday++;
  
  // Persist to file so limits survive restarts
  saveRateLimitState(state);
}

export type AlertType = 
  | 'server_error'
  | 'database_error'
  | 'external_service_error'
  | 'booking_failure'
  | 'payment_failure'
  | 'security_alert';

interface AlertOptions {
  type: AlertType;
  title: string;
  message: string;
  context?: string;
  details?: Record<string, any>;
  userEmail?: string;
  requestId?: string;
}

export async function sendErrorAlert(options: AlertOptions): Promise<boolean> {
  const { type, title, message, context, details, userEmail, requestId } = options;
  const key = getAlertKey(type, context);
  
  if (!canSendAlert(key)) {
    logger.info('[ErrorAlert] Alert rate-limited', {
      extra: { event: 'error_alert.rate_limited', type, context }
    });
    return false;
  }
  
  try {
    const { client, fromEmail } = await getResendClient();
    
    const detailsHtml = details 
      ? Object.entries(details)
          .map(([k, v]) => `<li><strong>${k}:</strong> ${typeof v === 'object' ? JSON.stringify(v) : v}</li>`)
          .join('')
      : '';
    
    const timestamp = new Date().toLocaleString('en-US', { 
      timeZone: 'America/Los_Angeles',
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    
    await client.emails.send({
      from: fromEmail || 'Ever House Members Club <noreply@everhouse.app>',
      to: ALERT_EMAIL,
      subject: `[Alert] ${title}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 20px; background: #f5f5f5;">
          <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <div style="border-left: 4px solid #dc2626; padding-left: 16px; margin-bottom: 20px;">
              <h2 style="margin: 0 0 8px 0; color: #dc2626;">${title}</h2>
              <p style="margin: 0; color: #666; font-size: 14px;">${timestamp} PT</p>
            </div>
            
            <div style="margin-bottom: 20px;">
              <p style="margin: 0; color: #333; line-height: 1.6;">${message}</p>
            </div>
            
            <div style="background: #f8f9fa; border-radius: 6px; padding: 16px; font-size: 14px;">
              <p style="margin: 0 0 8px 0; font-weight: 600; color: #333;">Details:</p>
              <ul style="margin: 0; padding-left: 20px; color: #555;">
                <li><strong>Type:</strong> ${type}</li>
                ${userEmail ? `<li><strong>User:</strong> ${userEmail}</li>` : ''}
                ${requestId ? `<li><strong>Request ID:</strong> ${requestId}</li>` : ''}
                ${detailsHtml}
              </ul>
            </div>
            
            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #eee; font-size: 12px; color: #888;">
              <p style="margin: 0;">This is an automated alert from the Ever House app. Max ${MAX_ALERTS_PER_DAY}/day, ${MAX_ALERTS_PER_HOUR}/hour.</p>
            </div>
          </div>
        </body>
        </html>
      `
    });
    
    recordAlertSent(key);
    
    logger.info('[ErrorAlert] Alert sent successfully', {
      extra: { event: 'error_alert.sent', type, title, alertsToday: state.alertsToday }
    });
    
    return true;
  } catch (error) {
    logger.error('[ErrorAlert] Failed to send alert email', {
      error: error instanceof Error ? error.message : String(error),
      extra: { event: 'error_alert.failed', type }
    });
    return false;
  }
}

export async function alertOnServerError(
  error: Error,
  context: { path?: string; method?: string; userEmail?: string; requestId?: string }
): Promise<void> {
  await sendErrorAlert({
    type: 'server_error',
    title: 'Server Error',
    message: error.message,
    context: context.path,
    details: {
      path: context.path,
      method: context.method,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    },
    userEmail: context.userEmail,
    requestId: context.requestId
  });
}

export async function alertOnExternalServiceError(
  service: string,
  error: Error,
  operation?: string
): Promise<void> {
  await sendErrorAlert({
    type: 'external_service_error',
    title: `${service} Service Error`,
    message: `Failed during: ${operation || 'unknown operation'}`,
    context: service,
    details: {
      service,
      operation,
      error: error.message
    }
  });
}

export async function alertOnBookingFailure(
  userEmail: string,
  reason: string,
  bookingDetails?: Record<string, any>
): Promise<void> {
  await sendErrorAlert({
    type: 'booking_failure',
    title: 'Booking System Failure',
    message: reason,
    context: 'booking',
    details: bookingDetails,
    userEmail
  });
}
