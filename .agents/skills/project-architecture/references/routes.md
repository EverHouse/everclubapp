# API Routes (`server/routes/`)

**CRITICAL RULE: Routes are THIN.** They handle HTTP request/response only. All business logic lives in `server/core/`. Never write business logic inline in route files.

## Authentication Patterns

All mutating routes (POST/PUT/PATCH/DELETE) must be protected. Two equivalent patterns exist:

1. **Middleware** (`isAuthenticated`, `isStaffOrAdmin`, `isAdmin`) — preferred for new routes
2. **Inline check** (`getSessionUser(req)` + 401 return) — used in roster.ts, bays/bookings.ts

**Important:** Inline checks only verify identity (authentication), not role/permissions (authorization). They are acceptable only for member-facing routes where any logged-in user can access. Routes requiring staff or admin access must use `isStaffOrAdmin` or `isAdmin` middleware.

**Intentionally public mutating routes:**
- Auth endpoints (`/api/auth/*`)
- Webhook endpoints (`/api/webhooks/*`) — verified by payload signature
- Tour booking (`/api/tours/book`) — prospect-facing
- Day pass confirmation (`/api/day-passes/confirm`) — verified by Stripe session
- Availability batch check (`/api/availability/batch`)
- HubSpot form submissions (`/api/hubspot/forms/*`)

---

## Booking Routes (`server/routes/bays/`)

- `bookings.ts` — Booking CRUD, cancellation flow
- `approval.ts` — Booking approval, rejection, prepayment
- `calendar.ts` — Booking calendar views
- `resources.ts` — Bay/resource management
- `notifications.ts` — Booking notifications
- `helpers.ts` — Shared route helpers
- `staff-conference-booking.ts` — Staff conference room booking
- `index.ts` — Route registration

---

## Stripe Routes (`server/routes/stripe/`)

- `payments.ts` — Payment processing endpoints
- `member-payments.ts` — Member-facing payment history, prepayment intents, saved card payments, and Stripe Customer Sessions
- `booking-fees.ts` — Staff-initiated booking fee charges and saved card charges
- `quick-charge.ts` — Staff quick-charge endpoint for ad-hoc member charges
- `payment-admin.ts` — Admin payment management endpoints
- `financial-reports.ts` — Financial reporting endpoints
- `subscriptions.ts` — Subscription management
- `invoices.ts` — Invoice endpoints
- `admin.ts` — Stripe admin tools
- `config.ts` — Stripe config endpoints
- `coupons.ts` — Coupon management
- `terminal.ts` — Stripe Terminal (in-person readers)
- `helpers.ts` — Shared Stripe helpers
- `index.ts` — Route registration

---

## Trackman Routes (`server/routes/trackman/`)

- `webhook-index.ts` — Webhook entry point and signature verification
- `webhook-handlers.ts` — `handleBookingUpdate()`, auto-create, auto-link
- `webhook-billing.ts` — Webhook-triggered billing operations
- `webhook-helpers.ts` — Webhook utility functions
- `webhook-validation.ts` — Payload validation
- `import.ts` — CSV import endpoint
- `admin.ts` — Trackman admin tools
- `admin-roster.ts` — Staff roster linking/unlinking for Trackman bookings (push notifications with booking tags)
- `reconciliation.ts` — Reconciliation endpoints
- `index.ts` — Route registration

---

## Member Routes (`server/routes/members/`)

- `dashboard.ts` — Member dashboard data (8 independent endpoints: `/api/member/dashboard/bookings`, `booking-requests`, `rsvps`, `wellness`, `events`, `conference-rooms`, `stats`, `announcements` + legacy monolithic `/api/member/dashboard-data` kept for backward compat)
- `profile.ts` — Profile endpoints
- `admin-actions.ts` — Admin member management
- `communications.ts` — Communication preferences
- `notes.ts` — Member notes (staff)
- `search.ts` — Member search
- `visitors.ts` — Visitor management
- `applicationPipeline.ts` — Application pipeline management
- `onboarding.ts` — Member onboarding endpoints
- `helpers.ts` — Shared member helpers
- `index.ts` — Route registration

---

## Conference Routes (`server/routes/conference/`)

- `prepayment.ts` — Conference room prepayment (deprecated since v8.16.0 — conference rooms now use invoice flow; endpoints kept for backward compat)

---

## Staff Routes (`server/routes/staff/`)

- `manualBooking.ts` — Staff manual booking creation
- `index.ts` — Route registration

---

## Standalone Route Files

- `auth.ts` — Login, logout, session management
- `auth-passkey.ts` — Passkey (WebAuthn Face ID / Touch ID) registration + authentication (6 endpoints, member-only, staff blocked)
- `auth-google.ts` — Google Sign-In (login, link/unlink, status)
- `auth-apple.ts` — Apple Sign-In (login via JWKS token verification, link/unlink, status)
- `account.ts` — Account settings, deletion
- `roster.ts` — Roster/participant management (uses `roster_version` locking)
- `resources.ts` — Resource/bay CRUD
- `availability.ts` — Availability endpoint
- `staffCheckin.ts` — Check-in flow, fee calculation
- `nfcCheckin.ts` — NFC check-in endpoints
- `notifications.ts` — Notification CRUD
- `announcements.ts` — Club announcements
- `events.ts` — Event management, Eventbrite sync
- `calendar.ts` — Calendar endpoints
- `closures.ts` — Facility closures
- `cafe.ts` — Cafe menu CRUD (prices from Stripe, delete verifies Stripe product status)
- `checkout.ts` — Membership checkout flow
- `dayPasses.ts` — Day pass purchase and validation
- `guestPasses.ts` — Guest pass management
- `passes.ts` — Pass utilities
- `wellness.ts` — Wellness service endpoints
- `tours.ts` — Facility tour scheduling
- `financials.ts` — Financial reporting
- `memberBilling.ts` — Staff member billing tools
- `myBilling.ts` — Member self-service billing
- `membershipTiers.ts` — Tier management
- `tierFeatures.ts` — Tier feature comparison
- `pricing.ts` — Pricing display endpoints
- `groupBilling.ts` — Corporate billing
- `hubspot.ts` — HubSpot CRM contact sync endpoints
- `dataIntegrity.ts` — Data integrity dashboard
- `dataExport.ts` — CCPA data export
- `dataTools.ts` — Admin data repair tools
- `settings.ts` — App settings
- `gallery.ts` — Photo gallery
- `faqs.ts` — FAQ management
- `bugReports.ts` — Bug report submission
- `inquiries.ts` — Contact form inquiries
- `analytics.ts` — Staff booking analytics (3 endpoints: booking-stats, extended-stats, membership-insights)
- `training.ts` — Staff training guide
- `notices.ts` — Sequential notice system
- `push.ts` — Push notification registration
- `waivers.ts` — Waiver management
- `users.ts` — User CRUD
- `imageUpload.ts` — Image upload handling
- `idScanner.ts` — ID/license scanning (OpenAI Vision)
- `resendWebhooks.ts` — Resend email webhooks
- `mindbody.ts` — MindBody import endpoints
- `walletPass.ts` — Apple Wallet membership + booking pass generation and download (uses `server/walletPass/passGenerator.ts` and `server/walletPass/bookingPassService.ts`)
- `walletPassWebService.ts` — Apple Wallet web service protocol (`/v1/passes/...`) — device registration, serial updates, pass re-delivery
- `testAuth.ts` — Dev-only test auth
- `emailTemplates.ts` — Email template preview endpoints
- `monitoring.ts` — System monitoring endpoints
