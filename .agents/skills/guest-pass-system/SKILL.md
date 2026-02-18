---
name: guest-pass-system
description: "Guest pass lifecycle — allocation, holds, consumption, refunds, and monthly reset. Covers guest pass holds during booking, pass consumption at check-in, refund on cancellation, tier-based allocation, monthly reset scheduler, and the pending guest count system. Use when modifying guest pass logic, debugging pass counts, adding guest features, or working on check-in guest handling."
---

## Overview

Each membership tier grants a monthly allocation of guest passes. Members use these passes to bring guests to bookings without paying the guest fee. The system tracks passes through a hold/consume lifecycle that integrates with booking creation and check-in.

**Lifecycle:** Available → Held (booking created) → Consumed (check-in) or Released (cancellation)

**Key interactions:**
- Booking creation: hold passes for guests in the booking request
- Check-in: consume held passes, waiving the guest fee
- Cancellation: release held passes back to available pool
- Monthly reset: reset all passes_used to 0 on the 1st of each month

## Key Files

| File | Purpose |
|------|---------|
| `server/routes/guestPasses.ts` | REST endpoints, exported helper functions (`useGuestPass`, `refundGuestPass`, `getGuestPassesRemaining`, `ensureGuestPassRecord`) |
| `server/core/billing/guestPassConsumer.ts` | Transactional pass consumption at check-in, refund logic, availability check |
| `server/core/billing/guestPassHoldService.ts` | Hold creation/release during booking lifecycle, hold-to-usage conversion, expired hold cleanup |
| `server/schedulers/guestPassResetScheduler.ts` | Monthly reset scheduler (1st of month, 3 AM Pacific) |

## Database Tables

### guest_passes
| Column | Type | Description |
|--------|------|-------------|
| member_email | text | Normalized (lowercase) member email |
| passes_used | integer | Passes consumed this month |
| passes_total | integer | Monthly allocation from tier |

### guest_pass_holds
| Column | Type | Description |
|--------|------|-------------|
| member_email | text | Normalized member email |
| booking_id | integer | Associated booking request ID |
| passes_held | integer | Number of passes reserved |
| expires_at | timestamp | Hold expiration (30 days from creation) |

## Tier-Based Allocation

- `passes_total` derives from `membership_tiers.guest_passes_per_month` via `getTierLimits()`
- Auto-update on tier change: the GET `/api/guest-passes/:email` endpoint compares current `passes_total` against the tier config and updates if mismatched
- On upgrade: increase `passes_total` to new tier value
- On downgrade: decrease `passes_total` and clamp `passes_used` to not exceed new total (`Math.min(passes_used, newTotal)`)

## Hold Phase (Booking Creation)

### createGuestPassHold()
**File:** `server/core/billing/guestPassHoldService.ts`
**Signature:** `createGuestPassHold(memberEmail, bookingId, passesNeeded, externalClient?)`

1. Acquire `SELECT FOR UPDATE` lock on the `guest_passes` row
2. Calculate available passes: `total - used - activeHolds`
3. Determine passes to hold: `Math.min(passesNeeded, available)`
4. Return error if `passesToHold <= 0` and `passesNeeded > 0`
5. Insert into `guest_pass_holds` with 30-day expiry
6. Return `{ holdId, passesHeld, passesAvailable }`

Supports an optional `externalClient` (PoolClient) to participate in an outer transaction.

### getAvailableGuestPasses()
**Signature:** `getAvailableGuestPasses(memberEmail, tierName?, externalClient?)`

Calculate available passes accounting for both used passes AND active (non-expired) holds:
`available = passesTotal - passesUsed - activeHolds`

Auto-updates `passes_total` if the tier grants more than current total.

### releaseGuestPassHold()
**Signature:** `releaseGuestPassHold(bookingId)`

Delete all holds for the given `bookingId` from `guest_pass_holds`. Use on booking cancellation.

### convertHoldToUsage()
**Signature:** `convertHoldToUsage(bookingId, memberEmail)`

Atomically convert held passes to used passes within a transaction:
1. `SELECT FOR UPDATE` on the hold row
2. Increment `passes_used` by `passes_held` amount
3. Delete the hold row

Use at check-in when transitioning from hold to consumption.

### cleanupExpiredHolds()
Delete all holds where `expires_at < NOW()`. Run periodically to reclaim expired reservations.

## Consumption Phase (Check-In)

**See [checkin-flow skill](../checkin-flow/SKILL.md) for the full check-in context in which guest pass consumption occurs.**

### consumeGuestPassForParticipant()
**File:** `server/core/billing/guestPassConsumer.ts`
**Signature:** `consumeGuestPassForParticipant(participantId, ownerEmail, guestName, sessionId, sessionDate, staffEmail?)`

Full transactional flow (see `references/hold-consume-flow.md` for step-by-step):
1. Reject placeholder guests (`/^Guest \d+$/i`)
2. Check idempotency — skip if `used_guest_pass` already `true`
3. Look up tier `guest_passes_per_month` from `users` JOIN `membership_tiers`
4. Create or update `guest_passes` record with `SELECT FOR UPDATE`
5. Reject if no passes remaining (`passes_used >= passes_total`)
6. Increment `passes_used`
7. Update `usage_ledger`: set `guest_fee = 0`, `payment_method = 'guest_pass'`
8. Update `booking_participants`: `payment_status = 'waived'`, `cached_fee_cents = 0`, `used_guest_pass = TRUE`
9. Insert `legacy_purchases` record (category `'guest_pass'`, `item_total_cents = 0`)
10. Insert notification
11. Clean up associated hold (decrement or delete from `guest_pass_holds`)

### canUseGuestPass()
**Signature:** `canUseGuestPass(ownerEmail)`

Quick check returning `{ canUse, remaining, total }`. Look up tier passes, compare against current usage.

### refundGuestPassForParticipant()
**Signature:** `refundGuestPassForParticipant(participantId, ownerEmail, guestName)`

Reverse of consume (see `references/hold-consume-flow.md` for step-by-step):
1. Verify `used_guest_pass === true` on participant; skip if not
2. Decrement `passes_used` (with `GREATEST(0, ...)` floor)
3. Look up Stripe guest fee price from `membership_tiers` where name = `'guest pass'`
4. Reset participant: `payment_status = 'pending'`, `cached_fee_cents = guestFeeCents`, `used_guest_pass = FALSE`
5. Delete matching `legacy_purchases` record (most recent by `created_at`)

## Route Endpoints

### GET /api/guest-passes/:email
Require authentication. Members can view own passes; staff can view any member.

**Response:**
```json
{
  "passes_used": 1,
  "passes_total": 4,
  "passes_remaining": 3,
  "passes_pending": 2,
  "passes_remaining_conservative": 1
}
```

- Auto-creates `guest_passes` record if missing
- Auto-updates `passes_total` to match current tier allocation
- Clamps `passes_used` on downgrade
- `passes_pending`: count of guests in pending/approved bookings (from `requestParticipants` JSONB, entries with `type='guest'` that have `email` or `userId` set)
- `passes_remaining_conservative`: `passes_remaining - pending_guest_count` (floored at 0)

### POST /api/guest-passes/:email/use
Manual guest pass use. Reject placeholder guests. Increment `passes_used`, create notification, broadcast WebSocket update.

### PUT /api/guest-passes/:email
Staff-only. Set `passes_total` to a custom value (manual override). Require `isStaffOrAdmin` middleware.

## Exported Helper Functions

From `server/routes/guestPasses.ts`:
- `useGuestPass(memberEmail, guestName?, sendNotification?)` — programmatic pass use with transaction, notification, and WebSocket broadcast
- `refundGuestPass(memberEmail, guestName?, sendNotification?)` — programmatic refund with transaction, notification, and WebSocket broadcast
- `getGuestPassesRemaining(memberEmail, tier?)` — return remaining passes count
- `ensureGuestPassRecord(memberEmail, tier?)` — create `guest_passes` record if missing; use during member creation

## Monthly Reset

**File:** `server/schedulers/guestPassResetScheduler.ts`

- Run via `setInterval` every hour (3600s)
- Only act when `getPacificHour() === 3` AND `getPacificDayOfMonth() === 1`
- Idempotent via `system_settings` key `'last_guest_pass_reset'` with month key `YYYY-MM`
- Use `INSERT ... ON CONFLICT DO UPDATE ... WHERE value IS DISTINCT FROM` to claim the reset slot
- Reset SQL: `UPDATE guest_passes SET passes_used = 0 WHERE passes_used > 0`
- Log each reset member email and total

See `references/allocation-reset.md` for scheduler internals.

## Pending Guest Count

The GET endpoint calculates pending guest count by:
1. Query `booking_requests` where `userEmail` matches and status is `pending`, `pending_approval`, `approved`, or `confirmed`
2. Parse `requestParticipants` JSONB array
3. Count entries where `type === 'guest'` AND (`email` or `userId` is set)
4. `passes_remaining_conservative = Math.max(0, passes_remaining - pendingGuestCount)`

## Rules

- Always normalize email to lowercase for all guest pass operations
- Reject placeholder guests (`"Guest 1"`, `"Guest 2"`, etc.) from pass consumption via regex `/^Guest \d+$/i`
- Guest pass holds expire after 30 days
- Call `broadcastMemberStatsUpdated(email, { guestPasses: remaining })` after pass use/refund to update the UI via WebSocket
- All transactional operations use `BEGIN`/`COMMIT`/`ROLLBACK` with proper error handling
- Use `SELECT FOR UPDATE` to prevent race conditions on concurrent pass operations
