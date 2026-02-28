# Schedulers & Email Templates

## Schedulers (`server/schedulers/`)

All run automatically on timers. Registered in `index.ts`.

| Scheduler | Frequency | Purpose |
|-----------|-----------|---------|
| `stuckCancellationScheduler.ts` | Every 2 hours | Alert staff about cancellations stuck 4+ hours |
| `feeSnapshotReconciliationScheduler.ts` | Every 15 minutes | Reconcile fee snapshots |
| `hubspotQueueScheduler.ts` | Every 2 minutes | Process HubSpot sync queue |
| `bookingExpiryScheduler.ts` | Every hour | Expire unconfirmed bookings |
| `bookingAutoCompleteScheduler.ts` | Every 2 hours | Mark approved/confirmed bookings as attended (auto checked-in) 24h after end time |
| `communicationLogsScheduler.ts` | Every 30 minutes | Sync communication logs |
| `dailyReminderScheduler.ts` | Daily 6pm Pacific | Send booking reminders |
| `morningClosureScheduler.ts` | Daily 8am Pacific | Notify about closures |
| `sessionCleanupScheduler.ts` | Daily 2am Pacific | Clean expired sessions |
| `memberSyncScheduler.ts` | Daily 3am Pacific | Full member data sync |
| `duplicateCleanupScheduler.ts` | Daily 4am Pacific + startup | Remove duplicates |
| `webhookLogCleanupScheduler.ts` | Daily 4am Pacific | Delete logs > 30 days |
| `stripeReconciliationScheduler.ts` | Daily 5am Pacific | Reconcile with Stripe |
| `unresolvedTrackmanScheduler.ts` | Daily 9am Pacific | Alert on unresolved Trackman bookings |
| `gracePeriodScheduler.ts` | Daily 10am Pacific | Check billing grace periods |
| `integrityScheduler.ts` | Daily midnight Pacific | Run data integrity checks |
| `weeklyCleanupScheduler.ts` | Sundays 3am Pacific | Weekly deep cleanup |
| `guestPassResetScheduler.ts` | 1st of month 3am Pacific | Reset monthly guest passes |
| `waiverReviewScheduler.ts` | Every 4 hours | Check for stale waivers |
| `supabaseHeartbeatScheduler.ts` | Periodic | Supabase connection heartbeat |
| `backgroundSyncScheduler.ts` | Periodic | Background data sync tasks |
| `hubspotFormSyncScheduler.ts` | Periodic | HubSpot form sync |
| `onboardingNudgeScheduler.ts` | Periodic | Onboarding nudge emails |
| `pendingUserCleanupScheduler.ts` | Periodic | Pending user cleanup |
| `webhookEventCleanupScheduler.ts` | Periodic | Webhook event cleanup |

---

## Email Templates (`server/emails/`)

| File | Purpose |
|------|---------|
| `bookingEmails.ts` | Booking confirmation, cancellation, reminder emails |
| `membershipEmails.ts` | Membership welcome, tier change, renewal emails |
| `paymentEmails.ts` | Payment receipt, failed payment, refund emails |
| `passEmails.ts` | Day pass and guest pass delivery emails |
| `welcomeEmail.ts` | New member welcome email |
| `integrityAlertEmail.ts` | Data integrity alert emails to staff |
| `firstVisitEmail.ts` | First visit email |
| `onboardingNudgeEmails.ts` | Onboarding nudge emails |
| `trialWelcomeEmail.ts` | Trial welcome email |
