---
name: member-lifecycle
description: Member status transitions, onboarding flow, cancellation, reactivation, grace periods, tier changes, application pipeline, and membership state machine for the Ever Club Members App. Use when modifying member status, tier changes, billing provider logic, onboarding steps, grace period handling, group billing, MindBody migration, subscription creation, or member sync.
---

# Member Lifecycle

## File Map

| Task | Primary File(s) | When to touch |
|---|---|---|
| Login + auto-fix | `server/routes/auth.ts` | Login flow, Stripe status correction, session status refresh |
| Google/Apple login | `server/routes/auth-google.ts`, `server/routes/auth-apple.ts` | OAuth login with status mapping |
| Directory sync push | `server/routes/directorySync.ts` | Batch push active members to HubSpot |
| Member service | `server/core/memberService/MemberService.ts` | Member lookup, cache |
| Member cache | `server/core/memberService/memberCache.ts` | Cache config, invalidation |
| Email change | `server/core/memberService/emailChangeService.ts` | `cascadeEmailChange()` |
| Member types | `server/core/memberService/memberTypes.ts` | `MemberRecord`, identifier utils |
| Member sync (HubSpot) | `server/core/memberSync.ts` | Daily inbound sync |
| Subscription sync | `server/core/stripe/subscriptionSync.ts` | Stripe → DB reconciliation |
| Subscription creation | `server/core/stripe/subscriptions.ts` | New subscription safeguards |
| Billing migration | `server/core/stripe/billingMigration.ts` | MindBody → Stripe migration |
| Group billing | `server/core/stripe/groupBilling.ts` | Family/corporate billing |
| Grace period | `server/schedulers/gracePeriodScheduler.ts` | Failed payment follow-up |
| Onboarding | `server/routes/members/onboarding.ts` | 4-step checklist |
| Application pipeline | `server/routes/members/applicationPipeline.ts` | Membership applications |
| Admin actions | `server/routes/members/admin-actions.ts` | Staff tier/status changes |
| Member billing | `server/routes/memberBilling.ts` | Billing tab, migration API |
| Welcome emails | `server/emails/welcomeEmail.ts`, `trialWelcomeEmail.ts` | Onboarding emails |
| Nudge scheduler | `server/schedulers/onboardingNudgeScheduler.ts` | Stalled member nudges |

## Decision Trees

### What controls a member's status?

```
What is billing_provider?
├── 'stripe' → Stripe is authoritative (webhooks + login auto-fix)
├── 'mindbody' → HubSpot can update status (MindBody pushes to HubSpot)
│   └── Status changes from active → non-active?
│       ├── migration_status = 'pending'? → SKIP cascade (stay active)
│       └── Otherwise → Deactivation cascade: tier=NULL, billing_provider='stripe'
├── 'manual' / 'comped' → Staff-managed, webhooks skip
└── 'family_addon' → Group billing cascade from primary
```

### Subscription cancellation → what status?

```
Was the member trialing?
├── Yes → status = 'paused' (account preserved, booking blocked)
└── No → status = 'cancelled', tier → last_tier, tier = NULL
    └── Primary on billing group?
        ├── Yes → Deactivate all sub-members + group
        └── No → Just this member
```

### Grace period flow

```
invoice.payment_failed webhook fires
  → billing_provider = 'stripe'? (if not, skip)
  → Set grace_period_start = NOW(), status = 'past_due'
  → Scheduler runs daily at 10 AM Pacific
    ├── Send up to 3 emails (1/day) with billing portal link
    └── After 3 days + 3 emails → status = 'terminated', tier = NULL
```

## Hard Rules

1. **App DB is the primary brain.** The database is source of truth for `membership_status`, `tier`, `role`, `billing_provider`. HubSpot only provides profile fill-in data (name, phone, address).
2. **Stripe Wins.** When `billing_provider = 'stripe'`, Stripe is authoritative. All webhook handlers check and bail if `billing_provider != 'stripe'`.
3. **Default billing_provider is `'stripe'`.** Schema default, db-init ALTER, and explicit setting in creation paths.
4. **Staff = VIP.** Staff/admin/golf_instructor auto-set to `tier = 'VIP'`, `status = 'active'` on every login. $0 booking fees.
5. **Email is primary identifier.** All lookups normalize to lowercase. `findByEmail` checks `users.email`, `trackman_email`, and `linked_emails` JSONB.
6. **Grace period is 3 days.** `DEFAULT_GRACE_PERIOD_DAYS = 3`, configurable via `scheduling.grace_period_days`.
7. **Group billing rollback completeness.** Add failure → reset `membership_status = 'pending'` AND `tier = NULL`. Remove → set `cancelled`, save `last_tier`. Lock ordering: `billing_groups` FOR UPDATE before `group_members`.
8. **Group creation atomicity.** INSERT `billing_groups` + UPDATE `users.billing_group_id` in single `db.transaction()`.
9. **Cascade must NOT overwrite sub-member billing_provider.** Only change `membership_status` and `updated_at`.
10. **Subscription creation safeguards.** Rate limiter + per-email operation lock + idempotency keys + existing subscription reuse.
11. **Migration-pending members skip deactivation cascade.** `migration_status = 'pending'` blocks MindBody deactivation during HubSpot sync.
12. **Email change uses `cascadeEmailChange()`.** Updates all tables atomically. NEVER update email in a single table.
13. **Reactivation clears archived flag.** `archived = false`, `archived_at = NULL` when member reactivated.
14. **Dispute-won reactivation is guarded.** When a dispute is closed in the merchant's favor, `handleChargeDisputeClosed` checks: (a) no other open disputes exist for that member, and (b) the Stripe subscription is not in a non-viable state (`past_due`, `unpaid`, `canceled`). Only then does it reactivate. Subscription API failures are fail-closed (block reactivation, notify staff for manual review).
15. **`FOR UPDATE` queries MUST use `ORDER BY id ASC`.** Prevents PostgreSQL deadlocks on concurrent multi-row locking. Required in `payments.ts` and `manualBooking.ts`.

## Anti-Patterns (NEVER)

1. NEVER overwrite status/tier from HubSpot for Stripe-billed members (Stripe Wins rule).
2. NEVER overwrite visitor role from HubSpot sync.
3. NEVER update member email in a single table — use `cascadeEmailChange()`.
4. NEVER overwrite sub-member `billing_provider` during group status cascade.
5. NEVER create a billing group without wrapping INSERT + user UPDATE in a transaction.
6. NEVER skip the per-email operation lock during subscription creation.
7. NEVER use `FOR UPDATE` on multi-row queries without `ORDER BY id ASC`.

## Cross-References

- **Stripe webhook status changes** → `stripe-webhook-flow` skill
- **HubSpot sync rules** → `hubspot-sync` skill
- **Grace period scheduler** → `scheduler-jobs` skill
- **Booking fee impact of tier** → `fee-calculation` skill

## Detailed Reference

- **[references/transitions.md](references/transitions.md)** — All status transitions with triggers, guards, and side effects.
- **[references/tier-changes.md](references/tier-changes.md)** — Tier change flow, proration, HubSpot sync.

---

## Status Values

| Status | Meaning |
|---|---|
| `active` | Paying member with full access |
| `trialing` | Free trial (7-day Stripe) |
| `past_due` | Payment failed; grace period; still has access |
| `suspended` | Admin-initiated pause |
| `frozen` | Stripe `subscription.paused` automatic |
| `paused` | Trial ended without conversion |
| `cancelled` | Subscription deleted |
| `terminated` | Grace period expired after 3 days |
| `pending` | Stripe subscription incomplete |
| `inactive` | Catch-all deactivation |
| `archived` | Soft-deleted by staff |
| `non-member` | Tier cleared by admin |
| `merged` | Duplicate merged |

## Billing Provider Values

| Value | Description |
|---|---|
| `stripe` | Stripe-managed (default) |
| `mindbody` | Legacy MindBody |
| `manual` | Staff-managed |
| `comped` | Complimentary |
| `family_addon` | Family group add-on |

## Status Categories

- **ACTIVE_STATUSES:** `['active', 'trialing', 'past_due']` — These grant full member access (booking, events, wellness, etc.)
- **INACTIVE_STATUSES (UI):** `['terminated', 'suspended', 'expired', 'cancelled', 'frozen', 'paused', 'inactive']` — TierBadge shows "No Active Membership"
- **CHURNED_STATUSES:** `['terminated', 'cancelled', 'non-member']`

## Status Display Mapping

All auth paths (OTP, Google, Apple, session refresh) normalize DB `membership_status` to display status using a `statusMap`. The frontend `AuthDataContext` passes real status through — never hardcodes `'Active'`. Frontend active-access gates must use `ACTIVE_STATUSES` (not `!== 'active'`) to avoid blocking trial/past_due members.

Key files with status mapping:
- `server/routes/auth.ts` — OTP login + session refresh
- `server/routes/auth-google.ts` — Google verify + callback
- `server/routes/auth-apple.ts` — Apple verify
- `src/contexts/AuthDataContext.tsx` — Frontend status passthrough
- `src/components/TierBadge.tsx` — INACTIVE_STATUSES display

## Auth Linking Hardening (v8.86.6/v8.87.1)

- **Config guards (fail-closed):** All Google and Apple auth routes (verify, callback, link, unlink, status) return 503 if their client ID env var is missing — prevents silent token-verification bypass.
- **Partial unique indexes:** `google_id` and `apple_id` columns have `UNIQUE WHERE NOT NULL` indexes to prevent race-condition duplicate linking at the database level.
- **Conflict handling:** Link endpoints catch unique constraint violations from concurrent requests and return 409 instead of 500.
- **`resolveDbUserId()` fallback (v8.87.1):** Link/unlink endpoints in `auth-google.ts` and `auth-apple.ts` resolve the DB user ID via a 2-step fallback: first by session `user.id`, then by normalized email. Returns 404 if no match. This fixed the "User account not found" error when session IDs didn't match DB IDs.
- **`upsertUserWithTier()` returns DB ID (v8.87.1):** Login upsert in `auth.ts` now returns the inserted/updated user's DB `id` and stores it in `req.session.user.id`. This ensures the session always carries the correct DB identity for downstream linking operations.

## Onboarding Checklist

4 steps tracked by date columns: profile_completed_at, waiver_signed_at, first_booking_at, app_installed_at. All complete → `onboarding_completed_at` set.

Nudge emails: 24h, 72h, 7d — max 3 per member, 20 members/run, 10 AM Pacific.

## Application Pipeline Stages

`new` → `read` → `reviewing` → `approved` → `invited` → `converted` (or `declined`/`archived`)

## Property Dictionary

DB tier slugs → HubSpot labels mapping lives in `server/core/hubspot/constants.ts`. See `hubspot-sync` skill for full property mapping.
