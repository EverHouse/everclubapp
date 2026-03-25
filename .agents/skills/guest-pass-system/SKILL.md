---
name: guest-pass-system
description: "Guest pass lifecycle — allocation, holds, consumption, refunds, and yearly reset. Covers guest pass holds during booking, pass consumption at check-in, refund on cancellation, tier-based allocation, yearly reset scheduler, and the pending guest count system. Use when modifying guest pass logic, debugging pass counts, adding guest features, or working on check-in guest handling."
---

# Guest Pass System

**Lifecycle:** Available → Held (booking created) → Consumed (check-in) or Released (cancellation)

## File Map

| Task | Primary File(s) | When to touch |
|---|---|---|
| REST endpoints + helpers | `server/routes/guestPasses.ts` | API, `useGuestPass`, `refundGuestPass`, `getGuestPassesRemaining` |
| Consumption/refund logic | `server/core/billing/guestPassConsumer.ts` | `consumeGuestPassForParticipant`, `refundGuestPassForParticipant` |
| Hold lifecycle | `server/core/billing/guestPassHoldService.ts` | `createGuestPassHold`, `releaseGuestPassHold`, `convertHoldToUsage` |
| Yearly reset | `server/schedulers/guestPassResetScheduler.ts` | Reset scheduler (January 1st, 3 AM Pacific) |

## Decision Trees

### Guest pass flow through a booking

```
Booking created with guests
  → createGuestPassHold(email, bookingId, passesNeeded)
    ├── Passes available? → Hold created (30-day expiry)
    └── No passes? → Hold fails (booking proceeds, guest pays fee)

Booking approved / session created
  → convertHoldToUsage(bookingId, email) [inside transaction]
    ├── Hold exists? → Increment passes_used, delete hold
    └── No hold? → Direct deduction from guest_passes

Check-in: staff clicks "Use Guest Pass"
  → consumeGuestPassForParticipant(participantId, ownerEmail, ...)
    ├── Placeholder guest? → REJECT (real name required)
    ├── Already consumed? → Skip (idempotent)
    ├── Passes remaining? → Consume, waive fee, notify
    └── No passes? → REJECT

Booking cancelled
  → releaseGuestPassHold(bookingId) [delete holds]
    └── Runs AFTER hard-delete transaction commits (v8.87.35)
        └── Prevents premature release if delete fails partway
  → If >= 1hr before start: refundGuestPassForParticipant()
  → If < 1hr before start: passes forfeited
```

## Hard Rules

1. **Always normalize email to lowercase** for all guest pass operations.
2. **Reject placeholder guests** (`/^Guest \d+$/i`) from pass consumption.
3. **Holds expire after 30 days.** `cleanupExpiredHolds()` reclaims them.
4. **Hold-to-usage uses `Math.min(passesHeld, guestPassesUsed)`.** Never trust holds match final guest count.
5. **Guest pass refund window: 1 hour.** Cancellation >= 1hr before start → refund passes. Late cancellation → forfeited.
6. **Never refund from `tryLinkCancelledBooking`.** Cancellation workflows handle their own refunds.
7. **Use `SELECT FOR UPDATE`** on `guest_passes` for all atomic operations.
8. **Broadcast after pass use/refund.** `broadcastMemberStatsUpdated(email, { guestPasses: remaining })`.
9. **Auto-update allocation on tier change (safe clamping).** All three runtime sync paths (`guestPassConsumer.ts`, `guestPassHoldService.ts`, `sessionManager.ts`) compare `passes_total` against tier config and use `Math.max(tierAllocation, passesUsed)` to prevent setting `passes_total` below `passes_used` (which would violate the `guest_passes_usage_check` CHECK constraint). A warning is logged when clamping occurs. The startup reconciliation in `startup.ts` also uses `GREATEST(passes_total, used_count)` for the same reason.
10. **Yearly reset is idempotent.** Uses `system_settings` key `'last_guest_pass_reset'` with year key `YYYY`. Runs only on January 1st, 3am–8am Pacific catch-up window.
11. **Tier lookup fail-closed (v8.95.4).** When `guest_passes_per_year` lookup returns null (e.g., member has no `tier_id` linkage), both `consumeGuestPass()` and `canUseGuestPass()` default to **0 passes** (not 4). A `logger.warn` fires to flag members with broken tier linkage.

## Anti-Patterns (NEVER)

1. NEVER consume guest passes for placeholder guests ("Guest 1", "Guest 2").
2. NEVER refund guest passes from `tryLinkCancelledBooking`.
3. NEVER skip `SELECT FOR UPDATE` on concurrent pass operations. `createGuestPassHold`, `convertHoldToUsage`, and `consumeGuestPassForParticipant` all use `FOR UPDATE` with `UPDATE WHERE passes_used < passes_total` guards (v8.86.0 — verified with 14 concurrency tests in `tests/guestPassConcurrency.test.ts`).
4. NEVER trust that holds match the final guest count — use `Math.min()`.
5. NEVER ignore `refundGuestPass()` return value — always check `refundResult.success`. The function returns `{success: false}` on failure instead of throwing, so catch blocks alone are dead code. All 4 cancellation paths (member cancel, staff cancel, complete pending cancellation, bookingStateService) now check the return value (v8.87.31).
6. NEVER call `refundGuestPass()` without passing `txClient` when inside an existing transaction — creating a nested `db.transaction()` inside an active transaction causes a deadlock. `bookingStateService.ts` passes `tx` for this reason (v8.87.34).

## Cross-References

- **Fee calculation (guest fee exemptions)** → `fee-calculation` skill
- **Check-in consumption flow** → `checkin-flow` skill
- **Booking creation (hold phase)** → `booking-flow` skill
- **Yearly reset scheduler** → `scheduler-jobs` skill

## Detailed Reference

- **[references/hold-consume-flow.md](references/hold-consume-flow.md)** — Step-by-step transactional flow for consumption and refund.
- **[references/allocation-reset.md](references/allocation-reset.md)** — Yearly reset scheduler internals.

---

## Database Tables

### guest_passes

| Column | Type | Description |
|---|---|---|
| member_email | text | Normalized (lowercase) |
| passes_used | integer | Consumed this year |
| passes_total | integer | Annual allocation from tier |

### guest_pass_holds

| Column | Type | Description |
|---|---|---|
| member_email | text | Normalized |
| booking_id | integer | Associated booking request |
| passes_held | integer | Passes reserved |
| expires_at | timestamp | 30 days from creation |

## Available Passes Formula

`available = passes_total - passes_used - active_holds`

**v8.97.28 — Holds shown in remaining count**: `getGuestPassesRemaining()` now subtracts active holds from the available count. The member-facing display shows the conservative estimate accounting for pending booking holds.

## Pending Guest Count

GET endpoint calculates: query `booking_requests` with status in `pending/pending_approval/approved/confirmed`, parse `requestParticipants` JSONB, count `type === 'guest'` with email or userId set.

`passes_remaining_conservative = Math.max(0, passes_remaining - pendingGuestCount)`

## Auto-Consumption in Bulk Paths (v8.97.28)

Guest pass consumption now also runs during:
- **Booking auto-complete** (`bookingAutoCompleteScheduler`): When a booking is auto-completed 30 min after end time, eligible guests with available passes have passes consumed automatically.
- **Bulk check-in**: When multiple bookings are checked in simultaneously, guest pass consumption is applied per-participant.

Previously, guest pass consumption only occurred during individual staff check-in via `consumeGuestPassForParticipant`.

## Exported Helpers (from `guestPasses.ts`)

- `useGuestPass(email, guestName?, sendNotification?)` — programmatic use
- `refundGuestPass(email, guestName?, sendNotification?, txClient?)` — programmatic refund; pass `txClient` when calling inside an existing transaction to avoid deadlock (v8.87.34)
- `getGuestPassesRemaining(email, tier?)` — remaining count
- `ensureGuestPassRecord(email, tier?)` — create record if missing
