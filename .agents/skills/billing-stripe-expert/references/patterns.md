# Additional Billing Patterns

## Table of Contents
- [11. Deferred Action Pattern](#11-deferred-action-pattern)
- [12. Fee Snapshots](#12-fee-snapshots)
- [13. Prepayment Lifecycle](#13-prepayment-lifecycle)
- [14. Stripe Client Singleton](#14-stripe-client-singleton)
- [15. Stripe Customer Rules](#15-stripe-customer-rules)
- [16. Subscription Lifecycle](#16-subscription-lifecycle)
- [17. Dispute Handling](#17-dispute-handling)
- [18. Day Pass & Checkout](#18-day-pass--checkout)
- [19. Terminal Payments](#19-terminal-payments)
- [20. Reconciliation](#20-reconciliation)
- [21. Stripe Transaction Cache](#21-stripe-transaction-cache)
- [22. Stripe Products & Pricing Sync](#22-stripe-products--pricing-sync)
- [23. Card Expiry Monitoring](#23-card-expiry-monitoring)

---

## 11. Deferred Action Pattern
Stripe webhook side effects (notifications, HubSpot syncs, emails) execute AFTER the DB transaction commits, never inside it.

- **Type**: `DeferredAction = () => Promise<void>`
- Each webhook handler returns `DeferredAction[]`
- `executeDeferredActions()` runs after `COMMIT` succeeds
- **Why**: Prevents orphaned side effects if the transaction rolls back (e.g., sending a "payment confirmed" email for a rolled-back payment)
- If adding a new webhook handler, return deferred actions — never call external APIs inside the transaction

## 12. Fee Snapshots
`booking_fee_snapshots` captures point-in-time fee calculations tied to payment intents.

- Created when a prepayment intent is generated
- Stores: `session_id`, `booking_id`, `participant_fees` (JSON), `total_cents`, `stripe_payment_intent_id`, `status`
- `PaymentStatusService` in `server/core/billing/PaymentStatusService.ts` coordinates atomic updates across:
  - `booking_fee_snapshots` (status → paid/refunded)
  - `stripe_payment_intents` (status → succeeded/refunded)
  - `booking_participants` (cached_fee_cents updates)
- **Reconciliation**: `server/schedulers/feeSnapshotReconciliationScheduler.ts` cross-checks snapshots against Stripe payment intent status

## 13. Prepayment Lifecycle
After booking approval or Trackman auto-linking, a prepayment intent is created for expected fees.

- **Service**: `server/core/billing/prepaymentService.ts` — `createPrepaymentIntent()`
- **Flow**:
  1. Check for existing active prepayment intent (prevents duplicates)
  2. Create Stripe PaymentIntent with metadata (booking ID, session ID, fee breakdown)
  3. Record in `stripe_payment_intents` table with `purpose = 'prepayment'`
  4. Return `client_secret` to frontend for payment
- **Cancellation**: `cancelPaymentIntent()` in `server/core/stripe/payments.ts` — cancels in Stripe + updates local DB
- **Refund**: `markPaymentRefunded()` in `PaymentStatusService` — refunds succeeded prepayments with idempotency
- **Check-in block**: Members cannot check in until prepayment fees are paid

## 14. Stripe Client Singleton
Always use `getStripeClient()` from `server/core/stripe/client.ts`. NEVER instantiate Stripe directly.

- Ensures consistent API version and configuration
- **Environment validation**: `server/core/stripe/environmentValidation.ts` validates Stripe keys on startup

## 15. Stripe Customer Rules
- **Function**: `getOrCreateStripeCustomer()` in `server/core/stripe/customers.ts`
- Blocks placeholder emails (e.g., `placeholder+...@...`) from creating Stripe customers
- **Metadata sync**: `syncCustomerMetadataToStripe()` pushes `userId` + `tier` to Stripe customer metadata
- **Customer sync**: `server/core/stripe/customerSync.ts` — bulk sync of customer metadata
- Always use `getOrCreateStripeCustomer()`, never call `stripe.customers.create()` directly

## 16. Subscription Lifecycle
All subscription changes flow through webhooks, not direct DB updates.

- **Creation** (`customer.subscription.created`): Creates/links user, sets tier, syncs to HubSpot
- **Update** (`customer.subscription.updated`): Handles status changes (active → past_due → canceled), tier changes
- **Deletion** (`customer.subscription.deleted`): Deactivates group members, sets status to cancelled, syncs to HubSpot
- **Tier changes**: `changeSubscriptionTier()` in `server/core/stripe/subscriptions.ts` — handles proration (`always_invoice` for immediate, `none` for end-of-cycle)
- **Subscription sync**: `server/core/stripe/subscriptionSync.ts` — bulk subscription status sync
- **Group billing**: `server/core/stripe/groupBilling.ts` — corporate subscriptions with multiple seats. Primary cancellation cascades to all sub-members via `handlePrimarySubscriptionCancelled()`
- **Tier sync**: `server/core/stripe/tierChanges.ts` — tier change processing with HubSpot sync
- **HubSpot sync**: `server/core/stripe/hubspotSync.ts` — syncs subscription status/tier to HubSpot contact

## 17. Dispute Handling
Payment disputes trigger immediate membership suspension — different from grace period logic.

- `charge.dispute.created` → suspends membership immediately, notifies staff and member
- `charge.dispute.closed` → updates dispute status, may restore membership
- Disputes on terminal payments update `terminal_payments` table with `dispute_id` and `dispute_status`

## 18. Day Pass & Checkout
Day pass purchases use Stripe Checkout Sessions, not Payment Intents.

- **Route**: `server/routes/stripe/payments.ts` — `/api/public/day-pass/checkout`
- Uses `stripe.checkout.sessions.create()` with `mode: 'payment'`
- Metadata includes: product type, buyer info, purchase source
- **Visitor matching**: `server/core/visitors/matchingService.ts` matches day pass purchases to existing visitor records
- **Frontend**: `src/pages/Public/BuyDayPass.tsx`
- **Checkout page**: `src/pages/Checkout.tsx` — handles post-checkout confirmation

## 19. Terminal Payments
In-person card reader (WisePOS E / S700) support for membership signup and payments.

- **Route**: `server/routes/stripe/terminal.ts`
- Endpoints: connection tokens, reader listing, payment processing, subscription payment, confirmation
- Uses `stripe.terminal.readers.processPaymentIntent()` for card-present payments
- Simulated readers available for development testing (`testHelpers.terminal.readers.presentPaymentMethod`)
- Requires idempotency keys, metadata validation, and audit logging
- **Frontend**: `src/components/staff-command-center/TerminalPayment.tsx`

## 20. Reconciliation
Daily and subscription reconciliation schedulers cross-check Stripe vs. local DB to catch drift.

- **Daily payments**: `server/core/stripe/reconciliation.ts` — `reconcileDailyPayments()` checks recent Stripe payment intents against local records
- **Subscriptions**: `reconcileSubscriptions()` — verifies all active subscriptions match Stripe status
- **Scheduler**: `server/schedulers/stripeReconciliationScheduler.ts`
- **Fee snapshots**: `server/schedulers/feeSnapshotReconciliationScheduler.ts` — ensures snapshots match actual Stripe payment status
- **Duplicate cleanup**: `server/schedulers/duplicateCleanupScheduler.ts` — removes duplicate payment records

## 21. Stripe Transaction Cache
Local caching of Stripe transaction history for fast querying.

- **Table**: `stripe_transaction_cache`
- **Cache management**: `server/core/stripe/transactionCache.ts` — Stripe transaction cache management
- Populated by `server/core/stripe/invoices.ts` and webhook handlers
- Used by financials dashboard and member billing views
- **Payment repository**: `server/core/stripe/paymentRepository.ts` — query layer for cached transactions

## 22. Stripe Products & Pricing Sync
Two-way sync between app and Stripe Product Catalog.

- **Push sync**: `server/core/stripe/products.ts` — `syncMembershipTiersToStripe()`, `syncCafeItemsToStripe()`, `syncTierFeaturesToStripe()`
- **Pull sync**: Reverse sync reads Stripe products/features back into DB
- **Webhook refresh**: `product.updated/created/deleted` and `price.updated/created` trigger automatic reverse sync
- **Discounts**: `server/core/stripe/discounts.ts` — coupon and discount management
- **Coupons route**: `server/routes/stripe/coupons.ts` — CRUD endpoints for Stripe coupons

## 23. Card Expiry Monitoring
Proactive warnings for members with expiring payment methods.

- **Module**: `server/core/billing/cardExpiryChecker.ts`
- Checks card expiry dates and sends advance warning emails
- Prevents surprise payment failures on subscription renewal
