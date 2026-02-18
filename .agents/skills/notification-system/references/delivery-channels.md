# Delivery Channels Reference

Detailed step-by-step for each notification delivery channel in `server/core/notificationService.ts`.

## DeliveryResult Interface

```ts
interface DeliveryResult {
  channel: 'database' | 'websocket' | 'push' | 'email';
  success: boolean;
  error?: string;
  details?: Record<string, any>;
}

interface NotificationResult {
  notificationId?: number;
  deliveryResults: DeliveryResult[];
  allSucceeded: boolean;
}
```

Every channel produces a `DeliveryResult`. The `NotificationResult` aggregates all results and sets `allSucceeded` to true only when every delivery succeeds.

## Channel 1: Database Insertion

**Function:** `insertNotificationToDatabase(payload)`

### Validation

Check all required fields before inserting:
- `userEmail` — must be truthy
- `title` — must be truthy
- `message` — must be truthy
- `type` — must be truthy

If any field is missing, log an error with event `notification.insert_missing_fields` and return `null`.

### Defensive relatedId Handling

```ts
const safeRelatedId = typeof payload.relatedId === 'number' ? payload.relatedId : null;
const safeRelatedType = payload.relatedType && typeof payload.relatedType === 'string' ? payload.relatedType : null;
```

The `relatedId` column is an integer. Empty strings, `undefined`, or non-number values become `null` to prevent database type errors.

### Insert

Use Drizzle ORM `db.insert(notifications).values({...}).returning({ id: notifications.id })`.

### Error Handling

Catch all errors, log with event `notification.database_insert_failed`, and return `null`. The caller treats `null` as a failed database delivery.

## Channel 2: WebSocket Delivery

**Function:** `deliverViaWebSocket(payload)`

### Connection Lookup

Call `sendNotificationToUser(email, notification)` from `websocket.ts`:
1. Normalize email to lowercase.
2. Look up `clients.get(email)` — the connection map.
3. Check if any connection has `readyState === WebSocket.OPEN`.

### JSON Serialization

Serialize the notification payload:
```ts
const payload = JSON.stringify({
  type: 'notification',
  title: notification.title,
  message: notification.message,
  data: {
    notificationType: payload.type,
    relatedId: payload.relatedId,
    relatedType: payload.relatedType
  }
});
```

### Delivery Result Tracking

The `sendNotificationToUser` function returns a `NotificationDeliveryResult`:
```ts
interface NotificationDeliveryResult {
  success: boolean;
  connectionCount: number;
  sentCount: number;
  hasActiveSocket: boolean;
}
```

- `success` is true if `sentCount > 0`.
- If no connections exist, success is false but the notification still persists in the database.
- Individual send errors per connection are logged but do not fail the entire WebSocket delivery.

### Logging

Log with structured events:
- `notification.websocket_delivered` — at least one connection received the message.
- `notification.websocket_no_connection` — no active connections for this email.
- `notification.websocket_failed` — exception during delivery attempt.

## Channel 3: Push Delivery

**Function:** `deliverViaPush(userEmail, payload)`

### VAPID Setup Check

Return early with `{ success: false, error: 'VAPID keys not configured' }` if `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` environment variables are missing.

### Subscription Lookup

Query `push_subscriptions` table for matching `user_email`:
```ts
const subscriptions = await db
  .select({ endpoint, p256dh, auth })
  .from(pushSubscriptions)
  .where(eq(pushSubscriptions.userEmail, userEmail));
```

If no subscriptions found, return `{ success: true, details: { reason: 'no_subscriptions', count: 0 } }`. This is not an error — the user simply has not subscribed.

### Parallel Send

Use `Promise.all` to send to all subscriptions in parallel:
```ts
const pushSubscription = {
  endpoint: sub.endpoint,
  keys: { p256dh: sub.p256dh, auth: sub.auth }
};
await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
```

Track `successCount` and `failCount` across all subscription attempts.

### Stale Endpoint Cleanup (HTTP 410)

When a push endpoint returns HTTP 410 (Gone), the browser has unsubscribed. Collect stale endpoints and batch-delete:
```ts
if (getErrorStatusCode(err) === 410) {
  staleEndpoints.push(sub.endpoint);
}
// After all sends:
await db.delete(pushSubscriptions)
  .where(inArray(pushSubscriptions.endpoint, staleEndpoints));
```

Log with event `notification.push_stale_removed`.

### Result

Return `{ success: !allFailed }` where `allFailed = successCount === 0 && subscriptions.length > 0`.

## Channel 4: Email Delivery

**Function:** `deliverViaEmail(to, subject, html)`

### Prerequisites

Email delivery only runs when ALL conditions are met in `notifyMember()`:
- `sendEmail` option is `true`
- `emailSubject` is provided
- `emailHtml` is provided

### Resend Client

```ts
const { client, fromEmail } = await getResendClient();
await client.emails.send({
  from: fromEmail || 'Ever Club <noreply@everclub.app>',
  to,
  subject,
  html
});
```

The `getResendClient()` function returns the configured Resend instance and default from address.

### Error Handling

Catch all errors, log with event `notification.email_failed`, return `DeliveryResult` with `success: false`.

## Staff Notification Flow

**Function:** `notifyAllStaff(title, message, type, options?)`

### Step 1: Query Staff

```ts
const staffEmails = await db.select({ email: staffUsers.email })
  .from(staffUsers)
  .where(eq(staffUsers.isActive, true));
```

If no active staff found, log warning and return early.

### Step 2: Batch Insert

Build notification values for all staff emails with defensive `relatedId` handling (same pattern as single-member insert). Insert all rows in a single `db.insert(notifications).values(notificationValues)`.

### Step 3: broadcastToStaff (WebSocket)

Call `broadcastToStaff()` which iterates all connections and sends to those with `isStaff === true` and `readyState === WebSocket.OPEN`.

### Step 4: deliverPushToStaff

Query push subscriptions joined with `users` table filtering for `admin`/`staff` roles:
```ts
const staffSubscriptions = await db
  .selectDistinct({ userEmail, endpoint, p256dh, auth })
  .from(pushSubscriptions)
  .innerJoin(users, eq(pushSubscriptions.userEmail, users.email))
  .where(inArray(users.role, ['admin', 'staff']));
```

Send in parallel with same 410 stale-endpoint cleanup pattern.

## notifyMember() Orchestration Summary

```
notifyMember(payload, options)
  │
  ├── 1. Validate payload fields
  │
  ├── 2. insertNotificationToDatabase(payload)
  │      → DeliveryResult { channel: 'database' }
  │
  ├── 3. if sendWebSocket:
  │      deliverViaWebSocket(payload)
  │      → DeliveryResult { channel: 'websocket' }
  │
  ├── 4. if sendPush:
  │      deliverViaPush(email, { title, body, url, tag })
  │      → DeliveryResult { channel: 'push' }
  │
  ├── 5. if sendEmail && emailSubject && emailHtml:
  │      deliverViaEmail(email, subject, html)
  │      → DeliveryResult { channel: 'email' }
  │
  └── return NotificationResult {
        notificationId,
        deliveryResults[],
        allSucceeded
      }
```

## Legacy Staff Notifications

**File:** `server/core/staffNotifications.ts`

Contains `notifyAllStaff()` and `notifyMemberRequired()` — these only do database inserts, no WebSocket or push delivery. Prefer `notifyMember()` and `notifyAllStaff()` from `notificationService.ts` for full 3-channel delivery.
