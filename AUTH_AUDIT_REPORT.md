# Authentication & Authorization Security Audit Report
## Ever House Golf Club - Backend API

**Audit Date:** February 2, 2026  
**Scope:** Express.js API endpoints across `server/routes/`

---

## Executive Summary

The application has **good baseline authentication** with middleware-based protection, but several **critical authorization gaps** were identified where users can access resources belonging to other users without proper validation.

### Risk Level: **HIGH**
- 1 CRITICAL vulnerability (resource ownership)
- 2 MAJOR vulnerabilities (authorization checks)
- 3 MODERATE issues (webhook validation, session consistency)

---

## CRITICAL ISSUES

### 1. ⚠️ CRITICAL: Resource Ownership Bypass in Member Profile Details
**Location:** `server/routes/members/profile.ts:23`  
**Endpoint:** `GET /api/members/:email/details`  
**Severity:** CRITICAL

```typescript
router.get('/api/members/:email/details', isAuthenticated, async (req, res) => {
```

**Issue:** 
- Uses only `isAuthenticated` middleware
- **NO check** to verify if the requesting user can access this member's details
- Any logged-in user can query ANY other user's private information:
  - Full name, phone number, address
  - Membership tier
  - Email preferences (SMS/email opt-in status)
  - Date of birth
  - Company name
  - Historical activity data

**Impact:**
- Privacy violation: Users can enumerate and profile all other members
- Data collection: Attackers can scrape member database
- Potential for harassment/targeting

**Recommended Fix:**
```typescript
router.get('/api/members/:email/details', isAuthenticated, async (req, res) => {
  const sessionUser = getSessionUser(req);
  const normalizedEmail = decodeURIComponent(email).toLowerCase();
  
  // Only allow access to own profile OR staff/admin
  if (sessionUser?.email?.toLowerCase() !== normalizedEmail && 
      !['staff', 'admin'].includes(sessionUser?.role)) {
    return res.status(403).json({ error: 'Not authorized to view this profile' });
  }
  // ... rest of implementation
});
```

---

### 2. ⚠️ CRITICAL: Inconsistent Session User Access Pattern
**Location:** `server/routes/members/profile.ts:175-185`  
**Endpoint:** `PUT /api/members/:email/sms-preferences`

```typescript
const requestingUser = (req as any).user;  // ← INCONSISTENT PATTERN

if (requestingUser?.email?.toLowerCase() !== normalizedEmail && 
    !['staff', 'admin'].includes(requestingUser?.role)) {
```

**Issue:**
- Uses `(req as any).user` instead of `getSessionUser(req)`
- May not work consistently if session is not attached to `req.user`
- Inconsistent with other parts of codebase that use `getSessionUser(req)`

**Recommended Fix:**
```typescript
const sessionUser = getSessionUser(req);

if (sessionUser?.email?.toLowerCase() !== normalizedEmail && 
    !['staff', 'admin'].includes(sessionUser?.role)) {
```

---

## MAJOR ISSUES

### 3. 🔴 Webhook Endpoints Rely Entirely on Signature Validation
**Location:** `server/routes/trackman/webhook-index.ts:X`  
**Endpoints:**
- `POST /api/webhooks/trackman`
- `POST /webhooks` (HubSpot)

**Severity:** MAJOR

**Issue:**
- External webhook endpoints **do not use authentication middleware**
- Rely 100% on HMAC signature validation
- Signature validation has fallback behavior:

```typescript
// From trackman/webhook-validation.ts:21
if (!signature) {
  logger.warn('[Trackman Webhook] No signature header found');
  return !isProduction;  // ← ALLOWS UNSIGNED WEBHOOKS IN DEVELOPMENT
}

// Line 52: Falls back to allowing in development
return isValid || !isProduction;  // ← DANGER: Unsigned webhooks allowed in dev
```

**Risk:**
- Unsigned/forged webhook requests accepted in development
- If webhook secret is misconfigured, all requests accepted
- Can trigger booking creation, cancellation, payment processing

**Recommended Fix:**
1. Validate webhook signatures in production strictly
2. Never fall back to allowing unsigned webhooks
3. Add webhook signature header validation even in development
4. Consider rate-limiting on webhook endpoints

```typescript
if (!webhookSecret) {
  logger.error('[Webhook] CRITICAL: No secret configured');
  return res.status(500).json({ error: 'Webhook secret not configured' });
}
```

---

### 4. 🔴 Guest Passes Endpoint Missing Email Normalization Consistency
**Location:** `server/routes/guestPasses.ts:25-67`  
**Endpoint:** `GET /api/guest-passes/:email`

**Severity:** MAJOR

```typescript
const email = decodeURIComponent(req.params.email);
const sessionEmail = sessionUser.email?.toLowerCase() || '';
const requestedEmail = email.toLowerCase();

// ... later in code:
.where(eq(guestPasses.memberEmail, email))  // ← USES ORIGINAL CASE
```

**Issue:**
- Email comparison uses lowercase (`requestedEmail`)
- But database query uses original case (`email`)
- If database stores emails in mixed case, query may not find records
- Race condition possible between comparison and query

**Recommended Fix:**
Normalize consistently throughout:
```typescript
const email = decodeURIComponent(req.params.email).toLowerCase();
const sessionEmail = sessionUser.email?.toLowerCase() || '';

.where(eq(guestPasses.memberEmail, email))
```

---

## MODERATE ISSUES

### 5. 🟡 Settings Endpoint Accessible to All Authenticated Users
**Location:** `server/routes/settings.ts:26`  
**Endpoint:** `GET /api/settings`

```typescript
router.get('/api/settings', isAuthenticated, async (req, res) => {
```

**Severity:** MODERATE

**Issue:**
- Uses `isAuthenticated` (any logged-in user)
- Allows any member to view all application settings
- Contains configuration data that may be sensitive

**Assessment:**
- This might be **intentional** if settings are meant to be public configuration
- Recommend reviewing if settings should be staff-only or if they contain sensitive data

**Recommended:** Document if this is intentional, or restrict to staff:
```typescript
router.get('/api/settings', isStaffOrAdmin, async (req, res) => {
```

---

### 6. 🟡 Checkout and Public Endpoints Without Authentication
**Location:** Multiple endpoints in various files
**Examples:**
- `POST /api/checkout/sessions` (line 17 of checkout.ts)
- `POST /api/day-passes/checkout` (dayPasses.ts)
- `GET /api/events` (events.ts)
- `GET /api/announcements` (announcements.ts)
- `GET /api/cafe-menu` (cafe.ts)

**Severity:** MODERATE (Intentional)

**Assessment:**
- These endpoints are **intentionally public** for guest bookings
- Allow unauthenticated users to browse and start checkout flows
- **This is appropriate design** for public-facing features

**No action needed** - design is correct.

---

### 7. 🟡 Inconsistent Middleware Usage Across Routes
**Location:** Various files
**Examples:**
- Some endpoints use `isAuthenticated` directly
- Some use custom `requireAuth` function
- Some use `getSessionUser(req)` pattern with manual checks

**Severity:** MODERATE

**Issue:**
- Multiple patterns make codebase harder to audit
- Increases risk of missed middleware application

**Examples of inconsistency:**
```typescript
// Pattern 1: Middleware
router.get('/api/endpoint', isAuthenticated, ...)

// Pattern 2: Custom function
function requireAuth(req, res, next) {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// Pattern 3: Manual in handler
const sessionUser = getSessionUser(req);
if (!sessionUser) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

**Recommended:** Standardize on middleware-based approach:
```typescript
// Single pattern throughout
router.get('/api/endpoint', isAuthenticated, async (req, res) => {
  const sessionUser = getSessionUser(req);
  // ... handler
});
```

---

## POSITIVE FINDINGS

✅ **Good:**
1. **Middleware-based protection is used consistently** for admin/staff endpoints
2. **`isStaffOrAdmin` middleware is properly enforced** on sensitive operations
3. **`isAdmin` middleware** restricts super-admin operations appropriately
4. **Resource-specific endpoints** that already check ownership work correctly (e.g., notifications, guest passes)
5. **Audit logging** is implemented for sensitive operations
6. **No hardcoded credentials or secrets** exposed in code
7. **Password hashing** is used (bcryptjs)

---

## ENDPOINTS REQUIRING IMMEDIATE ATTENTION

### Critical Review Needed:
1. ✅ `/api/members/:email/details` - **ADD OWNERSHIP CHECK**
2. ✅ `/api/members/:email/sms-preferences` - **FIX SESSION USER PATTERN**
3. ✅ `/api/webhooks/trackman` - **STRICT SIGNATURE VALIDATION**
4. ✅ `/webhooks` (HubSpot) - **STRICT SIGNATURE VALIDATION**

### Recommended Review:
5. `/api/settings` - Confirm if intentionally public
6. All endpoints using `(req as any).user` - Should use `getSessionUser(req)`

---

## STAFF/ADMIN ENDPOINT SUMMARY

All identified staff-only operations are properly protected:
- ✅ `/api/members/:email/tier` - `isStaffOrAdmin`
- ✅ `/api/members/:email/history` - `isStaffOrAdmin`
- ✅ `/api/member-billing/:email` - `isStaffOrAdmin`
- ✅ `/api/staff-users/*` - `isAdmin` for CRUD
- ✅ `/api/financials/recent-transactions` - `isStaffOrAdmin`
- ✅ `/api/group-billing/*` - `isStaffOrAdmin`
- ✅ Data tools endpoints - `isAdmin`

---

## ROLE-BASED ACCESS CONTROL ASSESSMENT

**Current Implementation:**
- 3 roles: `admin`, `staff`, `member`
- Stored in `staff_users.role` table

**Enforcement Status:**
- ✅ **Admin-only operations** - Properly gated
- ✅ **Staff-or-admin operations** - Properly gated  
- ⚠️ **Member-only operations** - Missing on some endpoints
  - `/api/members/:email/details` - Missing check
  - `/api/members/:email/sms-preferences` - Inconsistent implementation

**Recommendations:**
1. Add member-only access checks where needed
2. Standardize access check pattern:
```typescript
// Enforce: User can only access their own resources unless staff
const isOwner = sessionUser?.email?.toLowerCase() === requestedEmail;
const isStaff = sessionUser?.role === 'admin' || sessionUser?.role === 'staff';

if (!isOwner && !isStaff) {
  return res.status(403).json({ error: 'Not authorized' });
}
```

---

## CROSS-USER RESOURCE ACCESS

**Summary:** Users CAN access resources belonging to other users

### Vulnerable Endpoints:
1. ❌ `/api/members/:email/details` - **CAN ACCESS OTHERS**
2. ✅ `/api/guest-passes/:email` - Properly checks ownership
3. ✅ `/api/members/:email/sms-preferences` - Checks ownership (but inconsistently)
4. ✅ `/api/notifications` - Checks user email
5. ✅ `/api/booking-requests` - Proper checks implemented

---

## IMMEDIATE ACTION ITEMS

### Priority 1 (Do Today):
- [ ] Fix `/api/members/:email/details` ownership check
- [ ] Standardize session user access pattern
- [ ] Review and fix webhook signature validation fallbacks

### Priority 2 (This Sprint):
- [ ] Audit all endpoints using `(req as any).user` pattern
- [ ] Standardize access control pattern across codebase
- [ ] Add authorization tests for cross-user access scenarios

### Priority 3 (Next Sprint):
- [ ] Implement comprehensive authorization audit tests
- [ ] Document security requirements for new endpoints
- [ ] Review role-based access control design

---

## TESTING RECOMMENDATIONS

### Test Cases to Add:
```typescript
// Test 1: Verify users cannot access others' profiles
test('User cannot access other user profile details', async () => {
  const response = await request
    .get('/api/members/other@example.com/details')
    .set('Cookie', 'sessionId=user1@example.com');
  expect(response.status).toBe(403);
});

// Test 2: Verify staff can access any profile
test('Staff can access any member profile details', async () => {
  const response = await request
    .get('/api/members/user1@example.com/details')
    .set('Cookie', 'sessionId=staff@example.com');
  expect(response.status).toBe(200);
});

// Test 3: Verify unsigned webhooks are rejected in production
test('Unsigned webhook rejected in production', async () => {
  // Test with invalid/missing signature
});
```

---

## COMPLIANCE NOTES

- **GDPR:** Users can view PII of other users - violates data protection principles
- **Privacy:** No data access controls between members - potential privacy violation
- **SOC 2:** Access control gaps - missing compensating controls

---

## Conclusion

The application has **solid middleware-based authentication**, but suffers from **incomplete authorization checks** in critical member data endpoints. The most pressing issue is the `/api/members/:email/details` endpoint which allows any authenticated user to access any other user's private information.

**Estimated remediation time:** 2-3 hours
**Risk if not fixed:** HIGH - Privacy violation, data enumeration, targeted attacks

