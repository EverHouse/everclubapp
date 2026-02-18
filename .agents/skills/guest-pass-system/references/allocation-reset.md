# Allocation, Reset, and Administrative Controls

Details on tier-based allocation, monthly reset scheduler, record initialization, staff overrides, and availability calculation.

## Tier-Based Allocation

### Source of passes_total

The `guest_passes.passes_total` value derives from `membership_tiers.guest_passes_per_month`:

```sql
SELECT mt.guest_passes_per_month
FROM users u
JOIN membership_tiers mt ON LOWER(u.tier) = LOWER(mt.name)
WHERE LOWER(u.email) = $1
```

Look up via `getTierLimits(tierName)` in `server/core/tierService.ts`, which returns an object containing `guest_passes_per_month`.

### Tier Change Handling

Auto-update occurs on **GET /api/guest-passes/:email** in `server/routes/guestPasses.ts`:

1. Look up member's current tier from `users` table
2. Call `getTierLimits(actualTier)` to get `guest_passes_per_month`
3. Compare against existing `guest_passes.passes_total`
4. If mismatched, update the record:

**Upgrade** (new tier grants more passes):
```typescript
await db.update(guestPasses)
  .set({ passesTotal: passesTotal })
  .where(sql`LOWER(member_email) = ${normalizedEmail}`)
```

**Downgrade** (new tier grants fewer passes):
```typescript
const newPassesUsed = Math.min(result[0].passesUsed, passesTotal);
await db.update(guestPasses)
  .set({ passesTotal: passesTotal, passesUsed: newPassesUsed })
  .where(sql`LOWER(member_email) = ${normalizedEmail}`)
```

Clamping prevents `passes_used` from exceeding the new lower `passes_total`.

### Auto-Update in Consumer

`consumeGuestPassForParticipant()` also auto-upgrades `passes_total` if the tier grants more than the current value (but does not handle downgrades — that is the GET endpoint's responsibility):

```sql
UPDATE guest_passes SET passes_total = $tierGuestPasses
WHERE LOWER(member_email) = $1
```

### Auto-Update in Hold Service

`getAvailableGuestPasses()` similarly upgrades `passes_total` if `tierGuestPasses > passesTotal`.

## Monthly Reset Scheduler

**File:** `server/schedulers/guestPassResetScheduler.ts`

### Timing

- Scheduler runs on a `setInterval` of 1 hour (3,600,000 ms)
- Each tick checks:
  - `getPacificHour() === 3` (3 AM Pacific)
  - `getPacificDayOfMonth() === 1` (1st of the month)
- Only proceeds if both conditions are true

### Idempotency Mechanism

Use `system_settings` table to prevent double runs:

```sql
INSERT INTO system_settings (key, value, updated_at)
VALUES ('last_guest_pass_reset', $monthKey, NOW())
ON CONFLICT (key) DO UPDATE SET value = $monthKey, updated_at = NOW()
WHERE system_settings.value IS DISTINCT FROM $monthKey
RETURNING key
```

- `monthKey` format: `YYYY-MM` (e.g., `2026-02`)
- The `IS DISTINCT FROM` clause ensures the UPDATE only happens if the value actually changes
- If `RETURNING` yields 0 rows, the reset already ran this month — skip

### Reset SQL

```sql
UPDATE guest_passes
SET passes_used = 0, updated_at = NOW()
WHERE passes_used > 0
RETURNING member_email, passes_total
```

- Only touch rows with `passes_used > 0` (efficiency)
- Log each affected member and their total allocation
- Record scheduler run via `schedulerTracker.recordRun('Guest Pass Reset', true)`

### Lifecycle

- `startGuestPassResetScheduler()`: start the hourly interval (idempotent — checks for existing interval)
- `stopGuestPassResetScheduler()`: clear the interval

## ensureGuestPassRecord()

**File:** `server/routes/guestPasses.ts`
**Signature:** `ensureGuestPassRecord(memberEmail, tier?)`

Create a `guest_passes` record if one does not exist. Use during member creation or onboarding.

### Flow

1. Normalize email to lowercase
2. Look up `guest_passes_per_month` from tier via `getTierLimits(tier)`
3. Query `guest_passes` by normalized email
4. If no record exists, insert:
   ```typescript
   db.insert(guestPasses).values({
     memberEmail: normalizedEmail,
     passesUsed: 0,
     passesTotal: passesTotal  // from tier config
   })
   ```
5. If record already exists, do nothing (no update)

Errors are logged but not thrown (best-effort).

## Staff Override — PUT /api/guest-passes/:email

**File:** `server/routes/guestPasses.ts`
**Middleware:** `isStaffOrAdmin`

Allow staff to manually set `passes_total` to any value:

```typescript
db.update(guestPasses)
  .set({ passesTotal: passes_total })
  .where(sql`LOWER(member_email) = ${normalizedEmail}`)
  .returning()
```

- Requires `isStaffOrAdmin` middleware plus an additional `isStaffOrAdminCheck()` verification
- Broadcast `broadcastMemberStatsUpdated()` after update
- Log via `logFromRequest()` with action `'update_guest_passes'`
- Return 404 if no matching record found

**Note:** This override can be reverted by the auto-update logic on the next GET request if the tier config differs. To make a permanent override, the tier's `guest_passes_per_month` should be adjusted in the membership_tiers table.

## Available Passes Calculation

**File:** `server/core/billing/guestPassHoldService.ts` — `getAvailableGuestPasses()`

```
available = passesTotal - passesUsed - activeHolds
```

### Steps

1. Look up tier's `guest_passes_per_month` via `users` JOIN `membership_tiers`
2. Read `passes_used` and `passes_total` from `guest_passes`
3. Auto-update `passes_total` if tier grants more
4. Sum active holds:
   ```sql
   SELECT COALESCE(SUM(passes_held), 0) as total_held
   FROM guest_pass_holds
   WHERE LOWER(member_email) = $1
   AND (expires_at IS NULL OR expires_at > NOW())
   ```
5. Return `Math.max(0, passesTotal - passesUsed - passesHeld)`

### Pending Guest Count (GET endpoint)

The GET `/api/guest-passes/:email` endpoint adds a separate "pending" calculation on top:

1. Query `booking_requests` with status in `['pending', 'pending_approval', 'approved', 'confirmed']`
2. Parse `requestParticipants` JSONB for each booking
3. Count entries where `type === 'guest'` AND (`email` or `userId` is truthy)
4. `passes_remaining_conservative = Math.max(0, passes_remaining - pendingGuestCount)`

This differs from the hold-based calculation — pending count comes from booking request data, while holds are explicit records in `guest_pass_holds`. Both are surfaced in the API response for different use cases.
