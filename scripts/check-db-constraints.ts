import pg from 'pg';

const expectedTriggers: Array<{ name: string; table: string }> = [
  { name: 'normalize_email_trigger', table: 'users' },
  { name: 'normalize_email_trigger', table: 'booking_requests' },
  { name: 'normalize_email_trigger', table: 'notifications' },
  { name: 'normalize_email_trigger', table: 'push_subscriptions' },
  { name: 'check_booking_session_overlap', table: 'booking_sessions' },
  { name: 'normalize_tier_before_write', table: 'users' },
  { name: 'trg_membership_status_change', table: 'users' },
  { name: 'trg_cascade_user_email_delete', table: 'users' },
  { name: 'trg_cascade_user_email_update', table: 'users' },
  { name: 'trg_validate_email_notifications', table: 'notifications' },
  { name: 'trg_validate_email_push_subscriptions', table: 'push_subscriptions' },
  { name: 'trg_validate_email_event_rsvps', table: 'event_rsvps' },
  { name: 'trg_validate_email_wellness_enrollments', table: 'wellness_enrollments' },
  { name: 'trg_validate_email_user_dismissed_notices', table: 'user_dismissed_notices' },
  { name: 'trg_validate_email_member_notes', table: 'member_notes' },
  { name: 'trg_validate_guest_pass_member', table: 'guest_passes' },
  { name: 'trg_booking_status_machine', table: 'booking_requests' },
  { name: 'trg_membership_status_machine', table: 'users' },
  { name: 'trg_guard_guest_pass_hold', table: 'guest_pass_holds' },
  { name: 'trg_prevent_archived_booking_requests', table: 'booking_requests' },
  { name: 'trg_prevent_archived_event_rsvps', table: 'event_rsvps' },
  { name: 'trg_prevent_archived_wellness_enrollments', table: 'wellness_enrollments' },
  { name: 'trg_prevent_archived_guest_pass_holds', table: 'guest_pass_holds' },
  { name: 'trg_prevent_archived_push_subscriptions', table: 'push_subscriptions' },
  { name: 'trg_guard_stale_pending', table: 'booking_requests' },
  { name: 'trg_guard_attended_unpaid', table: 'booking_requests' },
  { name: 'trg_cleanup_fee_on_terminal', table: 'booking_requests' },
  { name: 'trg_clear_unmatched_on_terminal', table: 'booking_requests' },
  { name: 'trg_auto_expire_stale_tours', table: 'tours' },
  { name: 'trg_auto_billing_provider', table: 'users' },
  { name: 'trg_sync_staff_role', table: 'staff_users' },
  { name: 'trg_link_participant_user_id', table: 'booking_participants' },
];

const expectedCheckConstraints: Array<{ name: string; table: string }> = [
  { name: 'booking_requests_status_check', table: 'booking_requests' },
  { name: 'booking_requests_duration_minutes_check', table: 'booking_requests' },
  { name: 'booking_requests_time_order_check', table: 'booking_requests' },
  { name: 'booking_sessions_time_order_check', table: 'booking_sessions' },
  { name: 'users_billing_provider_check', table: 'users' },
  { name: 'users_active_email_check', table: 'users' },
  { name: 'users_membership_status_lowercase_check', table: 'users' },
  { name: 'availability_blocks_block_type_check', table: 'availability_blocks' },
  { name: 'notifications_type_check', table: 'notifications' },
  { name: 'guest_passes_usage_check', table: 'guest_passes' },
];

const expectedFunctions = [
  'normalize_email',
  'set_updated_at',
  'set_updated_at_metadata',
  'prevent_booking_session_overlap',
  'normalize_tier_value',
  'trg_track_membership_status_change',
  'cascade_user_email_delete',
  'cascade_user_email_update',
  'validate_email_exists_in_users',
  'validate_guest_pass_member',
  'enforce_booking_status_transition',
  'enforce_membership_status_transition',
  'guard_guest_pass_hold_limit',
  'prevent_archived_member_writes',
  'guard_stale_pending_booking',
  'guard_attended_unpaid_fees',
  'cleanup_fee_snapshots_on_terminal',
  'auto_expire_stale_tours',
  'auto_set_billing_provider',
  'auto_sync_staff_role',
  'auto_link_participant_user_id',
  'auto_clear_unmatched_on_terminal',
];

const expectedUniqueIndexes: Array<{ name: string; table: string }> = [
  { name: 'users_stripe_customer_id_unique', table: 'users' },
  { name: 'users_hubspot_id_unique', table: 'users' },
  { name: 'idx_users_email_stripe_unique', table: 'users' },
  { name: 'idx_bookings_invoice_unique', table: 'booking_requests' },
];

function checkCategory<T extends { name: string; table?: string }>(
  label: string,
  expected: T[],
  actual: Set<string>,
  makeKey: (item: T) => string,
  formatExpected: (item: T) => string,
  formatActual: (key: string) => string,
  reportUnexpected = true,
): { missing: number; extra: number } {
  console.log(`\n── ${label} ──`);
  let missing = 0;
  let extra = 0;

  const expectedKeys = new Set<string>();
  for (const item of expected) {
    const key = makeKey(item);
    expectedKeys.add(key);
    if (actual.has(key)) {
      console.log(`  ✅ ${formatExpected(item)}`);
    } else {
      console.log(`  ❌ MISSING: ${formatExpected(item)}`);
      missing++;
    }
  }

  if (reportUnexpected) {
    for (const key of actual) {
      if (!expectedKeys.has(key)) {
        console.log(`  ⚠️  UNEXPECTED: ${formatActual(key)}`);
        extra++;
      }
    }
  }

  return { missing, extra };
}

async function run(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    console.log('\n🔍 Database Constraint Drift Report');
    console.log('═'.repeat(60));

    let totalMissing = 0;
    let totalExtra = 0;

    const triggerResult = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      GROUP BY trigger_name, event_object_table
    `);
    const actualTriggers = new Set(
      triggerResult.rows.map((r: { trigger_name: string; event_object_table: string }) =>
        `${r.trigger_name}@${r.event_object_table}`
      )
    );

    const triggerStats = checkCategory(
      'Triggers',
      expectedTriggers,
      actualTriggers,
      t => `${t.name}@${t.table}`,
      t => `${t.name} ON ${t.table}`,
      key => { const [n, t] = key.split('@'); return `${n} ON ${t}`; },
    );
    totalMissing += triggerStats.missing;
    totalExtra += triggerStats.extra;

    const constraintResult = await client.query(`
      SELECT con.conname AS constraint_name, rel.relname AS table_name
      FROM pg_constraint con
      JOIN pg_class rel ON con.conrelid = rel.oid
      JOIN pg_namespace nsp ON rel.relnamespace = nsp.oid
      WHERE nsp.nspname = 'public'
        AND con.contype = 'c'
    `);
    const actualConstraints = new Set(
      constraintResult.rows.map((r: { constraint_name: string; table_name: string }) =>
        `${r.constraint_name}@${r.table_name}`
      )
    );

    const constraintStats = checkCategory(
      'Check Constraints',
      expectedCheckConstraints,
      actualConstraints,
      c => `${c.name}@${c.table}`,
      c => `${c.name} ON ${c.table}`,
      key => { const [n, t] = key.split('@'); return `${n} ON ${t}`; },
    );
    totalMissing += constraintStats.missing;
    totalExtra += constraintStats.extra;

    const funcResult = await client.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_type = 'FUNCTION'
    `);
    const actualFunctions = new Set(
      funcResult.rows.map((r: { routine_name: string }) => r.routine_name)
    );

    const funcStats = checkCategory(
      'Functions (db-init.ts managed)',
      expectedFunctions.map(f => ({ name: f })),
      actualFunctions,
      f => f.name,
      f => `${f.name}()`,
      key => `${key}()`,
      false,
    );
    totalMissing += funcStats.missing;

    const indexResult = await client.query(`
      SELECT i.relname AS index_name, t.relname AS table_name
      FROM pg_index ix
      JOIN pg_class i ON ix.indexrelid = i.oid
      JOIN pg_class t ON ix.indrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public'
        AND ix.indisunique = true
        AND NOT ix.indisprimary
    `);
    const actualIndexes = new Set(
      indexResult.rows.map((r: { index_name: string; table_name: string }) =>
        `${r.index_name}@${r.table_name}`
      )
    );

    const indexStats = checkCategory(
      'Unique Indexes (runtime-managed)',
      expectedUniqueIndexes,
      actualIndexes,
      idx => `${idx.name}@${idx.table}`,
      idx => `${idx.name} ON ${idx.table}`,
      key => { const [n, t] = key.split('@'); return `${n} ON ${t}`; },
    );
    totalMissing += indexStats.missing;
    totalExtra += indexStats.extra;

    const exclusionResult = await client.query(`
      SELECT con.conname AS constraint_name, rel.relname AS table_name
      FROM pg_constraint con
      JOIN pg_class rel ON con.conrelid = rel.oid
      JOIN pg_namespace nsp ON rel.relnamespace = nsp.oid
      WHERE nsp.nspname = 'public'
        AND con.contype = 'x'
    `);
    const actualExclusions = exclusionResult.rows as Array<{ constraint_name: string; table_name: string }>;

    console.log('\n── Exclusion Constraints ──');
    if (actualExclusions.length === 0) {
      console.log('  (none found — none expected from db-init.ts)');
    } else {
      for (const ex of actualExclusions) {
        console.log(`  ⚠️  FOUND: ${ex.constraint_name} ON ${ex.table_name}`);
        totalExtra++;
      }
    }

    console.log('\n' + '─'.repeat(60));
    if (totalMissing === 0 && totalExtra === 0) {
      console.log('✅ All expected database constraints are present, no unexpected objects');
    } else {
      if (totalMissing > 0) {
        console.log(`❌ ${totalMissing} expected constraint(s) are MISSING from the database`);
      }
      if (totalExtra > 0) {
        console.log(`⚠️  ${totalExtra} unexpected object(s) found (may be intentional)`);
      }
    }
    console.log('');

    if (totalMissing > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Database connection failed:', (err as Error).message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
