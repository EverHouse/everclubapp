# Hold, Consume, and Refund Flow

Detailed transactional steps for guest pass hold creation, consumption at check-in, refund, and hold conversion.

## Hold Creation — createGuestPassHold()

**File:** `server/core/billing/guestPassHoldService.ts`
**Signature:** `createGuestPassHold(memberEmail, bookingId, passesNeeded, externalClient?)`

### Transaction Flow

1. **Early exit:** Return `{ success: true, passesHeld: 0 }` if `passesNeeded <= 0`
2. **Acquire client:** Use `externalClient` if provided, otherwise acquire from `pool`
3. **Begin transaction** (only if managing own transaction, i.e., no `externalClient`)
4. **Lock guest_passes row:**
   ```sql
   SELECT id FROM guest_passes WHERE LOWER(member_email) = $1 FOR UPDATE
   ```
5. **Calculate availability** via `getAvailableGuestPasses()`:
   - Look up `guest_passes_per_month` from `users` JOIN `membership_tiers`
   - Query `guest_passes` for current `passes_used` and `passes_total`
   - Auto-update `passes_total` if tier grants more than current total
   - Sum active holds: `SELECT COALESCE(SUM(passes_held), 0) FROM guest_pass_holds WHERE expires_at > NOW()`
   - Available = `passesTotal - passesUsed - passesHeld`
6. **Determine passes to hold:** `Math.min(passesNeeded, available)`
7. **Reject if insufficient:** Return error with `passesAvailable` if `passesToHold <= 0` and `passesNeeded > 0`
8. **Create hold record:**
   ```sql
   INSERT INTO guest_pass_holds (member_email, booking_id, passes_held, expires_at)
   VALUES ($1, $2, $3, $4) RETURNING id
   ```
   Expiry = `new Date() + 30 days`
9. **Commit** (if managing own transaction)
10. **Return:** `{ success: true, holdId, passesHeld, passesAvailable }`

### Error Handling
- Rollback on any error (if managing own transaction)
- Release client to pool (if not using external client)
- Return `{ success: false, error: message }`

## Consumption — consumeGuestPassForParticipant()

**File:** `server/core/billing/guestPassConsumer.ts`
**Signature:** `consumeGuestPassForParticipant(participantId, ownerEmail, guestName, sessionId, sessionDate, staffEmail?)`

### Pre-Transaction Checks

1. **Reject placeholder guests:** Test `guestName` against `/^Guest \d+$/i`. Return error if matched.
2. **Normalize email:** `ownerEmail.toLowerCase().trim()`

### Transaction Flow

3. **Acquire client** from `pool.connect()`, **BEGIN**
4. **Idempotency check:**
   ```sql
   SELECT id, used_guest_pass, guest_id FROM booking_participants WHERE id = $1
   ```
   If `used_guest_pass === true`, ROLLBACK and return `{ success: true }` (already consumed)
5. **Look up owner user ID:**
   ```sql
   SELECT id FROM users WHERE LOWER(email) = $1
   ```
6. **Look up tier allocation:**
   ```sql
   SELECT mt.guest_passes_per_month
   FROM users u JOIN membership_tiers mt ON LOWER(u.tier) = LOWER(mt.name)
   WHERE LOWER(u.email) = $1
   ```
   Default to 4 if not found.
7. **Lock and read guest_passes:**
   ```sql
   SELECT id, passes_used, passes_total FROM guest_passes
   WHERE LOWER(member_email) = $1 FOR UPDATE
   ```
8. **Create or update record:**
   - If no record exists: INSERT with `passes_used = 1`, `passes_total = tierGuestPasses`
   - If record exists:
     - Auto-upgrade `passes_total` if tier grants more
     - Reject if `passes_used >= passes_total` (ROLLBACK, return error)
     - Increment: `UPDATE guest_passes SET passes_used = passes_used + 1`
9. **Update usage_ledger** (if owner has a ledger entry for this session):
   ```sql
   UPDATE usage_ledger SET guest_fee = 0, payment_method = 'guest_pass'
   WHERE session_id = $1 AND member_id = $2
   ```
10. **Update booking_participants:**
    ```sql
    UPDATE booking_participants
    SET payment_status = 'waived', cached_fee_cents = 0, used_guest_pass = TRUE
    WHERE id = $1
    ```
11. **Insert legacy_purchases record:**
    ```sql
    INSERT INTO legacy_purchases
      (user_id, member_email, item_name, item_category, item_price_cents, quantity,
       subtotal_cents, discount_percent, discount_amount_cents, tax_cents,
       item_total_cents, payment_method, sale_date, linked_booking_session_id,
       is_comp, is_synced, created_at)
    VALUES ($1, $2, 'Guest Pass - <guestName>', 'guest_pass', 0, 1, 0, 0, 0, 0, 0,
            'guest_pass', $sessionDate, $sessionId, true, false, NOW())
    RETURNING id
    ```
12. **Insert notification:**
    ```sql
    INSERT INTO notifications (user_email, title, message, type, related_type, created_at)
    VALUES ($1, 'Guest Pass Used', '<message>', 'guest_pass', 'guest_pass', NOW())
    ```
13. **COMMIT**

### Post-Transaction Hold Cleanup

14. **Clean up hold** (non-blocking, outside transaction):
    - Look up `booking_requests.id` by `session_id`
    - If hold has `passes_held <= 1`: DELETE the hold row
    - If hold has `passes_held > 1`: decrement `passes_held` by 1
    - Failure here is logged but does not fail the operation

### Return Value
```typescript
{ success: true, passesRemaining: number, purchaseId: number }
```

### Error Handling
- ROLLBACK on any error within the transaction
- Release client in `finally` block
- Return `{ success: false, error: message }`

## Refund — refundGuestPassForParticipant()

**File:** `server/core/billing/guestPassConsumer.ts`
**Signature:** `refundGuestPassForParticipant(participantId, ownerEmail, guestName)`

### Transaction Flow

1. **Acquire client**, **BEGIN**
2. **Check participant:**
   ```sql
   SELECT id, used_guest_pass FROM booking_participants WHERE id = $1
   ```
   If `used_guest_pass !== true`, ROLLBACK and return `{ success: true }` (nothing to refund)
3. **Decrement passes_used:**
   ```sql
   UPDATE guest_passes SET passes_used = GREATEST(0, passes_used - 1)
   WHERE LOWER(member_email) = $1
   ```
4. **Read remaining:**
   ```sql
   SELECT passes_total - passes_used as remaining FROM guest_passes
   WHERE LOWER(member_email) = $1
   ```
5. **Look up Stripe guest fee:**
   - Query `membership_tiers` for `stripe_price_id` where `name = 'guest pass'`
   - Retrieve price from Stripe API: `stripe.prices.retrieve(priceId)`
   - Use `price.unit_amount` as `guestFeeCents`
   - Fall back to `PRICING.GUEST_FEE_CENTS` from `pricingConfig` on failure
6. **Reset participant:**
   ```sql
   UPDATE booking_participants
   SET payment_status = 'pending', cached_fee_cents = $guestFeeCents, used_guest_pass = FALSE
   WHERE id = $1
   ```
7. **Delete legacy_purchase record** (most recent matching record):
   ```sql
   DELETE FROM legacy_purchases
   WHERE LOWER(member_email) = $1
     AND item_category = 'guest_pass'
     AND item_name LIKE 'Guest Pass - <guestName>%'
     AND item_total_cents = 0
     AND id = (SELECT id FROM legacy_purchases WHERE ... ORDER BY created_at DESC LIMIT 1)
   ```
8. **COMMIT**

### Return Value
```typescript
{ success: true, passesRemaining: number }
```

## Hold Conversion — convertHoldToUsage()

**File:** `server/core/billing/guestPassHoldService.ts`
**Signature:** `convertHoldToUsage(bookingId, memberEmail)`

### Transaction Flow

1. **Acquire client**, **BEGIN**
2. **Lock and read hold:**
   ```sql
   SELECT id, passes_held FROM guest_pass_holds
   WHERE booking_id = $1 AND LOWER(member_email) = $2 FOR UPDATE
   ```
3. **If no hold found:** COMMIT and return `{ success: true, passesConverted: 0 }`
4. **Increment passes_used:**
   ```sql
   UPDATE guest_passes SET passes_used = passes_used + $passesToConvert
   WHERE LOWER(member_email) = $1
   ```
5. **Delete hold:**
   ```sql
   DELETE FROM guest_pass_holds WHERE booking_id = $1
   ```
6. **COMMIT**
7. **Return:** `{ success: true, passesConverted }`

### Error Handling
- ROLLBACK on error, return `{ success: false, passesConverted: 0 }`

## Error Handling Patterns

All transactional functions follow these patterns:

1. **Client acquisition:** `pool.connect()` with release in `finally`
2. **Transaction boundary:** explicit `BEGIN`/`COMMIT` with `ROLLBACK` in catch
3. **External client support:** `createGuestPassHold` and `getAvailableGuestPasses` accept an optional `externalClient` (PoolClient) to participate in an outer transaction, skipping own transaction management
4. **Idempotency:** both `consumeGuestPassForParticipant` and `refundGuestPassForParticipant` check current state before acting, returning success if already in desired state
5. **Row-level locking:** `SELECT FOR UPDATE` on `guest_passes` and `guest_pass_holds` to prevent concurrent modification
6. **Floor clamping:** `GREATEST(0, passes_used - 1)` on refund to prevent negative counts
7. **Non-blocking cleanup:** post-commit hold cleanup failures are logged but do not fail the operation
