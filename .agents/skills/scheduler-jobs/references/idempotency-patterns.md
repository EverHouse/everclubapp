# Idempotency Patterns

Patterns used across schedulers to prevent double execution and ensure safe repeated runs.

## Time Gate Pattern

Check the current Pacific hour against a target constant. Only proceed when they match.

```typescript
import { getPacificHour } from '../utils/dateUtils';

const TARGET_HOUR = 18; // 6 PM Pacific

async function checkAndRun(): Promise<void> {
  const currentHour = getPacificHour();
  if (currentHour !== TARGET_HOUR) {
    return; // Not the right hour, skip
  }
  // Proceed with task...
}

setInterval(checkAndRun, 30 * 60 * 1000); // Check every 30 min
```

**Used by:** Daily Reminder (18), Morning Closure (8), Integrity Check (0), Stripe Reconciliation (5), Grace Period (10), Unresolved Trackman (9), Onboarding Nudge (10), Session Cleanup (2), Webhook Log Cleanup (4), Duplicate Cleanup (4).

## Claim Slot Pattern (Database)

Use `system_settings` table with INSERT ON CONFLICT to atomically claim a daily execution slot. The `IS DISTINCT FROM` clause ensures the row is only updated once per day.

```typescript
import { db } from '../db';
import { systemSettings } from '../../shared/schema';
import { sql } from 'drizzle-orm';
import { getTodayPacific } from '../utils/dateUtils';

const SETTING_KEY = 'last_my_task_date';

async function tryClaimSlot(todayStr: string): Promise<boolean> {
  try {
    const result = await db
      .insert(systemSettings)
      .values({
        key: SETTING_KEY,
        value: todayStr,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: {
          value: todayStr,
          updatedAt: new Date(),
        },
        where: sql`${systemSettings.value} IS DISTINCT FROM ${todayStr}`,
      })
      .returning({ key: systemSettings.key });

    return result.length > 0; // true = claimed, false = already ran today
  } catch (err) {
    console.error('[My Task] Database error:', err);
    return false;
  }
}

async function checkAndRun(): Promise<void> {
  const currentHour = getPacificHour();
  const todayStr = getTodayPacific();

  if (currentHour === TARGET_HOUR) {
    const claimed = await tryClaimSlot(todayStr);
    if (claimed) {
      // Run the task — guaranteed to execute only once per day
      await doWork();
    }
  }
}
```

**Used by:** Daily Reminder (`last_daily_reminder_date`), Morning Closure (`last_morning_closure_notification_date`), Integrity Check (`last_integrity_check_date`), Stripe Reconciliation (`last_stripe_reconciliation_date`), Unresolved Trackman (`last_unresolved_trackman_check_date`).

### How It Works

1. INSERT a row with key = setting name, value = today's date string
2. ON CONFLICT (key already exists), UPDATE the value — but only WHERE the existing value IS DISTINCT FROM today's date
3. RETURNING clause: if a row is returned, the update happened (first run today); if empty, already ran

This is crash-safe: even if the server restarts mid-day, the database records whether the task already ran.

## Monthly Claim Slot Pattern

Same as daily claim slot but use a month key (`YYYY-MM`) instead of a date string. Combine with a day-of-month check.

```typescript
import { getPacificHour, getPacificDayOfMonth, getPacificDateParts } from '../utils/dateUtils';

const RESET_HOUR = 3;

async function tryClaimResetSlot(monthKey: string): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES ('last_guest_pass_reset', ${monthKey}, NOW())
      ON CONFLICT (key) DO UPDATE SET value = ${monthKey}, updated_at = NOW()
      WHERE system_settings.value IS DISTINCT FROM ${monthKey}
      RETURNING key
    `);
    return (result.rowCount || 0) > 0;
  } catch (err) {
    return false;
  }
}

async function resetGuestPasses(): Promise<void> {
  const currentHour = getPacificHour();
  const dayOfMonth = getPacificDayOfMonth();

  if (currentHour !== RESET_HOUR || dayOfMonth !== 1) {
    return; // Only run at 3 AM on the 1st
  }

  const parts = getPacificDateParts();
  const monthKey = `${parts.year}-${String(parts.month).padStart(2, '0')}`;

  if (!await tryClaimResetSlot(monthKey)) {
    return; // Already ran this month
  }

  // Perform the monthly reset...
}
```

**Used by:** Guest Pass Reset (`last_guest_pass_reset` with value `YYYY-MM`).

## Local Variable Gate Pattern

Track the last run date in a module-level variable. Simpler but not crash-safe (resets on server restart).

```typescript
let lastCleanupDate = '';

async function checkAndRunCleanup(): Promise<void> {
  const currentHour = getPacificHour();
  const todayStr = getTodayPacific();

  if (currentHour === CLEANUP_HOUR && lastCleanupDate !== todayStr) {
    lastCleanupDate = todayStr; // Claim before running
    await doCleanup();
  }
}
```

**Used by:** Duplicate Cleanup (`lastCleanupDate`).

### Trade-offs

- Pro: No database write needed, fast
- Con: After server restart, the task may run again the same day
- Use when: Double execution is harmless (e.g., cleanup is idempotent)

## Weekly Gate Pattern

Combine day-of-week check + hour check + week-number tracking.

```typescript
const CLEANUP_DAY = 0; // Sunday
const CLEANUP_HOUR = 3;
let lastCleanupWeek = -1;

async function checkAndRunCleanup(): Promise<void> {
  const parts = getPacificDateParts();
  const pacificDate = new Date(parts.year, parts.month - 1, parts.day);
  const currentDay = pacificDate.getDay();
  const currentHour = parts.hour;
  const currentWeek = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));

  if (currentDay === CLEANUP_DAY && currentHour === CLEANUP_HOUR && currentWeek !== lastCleanupWeek) {
    lastCleanupWeek = currentWeek;
    await doWeeklyCleanup();
  }
}
```

**Used by:** Weekly Cleanup.

## Job Queue Claim Pattern

The job queue uses database-level locking to prevent double-processing of jobs.

```typescript
const result = await db.execute(sql`
  UPDATE job_queue
  SET locked_at = ${now}, locked_by = ${WORKER_ID}
  WHERE id IN (
    SELECT id FROM job_queue
    WHERE status = 'pending'
      AND scheduled_for <= ${now}
      AND (locked_at IS NULL OR locked_at < ${lockExpiry})
    ORDER BY priority DESC, scheduled_for ASC
    LIMIT ${BATCH_SIZE}
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, job_type, payload, retry_count, max_retries
`);
```

### How It Works

1. SELECT pending jobs that are scheduled and not locked (or lock expired)
2. `FOR UPDATE SKIP LOCKED` — skip rows already claimed by another worker
3. Atomically UPDATE to set `locked_at` and `locked_by` (worker ID)
4. After processing: mark `completed` or `failed` (with retry backoff)
5. Lock timeout: 5 minutes — auto-release if worker crashes

**Used by:** Job Queue Processor (`server/core/jobQueue.ts`).

## Mutex Guard Pattern

Use a module-level boolean to prevent overlapping runs of the same scheduler.

```typescript
let isProcessing = false;

async function processQueue(): Promise<void> {
  if (isProcessing) {
    return; // Skip if already processing
  }

  isProcessing = true;

  try {
    await doWork();
  } finally {
    isProcessing = false;
  }
}
```

**Used by:** HubSpot Queue (`isProcessing`), HubSpot Form Sync (`isSyncing`).

## Scheduler Tracker Integration

Always integrate with `schedulerTracker` for health monitoring.

### Startup Registration

Register the scheduler with its expected interval during `initSchedulers()`:

```typescript
schedulerTracker.registerScheduler('My New Scheduler', 60 * 60 * 1000); // 1 hour
```

This sets the initial state to `pending` and computes the first expected `nextRunAt`.

### Recording Runs

Record every run outcome — success or failure:

```typescript
try {
  await doWork();
  schedulerTracker.recordRun('My New Scheduler', true);
} catch (error) {
  console.error('[My New Scheduler] Error:', error);
  schedulerTracker.recordRun('My New Scheduler', false, String(error));
}
```

Pass optional `durationMs` for performance tracking:

```typescript
const start = Date.now();
await doWork();
schedulerTracker.recordRun('My New Scheduler', true, undefined, Date.now() - start);
```

## Error Handling Pattern

Never let errors crash the interval. Catch at the top level of the scheduled function:

```typescript
setInterval(() => {
  myScheduledTask().catch(err => {
    console.error('[My Scheduler] Uncaught error:', err);
    schedulerTracker.recordRun('My Scheduler', false, String(err));
  });
}, intervalMs);
```

For critical schedulers, also alert staff on failure:

```typescript
import { alertOnScheduledTaskFailure } from '../core/dataAlerts';

try {
  await doWork();
} catch (error) {
  schedulerTracker.recordRun('My Scheduler', false, String(error));
  await alertOnScheduledTaskFailure(
    'My Scheduler Name',
    error instanceof Error ? error : new Error(String(error)),
    { context: 'Scheduled run context' }
  );
}
```

**Used by:** Integrity Check, Stripe Reconciliation, HubSpot Queue, Waiver Review.
