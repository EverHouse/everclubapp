import { Router } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { syncPush, syncPull, runDataCleanup } from '../../core/dataIntegrity';
import { syncAllCustomerMetadata } from '../../core/stripe/customers';
import { getSystemHealth } from '../../core/healthCheck';
import { logger, isAdmin, validateBody, broadcastDataIntegrityUpdate, logFromRequest, getErrorMessage, db, sql } from './shared';
import { logAndRespond } from '../../core/logger';
import { parseConstraintError } from '../../utils/errorUtils';
import type { Request } from 'express';
import { syncPushPullSchema } from '../../../shared/validators/dataIntegrity';
import { systemSettings } from '../../../shared/models/system';
import { eq } from 'drizzle-orm';

const execFileAsync = promisify(execFile);

const router = Router();

router.post('/api/data-integrity/sync-push', isAdmin, validateBody(syncPushPullSchema), async (req: Request, res) => {
  try {
    const { issue_key, target, user_id, hubspot_contact_id, stripe_customer_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'userId is required for sync push operations' });
    }
    
    const result = await syncPush({
      issueKey: issue_key,
      target,
      userId: user_id,
      hubspotContactId: hubspot_contact_id,
      stripeCustomerId: stripe_customer_id
    });
    
    broadcastDataIntegrityUpdate('data_changed', { source: `sync_push_${target}` });
    
    res.json(result);
  } catch (error: unknown) {
    const parsed = parseConstraintError(error);
    if (parsed.isConstraintError) {
      return logAndRespond(req, res, 409, parsed.message, error);
    }
    logAndRespond(req, res, 500, 'Failed to push sync', error);
  }
});

router.post('/api/data-integrity/sync-pull', isAdmin, validateBody(syncPushPullSchema), async (req: Request, res) => {
  try {
    const { issue_key, target, user_id, hubspot_contact_id, stripe_customer_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'userId is required for sync pull operations' });
    }
    
    const result = await syncPull({
      issueKey: issue_key,
      target,
      userId: user_id,
      hubspotContactId: hubspot_contact_id,
      stripeCustomerId: stripe_customer_id
    });
    
    broadcastDataIntegrityUpdate('data_changed', { source: `sync_pull_${target}` });
    
    res.json(result);
  } catch (error: unknown) {
    const parsed = parseConstraintError(error);
    if (parsed.isConstraintError) {
      return logAndRespond(req, res, 409, parsed.message, error);
    }
    logAndRespond(req, res, 500, 'Failed to pull sync', error);
  }
});

const STRIPE_SYNC_STATUS_KEY = 'stripe_metadata_sync_status';
const STALE_SYNC_TIMEOUT_MS = 10 * 60 * 1000;

interface StripeSyncStatusData {
  status: 'running' | 'complete' | 'error' | 'idle';
  startedAt?: string;
  completedAt?: string;
  synced?: number;
  failed?: number;
  error?: string;
}

async function getStripeSyncStatus(): Promise<StripeSyncStatusData> {
  const [row] = await db.select().from(systemSettings).where(eq(systemSettings.key, STRIPE_SYNC_STATUS_KEY));
  if (!row?.value) return { status: 'idle' };
  let data: StripeSyncStatusData;
  try {
    data = JSON.parse(row.value);
  } catch {
    logger.warn('[DataIntegrity] Corrupt stripe sync status in DB, resetting to idle');
    return { status: 'idle' };
  }
  if (!data || typeof data.status !== 'string') return { status: 'idle' };
  if (data.status === 'running') {
    const startMs = data.startedAt ? new Date(data.startedAt).getTime() : NaN;
    const elapsed = Number.isFinite(startMs) ? Date.now() - startMs : Infinity;
    if (elapsed > STALE_SYNC_TIMEOUT_MS) {
      const staleData: StripeSyncStatusData = {
        status: 'error',
        startedAt: data.startedAt,
        completedAt: new Date().toISOString(),
        error: 'Sync timed out (exceeded 10 minutes) — likely interrupted by a server restart',
      };
      await setStripeSyncStatus(staleData);
      return staleData;
    }
  }
  return data;
}

async function setStripeSyncStatus(data: StripeSyncStatusData): Promise<void> {
  await db.insert(systemSettings)
    .values({
      key: STRIPE_SYNC_STATUS_KEY,
      value: JSON.stringify(data),
      category: 'sync',
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: JSON.stringify(data),
        category: 'sync',
        updatedAt: new Date(),
      },
    });
}

async function tryAcquireStripeSyncLock(startedAt: string): Promise<boolean> {
  const now = new Date();
  const runningValue = JSON.stringify({ status: 'running', startedAt } satisfies StripeSyncStatusData);
  const result = await db.execute(sql`
    INSERT INTO system_settings (key, value, category, updated_at)
    VALUES (${STRIPE_SYNC_STATUS_KEY}, ${runningValue}, 'sync', ${now})
    ON CONFLICT (key) DO UPDATE
      SET value = ${runningValue}, category = 'sync', updated_at = ${now}
      WHERE system_settings.value::jsonb->>'status' IS DISTINCT FROM 'running'
         OR system_settings.value::jsonb->>'startedAt' IS NULL
         OR NOT (system_settings.value::jsonb->>'startedAt' ~ '^\d{4}-\d{2}-\d{2}T')
         OR CASE
              WHEN system_settings.value::jsonb->>'startedAt' ~ '^\d{4}-\d{2}-\d{2}T'
              THEN (system_settings.value::jsonb->>'startedAt')::timestamptz < NOW() - INTERVAL '10 minutes'
              ELSE true
            END
    RETURNING key
  `);
  const rows = Array.isArray(result) ? result : (result as unknown as Record<string, unknown>).rows;
  return Array.isArray(rows) && rows.length > 0;
}

router.post('/api/data-integrity/sync-stripe-metadata', isAdmin, async (req, res) => {
  const startedAt = new Date().toISOString();
  const acquired = await tryAcquireStripeSyncLock(startedAt);
  if (!acquired) {
    const current = await getStripeSyncStatus();
    return res.status(409).json({ success: false, error: 'Stripe metadata sync is already running', startedAt: current.startedAt });
  }

  res.json({ success: true, message: 'Stripe metadata sync started in background.' });

  try {
    logger.info('[DataIntegrity] Starting Stripe customer metadata sync (background)...');
    const result = await syncAllCustomerMetadata();
    await setStripeSyncStatus({ status: 'complete', startedAt, completedAt: new Date().toISOString(), synced: result.synced, failed: result.failed });
    logger.info(`[DataIntegrity] Stripe metadata sync complete: ${result.synced} synced, ${result.failed} failed`);
  } catch (error: unknown) {
    const msg = getErrorMessage(error);
    await setStripeSyncStatus({ status: 'error', startedAt, completedAt: new Date().toISOString(), error: msg });
    logger.error('[DataIntegrity] Stripe metadata sync error', { extra: { detail: msg } });
  }
});

router.get('/api/data-integrity/sync-stripe-metadata/status', isAdmin, async (_req, res) => {
  const data = await getStripeSyncStatus();
  if (data.status === 'running') {
    return res.json({ status: 'running', startedAt: data.startedAt });
  }
  if (data.status === 'complete') {
    return res.json({
      status: 'complete',
      startedAt: data.startedAt,
      message: `Synced ${data.synced} customers to Stripe. ${data.failed} failed.`,
      synced: data.synced,
      failed: data.failed,
    });
  }
  if (data.status === 'error') {
    return res.json({ status: 'error', startedAt: data.startedAt, error: data.error });
  }
  res.json({ status: 'idle' });
});

router.post('/api/data-integrity/cleanup', isAdmin, async (req, res) => {
  try {
    logger.info('[DataIntegrity] Starting data cleanup...');
    const result = await runDataCleanup();
    
    res.json({ 
      success: true, 
      message: `Cleanup complete: Removed ${result.orphanedNotifications} orphaned notifications, marked ${result.orphanedBookings} orphaned bookings, removed ${result.expiredHolds} expired guest pass holds.`,
      ...result
    });
  } catch (error: unknown) {
    const parsed = parseConstraintError(error);
    if (parsed.isConstraintError) {
      return logAndRespond(req, res, 409, parsed.message, error);
    }
    logAndRespond(req, res, 500, 'Failed to run data cleanup', error);
  }
});

router.get('/api/data-integrity/health', isAdmin, async (req, res) => {
  try {
    const health = await getSystemHealth();
    
    logFromRequest(
      req,
      'health_check_viewed',
      'system',
      undefined,
      'System Health Check',
      { overall: health.overall }
    );
    
    res.json({ success: true, health });
  } catch (error: unknown) {
    const parsed = parseConstraintError(error);
    if (parsed.isConstraintError) {
      return logAndRespond(req, res, 409, parsed.message, error);
    }
    logAndRespond(req, res, 500, 'Failed to check system health', error);
  }
});

router.post('/api/data-integrity/resync-from-production', isAdmin, async (req, res) => {
  try {
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
      return res.status(403).json({ success: false, error: 'This operation is only available in development' });
    }

    const poolerUrl = process.env.DATABASE_POOLER_URL;
    const localUrl = process.env.DATABASE_URL;
    if (!poolerUrl || !localUrl) {
      return res.status(400).json({ success: false, error: 'Missing DATABASE_POOLER_URL or DATABASE_URL' });
    }

    const isLocal = (() => {
      try { return ['localhost', '127.0.0.1', 'helium'].includes(new URL(localUrl).hostname); }
      catch { return false; }
    })();
    if (!isLocal) {
      return res.status(400).json({ success: false, error: 'DATABASE_URL does not point to a local database — refusing to overwrite' });
    }

    logger.info('[DevSync] Starting production → local database resync...');

    const dumpDir = '/tmp/db_sync/data';
    mkdirSync(dumpDir, { recursive: true });

    if (existsSync(dumpDir)) {
      for (const f of readdirSync(dumpDir)) {
        if (f.endsWith('.csv')) unlinkSync(`${dumpDir}/${f}`);
      }
    }

    const { stdout: tableList } = await execFileAsync('psql', [
      poolerUrl, '-t', '-A', '-c',
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    ], { timeout: 30000 });

    const tables = tableList.trim().split('\n').filter(Boolean);
    logger.info(`[DevSync] Found ${tables.length} tables to export`);

    let exported = 0;
    const exportedTables: { table: string; rows: number }[] = [];
    for (const table of tables) {
      const { stdout: countStr } = await execFileAsync('psql', [
        poolerUrl, '-t', '-A', '-c', `SELECT count(*) FROM "${table}";`
      ], { timeout: 30000 });
      const count = parseInt(countStr.trim(), 10);
      if (count === 0) continue;

      await execFileAsync('psql', [
        poolerUrl, '-c', `\\COPY "${table}" TO '${dumpDir}/${table}.csv' WITH (FORMAT csv, HEADER true)`
      ], { timeout: 60000 });
      exported++;
      exportedTables.push({ table, rows: count });
    }

    logger.info(`[DevSync] Exported ${exported} tables from production`);

    const csvFiles = readdirSync(dumpDir).filter(f => f.endsWith('.csv'));

    const CRITICAL_TABLES = ['users', 'booking_requests', 'staff_users'];
    const missingCritical = CRITICAL_TABLES.filter(t => !csvFiles.includes(`${t}.csv`));
    if (missingCritical.length > 0) {
      const msg = `Export failed for critical tables: ${missingCritical.join(', ')}. Aborting — no data was modified.`;
      logger.error(`[DevSync] ${msg}`);
      return res.status(500).json({ success: false, error: msg });
    }

    if (csvFiles.length < 5) {
      const msg = `Only ${csvFiles.length} CSV files exported — expected many more. Aborting — no data was modified.`;
      logger.error(`[DevSync] ${msg}`);
      return res.status(500).json({ success: false, error: msg });
    }

    logger.info(`[DevSync] Export verified: ${csvFiles.length} CSV files, all critical tables present. Starting import...`);

    const DEV_ONLY_TABLES = [
      'stripe_transaction_cache',
      'stripe_payment_intents',
      'webhook_processed_events',
      'terminal_payments',
    ];

    interface StripeMapping {
      matchKey: string;
      cols: Record<string, string | null>;
    }
    const savedStripeMappings: Record<string, StripeMapping[]> = {};

    const stripePreserveQueries: Record<string, { query: string; cols: string[] }> = {
      users: {
        query: `SELECT email AS match_key, stripe_customer_id, stripe_subscription_id FROM users WHERE stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL`,
        cols: ['stripe_customer_id', 'stripe_subscription_id'],
      },
      membership_tiers: {
        query: `SELECT slug AS match_key, stripe_product_id, stripe_price_id FROM membership_tiers WHERE stripe_product_id IS NOT NULL OR stripe_price_id IS NOT NULL`,
        cols: ['stripe_product_id', 'stripe_price_id'],
      },
      fee_products: {
        query: `SELECT slug AS match_key, stripe_product_id, stripe_price_id FROM fee_products WHERE stripe_product_id IS NOT NULL OR stripe_price_id IS NOT NULL`,
        cols: ['stripe_product_id', 'stripe_price_id'],
      },
      cafe_items: {
        query: `SELECT name AS match_key, stripe_product_id, stripe_price_id FROM cafe_items WHERE stripe_product_id IS NOT NULL OR stripe_price_id IS NOT NULL`,
        cols: ['stripe_product_id', 'stripe_price_id'],
      },
      billing_groups: {
        query: `SELECT id::text AS match_key, stripe_customer_id, primary_stripe_customer_id, primary_stripe_subscription_id FROM billing_groups WHERE stripe_customer_id IS NOT NULL OR primary_stripe_customer_id IS NOT NULL OR primary_stripe_subscription_id IS NOT NULL`,
        cols: ['stripe_customer_id', 'primary_stripe_customer_id', 'primary_stripe_subscription_id'],
      },
      stripe_products: {
        query: `SELECT stripe_product_id AS match_key, stripe_price_id FROM stripe_products WHERE stripe_product_id IS NOT NULL`,
        cols: ['stripe_price_id'],
      },
    };

    for (const [table, config] of Object.entries(stripePreserveQueries)) {
      try {
        const { stdout } = await execFileAsync('psql', [
          localUrl, '-t', '-A', '-F', '|', '-c', config.query
        ], { timeout: 10000 });
        const rows = stdout.trim().split('\n').filter(Boolean);
        if (rows.length > 0) {
          savedStripeMappings[table] = rows.map(row => {
            const parts = row.split('|');
            const cols: Record<string, string | null> = {};
            config.cols.forEach((col, i) => {
              cols[col] = parts[i + 1] || null;
            });
            return { matchKey: parts[0], cols };
          });
          logger.info(`[DevSync] Saved ${rows.length} Stripe mappings from ${table}`);
        }
      } catch {
        logger.warn(`[DevSync] Could not save Stripe mappings from ${table} (table may be empty)`);
      }
    }

    let devOnlyPreserved = 0;
    const devOnlyData: Record<string, string> = {};
    for (const table of DEV_ONLY_TABLES) {
      try {
        const { stdout: countStr } = await execFileAsync('psql', [
          localUrl, '-t', '-A', '-c', `SELECT count(*) FROM "${table}";`
        ], { timeout: 10000 });
        const count = parseInt(countStr.trim(), 10);
        if (count > 0) {
          const backupPath = `${dumpDir}/_dev_${table}.csv`;
          await execFileAsync('psql', [
            localUrl, '-c', `\\COPY "${table}" TO '${backupPath}' WITH (FORMAT csv, HEADER true)`
          ], { timeout: 60000 });
          devOnlyData[table] = backupPath;
          devOnlyPreserved++;
          logger.info(`[DevSync] Backed up ${count} rows from dev-only table ${table}`);
        }
      } catch {
        logger.warn(`[DevSync] Could not backup dev-only table ${table}`);
      }
    }

    const importCsvFiles = csvFiles.filter(f => {
      const table = f.replace('.csv', '');
      return !DEV_ONLY_TABLES.includes(table);
    });

    const allTablesToTruncate = importCsvFiles.map(f => f.replace('.csv', ''));

    let imported = 0;
    const failed: string[] = [];

    const truncateSql = `SET session_replication_role = 'replica'; ` +
      allTablesToTruncate.map(t => `TRUNCATE "${t}" CASCADE;`).join(' ');
    await execFileAsync('psql', [localUrl, '-c', truncateSql], { timeout: 60000 });
    logger.info(`[DevSync] Truncated ${allTablesToTruncate.length} tables (preserved ${DEV_ONLY_TABLES.length} dev-only tables)`);

    const quoteIdent = (id: string) => '"' + id.replace(/"/g, '""') + '"';

    for (const csvFile of importCsvFiles) {
      const table = csvFile.replace('.csv', '');
      try {
        const { stdout: prodColsRaw } = await execFileAsync('psql', [
          poolerUrl, '-t', '-A', '-c',
          `SELECT column_name FROM information_schema.columns WHERE table_name=$$ ${table} $$ AND table_schema='public' ORDER BY ordinal_position;`
        ], { timeout: 10000 });
        const prodCols = prodColsRaw.trim().split('\n').filter(Boolean);

        const { stdout: localColsRaw } = await execFileAsync('psql', [
          localUrl, '-t', '-A', '-c',
          `SELECT column_name FROM information_schema.columns WHERE table_name=$$ ${table} $$ AND table_schema='public' ORDER BY ordinal_position;`
        ], { timeout: 10000 });
        const localCols = localColsRaw.trim().split('\n').filter(Boolean);
        const extraLocalCols = localCols.filter(c => !prodCols.includes(c));

        if (extraLocalCols.length === 0) {
          const importSql = `SET session_replication_role = 'replica';\n\\COPY ${quoteIdent(table)} FROM '${dumpDir}/${csvFile}' WITH (FORMAT csv, HEADER true)`;
          await execFileAsync('psql', [localUrl], {
            timeout: 120000,
            input: importSql
          } as Parameters<typeof execFileAsync>[2] & { input: string });
        } else {
          logger.info(`[DevSync] Table ${table} has ${extraLocalCols.length} extra local columns (${extraLocalCols.join(', ')}), using temp table approach`);
          const tmpTable = `_tmp_import_${table.replace(/[^a-zA-Z0-9_]/g, '_')}`;
          const setupSql = [
            `SET session_replication_role = 'replica';`,
            `DROP TABLE IF EXISTS ${quoteIdent(tmpTable)};`,
            `CREATE TABLE ${quoteIdent(tmpTable)} (LIKE ${quoteIdent(table)} INCLUDING DEFAULTS);`,
            ...extraLocalCols.map(col => `ALTER TABLE ${quoteIdent(tmpTable)} DROP COLUMN IF EXISTS ${quoteIdent(col)};`),
          ].join('\n');
          await execFileAsync('psql', [localUrl, '-c', setupSql], { timeout: 30000 });

          const copySql = `SET session_replication_role = 'replica';\n\\COPY ${quoteIdent(tmpTable)} FROM '${dumpDir}/${csvFile}' WITH (FORMAT csv, HEADER true)`;
          await execFileAsync('psql', [localUrl], {
            timeout: 120000,
            input: copySql
          } as Parameters<typeof execFileAsync>[2] & { input: string });

          const colList = prodCols.map(c => quoteIdent(c)).join(', ');
          const insertSql = `SET session_replication_role = 'replica'; INSERT INTO ${quoteIdent(table)} (${colList}) SELECT ${colList} FROM ${quoteIdent(tmpTable)}; DROP TABLE ${quoteIdent(tmpTable)};`;
          await execFileAsync('psql', [localUrl, '-c', insertSql], { timeout: 120000 });
        }
        imported++;
      } catch (importErr: unknown) {
        failed.push(table);
        logger.warn(`[DevSync] Failed to import ${table}: ${getErrorMessage(importErr)}`);
      }
    }

    const matchKeyColumn: Record<string, string> = {
      users: 'email',
      membership_tiers: 'slug',
      fee_products: 'slug',
      cafe_items: 'name',
      billing_groups: 'id',
      stripe_products: 'stripe_product_id',
    };

    let restoredCount = 0;
    for (const [table, mappings] of Object.entries(savedStripeMappings)) {
      const keyCol = matchKeyColumn[table];
      if (!keyCol) continue;
      const isNumericKey = keyCol === 'id';
      for (const mapping of mappings) {
        const sets = Object.entries(mapping.cols)
          .filter(([, v]) => v != null)
          .map(([col, val]) => `${col} = '${val}'`);
        if (sets.length === 0) continue;
        const whereVal = isNumericKey ? mapping.matchKey : `'${mapping.matchKey.replace(/'/g, "''")}'`;
        const restoreSql = `UPDATE "${table}" SET ${sets.join(', ')} WHERE ${keyCol} = ${whereVal}`;
        try {
          await execFileAsync('psql', [localUrl, '-c', restoreSql], { timeout: 10000 });
          restoredCount++;
        } catch (restoreErr: unknown) {
          logger.warn(`[DevSync] Failed to restore Stripe mapping for ${table}/${mapping.matchKey}: ${getErrorMessage(restoreErr)}`);
        }
      }
    }
    if (restoredCount > 0) {
      logger.info(`[DevSync] Restored ${restoredCount} dev Stripe ID mappings across ${Object.keys(savedStripeMappings).length} tables`);
    }

    if (failed.length > 0) {
      logger.warn(`[DevSync] ${failed.length} tables failed to import: ${failed.join(', ')}`);
      const criticalFailed = failed.filter(t => CRITICAL_TABLES.includes(t));
      if (criticalFailed.length > 0) {
        throw new Error(`Critical tables failed to import: ${criticalFailed.join(', ')}`);
      }
    }

    const { stdout: seqQueries } = await execFileAsync('psql', [
      localUrl, '-t', '-A', '-c',
      `SELECT 'SELECT setval(pg_get_serial_sequence(''' || quote_ident(tablename) || ''', ''' || attname || '''), COALESCE((SELECT MAX(' || quote_ident(attname) || ') FROM ' || quote_ident(tablename) || '), 1));'
       FROM pg_tables t
       JOIN pg_attribute a ON a.attrelid = (t.schemaname || '.' || t.tablename)::regclass
       JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE t.schemaname = 'public' AND pg_get_expr(d.adbin, d.adrelid) LIKE 'nextval%';`
    ], { timeout: 30000 });

    for (const seqSql of seqQueries.trim().split('\n').filter(Boolean)) {
      try {
        await execFileAsync('psql', [localUrl, '-c', seqSql], { timeout: 10000 });
      } catch { /* sequence reset is best-effort */ }
    }

    const { stdout: userCount } = await execFileAsync('psql', [localUrl, '-t', '-A', '-c', 'SELECT count(*) FROM users;'], { timeout: 10000 });
    const { stdout: bookingCount } = await execFileAsync('psql', [localUrl, '-t', '-A', '-c', 'SELECT count(*) FROM booking_requests;'], { timeout: 10000 });
    const { stdout: staffCount } = await execFileAsync('psql', [localUrl, '-t', '-A', '-c', 'SELECT count(*) FROM staff_users;'], { timeout: 10000 });

    const stripePart = restoredCount > 0 ? ` Restored ${restoredCount} dev Stripe mappings.` : '';
    const preservedPart = devOnlyPreserved > 0 ? ` Preserved ${devOnlyPreserved} dev-only tables.` : '';
    const summary = `Synced ${imported} tables (${failed.length} failed).${stripePart}${preservedPart} Local DB: ${userCount.trim()} users, ${bookingCount.trim()} bookings, ${staffCount.trim()} staff.`;
    logger.info(`[DevSync] ${summary}`);

    logFromRequest(req, 'dev_resync_from_production', 'system', undefined, summary);

    res.json({
      success: failed.length === 0,
      message: summary,
      tables: imported,
      failed: failed.length > 0 ? failed : undefined,
      stripePreserved: restoredCount,
      devOnlyTablesPreserved: devOnlyPreserved,
      users: parseInt(userCount.trim(), 10),
      bookings: parseInt(bookingCount.trim(), 10),
      staff: parseInt(staffCount.trim(), 10),
    });
  } catch (error: unknown) {
    const parsed = parseConstraintError(error);
    if (parsed.isConstraintError) {
      return logAndRespond(req, res, 409, parsed.message, error);
    }
    logAndRespond(req, res, 500, 'Failed to resync from production', error);
  }
});

export default router;
