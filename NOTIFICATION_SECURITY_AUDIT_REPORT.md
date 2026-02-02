# Push Notification Security Audit Report
**Date:** February 2, 2026  
**Severity Summary:** 3 CRITICAL, 2 HIGH, 1 MEDIUM

---

## Executive Summary
The notification system has critical authorization vulnerabilities that allow staff members to access and manipulate notifications for any member without proper scope verification. Additionally, notifications contain sensitive financial information that could be exposed through multiple delivery channels.

---

## Critical Issues

### 1. CRITICAL: Unrestricted Staff Access to Member Notifications
**Location:** `server/routes/notifications.ts` (lines 28-39, 41-150)  
**Severity:** CRITICAL

**Vulnerability:**
The `getEffectiveEmail()` function allows ANY staff member to access notifications of ANY member by passing a `user_email` query parameter:

```typescript
// VULNERABLE CODE
async function getEffectiveEmail(req: any, requestedEmail?: string) {
  const sessionEmail = getSessionEmail(req);
  const isStaff = await isStaffUser(sessionEmail);
  
  if (isStaff && requestedEmail) {
    return { email: requestedEmail.toLowerCase(), isStaff: true };  // ❌ NO VERIFICATION
  }
  return { email: sessionEmail, isStaff };
}
```

**Affected Endpoints:**
- `GET /api/notifications` (line 41-66)
- `GET /api/notifications/count` (line 68-88)
- `PUT /api/notifications/:id/read` (line 90-108)
- `PUT /api/notifications/mark-all-read` (line 110-128)
- `DELETE /api/notifications/dismiss-all` (line 131-150)

**Attack Scenario:**
A low-level staff member (e.g., front desk staff) can:
1. Call `GET /api/notifications?user_email=john@example.com` to view all notifications for any member
2. Call `DELETE /api/notifications/dismiss-all` with any member's email to delete their notifications
3. Mark notifications as read to hide evidence of activity

**Impact:**
- ✓ Can view private notifications for any member
- ✓ Can suppress notifications by marking them as read or deleting them
- ✓ Can perform surveillance on member activities
- ✓ No audit trail of who accessed what

**Proof of Concept:**
```bash
# Staff member views John's notifications
curl -X GET 'https://api.example.com/api/notifications?user_email=john@example.com' \
  -H 'Cookie: session=staff_session_cookie'

# Staff member suppresses Jane's notifications
curl -X DELETE 'https://api.example.com/api/notifications/dismiss-all' \
  -H 'Cookie: session=staff_session_cookie' \
  -H 'Content-Type: application/json' \
  -d '{"user_email":"jane@example.com"}'
```

---

### 2. CRITICAL: No Member-Staff Relationship Verification
**Location:** `server/routes/notifications.ts` (entire file)  
**Severity:** CRITICAL

**Vulnerability:**
The system does not verify whether a staff member should have access to a specific member. There's no concept of:
- Staff assignments to specific teams/bays
- Staff hierarchy (front desk vs management vs operations)
- Geographic or department-based access restrictions

**Current Authorization Model:**
```
IF user is admin/staff THEN can access ANY member's data
```

**Required Authorization Model:**
```
IF user is admin THEN can access ANY member's data
ELSE IF user is staff THEN can access only members in their assigned scope
```

**Exposed Information:**
Staff can view notifications revealing:
- Member visit patterns (booking reminders)
- Payment status and amounts
- Event attendance history
- Wellness class enrollment
- Personal schedule details

---

### 3. CRITICAL: Bulk Notification Sending by Any Staff Member
**Location:** `server/routes/push.ts` (lines 406-414, 563-571)  
**Severity:** CRITICAL

**Vulnerability:**
Two endpoints allow ANY staff member to broadcast notifications to ALL members:

1. **`POST /api/push/send-daily-reminders`** (line 406)
   - Protected with `isStaffOrAdmin`
   - Sends to all members with upcoming events, bookings, or classes
   - No recipient filtering

2. **`POST /api/push/send-morning-closure-notifications`** (line 563)
   - Protected with `isStaffOrAdmin`
   - Sends facility closure notices to ALL members
   - No member filtering or approval workflow

**Attack Scenario:**
A disgruntled staff member could:
1. Craft misleading or harassing messages
2. Disable notifications for specific members by triggering false ones
3. Manipulate member schedules through notification content

**Code Reference:**
```typescript
export async function sendPushNotificationToAllMembers(payload: { 
  title: string; 
  body: string; 
  url?: string; 
  tag?: string 
}): Promise<number> {
  // Gets ALL members without filtering
  const allMembers = await db
    .select({ email: users.email })
    .from(users)
    .where(or(eq(users.role, 'member'), isNull(users.role)));
  
  // Sends to EVERYONE
  for (const sub of memberSubscriptions) {
    await webpush.sendNotification(...);
  }
}
```

---

## High-Severity Issues

### 4. HIGH: Notifications Leak Sensitive Financial Information
**Location:** Multiple locations including `notificationService.ts`, `cardExpiryChecker.ts`, `stripe/webhooks.ts`  
**Severity:** HIGH

**Exposed Data in Notifications:**
Notifications contain sensitive financial information that could reveal member privacy:

1. **Card Details**
   - "Your payment card ending in 1234 expires 12/25"
   - Exposed in: `server/core/billing/cardExpiryChecker.ts` line ~32

2. **Payment Amounts**
   - "Your payment of $150.00 for Platinum membership was successful"
   - Exposed in: `notificationService.ts` (payment_success, payment_failed types)

3. **Outstanding Balances**
   - "You have an outstanding balance of $500.00"
   - Exposed in: `notificationService.ts` (outstanding_balance type)

4. **Subscription Information**
   - "Your membership is past due"
   - Reveals membership status

**Delivery Channels at Risk:**
- **Push Notifications**: Sent to push service providers (potential third-party exposure)
- **WebSocket**: Transmitted over network (could be logged)
- **In-App Database**: Stored long-term in notifications table

**Example Vulnerable Notification:**
```
Title: "Card Expiring Soon"
Message: "Your payment card ending in 4242 expires 12/25. Please update your payment method."
```

**Privacy Impact:**
If notifications table is breached or if staff gain unauthorized access:
- Full financial profile of members exposed
- Billing provider tracking enabled
- Payment method details leaked

---

### 5. HIGH: Staff Can Impersonate Members Without Scope Verification
**Location:** `server/routes/members/communications.ts` (lines 102-109, 156-163)  
**Severity:** HIGH

**Vulnerability:**
Similar to notifications, communication preferences can be modified for any member:

```typescript
if (requestedEmail && requestedEmail.toLowerCase() !== sessionUser.email.toLowerCase()) {
  if (sessionUser.role === 'admin' || sessionUser.role === 'staff') {
    targetEmail = decodeURIComponent(requestedEmail);  // ❌ NO SCOPE CHECK
  }
}
```

**Exploitable Endpoints:**
- `PATCH /api/members/me/preferences` - Can change any member's email opt-in settings
- `GET /api/members/me/preferences` - Can view any member's communication preferences
- `GET /api/my-visits` - Can view visit history of any member

**Attack Scenario:**
Staff could:
1. Disable email notifications for a member they dislike
2. View all visits/activities of members
3. Change SMS preferences affecting billing reminders

---

## Medium-Severity Issues

### 6. MEDIUM: No Audit Trail for Notification Access
**Location:** `server/routes/notifications.ts`  
**Severity:** MEDIUM

**Issue:**
When staff access member notifications, there is NO logging of:
- Who accessed the data
- When the access occurred
- Which member's data was accessed
- What action was taken (view, delete, mark as read)

**Impact:**
- Cannot detect unauthorized access
- Cannot investigate privacy breaches
- Violates audit logging best practices
- Non-compliant with privacy regulations

**Required Fix:**
All notification operations by staff should be logged:
```typescript
await logFromRequest(req, 'view_member_notifications', 'notifications', 
  `${effectiveEmail}`, `Staff viewed notifications`, {
    accessedMember: effectiveEmail,
    readCount: notifications.length
  });
```

---

## Recommendations & Fixes

### Critical (Implement Immediately)

#### Fix #1: Add Member-Scoped Access Control
```typescript
// NEW: Verify staff has access to member
async function hasAccessToMember(staffEmail: string, memberEmail: string): Promise<boolean> {
  const staffUser = await db.select()
    .from(staffUsers)
    .where(eq(staffUsers.email, staffEmail));
  
  // Admin has access to all members
  if (staffUser[0]?.role === 'admin') return true;
  
  // Check if member is in staff's assigned scope
  // (implement based on your business logic)
  const assignedMembers = await db.select()
    .from(memberAssignments)
    .where(and(
      eq(memberAssignments.staffEmail, staffEmail),
      eq(memberAssignments.memberEmail, memberEmail)
    ));
  
  return assignedMembers.length > 0;
}
```

#### Fix #2: Update getEffectiveEmail() with Authorization Check
```typescript
async function getEffectiveEmail(req: any, requestedEmail?: string) {
  const sessionEmail = getSessionEmail(req);
  if (!sessionEmail) return null;
  
  const isStaff = await isStaffUser(sessionEmail);
  
  if (isStaff && requestedEmail && requestedEmail.toLowerCase() !== sessionEmail.toLowerCase()) {
    // ✓ ADD: Verify staff has access
    const hasAccess = await hasAccessToMember(sessionEmail, requestedEmail);
    if (!hasAccess) {
      throw new Error('UNAUTHORIZED: You do not have access to this member');
    }
    return { email: requestedEmail.toLowerCase(), isStaff: true };
  }
  
  return { email: sessionEmail, isStaff };
}
```

#### Fix #3: Restrict Bulk Notification Sending
Add authorization check requiring admin role:
```typescript
router.post('/api/push/send-daily-reminders', isAdmin, async (req, res) => {  // ✓ Changed from isStaffOrAdmin
  const result = await sendDailyReminders();
  res.json(result);
});
```

Or create specific roles:
```typescript
const hasNotificationPermission = async (staffEmail: string) => {
  const staff = await db.select()
    .from(staffUsers)
    .where(and(
      eq(staffUsers.email, staffEmail),
      inArray(staffUsers.role, ['admin', 'notifications_manager'])
    ));
  return staff.length > 0;
};
```

### High Priority (Implement within 1 week)

#### Fix #4: Remove Sensitive Financial Data from Notifications
Limit notification messages to non-sensitive information:

```typescript
// BEFORE (UNSAFE)
message: `Your payment card ending in ${cardLast4} expires ${expMonth}/${expYear}`

// AFTER (SAFE)
message: `Your payment method is expiring soon. Please update it in your settings.`
```

#### Fix #5: Add Comprehensive Audit Logging
Log all notification access:
```typescript
router.get('/api/notifications', isAuthenticated, async (req, res) => {
  // ... existing code ...
  
  // ✓ Add logging
  if (effective.isStaff && effective.email !== sessionEmail) {
    await logFromRequest(req, 'view_member_notifications', 'notifications', 
      effective.email, `Viewed notifications`, {
        notificationCount: result.rows.length
      });
  }
  
  res.json(result.rows);
});
```

### Medium Priority (Implement within 2 weeks)

#### Fix #6: Implement Role-Based Notification Permissions
Create granular permissions:
```
ADMIN: Can send to all members, view all notifications
NOTIFICATION_MANAGER: Can send scheduled notifications only
OPERATIONS_STAFF: Can view notifications for assigned members only
FRONT_DESK: Cannot send or access notifications
```

#### Fix #7: Implement Notification Delivery Controls
- Add "requires_approval" flag for bulk notifications
- Implement review workflow for messages sent to members
- Add rate limiting to prevent notification spam

---

## Vulnerability Score

| Category | Score | Notes |
|----------|-------|-------|
| Authorization | 🔴 Critical | No member-scoped access control |
| Information Disclosure | 🔴 Critical | Any staff can view any member's notifications |
| Integrity | 🟠 High | Financial data in plaintext notifications |
| Audit Trail | 🟠 High | No logging of access |
| Access Control | 🟠 High | Bulk operations by any staff |

**Overall Risk Level: 🔴 CRITICAL**

---

## Testing Steps to Verify Issues

### Test #1: Cross-Member Notification Access
```bash
# As staff member, access another member's notifications
curl -X GET 'https://everhouse.app/api/notifications?user_email=victim@example.com' \
  -H 'Cookie: session=[staff_session]'
# Result: Should return 403 FORBIDDEN (but currently returns member's notifications)
```

### Test #2: Suppress Member Notifications
```bash
# As staff, delete another member's notifications
curl -X DELETE 'https://everhouse.app/api/notifications/dismiss-all' \
  -H 'Cookie: session=[staff_session]' \
  -H 'Content-Type: application/json' \
  -d '{"user_email":"victim@example.com"}'
# Result: Should return 403 FORBIDDEN (but currently succeeds)
```

### Test #3: Bulk Notification Broadcast
```bash
# As front-desk staff, send notification to all members
curl -X POST 'https://everhouse.app/api/push/send-daily-reminders' \
  -H 'Cookie: session=[front_desk_session]'
# Result: Should return 403 FORBIDDEN (but currently succeeds)
```

---

## Compliance Impact

**CCPA/Privacy Law Violations:**
- ❌ Unauthorized access to member data
- ❌ Inadequate access controls
- ❌ No audit trail for data access
- ❌ Financial information exposure

**GDPR Impact (if applicable):**
- ❌ Unauthorized processing of personal data
- ❌ No documented consent workflow
- ❌ Data breach notification capability compromised

---

## Summary Table

| Issue | Component | Criticality | Can Leak Private Data | Unauthorized Access |
|-------|-----------|-------------|----------------------|-------------------|
| Staff access any notifications | notifications.ts | 🔴 CRITICAL | ✓ YES | ✓ YES |
| No member-scope verification | All endpoints | 🔴 CRITICAL | ✓ YES | ✓ YES |
| Any staff sends bulk messages | push.ts | 🔴 CRITICAL | ✓ Potentially | ✓ YES |
| Financial data in notifications | notificationService.ts | 🟠 HIGH | ✓ YES | - |
| No audit logging | All endpoints | 🟠 HIGH | - | ✓ YES |

---

## Recommendations Priority

1. **IMMEDIATE** (Today):
   - Restrict bulk notification endpoints to admin only
   - Add member-scope verification to getEffectiveEmail()

2. **URGENT** (This week):
   - Implement audit logging for all notification access
   - Remove sensitive financial data from notification text

3. **IMPORTANT** (This month):
   - Design and implement role-based permission system
   - Add multi-level approval for bulk notifications
   - Create member-to-staff assignment system

---

**Report Generated:** 2026-02-02  
**Auditor:** Security Audit System  
**Status:** READY FOR IMMEDIATE ACTION
