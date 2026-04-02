import { logger } from './logger';
import webpush from 'web-push';
import { db } from '../db';
import { pushSubscriptions, users } from '../../shared/schema';
import { eq, inArray } from 'drizzle-orm';
import { getErrorMessage, getErrorStatusCode } from '../utils/errorUtils';

const vapidConfigured = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

if (vapidConfigured) {
  webpush.setVapidDetails(
    'mailto:hello@everclub.app',
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
}

export function isPushNotificationsEnabled(): boolean {
  return vapidConfigured;
}

const PUSH_ICON = '/icon-192.png';
const PUSH_BADGE = '/badge-72.png';

export async function sendPushNotification(userEmail: string, payload: { title: string; body: string; url?: string; tag?: string; icon?: string; badge?: string }): Promise<{ sent: boolean; reason?: string }> {
  if (!vapidConfigured) {
    return { sent: false, reason: 'VAPID not configured' };
  }
  
  try {
    const subs = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userEmail, userEmail));
    
    if (subs.length === 0) {
      return { sent: false, reason: 'No push subscriptions' };
    }
    
    let successCount = 0;
    let failCount = 0;
    const pushResults = subs.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };
      
      const enrichedPayload = { ...payload, icon: payload.icon || PUSH_ICON, badge: payload.badge || PUSH_BADGE };
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(enrichedPayload));
        successCount++;
      } catch (err: unknown) {
        failCount++;
        if (getErrorStatusCode(err) === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
        }
      }
    });
    
    await Promise.all(pushResults);
    const allFailed = successCount === 0 && subs.length > 0;
    return { sent: !allFailed, reason: allFailed ? 'All push subscriptions failed' : undefined };
  } catch (error: unknown) {
    logger.error('Failed to send push notification', { extra: { error: getErrorMessage(error) } });
    return { sent: false, reason: 'Error sending push' };
  }
}

export async function sendPushNotificationToStaff(payload: { title: string; body: string; url?: string; tag?: string; icon?: string; badge?: string }): Promise<{ sent: boolean; count: number; reason?: string }> {
  if (!vapidConfigured) {
    return { sent: false, count: 0, reason: 'VAPID not configured' };
  }
  
  try {
    const staffSubscriptions = await db
      .selectDistinct({
        id: pushSubscriptions.id,
        userEmail: pushSubscriptions.userEmail,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .innerJoin(users, eq(pushSubscriptions.userEmail, users.email))
      .where(inArray(users.role, ['admin', 'staff']));
    
    if (staffSubscriptions.length === 0) {
      return { sent: false, count: 0, reason: 'No staff subscriptions' };
    }
    
    const notifications = staffSubscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth
        }
      };
      
      const enrichedPayload = { ...payload, icon: payload.icon || PUSH_ICON, badge: payload.badge || PUSH_BADGE };
      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(enrichedPayload));
      } catch (err: unknown) {
        if (getErrorStatusCode(err) === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, sub.endpoint));
        }
      }
    });
    
    await Promise.all(notifications);
    return { sent: true, count: staffSubscriptions.length };
  } catch (error: unknown) {
    logger.error('Failed to send push notification to staff', { extra: { error: getErrorMessage(error) } });
    return { sent: false, count: 0, reason: 'Error sending push' };
  }
}
