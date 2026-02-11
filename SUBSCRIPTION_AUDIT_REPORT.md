# Membership Subscription System — Forensic Audit Report

**Date:** February 11, 2026  
**Scope:** Subscription activation links, terminal payments, payment intents, webhooks, group billing, database schema, error handling

---

## Executive Summary

The subscription system is architecturally sound with good separation of concerns across activation links (Stripe Checkout), terminal card-reader payments, and inline payment flows. Webhook deduplication with priority-based ordering is well-implemented. Group/family billing cascades status changes correctly. However, **6 bugs** and **9 risk areas** were identified that could cause real member-facing issues.

---

## 1. Subscription Activation Link Flow

**File:** `server/routes/stripe/subscriptions.ts` (lines 680–875)

### How It Works
1. Staff sends activation link via `/api/stripe/subscriptions/send-activation-link`
2. Creates or updates a user record with `membership_status = 'pending'`
3. Creates a Stripe Checkout Session (mode: subscription) with a 23-hour expiry
4. Emails the checkout URL to the member
5. On checkout completion, Stripe fires `customer.subscription.created` webhook which activates the member

### Findings

**GOOD:**
- Validates tier exists and has a Stripe price configured before creating the session
- Handles existing users (resend), archived users (unarchive), and active members (blocks duplicate)
- Blocks activation for users already in `pending` status with a helpful cleanup message
- Subscription metadata carries `tierSlug`, `tier`, `userId`, `memberEmail` for webhook to use
- Checkout session has `expires_at` set to 23 hours (within Stripe's 24h max)

**BUG #1 — Cleanup deletes user but may orphan Stripe customer subscriptions:**
- `cleanup-pending/:userId` (line 877) deletes the user and the Stripe customer
- However, if a Stripe subscription was already created (e.g., checkout was completed but webhook hasn't fired yet), the subscription becomes orphaned
- The endpoint only checks `membership_status !== 'pending'` but doesn't check for active Stripe subscriptions before deleting
- **Impact:** Rare but possible — a subscription could keep billing with no associated user record
- **Fix:** Before cleanup, check for and cancel any active Stripe subscriptions on the customer

**RISK — No expiration cleanup for pending users:**
- When a checkout session expires (23h), the user remains in `pending` status forever
- No scheduler exists to clean up expired pending users or expired checkout sessions
- **Impact:** Stale pending users accumulate, blocking new activation links for the same email
- **Fix:** Add a scheduler that cleans up pending users whose checkout sessions have expired

---

## 2. Terminal Payment Activation Flow

**File:** `server/routes/stripe/terminal.ts` (lines 358–734)

### How It Works
1. `/process-subscription-payment`: Takes the subscription's invoice PaymentIntent, reconfigures it for `card_present`, and presents it to the terminal reader
2. `/confirm-subscription-payment`: After card tap succeeds, saves the generated reusable card, sets member to active

### Findings

**GOOD:**
- Validates user exists and is in `pending`/`incomplete` status before processing
- Cancels stale PaymentIntents from previous failed attempts (inline + terminal)
- Validates PI metadata matches the subscription and user being activated
- Validates payment amount matches invoice amount
- Auto-refunds if user record is missing at confirmation time
- Records payment in `terminal_payments` table with idempotency check
- Correctly extracts `generated_card` from `card_present` payment for reusable billing

**BUG #2 — Terminal activation doesn't verify card was saved before marking active:**
- Lines 691–696: Sets `membershipStatus = 'active'` regardless of whether `cardSaved` is true or false
- If `generated_card` is missing (line 643 warns about this), the member becomes active with NO payment method for future billing
- Next month's invoice will immediately fail
- **Impact:** Member gets activated, first renewal fails, member goes to `past_due`
- **Fix:** If `cardSaved` is false, either block activation or prominently warn staff that future billing will fail

**BUG #3 — Fallback PI not linked to invoice:**
- Lines 460–478: When no invoice PI exists, a separate PaymentIntent is created
- This separate PI pays the correct amount but is NOT linked to the subscription's invoice
- The invoice remains unpaid, so the subscription stays `incomplete` even after terminal payment succeeds
- **Impact:** Payment collected but subscription not activated via Stripe's own lifecycle
- **Fix:** Use `stripe.invoices.pay()` with the terminal payment method instead of creating a detached PI

**RISK — No timeout for terminal reader action:**
- After `processPaymentIntent` is called on the reader, there's no server-side timeout
- If the reader hangs or the customer walks away, the PI stays in `requires_payment_method` indefinitely
- The stale PI cleanup only runs on the next attempt, not proactively
- **Fix:** Consider a scheduler or TTL check for terminal PIs older than 15 minutes

---

## 3. Payment Intent vs Setup Intent Handling

**File:** `server/core/stripe/subscriptions.ts`

### How It Works
- Uses `payment_behavior: 'default_incomplete'` which creates a subscription with an unpaid invoice
- The invoice's PaymentIntent is then paid via terminal or inline payment
- Uses `save_default_payment_method: 'on_subscription'` so Stripe auto-saves the card

### Findings

**GOOD:**
- `default_incomplete` is the correct pattern for in-person activation — it doesn't charge immediately
- `save_default_payment_method: 'on_subscription'` correctly handles future billing

**RISK — No SetupIntent path for free trials:**
- Trial subscriptions via activation links use Checkout which handles card collection
- But terminal-initiated trials (if supported) would have no card collection mechanism since `default_incomplete` with a $0 invoice creates no PaymentIntent
- **Impact:** Low — trials appear to only go through activation links currently

---

## 4. Webhook Event Processing and Deduplication

**File:** `server/core/stripe/webhooks.ts` (lines 1–140)

### How It Works
1. **Deduplication:** `tryClaimEvent` inserts into `webhook_processed_events` with `ON CONFLICT DO NOTHING` — atomic claim
2. **Priority ordering:** `checkResourceEventOrder` uses a priority map to prevent out-of-order processing (e.g., prevents a `subscription.created` from reactivating after `subscription.deleted`)
3. **Special exception:** `subscription.created` always passes priority check (line 121–123) since it should never be skipped
4. **Dedup window:** 7 days (`EVENT_DEDUP_WINDOW_DAYS`)
5. **Deferred actions:** Email sends and external API calls happen after the DB transaction commits

### Findings

**GOOD:**
- Atomic dedup via INSERT + ON CONFLICT is race-condition safe
- Priority system prevents the dangerous "deleted then created out-of-order" reactivation
- Deferred actions pattern prevents partial state if email/HubSpot fails
- Transaction cache (`stripe_transaction_cache`) provides a queryable copy of Stripe data

**BUG #4 — `subscription.created` priority exception may cause ghost reactivation:**
- Line 121–123: `subscription.created` always passes the priority check, even after `subscription.deleted` (priority 20)
- Scenario: Member cancels → `subscription.deleted` fires → then a delayed `subscription.created` for the SAME subscription ID arrives (Stripe retries from hours ago)
- The stale `created` event would re-insert the user as active
- **Impact:** Very rare but possible during webhook retry storms
- **Fix:** The exception should check if the resource already has a `subscription.deleted` event specifically, not just compare priorities

**RISK — No cleanup of `webhook_processed_events`:**
- Events accumulate with a 7-day conceptual window, but no actual cleanup scheduler exists
- The table will grow indefinitely
- **Fix:** Add a periodic cleanup: `DELETE FROM webhook_processed_events WHERE processed_at < NOW() - INTERVAL '7 days'`

---

## 5. Webhook Subscription Handlers

### handleSubscriptionCreated (lines 2162–2698)

**GOOD:**
- Resolves user by `stripe_customer_id` first, then by metadata email, then creates from Stripe customer data
- Handles linked emails via `resolveUserByEmail`
- Maps Stripe statuses to internal statuses correctly
- Auto-creates corporate billing groups for volume pricing purchases
- Clears grace period on new subscription
- Sends trial welcome QR email for trialing subscriptions
- Tier resolution has 3 fallback layers: metadata → price ID → product name keyword match

**BUG #5 — Undefined `status` variable in product name fallback path:**
- Line 2616: `status: status` references a variable `status` that is NOT defined in `handleSubscriptionCreated`
- The `status` variable only exists in `handleSubscriptionUpdated` (line 2704)
- In `handleSubscriptionCreated`, the subscription status is accessed via `subscription.status`
- **Impact:** HubSpot sync for product-name-matched tiers will send `undefined` as the status
- **Fix:** Change `status` to `subscription.status` on line 2616

**RISK — Duplicate tier update queries:**
- The function updates the user's tier in up to 3 places: the initial user creation/update (lines 2293–2320), the "closed-loop activation" block (lines 2494–2509), and the grace period cleanup (lines 2648–2661)
- Each uses slightly different logic for which fields to update
- **Impact:** Mostly harmless but creates unnecessary DB load and risk of inconsistency

### handleSubscriptionUpdated (lines 2700–3064)

**GOOD:**
- Detects subscription item changes and delegates to `handleSubscriptionItemsChanged` for group billing
- Propagates `past_due`, `unpaid`/`suspended`, and `active` status to sub-members in billing groups
- Reactivates sub-members when primary subscription returns to `active`
- Won't downgrade status from `cancelled`/`suspended`/`terminated` back to `active` (line 2838)

**RISK — Tier update doesn't verify subscription matches:**
- Lines 2784–2787: Updates the user's tier based on the subscription's price, but doesn't verify `stripe_subscription_id` matches
- If a user has multiple Stripe customers or subscriptions, a stale update event could change the tier incorrectly
- **Impact:** Low — most users have one subscription

### handleSubscriptionDeleted (lines 3066–3255)

**GOOD:**
- Calls `handlePrimarySubscriptionCancelled` first for group billing cascade
- Trial cancellations get `paused` status (account preserved, not deleted)
- Verifies `stripe_subscription_id` matches before cancelling (prevents stale events from cancelling a new subscription)
- Saves `last_tier` before clearing `tier` for re-signup reference
- Detects and alerts staff about orphaned group members
- Deactivates the billing group itself

**RISK — Group deactivation happens in two places:**
- `handlePrimarySubscriptionCancelled` (groupBilling.ts) deactivates group members and sets their status to `cancelled`
- `handleSubscriptionDeleted` (webhooks.ts) also deactivates the billing group (lines 3181–3187)
- The `handlePrimarySubscriptionCancelled` function does NOT deactivate the billing group itself — it only deactivates members
- This is actually correct (webhook handler does the group deactivation), but the split responsibility could cause issues if either path fails independently

---

## 6. Group/Family Billing

**File:** `server/core/stripe/groupBilling.ts`

### How It Works
- Family groups: FAMILY20 coupon (20% discount), add members as subscription items
- Corporate groups: Volume pricing with quantity-based subscriptions
- `handlePrimarySubscriptionCancelled`: Cascades cancellation to all sub-members

### Findings

**GOOD:**
- `handlePrimarySubscriptionCancelled` atomically deactivates all group members and clears their access
- Corporate group auto-creation from subscription metadata during webhook processing
- Status propagation (past_due, suspended, active) cascades to sub-members correctly

**BUG #6 — `handlePrimarySubscriptionCancelled` doesn't deactivate the billing group:**
- Lines 1682–1742: Deactivates all `group_members` and sets users to `cancelled`
- But does NOT set `billing_groups.is_active = false`
- The webhook handler (line 3181–3187) does this separately
- If `handlePrimarySubscriptionCancelled` is called from anywhere other than the webhook handler, the billing group stays active with no members
- **Impact:** The group appears active in admin UI even though all members are deactivated
- **Fix:** Add `billing_groups.is_active = false` update to `handlePrimarySubscriptionCancelled`

---

## 7. Database Schema Integrity

### Key Tables
- `users`: `stripe_customer_id`, `stripe_subscription_id`, `membership_status`, `tier`, `billing_provider`, `grace_period_start`, `last_tier`
- `billing_groups`: `primary_email`, `primary_stripe_subscription_id`, `is_active`, `type` (family/corporate)
- `group_members`: `billing_group_id`, `member_email`, `is_active`, `removed_at`, `stripe_subscription_item_id`
- `webhook_processed_events`: `event_id` (unique), `event_type`, `resource_id`, `processed_at`
- `terminal_payments`: `stripe_payment_intent_id`, `stripe_subscription_id`, `user_id`, `status`
- `stripe_transaction_cache`: Full copy of Stripe objects for local querying

### Findings

**GOOD:**
- `webhook_processed_events.event_id` has unique constraint for atomic dedup
- `terminal_payments` tracks all terminal transactions with full audit trail
- `users` table stores `last_tier` on cancellation for re-signup context
- Grace period fields (`grace_period_start`, `grace_period_email_count`) enable graduated dunning

**RISK — No foreign key between users and billing_groups:**
- `billing_groups.primary_email` references users by email (string match), not by user ID
- Email changes or linked email resolution could break the association
- **Impact:** Low — email is stable in this system, but not ideal for referential integrity

**RISK — `stripe_subscription_id` not unique on users table:**
- Multiple users could theoretically have the same `stripe_subscription_id`
- This is by design for group billing (sub-members share the primary's subscription)
- But could mask data issues if a subscription is accidentally assigned to the wrong user

---

## 8. Error Handling and Edge Cases

### Findings

**GOOD:**
- HubSpot sync failures are caught and logged but never block subscription processing
- HubSpot tier sync has a retry queue (`queueTierSync`) for failed syncs
- Terminal confirmation auto-refunds if user record is missing
- Webhook handlers throw errors to trigger Stripe's automatic retry mechanism
- Deferred actions (emails, external syncs) run after DB transaction commits
- Stale PaymentIntent cleanup before terminal payment prevents double-charging

**RISK — No retry mechanism for failed notification emails:**
- `sendMembershipActivationEmail`, `sendTrialWelcomeWithQrEmail`, etc. are fire-and-forget
- If the email service is down, the member never gets their activation link or welcome email
- The activation link URL is only available during the original request
- **Impact:** Member has no way to access their checkout link if the email fails

**RISK — Race condition in subscription sync:**
- `syncActiveSubscriptionsFromStripe` (subscriptionSync.ts) sets all synced users to `membership_status = 'active'`
- If run concurrently with webhook processing, it could reactivate a user that was just cancelled
- The sync uses `pool.query` (not within the webhook's transaction), so there's no isolation
- **Fix:** The sync should skip users whose `updated_at` is more recent than the sync start time

---

## Summary of All Issues

### Bugs (should fix)
| # | Severity | Location | Description |
|---|----------|----------|-------------|
| 1 | Medium | subscriptions.ts:877 | Cleanup deletes user without checking for active Stripe subscriptions |
| 2 | High | terminal.ts:691 | Terminal activation doesn't verify card was saved before marking active |
| 3 | High | terminal.ts:460 | Fallback PI not linked to subscription invoice — payment succeeds but subscription stays incomplete |
| 4 | Low | webhooks.ts:121 | `subscription.created` priority exception could cause ghost reactivation after deletion |
| 5 | Medium | webhooks.ts:2616 | Undefined `status` variable — HubSpot sync sends `undefined` for product-name-matched tiers |
| 6 | Medium | groupBilling.ts:1682 | `handlePrimarySubscriptionCancelled` doesn't deactivate the billing group itself |

### Risks (should address)
| # | Priority | Description |
|---|----------|-------------|
| 1 | High | No expiration cleanup for pending users with expired checkout sessions |
| 2 | Medium | No timeout/cleanup for abandoned terminal reader sessions |
| 3 | Low | No cleanup scheduler for `webhook_processed_events` table |
| 4 | Medium | Subscription sync could race with webhook cancellations |
| 5 | Low | No retry for failed activation/welcome emails |
| 6 | Low | Duplicate tier update queries in `handleSubscriptionCreated` |
| 7 | Low | No foreign key between `billing_groups` and `users` |
| 8 | Low | Group deactivation split across two functions |
| 9 | Low | Terminal fallback PI idempotency key includes `Date.now()` — not truly idempotent |

---

## Recommended Priority Actions

1. **Fix Bug #2** (terminal card save) — Prevent members from activating without a payment method
2. **Fix Bug #3** (fallback PI) — Ensure terminal payments actually activate the Stripe subscription
3. **Fix Bug #5** (undefined status) — Quick one-line fix for HubSpot sync accuracy
4. **Fix Bug #6** (group deactivation) — Add billing group deactivation to the centralized function
5. **Add pending user expiration scheduler** — Clean up abandoned activation links
6. **Fix Bug #1** (cleanup orphan check) — Check for subscriptions before deleting customers
