# Ever Club Members App — API Reference

> Manually maintained reference of all REST endpoints.
> Last updated: 2026-03-29

**Auth legend:**
- 🔓 Public — no authentication required
- 👤 Member — any logged-in member
- 🛡️ Staff — requires `isStaffOrAdmin` middleware (staff or admin)
- 🔑 Admin — requires `isAdmin` middleware (admin only)
- 🔐 Webhook — verified by signature/secret
- 🔒 Dev-gated — blocked in production or without explicit env flag

---

## Table of Contents

1. [Authentication](#authentication)
2. [Bookings & Bays](#bookings--bays)
3. [Roster & Participants](#roster--participants)
4. [Calendar & Availability](#calendar--availability)
5. [Members](#members)
6. [Member Onboarding & Profile](#member-onboarding--profile)
7. [Member Admin Actions](#member-admin-actions)
8. [Member Communications & Preferences](#member-communications--preferences)
9. [Application Pipeline](#application-pipeline)
10. [Visitors & Guests](#visitors--guests)
11. [Guest Passes](#guest-passes)
12. [Day Passes](#day-passes)
13. [Billing & Stripe Payments](#billing--stripe-payments)
14. [Stripe Subscriptions](#stripe-subscriptions)
15. [Stripe Terminal (POS)](#stripe-terminal-pos)
16. [Stripe Invoices](#stripe-invoices)
17. [Stripe Coupons & Discounts](#stripe-coupons--discounts)
18. [Stripe Admin & Sync](#stripe-admin--sync)
19. [Member Billing](#member-billing)
20. [My Billing (Self-Service)](#my-billing-self-service)
21. [Member Payments (Self-Service)](#member-payments-self-service)
22. [Group & Family Billing](#group--family-billing)
23. [Conference Room Prepayment](#conference-room-prepayment)
24. [Financials & Reporting](#financials--reporting)
25. [Checkout](#checkout)
26. [Trackman Integration](#trackman-integration)
27. [Events](#events)
28. [Wellness Classes](#wellness-classes)
29. [Tours](#tours)
30. [Closures & Notices](#closures--notices)
31. [Announcements](#announcements)
32. [Notifications & Push](#notifications--push)
33. [HubSpot Integration](#hubspot-integration)
34. [HubSpot Deals & Products](#hubspot-deals--products)
35. [Staff & Admin Dashboard](#staff--admin-dashboard)
36. [Staff Check-In](#staff-check-in)
37. [NFC Check-In](#nfc-check-in)
38. [Waivers](#waivers)
39. [Settings](#settings)
40. [Membership Tiers & Features](#membership-tiers--features)
41. [Pricing](#pricing)
42. [Gallery](#gallery)
43. [Café Menu](#café-menu)
44. [FAQs](#faqs)
45. [Analytics](#analytics)
46. [Training](#training)
47. [Bug Reports](#bug-reports)
48. [Inquiries](#inquiries)
49. [User Management (Staff/Admin)](#user-management-staffadmin)
50. [Data Integrity](#data-integrity)
51. [Data Tools](#data-tools)
52. [Data Export](#data-export)
53. [Image Upload](#image-upload)
54. [ID Scanner](#id-scanner)
55. [Monitoring](#monitoring)
56. [Email Templates](#email-templates)
57. [Passes (Redeemable)](#passes-redeemable)
58. [Webhooks (Inbound)](#webhooks-inbound)
59. [Account & Notices](#account--notices)
60. [Kiosk Check-In](#kiosk-check-in)
61. [Kiosk Payments](#kiosk-payments)
62. [Merch Management](#merch-management)
63. [Fee Products](#fee-products)
64. [Public Membership Checkout](#public-membership-checkout)
65. [Apple Wallet Pass (PKPass API)](#apple-wallet-pass-pkpass-api)
66. [Directory & Sync](#directory--sync)
67. [Calendar Admin](#calendar-admin)
68. [Miscellaneous](#miscellaneous)

---

## Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/verify-member` | 🔓 | Check if email belongs to a member |
| POST | `/api/auth/request-otp` | 🔓 | Send one-time password to email |
| POST | `/api/auth/verify-otp` | 🔓 | Verify OTP and create session |
| POST | `/api/auth/password-login` | 🔓 | Login with email + password |
| POST | `/api/auth/set-password` | 👤 | Set/change password |
| POST | `/api/auth/ws-token` | 👤 | Generate WebSocket authentication token |
| POST | `/api/auth/logout` | 🔓 | Destroy session |
| GET | `/api/auth/session` | 🔓 | Get current session info (self-guards with 401) |
| GET | `/api/auth/check-staff-admin` | 🔓 | Check if email is staff/admin (public query) |
| POST | `/api/auth/dev-login` | 🔓 | Dev-only: bypass login (blocked in production) |
| POST | `/api/auth/test-welcome-email` | 🔒 | Dev-only: trigger welcome email (blocked in production, admin role check) |

### Google Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/google/verify` | 🔓 | Verify Google OAuth token |
| POST | `/api/auth/google/callback` | 🔓 | Handle Google OAuth callback |
| POST | `/api/auth/google/link` | 👤 | Link Google account to profile |
| POST | `/api/auth/google/unlink` | 👤 | Unlink Google account |
| GET | `/api/auth/google/status` | 👤 | Check Google link status |
| GET | `/api/auth/google/unlinked-report` | 🛡️ | List members with no Google account linked |

### Apple Sign-In

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/apple/verify` | 🔓 | Verify Apple identity token |
| POST | `/api/auth/apple/link` | 👤 | Link Apple account to profile |
| POST | `/api/auth/apple/unlink` | 👤 | Unlink Apple account |
| GET | `/api/auth/apple/status` | 👤 | Check Apple link status |

### Passkeys (WebAuthn)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/passkey/register/options` | 👤 | Get passkey registration options |
| POST | `/api/auth/passkey/register/verify` | 👤 | Verify passkey registration |
| POST | `/api/auth/passkey/authenticate/options` | 🔓 | Get passkey authentication options |
| POST | `/api/auth/passkey/authenticate/verify` | 🔓 | Verify passkey authentication |
| GET | `/api/auth/passkey/list` | 👤 | List registered passkeys |
| DELETE | `/api/auth/passkey/:passkeyId` | 👤 | Delete a passkey |

---

## Bookings & Bays

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bays` | 🔓 | List all bay resources |
| GET | `/api/bays/:bayId/availability` | 🔓 | Get availability for a specific bay |
| GET | `/api/booking-requests` | 👤 | List booking requests (filtered by user or all for staff) |
| POST | `/api/booking-requests` | 👤 | Create a new booking request |
| GET | `/api/booking-requests/:id` | 👤 | Get booking request details |
| PUT | `/api/booking-requests/:id` | 🛡️ | Update booking request (approve/decline/modify) |
| PUT | `/api/booking-requests/:id/member-cancel` | 👤 | Member cancels own booking request |
| PUT | `/api/booking-requests/:id/complete-cancellation` | 🛡️ | Staff completes cancellation with refund |
| GET | `/api/fee-estimate` | 👤 | Get fee estimate for a booking |
| PUT | `/api/bookings/:id/checkin` | 🛡️ | Check in a booking |
| POST | `/api/admin/bookings/:id/dev-confirm` | 🛡️ | Dev: force-confirm a booking |
| GET | `/api/resources` | 🔓 | List all bookable resources |
| GET | `/api/bookings` | 👤 | List all bookings |
| POST | `/api/bookings` | 👤 | Create a booking directly |
| GET | `/api/bookings/:id/cascade-preview` | 🛡️ | Preview cascade effects of deleting a booking |
| DELETE | `/api/bookings/:id` | 🛡️ | Delete a booking |
| PUT | `/api/bookings/:id/approve` | 🛡️ | Approve a pending booking |
| PUT | `/api/bookings/:id/decline` | 🛡️ | Decline a pending booking |
| PUT | `/api/bookings/:id/revert-to-approved` | 🛡️ | Revert checked-in booking to approved |
| PUT | `/api/bookings/:id/member-cancel` | 👤 | Member cancels own booking |
| POST | `/api/bookings/:id/assign-member` | 🛡️ | Assign a member to an unlinked booking |
| PUT | `/api/bookings/:id/assign-with-players` | 🛡️ | Assign member + players to booking |
| PUT | `/api/bookings/:id/change-owner` | 🛡️ | Change booking owner |
| POST | `/api/bookings/link-trackman-to-member` | 🛡️ | Link a Trackman booking to a member |
| GET | `/api/bookings/check-existing` | 👤 | Check if member has existing booking |
| GET | `/api/bookings/check-existing-staff` | 🛡️ | Staff check for existing bookings |
| GET | `/api/pending-bookings` | 🛡️ | List pending bookings awaiting approval |
| GET | `/api/resources/overlapping-notices` | 🛡️ | Get notices overlapping with resources |
| GET | `/api/recent-activity` | 🛡️ | Recent booking activity feed |
| POST | `/api/staff/manual-booking` | 🛡️ | Staff creates manual booking |
| POST | `/api/staff/bookings/manual` | 🛡️ | Staff manual booking (alternate route) |

### Conference Room Bookings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/conference-room-bookings` | 🔓 | List conference room bookings |
| GET | `/api/approved-bookings` | 🛡️ | List approved bookings for calendar |
| GET | `/api/staff/conference-room/available-slots` | 🛡️ | Get available conference room slots |
| GET | `/api/staff/conference-room/fee-estimate` | 🛡️ | Estimate conference room fees |
| POST | `/api/staff/conference-room/booking` | 🛡️ | Book a conference room |

---

## Roster & Participants

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bookings/conflicts` | 👤 | Check participant conflicts |
| GET | `/api/bookings/:bookingId/participants` | 👤 | List participants for a booking |
| POST | `/api/bookings/:bookingId/participants` | 👤 | Add participant to booking |
| DELETE | `/api/bookings/:bookingId/participants/:participantId` | 👤 | Remove participant from booking |
| POST | `/api/bookings/:bookingId/participants/preview-fees` | 👤 | Preview fees for participant changes |
| PATCH | `/api/admin/booking/:bookingId/player-count` | 🛡️ | Update declared player count |
| POST | `/api/admin/booking/:bookingId/roster/batch` | 🛡️ | Batch add/remove roster participants |
| POST | `/api/admin/booking/:bookingId/recalculate-fees` | 🛡️ | Recalculate fees for a booking |
| GET | `/api/admin/booking/:id/members` | 🛡️ | Get member slots for a booking |
| POST | `/api/admin/booking/:id/guests` | 🛡️ | Add guest to a booking |
| DELETE | `/api/admin/booking/:id/guests/:guestId` | 🛡️ | Remove guest from booking |
| PUT | `/api/admin/booking/:bookingId/members/:slotId/link` | 🛡️ | Link member to booking slot |
| PUT | `/api/admin/booking/:bookingId/members/:slotId/unlink` | 🛡️ | Unlink member from booking slot |

---

## Calendar & Availability

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/availability/batch` | 🔓 | Batch check availability (public) |
| GET | `/api/availability` | 🔓 | Get availability for a date/resource |
| POST | `/api/availability-blocks` | 🛡️ | Create availability block |
| GET | `/api/availability-blocks` | 🔓 | List availability blocks (public read) |
| PUT | `/api/availability-blocks/:id` | 🛡️ | Update availability block |
| DELETE | `/api/availability-blocks/:id` | 🛡️ | Delete availability block |
| GET | `/api/admin/calendars` | 🛡️ | List Google Calendar connections |
| GET | `/api/calendars` | 🔓 | List calendars |
| GET | `/api/calendar/availability` | 🔓 | Get calendar availability |
| GET | `/api/calendar-availability/conference` | 🔓 | Get conference room calendar availability |
| POST | `/api/admin/conference-room/backfill` | 🔑 | Backfill conference room history |
| POST | `/api/admin/bookings/sync-history` | 🔑 | Sync booking history from calendar |
| POST | `/api/admin/bookings/sync-calendar` | 🛡️ | Sync bookings to Google Calendar |

---

## Members

### Search & Directory

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/members/search` | 👤 | Search members by name/email |
| GET | `/api/members/directory` | 🛡️ | Member directory listing (staff/admin only) |
| GET | `/api/guests/search` | 👤 | Search guests by name/email |
| GET | `/api/members/frequent-partners` | 👤 | List frequently booked-with partners |

### Member Details

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/members/:email/details` | 👤 | Full member profile details |
| GET | `/api/members/:email/history` | 🛡️ | Member activity history |
| GET | `/api/members/:email/guests` | 🛡️ | List member's guests |
| GET | `/api/members/:email/cascade-preview` | 🛡️ | Preview cascade effects of member deletion |
| GET | `/api/member/dashboard-data` | 👤 | Member dashboard summary data *(legacy — no frontend consumers)* |
| GET | `/api/member/dashboard/bookings` | 👤 | Member upcoming simulator bookings |
| GET | `/api/member/dashboard/booking-requests` | 👤 | Member pending booking requests |
| GET | `/api/member/dashboard/rsvps` | 👤 | Member event RSVPs |
| GET | `/api/member/dashboard/wellness` | 👤 | Member wellness enrollments + classes |
| GET | `/api/member/dashboard/events` | 👤 | Upcoming club events |
| GET | `/api/member/dashboard/conference-rooms` | 👤 | Member conference room bookings |
| GET | `/api/member/dashboard/stats` | 👤 | Member stats (guest passes, visit count) |
| GET | `/api/member/dashboard/announcements` | 👤 | Active banner announcement |

---

## Member Onboarding & Profile

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/member/onboarding` | 👤 | Get onboarding progress |
| POST | `/api/member/onboarding/complete-step` | 👤 | Mark onboarding step complete |
| POST | `/api/member/onboarding/dismiss` | 👤 | Dismiss onboarding |
| PUT | `/api/member/profile` | 👤 | Update own profile |
| PUT | `/api/members/:email/sms-preferences` | 👤 | Update member SMS preferences |
| PUT | `/api/members/:id/role` | 🔑 | Change member role |

---

## Member Admin Actions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/members/add-options` | 🛡️ | Get options for adding a member |
| POST | `/api/members` | 🛡️ | Create a new member |
| PATCH | `/api/members/:email/tier` | 🛡️ | Change member tier |
| POST | `/api/members/:id/suspend` | 🛡️ | Suspend a member |
| DELETE | `/api/members/:email` | 🔑 | Soft-delete a member |
| DELETE | `/api/members/:email/permanent` | 🔑 | Permanently delete a member |
| POST | `/api/members/:email/anonymize` | 🛡️ | Anonymize member data (GDPR) |
| POST | `/api/members/admin/bulk-tier-update` | 🛡️ | Bulk update member tiers |
| POST | `/api/admin/member/change-email` | 🛡️ | Change member email address |
| GET | `/api/admin/member/change-email/preview` | 🛡️ | Preview email change effects |
| GET | `/api/admin/tier-change/tiers` | 🛡️ | Get available tiers for changes |
| POST | `/api/admin/tier-change/preview` | 🛡️ | Preview tier change effects |
| POST | `/api/admin/tier-change/commit` | 🛡️ | Commit tier change |
| GET | `/api/members/:userId/duplicates` | 🛡️ | Find duplicate member records |
| POST | `/api/members/merge/preview` | 🔑 | Preview member merge |
| POST | `/api/members/merge/execute` | 🔑 | Execute member merge |
| POST | `/api/members/backfill-discount-codes` | 🔑 | Backfill discount codes |

---

## Member Communications & Preferences

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/members/:email/communications` | 🛡️ | Get communication log |
| POST | `/api/members/:email/communications` | 🛡️ | Log a communication |
| DELETE | `/api/members/:email/communications/:logId` | 🛡️ | Delete communication log entry |
| PATCH | `/api/members/me/preferences` | 👤 | Update own preferences |
| GET | `/api/members/me/preferences` | 👤 | Get own preferences |
| GET | `/api/my-visits` | 👤 | Get own visit history |
| POST | `/api/members/me/data-export-request` | 👤 | Request data export (GDPR) |

### Member Notes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/members/:email/notes` | 🛡️ | Get member notes |
| POST | `/api/members/:email/notes` | 🛡️ | Add a note to member |
| PUT | `/api/members/:email/notes/:noteId` | 🛡️ | Update a member note |
| DELETE | `/api/members/:email/notes/:noteId` | 🛡️ | Delete a member note |

---

## Application Pipeline

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/applications` | 🛡️ | List membership applications |
| PUT | `/api/admin/applications/:id/status` | 🛡️ | Update application status |
| POST | `/api/admin/applications/:id/send-invite` | 🛡️ | Send membership invite |

---

## Visitors & Guests

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/visitors` | 🛡️ | List visitors |
| GET | `/api/visitors/:id/purchases` | 🛡️ | Get visitor purchase history |
| GET | `/api/visitors/search` | 🛡️ | Search visitors |
| POST | `/api/visitors` | 🛡️ | Create visitor record |
| DELETE | `/api/visitors/:id` | 🛡️ | Delete visitor |
| POST | `/api/visitors/backfill-types` | 🔑 | Backfill visitor types |
| GET | `/api/visitors/check-email` | 🛡️ | Check if email belongs to existing visitor |
| GET | `/api/guests/needs-email` | 🛡️ | Find guests missing email |
| PATCH | `/api/guests/:guestId/email` | 🛡️ | Update guest email |

---

## Guest Passes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/guest-passes/:email` | 👤 | Get guest pass balance |
| POST | `/api/guest-passes/:email/use` | 👤 | Consume a guest pass |
| PUT | `/api/guest-passes/:email` | 🛡️ | Update guest pass allocation |

---

## Day Passes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/day-passes/products` | 🔓 | List day pass products |
| POST | `/api/day-passes/checkout` | 🔓 | Create day pass checkout session |
| POST | `/api/day-passes/confirm` | 🔓 | Confirm day pass purchase (Stripe verified) |
| POST | `/api/day-passes/staff-checkout` | 🛡️ | Staff creates day pass checkout |
| POST | `/api/day-passes/staff-checkout/confirm` | 🛡️ | Staff confirms day pass |

---

## Billing & Stripe Payments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stripe/config` | 🔓 | Get Stripe publishable key |
| GET | `/api/stripe/debug-connection` | 🛡️ | Debug Stripe connection |
| GET | `/api/stripe/prices/recurring` | 🛡️ | List recurring price objects |
| POST | `/api/stripe/create-payment-intent` | 🛡️ | Create a Stripe PaymentIntent |
| POST | `/api/stripe/confirm-payment` | 🛡️ | Confirm a payment |
| GET | `/api/stripe/payment-intent/:id` | 🛡️ | Get PaymentIntent status |
| POST | `/api/stripe/cancel-payment` | 🛡️ | Cancel a PaymentIntent |
| POST | `/api/stripe/create-customer` | 🛡️ | Create Stripe customer |
| POST | `/api/stripe/cleanup-stale-intents` | 🛡️ | Clean up stale PaymentIntents |
| GET | `/api/stripe/payments/:email` | 🛡️ | Get payment history for member |
| GET | `/api/billing/members/search` | 🛡️ | Search members with billing info |
| POST | `/api/stripe/staff/quick-charge` | 🛡️ | Quick charge (new card) |
| POST | `/api/stripe/staff/quick-charge/confirm` | 🛡️ | Confirm quick charge |
| POST | `/api/stripe/staff/quick-charge/attach-email` | 🛡️ | Attach email to anonymous charge |
| POST | `/api/stripe/staff/charge-saved-card` | 🛡️ | Charge saved card |
| POST | `/api/stripe/staff/charge-saved-card-pos` | 🛡️ | POS saved card charge |
| POST | `/api/stripe/staff/mark-booking-paid` | 🛡️ | Mark booking as paid |
| GET | `/api/stripe/staff/check-saved-card/:email` | 🛡️ | Check if member has saved card |
| GET | `/api/staff/member-balance/:email` | 🛡️ | Get member balance |
| POST | `/api/purchases/send-receipt` | 🛡️ | Send payment receipt email |
| POST | `/api/payments/adjust-guest-passes` | 🛡️ | Adjust guest pass counts |
| GET | `/api/stripe/transactions/today` | 🛡️ | Today's transactions |
| POST | `/api/payments/add-note` | 🛡️ | Add note to payment |
| GET | `/api/payments/:paymentIntentId/notes` | 🛡️ | Get payment notes |
| GET | `/api/payments/refundable` | 🛡️ | List refundable payments |
| GET | `/api/payments/refunded` | 🛡️ | List refunded payments |
| GET | `/api/payments/failed` | 🛡️ | List failed payments |
| POST | `/api/payments/retry` | 🛡️ | Retry a failed payment |
| POST | `/api/payments/cancel` | 🛡️ | Cancel a payment |
| POST | `/api/payments/refund` | 🛡️ | Refund a payment |
| GET | `/api/payments/pending-authorizations` | 🛡️ | List pending authorizations |
| GET | `/api/payments/future-bookings-with-fees` | 🛡️ | Bookings with outstanding fees |
| POST | `/api/payments/capture` | 🛡️ | Capture an authorized payment |
| POST | `/api/payments/void-authorization` | 🛡️ | Void an authorization |
| GET | `/api/payments/daily-summary` | 🛡️ | Daily payment summary |
| POST | `/api/stripe/staff/charge-subscription-invoice` | 🛡️ | Charge subscription invoice |

---

## Stripe Subscriptions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stripe/subscriptions/:customerId` | 🛡️ | Get customer subscriptions |
| POST | `/api/stripe/subscriptions` | 🛡️ | Create subscription |
| DELETE | `/api/stripe/subscriptions/:subscriptionId` | 🛡️ | Cancel subscription |
| POST | `/api/stripe/sync-subscriptions` | 🛡️ | Sync subscriptions from Stripe |
| POST | `/api/stripe/subscriptions/create-for-member` | 🛡️ | Create subscription for existing member |
| POST | `/api/stripe/subscriptions/create-new-member` | 🛡️ | Create subscription + member |
| POST | `/api/stripe/subscriptions/confirm-inline-payment` | 🛡️ | Confirm inline subscription payment |
| POST | `/api/stripe/subscriptions/send-activation-link` | 🛡️ | Send activation payment link |
| POST | `/api/stripe/subscriptions/confirm-trial-setup` | 🛡️ | Confirm trial setup intent |
| DELETE | `/api/stripe/subscriptions/cleanup-pending/:userId` | 🛡️ | Clean up pending subscription |

---

## Stripe Terminal (POS)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/stripe/terminal/connection-token` | 🛡️ | Get terminal connection token |
| GET | `/api/stripe/terminal/readers` | 🛡️ | List terminal readers |
| POST | `/api/stripe/terminal/create-simulated-reader` | 🛡️ | Create simulated reader (dev) |
| POST | `/api/stripe/terminal/process-payment` | 🛡️ | Process terminal payment |
| GET | `/api/stripe/terminal/payment-status/:paymentIntentId` | 🛡️ | Check terminal payment status |
| POST | `/api/stripe/terminal/cancel-payment` | 🛡️ | Cancel terminal payment |
| POST | `/api/stripe/terminal/process-subscription-payment` | 🛡️ | Process subscription via terminal |
| POST | `/api/stripe/terminal/confirm-subscription-payment` | 🛡️ | Confirm terminal subscription |
| POST | `/api/stripe/terminal/refund-payment` | 🛡️ | Refund terminal payment |
| POST | `/api/stripe/terminal/process-existing-payment` | 🛡️ | Process existing PI on terminal |
| POST | `/api/stripe/terminal/save-card` | 🛡️ | Save card via terminal |
| GET | `/api/stripe/terminal/setup-status/:setupIntentId` | 🛡️ | Check setup intent status |
| POST | `/api/stripe/terminal/confirm-save-card` | 🛡️ | Confirm saved card |

---

## Stripe Invoices

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stripe/invoices/preview` | 🛡️ | Preview invoice |
| GET | `/api/stripe/invoices/:customerId` | 🛡️ | List customer invoices |
| POST | `/api/stripe/invoices` | 🛡️ | Create invoice |
| POST | `/api/stripe/invoices/:invoiceId/finalize` | 🛡️ | Finalize invoice |
| GET | `/api/stripe/invoice/:invoiceId` | 🛡️ | Get invoice details |
| POST | `/api/stripe/invoices/:invoiceId/void` | 🛡️ | Void invoice |
| GET | `/api/my-invoices` | 👤 | Get own invoices |
| GET | `/api/my-billing/payment-history` | 👤 | Get own payment history |
| GET | `/api/stripe/subscriptions/invoice-link/:subscriptionId` | 🛡️ | Get hosted invoice link for subscription |
| GET | `/api/stripe/subscriptions/refresh-intent/:subscriptionId` | 🛡️ | Refresh setup/payment intent for subscription |

---

## Stripe Coupons & Discounts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/stripe/coupons` | 🛡️ | List coupons |
| POST | `/api/stripe/coupons` | 🔑 | Create coupon |
| PUT | `/api/stripe/coupons/:id` | 🔑 | Update coupon |
| DELETE | `/api/stripe/coupons/:id` | 🔑 | Delete coupon |
| POST | `/api/stripe/promo-codes/seed-welcome` | 🔑 | Seed default welcome promo code |

---

## Stripe Admin & Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/check-expiring-cards` | 🔑 | Check expiring payment cards |
| POST | `/api/admin/check-stale-waivers` | 🔑 | Check stale waivers |
| GET | `/api/stripe/tiers/status` | 🛡️ | Tier sync status |
| POST | `/api/stripe/tiers/sync` | 🔑 | Sync tiers to Stripe |
| GET | `/api/stripe/discounts/status` | 🛡️ | Discount sync status |
| POST | `/api/stripe/discounts/sync` | 🔑 | Sync discounts to Stripe |
| GET | `/api/stripe/billing/classification` | 🔑 | Billing classification report |
| GET | `/api/stripe/billing/needs-migration` | 🔑 | Members needing billing migration |
| POST | `/api/stripe/staff/send-membership-link` | 🛡️ | Send membership payment link |
| POST | `/api/stripe/staff/send-reactivation-link` | 🛡️ | Send reactivation payment link |
| POST | `/api/public/day-pass/checkout` | 🔓 | Public day pass checkout |
| GET | `/api/stripe/customer-sync-status` | 🛡️ | Customer sync status |
| POST | `/api/stripe/sync-customers` | 🛡️ | Sync customers from Stripe |
| POST | `/api/admin/stripe/replay-webhook` | 🔑 | Replay a Stripe webhook |
| POST | `/api/stripe/sync-member-subscriptions` | 🛡️ | Sync member subscriptions |

---

## Member Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/member-billing/:email` | 🛡️ | Get billing overview for member |
| GET | `/api/member-billing/:email/outstanding` | 🛡️ | Get outstanding balance |
| PUT | `/api/member-billing/:email/source` | 🛡️ | Update billing source |
| POST | `/api/member-billing/:email/pause` | 🛡️ | Pause subscription |
| POST | `/api/member-billing/:email/resume` | 🛡️ | Resume subscription |
| POST | `/api/member-billing/:email/cancel` | 🛡️ | Cancel subscription |
| POST | `/api/member-billing/:email/undo-cancellation` | 🛡️ | Undo pending cancellation |
| POST | `/api/member-billing/:email/credit` | 🛡️ | Apply credit to account |
| POST | `/api/member-billing/:email/discount` | 🛡️ | Apply discount |
| GET | `/api/member-billing/:email/invoices` | 🛡️ | Get member invoices |
| GET | `/api/member-billing/:email/payment-history` | 🛡️ | Get payment history |
| POST | `/api/member-billing/:email/payment-link` | 🛡️ | Send payment link |
| POST | `/api/member-billing/:email/migrate-to-stripe` | 🛡️ | Migrate to Stripe billing |
| POST | `/api/member-billing/:email/cancel-migration` | 🛡️ | Cancel billing migration |
| GET | `/api/member-billing/:email/migration-status` | 🛡️ | Get migration status |
| POST | `/api/member-billing/:email/sync-stripe` | 🛡️ | Sync billing from Stripe |
| POST | `/api/member-billing/:email/sync-metadata` | 🛡️ | Sync Stripe metadata |
| POST | `/api/member-billing/:email/sync-tier-from-stripe` | 🛡️ | Sync tier from Stripe |
| POST | `/api/member-billing/:email/backfill-cache` | 🛡️ | Backfill billing cache |

---

## My Billing (Self-Service)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/my/billing` | 👤 | Get own billing summary |
| GET | `/api/my/billing/invoices` | 👤 | Get own invoices |
| POST | `/api/my/billing/update-payment-method` | 👤 | Update payment method |
| POST | `/api/my/billing/portal` | 👤 | Open Stripe billing portal |
| POST | `/api/my/billing/add-payment-method-for-extras` | 👤 | Add card for extras |
| POST | `/api/my/billing/migrate-to-stripe` | 👤 | Self-service Stripe migration |
| GET | `/api/my/balance` | 👤 | Get account balance |
| POST | `/api/my/add-funds` | 👤 | Add funds to balance |
| GET | `/api/my-billing/account-balance` | 👤 | Get account balance (alt) |
| POST | `/api/my/billing/request-cancellation` | 👤 | Request membership cancellation |
| GET | `/api/my/billing/cancellation-status` | 👤 | Get cancellation status |
| GET | `/api/my-billing/receipt/:paymentIntentId` | 👤 | Get payment receipt |

---

## Member Payments (Self-Service)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/member/bookings/:id/pay-fees` | 👤 | Pay booking fees |
| POST | `/api/member/bookings/:id/confirm-payment` | 👤 | Confirm booking payment |
| POST | `/api/member/invoices/:invoiceId/pay` | 👤 | Pay an invoice |
| POST | `/api/member/invoices/:invoiceId/confirm` | 👤 | Confirm invoice payment |
| POST | `/api/member/guest-passes/purchase` | 👤 | Purchase guest passes |
| POST | `/api/member/guest-passes/confirm` | 👤 | Confirm guest pass purchase |
| GET | `/api/member/balance` | 👤 | Get payment balance |
| POST | `/api/member/balance/pay` | 👤 | Pay balance |
| POST | `/api/member/balance/confirm` | 👤 | Confirm balance payment |
| POST | `/api/member/bookings/:bookingId/cancel-payment` | 👤 | Cancel in-progress payment |
| GET | `/api/member/payment-methods` | 👤 | List saved payment methods |
| POST | `/api/member/bookings/:id/pay-saved-card` | 👤 | Pay booking fees with saved card |
| POST | `/api/member/invoices/:invoiceId/pay-saved-card` | 👤 | Pay invoice with saved card |

---

## Group & Family Billing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/group-billing/products` | 🛡️ | List group billing products |
| GET | `/api/family-billing/products` | 🛡️ | List family billing products |
| POST | `/api/group-billing/products/sync` | 🛡️ | Sync group products |
| POST | `/api/family-billing/products/sync` | 🛡️ | Sync family products |
| PUT | `/api/group-billing/products/:tierName` | 🛡️ | Update group product |
| PUT | `/api/family-billing/products/:tierName` | 🛡️ | Update family product |
| GET | `/api/group-billing/groups` | 🛡️ | List billing groups |
| GET | `/api/family-billing/groups` | 🛡️ | List family groups |
| GET | `/api/group-billing/group/:email` | 🛡️ | Get group by owner email |
| GET | `/api/family-billing/group/:email` | 🛡️ | Get family group by owner email |
| PUT | `/api/group-billing/group/:groupId/name` | 🛡️ | Rename group |
| DELETE | `/api/group-billing/group/:groupId` | 🛡️ | Delete group |
| POST | `/api/group-billing/groups` | 🛡️ | Create billing group |
| POST | `/api/family-billing/groups` | 🛡️ | Create family group |
| POST | `/api/group-billing/groups/:groupId/members` | 🛡️ | Add member to group |
| POST | `/api/group-billing/groups/:groupId/corporate-members` | 🛡️ | Add corporate member |
| POST | `/api/family-billing/groups/:groupId/members` | 🛡️ | Add family member |
| GET | `/api/group-billing/corporate-pricing` | 🛡️ | Get corporate pricing |
| DELETE | `/api/group-billing/members/:memberId` | 🛡️ | Remove member from group |
| DELETE | `/api/family-billing/members/:memberId` | 🛡️ | Remove family member |
| POST | `/api/group-billing/groups/:groupId/link-subscription` | 🛡️ | Link subscription to group |
| POST | `/api/family-billing/groups/:groupId/link-subscription` | 🛡️ | Link subscription to family |
| POST | `/api/group-billing/reconcile` | 🛡️ | Reconcile group billing |
| POST | `/api/family-billing/reconcile` | 🛡️ | Reconcile family billing |

---

## Conference Room Prepayment

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/member/conference/prepay/estimate` | 👤 | Estimate prepayment amount |

---

## Financials & Reporting

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/financials/recent-transactions` | 🛡️ | List recent transactions |
| POST | `/api/financials/backfill-stripe-cache` | 🛡️ | Backfill Stripe cache |
| POST | `/api/financials/sync-member-payments` | 🛡️ | Sync member payments |
| GET | `/api/financials/cache-stats` | 🛡️ | Get cache statistics |
| GET | `/api/financials/subscriptions` | 🛡️ | List all subscriptions |
| POST | `/api/financials/subscriptions/:subscriptionId/send-reminder` | 🛡️ | Send payment reminder |
| GET | `/api/financials/invoices` | 🛡️ | List all invoices |
| GET | `/api/admin/financials/summary` | 🛡️ | Financial summary dashboard |

---

## Checkout

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/checkout/sessions` | 🔓 | Create checkout session |
| GET | `/api/checkout/session/:sessionId` | 🔓 | Get checkout session status |

---

## Trackman Integration

### Import & CSV

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/trackman/import-runs` | 🛡️ | List import runs |
| POST | `/api/admin/trackman/import` | 🛡️ | Import Trackman data |
| POST | `/api/admin/trackman/upload` | 🛡️ | Upload Trackman CSV |
| POST | `/api/admin/trackman/rescan` | 🛡️ | Rescan Trackman data |

### Matching & Resolution

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/trackman/needs-players` | 🛡️ | Bookings needing player assignment |
| GET | `/api/admin/trackman/unmatched` | 🛡️ | List unmatched Trackman bookings |
| POST | `/api/admin/trackman/unmatched/auto-resolve` | 🛡️ | Auto-resolve unmatched |
| POST | `/api/admin/trackman/unmatched/bulk-dismiss` | 🛡️ | Bulk dismiss unmatched |
| PUT | `/api/admin/trackman/unmatched/:id/resolve` | 🛡️ | Resolve unmatched booking |
| POST | `/api/admin/trackman/auto-resolve-same-email` | 🛡️ | Auto-resolve same-email |
| DELETE | `/api/admin/trackman/linked-email` | 🛡️ | Unlink email |
| GET | `/api/admin/trackman/matched` | 🛡️ | List matched bookings |
| PUT | `/api/admin/trackman/matched/:id/reassign` | 🛡️ | Reassign matched booking |
| POST | `/api/admin/trackman/unmatch-member` | 🛡️ | Unmatch a member |
| GET | `/api/admin/trackman/potential-matches` | 🛡️ | Find potential matches |
| GET | `/api/admin/trackman/requires-review` | 🛡️ | Items requiring review |
| POST | `/api/admin/trackman/auto-match-visitors` | 🛡️ | Auto-match visitors |
| POST | `/api/trackman/admin/cleanup-lessons` | 🛡️ | Clean up lesson records |

### Reconciliation

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/trackman/reconciliation` | 🛡️ | Reconciliation report |
| GET | `/api/admin/trackman/reconciliation/summary` | 🛡️ | Reconciliation summary |
| PUT | `/api/admin/trackman/reconciliation/:id` | 🛡️ | Update reconciliation |

### Data Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| DELETE | `/api/admin/trackman/reset-data` | 🛡️ | Reset Trackman data |
| GET | `/api/admin/backfill-sessions/preview` | 🛡️ | Preview session backfill |
| POST | `/api/admin/backfill-sessions` | 🛡️ | Backfill sessions |
| GET | `/api/admin/trackman/duplicate-bookings` | 🛡️ | Find duplicate bookings |
| POST | `/api/admin/trackman/cleanup-duplicates` | 🛡️ | Clean up duplicates |

### Webhook Diagnostics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/trackman-webhooks` | 🛡️ | List Trackman webhook events |
| GET | `/api/admin/trackman-webhooks/stats` | 🛡️ | Webhook processing statistics |
| GET | `/api/admin/trackman-webhook/stats` | 🛡️ | Webhook stats (alternate) |
| GET | `/api/admin/trackman-webhook/failed` | 🛡️ | List failed webhook events |
| POST | `/api/admin/trackman-webhook/:eventId/retry` | 🛡️ | Retry failed webhook event |
| POST | `/api/admin/trackman-webhook/:eventId/auto-match` | 🛡️ | Auto-match webhook event |
| POST | `/api/admin/trackman-webhook/cleanup` | 🛡️ | Cleanup old webhook events |
| POST | `/api/admin/trackman-webhooks/backfill` | 🔑 | Backfill webhook events |
| GET | `/api/availability/trackman-cache` | 🛡️ | Get Trackman availability cache |
| POST | `/api/trackman/replay-webhooks-to-dev` | 🔑 | Replay webhooks to dev environment |

### Linked Emails (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/linked-emails` | 🛡️ | List linked email records |
| GET | `/api/admin/linked-emails/:email` | 🛡️ | Get linked email details |
| POST | `/api/admin/linked-emails` | 🛡️ | Create linked email record |
| DELETE | `/api/admin/linked-emails/:email` | 🛡️ | Delete linked email |
| POST | `/api/admin/repair-linked-email-bookings` | 🛡️ | Repair bookings after linked email changes |

---

## Events

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/events` | 🔓 | List events |
| POST | `/api/events` | 🛡️ | Create event |
| PUT | `/api/events/:id` | 🛡️ | Update event |
| DELETE | `/api/events/:id` | 🛡️ | Delete event |
| GET | `/api/events/:id/cascade-preview` | 🛡️ | Preview cascade effects |
| POST | `/api/events/sync/google` | 🛡️ | Sync from Google Calendar |
| POST | `/api/events/sync` | 🛡️ | Sync events |
| POST | `/api/calendars/sync-all` | 🛡️ | Sync all calendars |
| GET | `/api/events/needs-review` | 🛡️ | Events needing review |
| POST | `/api/events/:id/mark-reviewed` | 🛡️ | Mark event reviewed |
| POST | `/api/eventbrite/sync` | 🛡️ | Sync from Eventbrite |
| GET | `/api/rsvps` | 👤 | Get own RSVPs |
| POST | `/api/rsvps` | 👤 | Create RSVP |
| DELETE | `/api/rsvps/:event_id/:user_email` | 👤 | Cancel RSVP |
| GET | `/api/events/:id/rsvps` | 🛡️ | List RSVPs for event |
| DELETE | `/api/events/:eventId/rsvps/:rsvpId` | 🛡️ | Remove RSVP |
| POST | `/api/events/:id/rsvps/manual` | 🛡️ | Add manual RSVP |
| POST | `/api/events/:id/sync-eventbrite-attendees` | 🛡️ | Sync Eventbrite attendees |
| GET | `/api/events/:id/eventbrite-attendees` | 🛡️ | List Eventbrite attendees |

---

## Wellness Classes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/wellness-classes` | 🔓 | List wellness classes |
| POST | `/api/wellness-classes` | 🛡️ | Create wellness class |
| PUT | `/api/wellness-classes/:id` | 🛡️ | Update wellness class |
| DELETE | `/api/wellness-classes/:id` | 🛡️ | Delete wellness class |
| POST | `/api/wellness-classes/sync` | 🛡️ | Sync wellness classes |
| POST | `/api/wellness-classes/backfill-calendar` | 🛡️ | Backfill calendar entries |
| GET | `/api/wellness-classes/needs-review` | 🛡️ | Classes needing review |
| POST | `/api/wellness-classes/:id/mark-reviewed` | 🛡️ | Mark class reviewed |
| GET | `/api/wellness-enrollments` | 👤 | List enrollments |
| POST | `/api/wellness-enrollments` | 👤 | Enroll in class |
| DELETE | `/api/wellness-enrollments/:class_id/:user_email` | 👤 | Cancel enrollment |
| GET | `/api/wellness-classes/:id/enrollments` | 🛡️ | List class enrollments |
| POST | `/api/wellness-classes/:id/enrollments/manual` | 🛡️ | Add manual enrollment |

---

## Tours

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/tours` | 🛡️ | List tours |
| GET | `/api/tours/today` | 🛡️ | Today's tours |
| POST | `/api/tours/:id/checkin` | 🛡️ | Check in tour guest |
| PATCH | `/api/tours/:id/status` | 🛡️ | Update tour status |
| POST | `/api/tours/sync` | 🛡️ | Sync tours |
| POST | `/api/tours/book` | 🔓 | Book a tour (public) |
| PATCH | `/api/tours/:id/confirm` | 🔓 | Confirm tour |
| GET | `/api/tours/needs-review` | 🛡️ | Tours needing review |
| POST | `/api/tours/link-hubspot` | 🛡️ | Link tour to HubSpot |
| POST | `/api/tours/create-from-hubspot` | 🛡️ | Create tour from HubSpot |
| POST | `/api/tours/dismiss-hubspot` | 🛡️ | Dismiss HubSpot match |
| GET | `/api/tours/availability` | 🔓 | Tour availability |
| POST | `/api/tours/schedule` | 🔓 | Schedule a tour |

---

## Closures & Notices

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/closures` | 🔓 | List closures |
| GET | `/api/closures/needs-review` | 🛡️ | Closures needing review |
| POST | `/api/closures` | 🛡️ | Create closure |
| PUT | `/api/closures/:id` | 🛡️ | Update closure |
| DELETE | `/api/closures/:id` | 🛡️ | Delete closure |
| POST | `/api/closures/backfill-blocks` | 🛡️ | Backfill closure blocks |
| POST | `/api/closures/sync` | 🛡️ | Sync closures |
| POST | `/api/closures/fix-orphaned` | 🔑 | Fix orphaned closures |
| GET | `/api/notice-types` | 🔓 | List notice types |
| POST | `/api/notice-types` | 🛡️ | Create notice type |
| PUT | `/api/notice-types/:id` | 🛡️ | Update notice type |
| DELETE | `/api/notice-types/:id` | 🛡️ | Delete notice type |
| GET | `/api/closure-reasons` | 🔓 | List closure reasons |
| POST | `/api/closure-reasons` | 🛡️ | Create closure reason |
| PUT | `/api/closure-reasons/:id` | 🛡️ | Update closure reason |
| DELETE | `/api/closure-reasons/:id` | 🛡️ | Delete closure reason |

---

## Announcements

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/announcements` | 🔓 | List announcements |
| GET | `/api/announcements/banner` | 🔓 | Get active banner |
| GET | `/api/announcements/export` | 🛡️ | Export announcements |
| POST | `/api/announcements` | 🛡️ | Create announcement |
| PUT | `/api/announcements/:id` | 🛡️ | Update announcement |
| DELETE | `/api/announcements/:id` | 🛡️ | Delete announcement |
| POST | `/api/announcements/sheets/connect` | 🛡️ | Connect Google Sheet |
| GET | `/api/announcements/sheets/status` | 🛡️ | Sheet connection status |
| POST | `/api/announcements/sheets/sync-from` | 🛡️ | Sync from Google Sheet |
| POST | `/api/announcements/sheets/sync-to` | 🛡️ | Sync to Google Sheet |
| POST | `/api/announcements/sheets/disconnect` | 🛡️ | Disconnect Sheet |

---

## Notifications & Push

### In-App Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | 👤 | List notifications |
| GET | `/api/notifications/count` | 👤 | Unread count |
| PUT | `/api/notifications/:id/read` | 👤 | Mark as read |
| PUT | `/api/notifications/mark-all-read` | 👤 | Mark all as read |
| DELETE | `/api/notifications/:id` | 👤 | Delete notification |
| DELETE | `/api/notifications/dismiss-all` | 👤 | Dismiss all |

### Push Notifications

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/push/vapid-public-key` | 🔓 | Get VAPID public key |
| POST | `/api/push/subscribe` | 👤 | Subscribe to push |
| POST | `/api/push/unsubscribe` | 👤 | Unsubscribe from push |
| POST | `/api/push/test` | 👤 | Send test push |
| POST | `/api/push/send-daily-reminders` | 🛡️ | Trigger daily reminders |
| POST | `/api/push/send-morning-closure-notifications` | 🛡️ | Trigger closure notifications |

---

## HubSpot Integration

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/hubspot/contacts` | 🛡️ | List HubSpot contacts |
| GET | `/api/hubspot/contacts/:id` | 🛡️ | Get HubSpot contact |
| POST | `/api/hubspot/forms/:formType` | 🔓 | Submit HubSpot form |
| POST | `/api/hubspot/sync-tiers` | 🛡️ | Sync tiers to HubSpot |
| PUT | `/api/hubspot/contacts/:id/tier` | 🛡️ | Update contact tier |
| POST | `/api/hubspot/webhooks` | 🔓 | HubSpot webhook handler |
| POST | `/api/hubspot/push-db-tiers` | 🛡️ | Push DB tiers to HubSpot |
| POST | `/api/hubspot/sync-billing-providers` | 🛡️ | Sync billing providers |
| POST | `/api/admin/hubspot/sync-form-submissions` | 🛡️ | Sync form submissions |
| GET | `/api/admin/hubspot/form-sync-status` | 🔑 | Form sync status |
| POST | `/api/admin/hubspot/form-sync-reset` | 🔑 | Reset form sync |
| POST | `/api/admin/hubspot/set-forms-token` | 🔑 | Set forms API token |
| GET | `/api/admin/hubspot/set-forms-token-page` | 🔑 | Token setup page |
| GET | `/api/admin/hubspot/marketing-contacts-audit` | 🔑 | Marketing contacts audit |
| POST | `/api/admin/hubspot/remove-marketing-contacts` | 🔑 | Remove marketing contacts |

---

## HubSpot Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/hubspot/sync-status` | 🛡️ | HubSpot sync status |
| POST | `/api/hubspot/sync-all-members` | 🛡️ | Sync all members to HubSpot |
| POST | `/api/hubspot/push-members-to-hubspot` | 🛡️ | Push members to HubSpot |

---

## Staff & Admin Dashboard

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/command-center` | 🛡️ | Staff command center data |
| GET | `/api/admin/dashboard-summary` | 🛡️ | Admin dashboard summary |
| GET | `/api/admin/todays-bookings` | 🛡️ | Today's bookings |
| GET | `/api/staff/list` | 🛡️ | List staff members |
| GET | `/api/directory/team` | 👤 | Team directory |

---

## Staff Check-In

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/bookings/:id/staff-checkin-context` | 🛡️ | Get check-in context |
| PATCH | `/api/bookings/:id/payments` | 🛡️ | Update booking payments |
| GET | `/api/bookings/overdue-payments` | 🛡️ | List overdue payments |
| POST | `/api/bookings/:id/staff-direct-add` | 🛡️ | Staff directly adds participant |
| POST | `/api/staff/qr-checkin` | 🛡️ | QR code check-in |

---

## NFC Check-In

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/member/nfc-checkin` | 👤 | NFC-based member check-in |

---

## Waivers

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/waivers/status` | 👤 | Get waiver signing status |
| POST | `/api/waivers/sign` | 👤 | Sign waiver |
| POST | `/api/waivers/email-copy` | 👤 | Email signed waiver copy to member |
| GET | `/api/waivers/current-version` | 🛡️ | Get current waiver version |
| POST | `/api/waivers/update-version` | 🛡️ | Update waiver version |

---

## Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings/public` | 🔓 | Get public settings (contact, hours, social) |
| GET | `/api/settings` | 👤 | Get all settings |
| GET | `/api/settings/:key` | 👤 | Get setting by key |
| PUT | `/api/admin/settings/:key` | 🔑 | Update setting by key |
| PUT | `/api/admin/settings` | 🔑 | Update multiple settings |

---

## Membership Tiers & Features

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/membership-tiers` | 🔓 | List membership tiers (public) |
| GET | `/api/membership-tiers/:id` | 🔓 | Get tier details (public) |
| GET | `/api/membership-tiers/limits/:tierName` | 🔓 | Get tier limits (public) |
| GET | `/api/membership-tiers/:id/member-count` | 🔑 | Get active member count for tier |
| PUT | `/api/membership-tiers/:id` | 🔑 | Update tier |
| POST | `/api/membership-tiers` | 🔑 | Create tier |
| DELETE | `/api/membership-tiers/:id` | 🔑 | Delete tier (blocks if members assigned) |
| POST | `/api/admin/stripe/sync-products` | 🔑 | Sync tier products to Stripe |
| GET | `/api/admin/stripe/sync-status` | 🛡️ | Get product sync status |
| POST | `/api/admin/stripe/pull-from-stripe` | 🛡️ | Pull products from Stripe |
| GET | `/api/tier-features` | 🔓 | List tier features |
| POST | `/api/tier-features` | 🔑 | Create tier feature |
| PUT | `/api/tier-features/:id` | 🔑 | Update tier feature |
| DELETE | `/api/tier-features/:id` | 🔑 | Delete tier feature |
| PUT | `/api/tier-features/:featureId/values/:tierId` | 🔑 | Set feature value for tier |

---

## Pricing

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/pricing` | 🔓 | Get public pricing info |
| PUT | `/api/pricing` | 🛡️ | Update pricing config |
| PUT | `/api/admin/pricing/guest-fee` | 🔑 | Update guest fee rate |
| PUT | `/api/admin/pricing/overage-rate` | 🔑 | Update overage fee rate |

---

## Gallery

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/gallery` | 🔓 | List gallery images |
| POST | `/api/admin/gallery` | 🛡️ | Add gallery image |
| PUT | `/api/admin/gallery/:id` | 🛡️ | Update gallery image |
| DELETE | `/api/admin/gallery/:id` | 🛡️ | Delete gallery image |
| POST | `/api/admin/gallery/reorder` | 🛡️ | Reorder gallery |

---

## Café Menu

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/cafe-menu` | 🔓 | List menu items |
| POST | `/api/cafe-menu` | 🛡️ | Add menu item |
| PUT | `/api/cafe-menu/:id` | 🛡️ | Update menu item |
| DELETE | `/api/cafe-menu/:id` | 🛡️ | Delete menu item |
| POST | `/api/admin/seed-cafe` | 🔑 | Seed menu data |
| DELETE | `/api/cafe-menu/inactive/all` | 🔑 | Bulk delete all inactive menu items |

---

## FAQs

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/faqs` | 🔓 | List public FAQs |
| GET | `/api/admin/faqs` | 🛡️ | List all FAQs (admin) |
| POST | `/api/admin/faqs` | 🛡️ | Create FAQ |
| PUT | `/api/admin/faqs/:id` | 🛡️ | Update FAQ |
| DELETE | `/api/admin/faqs/:id` | 🛡️ | Delete FAQ |
| POST | `/api/admin/faqs/reorder` | 🛡️ | Reorder FAQs |
| POST | `/api/admin/faqs/seed` | 🛡️ | Seed FAQ data |

---

## Analytics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/analytics/booking-stats` | 🛡️ | Core booking stats: peak hours heatmap, resource utilization, top members |
| GET | `/api/analytics/extended-stats` | 🛡️ | Extended stats: bookings over time, revenue by category, utilization by hour, active/inactive members, booking frequency |
| GET | `/api/analytics/membership-insights` | 🛡️ | Membership insights: tier distribution, at-risk members, new member growth |

---

## Training

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/training-sections` | 🛡️ | List training sections |
| POST | `/api/admin/training-sections` | 🔑 | Create training section |
| PUT | `/api/admin/training-sections/:id` | 🔑 | Update training section |
| DELETE | `/api/admin/training-sections/:id` | 🔑 | Delete training section |
| POST | `/api/admin/training-sections/seed` | 🔑 | Seed training data |

---

## Bug Reports

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/bug-reports` | 👤 | Submit bug report |
| GET | `/api/admin/bug-reports` | 🛡️ | List bug reports |
| GET | `/api/admin/bug-reports/:id` | 🛡️ | Get bug report details |
| PUT | `/api/admin/bug-reports/:id` | 🛡️ | Update bug report |
| DELETE | `/api/admin/bug-reports/:id` | 🛡️ | Delete bug report |

---

## Inquiries

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/inquiries` | 🛡️ | List inquiries |
| GET | `/api/admin/inquiries/:id` | 🛡️ | Get inquiry details |
| PUT | `/api/admin/inquiries/:id` | 🛡️ | Update inquiry |
| DELETE | `/api/admin/inquiries/:id` | 🛡️ | Delete inquiry |

---

## User Management (Staff/Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/staff-users` | 🛡️ | List staff users |
| GET | `/api/staff-users/by-email/:email` | 🛡️ | Get staff user by email |
| POST | `/api/staff-users` | 🔑 | Create staff user |
| PUT | `/api/staff-users/:id` | 🔑 | Update staff user |
| DELETE | `/api/staff-users/:id` | 🔑 | Delete staff user |
| GET | `/api/admin-users` | 🔑 | List admin users |
| POST | `/api/admin-users` | 🔑 | Create admin user |
| PUT | `/api/admin-users/:id` | 🔑 | Update admin user |
| DELETE | `/api/admin-users/:id` | 🔑 | Delete admin user |
| POST | `/api/users/batch-emails` | 🛡️ | Batch lookup users by email |

---

## Data Integrity

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/data-integrity/cached` | 🔑 | Get cached integrity check results |
| GET | `/api/data-integrity/run` | 🔑 | Run integrity checks |
| GET | `/api/data-integrity/summary` | 🔑 | Get integrity check summary |
| GET | `/api/data-integrity/history` | 🔑 | Get integrity check history |
| GET | `/api/data-integrity/health` | 🔑 | System health check |
| GET | `/api/data-integrity/audit-log` | 🔑 | Integrity audit log |
| GET | `/api/data-integrity/orphaned-stripe-customers` | 🔑 | List orphaned Stripe customers |
| POST | `/api/data-integrity/resolve` | 🔑 | Resolve integrity issue |
| POST | `/api/data-integrity/sync-push` | 🔑 | Push sync to external systems |
| POST | `/api/data-integrity/sync-pull` | 🔑 | Pull sync from external systems |
| POST | `/api/data-integrity/sync-stripe-metadata` | 🔑 | Sync Stripe metadata |
| GET | `/api/data-integrity/sync-stripe-metadata/status` | 🔑 | Stripe metadata sync status |
| POST | `/api/data-integrity/cleanup` | 🔑 | Run cleanup routines |
| POST | `/api/data-integrity/resync-from-production` | 🔑 | Resync data from production |
| GET | `/api/data-integrity/ignores` | 🔑 | List ignored issues |
| POST | `/api/data-integrity/ignore` | 🔑 | Ignore an issue |
| DELETE | `/api/data-integrity/ignore/:issueKey` | 🔑 | Un-ignore an issue |
| POST | `/api/data-integrity/ignore-bulk` | 🔑 | Bulk ignore issues |
| GET | `/api/data-integrity/placeholder-accounts` | 🔑 | List placeholder accounts |
| POST | `/api/data-integrity/placeholder-accounts/delete` | 🔑 | Delete placeholder accounts |

### Booking & Session Fixes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/data-integrity/fix/delete-guest-pass` | 🔑 | Delete guest pass |
| POST | `/api/data-integrity/fix/delete-fee-snapshot` | 🔑 | Delete fee snapshot |
| POST | `/api/data-integrity/fix/dismiss-trackman-unmatched` | 🔑 | Dismiss unmatched Trackman |
| POST | `/api/data-integrity/fix/delete-booking-participant` | 🔑 | Delete booking participant |
| POST | `/api/data-integrity/fix/fix-orphaned-participants` | 🔑 | Fix orphaned participants |
| POST | `/api/data-integrity/fix/convert-participant-to-guest` | 🔑 | Convert participant to guest |
| POST | `/api/data-integrity/fix/approve-review-item` | 🔑 | Approve review item |
| POST | `/api/data-integrity/fix/delete-review-item` | 🔑 | Delete review item |
| POST | `/api/data-integrity/fix/approve-all-review-items` | 🔑 | Approve all review items |
| POST | `/api/data-integrity/fix/delete-empty-session` | 🔑 | Delete empty session |
| POST | `/api/data-integrity/fix/assign-session-owner` | 🔑 | Assign session owner |
| POST | `/api/data-integrity/fix/complete-booking` | 🔑 | Force-complete booking |
| POST | `/api/data-integrity/fix/cancel-stale-booking` | 🔑 | Cancel stale booking |
| POST | `/api/data-integrity/fix/bulk-cancel-stale-bookings` | 🔑 | Bulk cancel stale bookings |
| POST | `/api/data-integrity/fix/bulk-attend-stale-bookings` | 🔑 | Bulk mark stale bookings as attended |
| POST | `/api/data-integrity/fix/recalculate-session-fees` | 🔑 | Recalculate session fees |
| POST | `/api/data-integrity/fix/bulk-recalculate-usage-ledger` | 🔑 | Bulk recalculate usage ledger |

### Member & Billing Fixes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/data-integrity/fix/unlink-hubspot` | 🔑 | Unlink HubSpot record |
| POST | `/api/data-integrity/fix/merge-hubspot-duplicates` | 🔑 | Merge HubSpot duplicates |
| POST | `/api/data-integrity/fix/merge-stripe-customers` | 🔑 | Merge Stripe customers |
| POST | `/api/data-integrity/fix/deactivate-stale-member` | 🔑 | Deactivate stale member |
| POST | `/api/data-integrity/fix/change-billing-provider` | 🔑 | Change billing provider |
| POST | `/api/data-integrity/fix/bulk-change-billing-provider` | 🔑 | Bulk change billing provider |
| POST | `/api/data-integrity/fix/delete-member-no-email` | 🔑 | Delete member without email |
| POST | `/api/data-integrity/fix/activate-stuck-member` | 🔑 | Activate stuck member |
| POST | `/api/data-integrity/fix/recalculate-guest-passes` | 🔑 | Recalculate guest passes |
| POST | `/api/data-integrity/fix/reconcile-all-guest-passes` | 🔑 | Reconcile all guest passes |
| POST | `/api/data-integrity/fix/release-guest-pass-hold` | 🔑 | Release guest pass hold |
| POST | `/api/data-integrity/fix/cancel-orphaned-pi` | 🔑 | Cancel orphaned PaymentIntent |
| POST | `/api/data-integrity/fix/delete-orphan-enrollment` | 🔑 | Delete orphan enrollment |
| POST | `/api/data-integrity/fix/delete-orphan-rsvp` | 🔑 | Delete orphan RSVP |
| POST | `/api/data-integrity/fix/delete-orphan-records-by-email` | 🔑 | Delete orphan records by email |
| POST | `/api/data-integrity/fix/mark-waiver-signed` | 🔑 | Mark waiver as signed |
| POST | `/api/data-integrity/fix/accept-tier` | 🔑 | Accept tier mismatch |
| POST | `/api/data-integrity/fix/update-tour-status` | 🔑 | Update tour status |
| POST | `/api/data-integrity/fix/clear-stripe-customer-id` | 🔑 | Clear stale Stripe customer ID |
| POST | `/api/data-integrity/fix/link-stripe-customer-only` | 🔑 | Link Stripe customer without subscription |
| POST | `/api/data-integrity/fix/reconnect-stripe-subscription` | 🔑 | Reconnect Stripe subscription |
| POST | `/api/data-integrity/fix/bulk-reconnect-stripe` | 🔑 | Bulk reconnect Stripe subscriptions |
| POST | `/api/data-integrity/fix/repair-jan2026-status-dates` | 🔑 | Repair Jan 2026 status dates |
| POST | `/api/data-integrity/fix/backfill-hubspot-last-modified` | 🔑 | Backfill HubSpot last modified dates |

---

## Data Tools

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/data-tools/resync-member` | 🔑 | Resync member data |
| GET | `/api/data-tools/unlinked-guest-fees` | 🔑 | Find unlinked guest fees |
| GET | `/api/data-tools/available-sessions` | 🔑 | List available sessions |
| POST | `/api/data-tools/link-guest-fee` | 🔑 | Link guest fee to session |
| GET | `/api/data-tools/bookings-search` | 🛡️ | Search bookings |
| POST | `/api/data-tools/update-attendance` | 🔑 | Update attendance records |
| POST | `/api/data-tools/mindbody-reimport` | 🔑 | Reimport from Mindbody |
| GET | `/api/data-tools/audit-log` | 🔑 | View audit log |
| GET | `/api/data-tools/staff-activity` | 🔑 | Staff activity report |
| POST | `/api/data-tools/cleanup-mindbody-ids` | 🔑 | Clean up Mindbody IDs |
| POST | `/api/data-tools/bulk-push-to-hubspot` | 🔑 | Bulk push to HubSpot |
| POST | `/api/data-tools/sync-members-to-hubspot` | 🔑 | Sync members to HubSpot |
| POST | `/api/data-tools/sync-subscription-status` | 🔑 | Sync subscription status |
| POST | `/api/data-tools/clear-orphaned-stripe-ids` | 🔑 | Clear orphaned Stripe IDs |
| POST | `/api/data-tools/link-stripe-hubspot` | 🔑 | Link Stripe to HubSpot |
| POST | `/api/data-tools/sync-visit-counts` | 🔑 | Sync visit counts |
| POST | `/api/data-tools/detect-duplicates` | 🔑 | Detect duplicate records |
| POST | `/api/data-tools/sync-payment-status` | 🔑 | Sync payment status |
| POST | `/api/data-tools/fix-trackman-ghost-bookings` | 🔑 | Fix Trackman ghost bookings |
| POST | `/api/data-tools/cleanup-stripe-customers` | 🔑 | Clean up Stripe customers |
| GET | `/api/data-tools/cleanup-stripe-customers/status` | 🔑 | Cleanup status |
| POST | `/api/data-tools/archive-stale-visitors` | 🔑 | Archive stale visitors |
| GET | `/api/data-tools/archive-stale-visitors/status` | 🔑 | Archive status |
| POST | `/api/data-tools/cleanup-ghost-fees` | 🔑 | Clean up ghost fees |

---

## Data Export

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/account/my-data` | 👤 | Download own data (GDPR) |
| GET | `/api/account/my-data/preview` | 👤 | Preview data export |
| GET | `/api/account/export-history` | 👤 | Export request history |

---

## Image Upload

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/upload-image` | 🛡️ | Upload image file |

---

## ID Scanner

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/scan-id` | 🛡️ | Scan ID document (OCR) |
| POST | `/api/admin/save-id-image` | 🛡️ | Save ID image |
| GET | `/api/admin/member/:userId/id-image` | 🛡️ | Get member ID image |
| DELETE | `/api/admin/member/:userId/id-image` | 🛡️ | Delete member ID image |

---

## Monitoring

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/monitoring/schedulers` | 🛡️ | Scheduler status |
| GET | `/api/admin/monitoring/webhooks` | 🛡️ | Webhook activity log |
| GET | `/api/admin/monitoring/webhook-types` | 🛡️ | Webhook type summary |
| GET | `/api/admin/monitoring/jobs` | 🛡️ | Job queue status |
| GET | `/api/admin/monitoring/hubspot-queue` | 🛡️ | HubSpot queue status |
| GET | `/api/admin/monitoring/alerts` | 🛡️ | System alerts |
| GET | `/api/admin/monitoring/audit-logs` | 🛡️ | Audit logs |
| GET | `/api/admin/monitoring/email-health` | 🛡️ | Email delivery health |
| GET | `/api/admin/monitoring/push-status` | 🛡️ | Push notification status |
| GET | `/api/admin/monitoring/auto-approve-config` | 🛡️ | Auto-approve configuration |
| GET | `/api/admin/monitoring/external-systems` | 🛡️ | External system health status |

---

## Email Templates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/email-templates` | 🛡️ | List email templates |
| GET | `/api/admin/email-templates/:templateId/preview` | 🛡️ | Preview email template |

---

## Passes (Redeemable)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/staff/passes/unredeemed` | 🛡️ | List unredeemed passes |
| GET | `/api/staff/passes/golf-sim/by-email` | 🛡️ | Lookup golf sim passes by member email |
| GET | `/api/staff/passes/search` | 🛡️ | Search passes |
| POST | `/api/staff/passes/:id/redeem` | 🛡️ | Redeem pass |
| GET | `/api/staff/passes/:passId/history` | 🛡️ | Pass history |
| POST | `/api/staff/passes/:passId/refund` | 🛡️ | Refund pass |

---

## Webhooks (Inbound)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/webhooks/trackman` | 🔐 | Trackman webhook receiver |
| POST | `/api/webhooks/resend` | 🔐 | Resend email webhook receiver |
| GET | `/api/webhooks/resend/health` | 🔓 | Resend webhook health |

Stripe webhook is handled separately via `express.raw()` middleware at the Express app level.

---

## Account & Notices

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/account/delete-request` | 👤 | Request account deletion |
| GET | `/api/notices/dismissed` | 👤 | Get dismissed notices |
| POST | `/api/notices/dismiss` | 👤 | Dismiss a notice |
| POST | `/api/notices/dismiss-all` | 👤 | Dismiss all notices |

---

## Kiosk Check-In

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/kiosk/checkin` | 🛡️ | Process kiosk member check-in (QR scan or manual lookup) |
| GET | `/api/kiosk/verify-staff` | 🛡️ | Verify staff session for kiosk mode |
| POST | `/api/kiosk/verify-passcode` | 🛡️ | Verify kiosk exit passcode |

---

## Kiosk Payments

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/kiosk/bookings/:id/pay-fees` | 🛡️ | Create payment intent for booking fees via kiosk (staff auth, resolves member by ID) |
| POST | `/api/kiosk/bookings/:id/confirm-payment` | 🛡️ | Confirm kiosk payment intent |
| POST | `/api/kiosk/bookings/:bookingId/cancel-payment` | 🛡️ | Cancel kiosk payment intent and restore account credit |

---

## Merch Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/merch` | 🔓 | List merch items (active only for public; all with `include_inactive=true` for staff) |
| POST | `/api/merch` | 🛡️ | Create merch item (auto-syncs to Stripe) |
| PUT | `/api/merch/:id` | 🛡️ | Update merch item (auto-syncs to Stripe) |
| DELETE | `/api/merch/:id` | 🛡️ | Delete merch item (archives Stripe product) |

---

## Fee Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/fee-products` | 🛡️ | List fee products (overage, guest fee, etc.) |
| POST | `/api/fee-products` | 🔑 | Create fee product (auto-syncs to Stripe) |
| PUT | `/api/fee-products/:id` | 🔑 | Update fee product (auto-syncs to Stripe) |
| DELETE | `/api/fee-products/:id` | 🔑 | Delete fee product (deletes Stripe product and prices) |

---

## Public Membership Checkout

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/public/membership-tiers` | 🔓 | List tiers eligible for self-serve checkout |
| POST | `/api/public/membership-checkout` | 🔓 | Self-serve membership checkout (rate-limited, creates Stripe subscription) |
| POST | `/api/public/day-pass/checkout` | 🔓 | Create day pass checkout session (public) |

---

## Apple Wallet Pass (PKPass API)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/member/wallet-pass` | 👤 | Download Apple Wallet pass (.pkpass) |
| GET | `/api/member/wallet-pass/status` | 👤 | Check if wallet pass is active |
| GET | `/api/member/booking-wallet-pass/:bookingId` | 👤 | Download booking-specific wallet pass |
| POST | `/api/admin/wallet-pass/push-update-all` | 🛡️ | Push APNs update to all registered passes |
| GET | `/api/wallet/v1/passes/:passTypeId/:serialNumber` | 👤 | Apple Wallet: get latest pass (session-authenticated) |
| POST | `/api/wallet/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber` | 👤 | Apple Wallet: register device (session-authenticated) |
| DELETE | `/api/wallet/v1/devices/:deviceLibraryId/registrations/:passTypeId/:serialNumber` | 👤 | Apple Wallet: unregister device (session-authenticated) |
| GET | `/api/wallet/v1/devices/:deviceLibraryId/registrations/:passTypeId` | 🔓 | Apple Wallet: list serial numbers for device |
| POST | `/api/wallet/v1/log` | 🔓 | Apple Wallet: receive device logs |

---

## Directory & Sync

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/directory/sync` | 🛡️ | Sync member directory |
| GET | `/api/directory/sync-status` | 🛡️ | Get directory sync status |

---

## Calendar Admin

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/admin/backfill-availability-blocks` | 🛡️ | Backfill availability blocks from calendar |
| POST | `/api/admin/backfill-calendar-extended-properties` | 🔑 | Backfill calendar extended properties |
| GET | `/api/admin/backfill-calendar-extended-properties/status` | 🔑 | Backfill status |
| GET | `/api/admin/calendar/cleanup-status` | 🛡️ | Calendar cleanup status |
| POST | `/api/admin/calendar/migrate-clean-descriptions` | 🔑 | Migrate calendar descriptions |
| POST | `/api/admin/calendar/sync-all` | 🛡️ | Sync all Google Calendars |
| POST | `/api/admin/bookings/:id/simulate-confirm` | 🛡️ | Simulate booking confirmation (dry run) |
| GET | `/api/tours/scheduler-url` | 🔓 | Get tour scheduler URL |

---

## Miscellaneous

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/mapkit-token` | 🔓 | Get Apple MapKit JS token |
| GET | `/api/members/:email/contact-info` | 🛡️ | Get member contact info |
| PUT | `/api/members/:email/contact-info` | 🛡️ | Update member contact info |
| GET | `/api/members/:email/profile-details` | 🛡️ | Get member profile details |
| PUT | `/api/members/:email/profile-details` | 🛡️ | Update member profile details |
| POST | `/api/members/me/data-export-request` | 👤 | Request personal data export |
