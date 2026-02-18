# WebSocket Architecture Reference

Detailed architecture for the WebSocket server in `server/core/websocket.ts`.

## Server Initialization

```ts
export function initWebSocketServer(server: Server) {
  wss = new WebSocketServer({ server, path: '/ws' });
  // ...
}
```

Bind to the HTTP server on the `/ws` path. Returns the `WebSocketServer` instance.

### Origin Validation

`isAllowedOrigin(origin)` checks the `Origin` header against:
- Replit domains: `*.replit.app`, `*.replit.dev`, `*.repl.co`
- Localhost: `localhost`, `127.0.0.1`
- Production domains: `everclub.app`, `everhouse.app`, and subdomains
- Custom domains from `ALLOWED_ORIGINS` env var (comma-separated)

Reject connections from disallowed origins with code `4003` ("Forbidden origin").

## Authentication Flow

### Primary: Cookie-Based Session Verification

On each new connection, attempt session-based auth immediately:

1. **parseSessionId(cookieHeader, sessionSecret):** Extract `connect.sid` cookie value. If it starts with `s:`, strip the prefix and signature (split on `.`). Return the raw session ID.

2. **verifySessionFromDatabase(sessionId):** Query the `sessions` table:
   ```sql
   SELECT sess FROM sessions WHERE sid = $1 AND expire > NOW()
   ```
   Uses a dedicated `Pool` with `max: 5` connections and 5s connection timeout.

3. **getVerifiedUserFromRequest(req):** Combine steps 1–2. Extract email and role from `sess.user`. Determine `isStaff` from role being `admin` or `staff`. Return `{ email, role, isStaff, sessionId }` or `null`.

If session verification succeeds on connection:
- Create `ClientConnection` and add to the `clients` map.
- If staff, add to `staffEmails` set.
- Send `{ type: 'auth_success', email, verified: true }`.

### Fallback: Auth Message

If cookie verification fails on connection:
- Start a 10-second auth timeout (`AUTH_TIMEOUT_MS = 10000`).
- Close connection with code `4001` ("Authentication timeout") if no valid auth within timeout.

On receiving an `auth` message from an unauthenticated client:
- Increment `authAttempts` (max `MAX_AUTH_ATTEMPTS = 3`).
- If exceeded, close with code `4003` ("Too many authentication attempts").
- Retry `getVerifiedUserFromRequest(req)` — the client may have logged in since connecting.
- On success, register the connection as authenticated.
- On failure, send `{ type: 'auth_error', message, attemptsRemaining }`.
- If all 3 attempts exhausted, close with code `4002` ("Authentication failed").

## Connection Management

### Data Structures

```ts
const clients: Map<string, ClientConnection[]> = new Map();
const staffEmails: Set<string> = new Set();
```

- `clients` maps lowercase email → array of `ClientConnection`. Multiple connections per user (multiple tabs/devices).
- `staffEmails` tracks which emails belong to staff for targeted broadcasts.

### ClientConnection Interface

```ts
interface ClientConnection {
  ws: WebSocket;
  userEmail: string;
  isAlive: boolean;
  isStaff: boolean;
  sessionId?: string;
}
```

### Connection Lifecycle

**On connect:** Add connection to the user's array in `clients`. If staff, add email to `staffEmails`.

**On disconnect:** Remove the specific `ws` from the user's connection array. If no connections remain for that email, delete the entry from `clients` and remove from `staffEmails`.

## Message Types

### Inbound (client → server)

| Type | When | Handler |
|---|---|---|
| `auth` | Unauthenticated client attempting login | Verify session, register connection |
| `auth` | Already authenticated client | Respond with `auth_success` (no-op) |
| `staff_register` | Authenticated user claiming staff role | Verify role via session, add to staff set |
| `ping` | Client keepalive | Respond with `{ type: 'pong' }` |

### Outbound (server → client)

| Type | Purpose |
|---|---|
| `auth_success` | Confirm successful authentication |
| `auth_error` | Report failed auth attempt with remaining attempts |
| `error` | Generic error (e.g., message from unauthenticated client) |
| `pong` | Response to client ping |
| `notification` | Notification payload from broadcasts |
| `booking_event` | Real-time booking event (staff only) |
| `announcement_update` | Announcement CRUD events |
| `availability_update` | Booking availability changes |
| `waitlist_update` | Waitlist spot changes |
| `directory_update` | Member directory sync events (staff only) |
| `member_stats_updated` | Guest pass/visit count changes |
| `closure_update` | Facility closure changes |
| `billing_update` | Payment/subscription events |
| `tier_update` | Membership tier changes |
| `member_data_updated` | Bulk member data sync (staff only) |
| `day_pass_update` | Day pass purchase/redemption (staff only) |
| `cafe_menu_update` | Café menu changes |
| `data_integrity_update` | Data integrity check results (staff only) |

## Heartbeat

```ts
const heartbeatInterval = setInterval(() => {
  clients.forEach((connections, email) => {
    const alive: ClientConnection[] = [];
    connections.forEach((conn) => {
      if (!conn.isAlive) {
        conn.ws.terminate();
        return;
      }
      conn.isAlive = false;
      conn.ws.ping();
      alive.push(conn);
    });
    if (alive.length === 0) {
      clients.delete(email);
      staffEmails.delete(email);
    } else {
      clients.set(email, alive);
    }
  });
}, 30000);
```

Every 30 seconds:
1. Check `isAlive` flag on each connection.
2. If `false` (no pong since last ping), terminate the connection immediately.
3. Set `isAlive = false` and send a ping frame.
4. On receiving a pong frame (handled via `ws.on('pong')`), set `isAlive = true`.
5. Remove emails with zero live connections from both `clients` and `staffEmails`.

## Broadcast Patterns

### All Members

`broadcastToAllMembers(notification)` — iterate all entries in `clients`, send to every connection with `readyState === OPEN`. Used for announcements and availability updates.

### Staff Only

`broadcastToStaff(notification)` — iterate all connections, filter by `conn.isStaff === true`. Used for booking events, directory updates, data integrity updates.

### Member + Staff

`broadcastMemberStatsUpdated(email, data)` — send to the specific member's connections, then also to all staff connections. Used for guest pass counts, tier changes, billing updates.

### Booking Events (Staff Only)

`broadcastBookingEvent(event: BookingEvent)` — send structured booking event data to staff connections only. Includes `eventType`, `bookingId`, `memberEmail`, resource details, and timing.

### Target Patterns Summary

| Pattern | Functions |
|---|---|
| All users | `broadcastToAllMembers`, `broadcastAnnouncementUpdate`, `broadcastAvailabilityUpdate`, `broadcastWaitlistUpdate`, `broadcastClosureUpdate`, `broadcastCafeMenuUpdate` |
| Staff only | `broadcastToStaff`, `broadcastBookingEvent`, `broadcastDirectoryUpdate`, `broadcastMemberDataUpdated`, `broadcastDayPassUpdate`, `broadcastDataIntegrityUpdate` |
| Member + staff | `broadcastMemberStatsUpdated`, `broadcastTierUpdate`, `broadcastBillingUpdate` |
| Single user | `sendNotificationToUser` |

## Graceful Shutdown

```ts
export function closeWebSocketServer(): void {
  // Close all client connections with code 1001 ("Going Away")
  clients.forEach((connections) => {
    connections.forEach(conn => conn.ws.close(1001, 'Server shutting down'));
  });
  clients.clear();
  staffEmails.clear();
  wss.close();
  wss = null;
}
```

## Utility Functions

| Function | Purpose |
|---|---|
| `getClientStatus(email)` | Return `{ connected, connectionCount, activeCount }` |
| `getConnectedUsers()` | Return all emails with active connections |
| `getConnectedStaff()` | Return all staff emails |
| `isUserConnected(email)` | Check if user has at least one OPEN connection |

## Frontend Integration

### NotificationContext (`src/contexts/NotificationContext.tsx`)

Expose `openNotifications(tab?)` via React context. Accept an optional `tab` parameter (`'updates'` or `'announcements'`) to open the notification panel to a specific tab.

### notificationStore (`src/stores/notificationStore.ts`)

Zustand store for client-side notification state:

| Property/Method | Purpose |
|---|---|
| `notifications[]` | Array of notification objects |
| `unreadCount` | Count of unread notifications |
| `isLoading` | Loading state flag |
| `lastFetched` | Timestamp of last fetch |
| `fetchNotifications(email)` | GET `/api/notifications?user_email=...` with credentials |
| `fetchUnreadCount(email)` | GET `/api/notifications?user_email=...&unread_only=true` |
| `addNotification(n)` | Prepend notification, increment unread if not read |
| `markAsRead(id)` | Mark single notification read, decrement unread |
| `markAllAsRead()` | Mark all read, reset unread to 0 |
| `setNotifications(list)` | Bulk-set notifications with auto-computed unread count |

Error handling: silently ignore 401/403 errors (session not ready). Only log non-network errors.

### pushNotifications Service (`src/services/pushNotifications.ts`)

| Function | Purpose |
|---|---|
| `subscribeToPush(email)` | Request permission → register SW → fetch VAPID key → PushManager.subscribe → POST `/api/push/subscribe` |
| `unsubscribeFromPush()` | Get current subscription → POST `/api/push/unsubscribe` → PushSubscription.unsubscribe() |
| `isSubscribedToPush()` | Check `PushManager.getSubscription()` existence |
| `isPushSupported()` | Check for `serviceWorker` and `PushManager` in navigator/window |
| `getNotificationPermission()` | Return current `Notification.permission` |
| `requestNotificationPermission()` | Call `Notification.requestPermission()` |
| `registerServiceWorker()` | Register `/sw.js` service worker |

VAPID key conversion: `urlBase64ToUint8Array()` converts the base64url-encoded VAPID public key to a `Uint8Array` for the `applicationServerKey` option.

### useNotificationSounds Hook (`src/hooks/useNotificationSounds.ts`)

Maintain a `seenIds` set (via `useRef`). On first invocation of `processNotifications()`, seed the set with all current notification IDs (no sound played). On subsequent calls, detect new unread notifications and play the appropriate sound.

**Staff sound map:**
- `booking`, `booking_request`, `event_rsvp`, `wellness_enrollment` → `newBookingRequest`
- `booking_cancelled`, `event_rsvp_cancelled`, `wellness_cancellation` → `bookingCancelled`

**Member sound map:**
- `booking_approved`, `booking_confirmed`, `event_rsvp`, `wellness_booking` → `bookingApproved`
- `booking_declined` → `bookingDeclined`
- `booking_cancelled` → `bookingCancelled`

**Priority:** If multiple new notifications map to different sounds, cancellation/decline sounds take priority. Unmapped types fall back to the generic `notification` sound.

Reset seen IDs when `userKey` changes (user switch) or on component unmount.
