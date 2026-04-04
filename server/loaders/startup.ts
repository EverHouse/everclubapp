import { getErrorMessage } from '../utils/errorUtils';
import { logger } from '../core/logger';
import { db } from '../db';
import { sql } from 'drizzle-orm';
import { runWithConcurrency } from './startupUtils';
import { initDatabaseConstraints, buildParallelDbTasks, verifyFeeProducts, verifyIntegrityConstraintsStartup } from './startupDbTasks';
import { initStripe, verifyStripeEnvironment, verifyResendConnector, initSupabaseRealtime } from './startupStripeInit';
import { buildPostStripeTasks } from './startupPostTasks';
import type { StartupHealth } from './startupTypes';

const startupHealth: StartupHealth = {
  database: 'pending',
  stripe: 'pending',
  realtime: 'pending',
  criticalFailures: [],
  warnings: [],
  startedAt: new Date().toISOString()
};

export function getStartupHealth(): StartupHealth {
  return { ...startupHealth };
}

async function waitForDatabaseReady(maxAttempts = 20): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await db.execute(sql`SELECT 1`);
      if (attempt > 1) {
        logger.info(`[Startup] Database connection ready (after ${attempt} attempts)`);
      }
      return;
    } catch (err: unknown) {
      if (attempt === maxAttempts) {
        logger.error(`[Startup] Database not ready after ${maxAttempts} attempts — startup tasks may fail`, { extra: { error: getErrorMessage(err) } });
        throw err;
      }
      const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), 10000);
      logger.warn(`[Startup] Database not ready (attempt ${attempt}/${maxAttempts}), retrying in ${Math.round(delay / 1000)}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

export function validateEnvironment(): void {
  const FATAL_VARS = [
    'DATABASE_URL',
  ];

  const DEGRADED_VARS: Array<{ name: string; feature: string }> = [
    { name: 'GOOGLE_CLIENT_ID', feature: 'Google sign-in' },
    { name: 'SUPABASE_URL', feature: 'Supabase realtime' },
    { name: 'SUPABASE_ANON_KEY', feature: 'Supabase client' },
    { name: 'SESSION_SECRET', feature: 'Session security' },
  ];

  const OPTIONAL_VARS = [
    'HUBSPOT_ACCESS_TOKEN',
    'APPLE_CLIENT_ID',
    'APPLE_TEAM_ID',
    'MAPKIT_PRIVATE_KEY',
    'VAPID_PUBLIC_KEY',
    'VAPID_PRIVATE_KEY',
  ];

  const fatalMissing: string[] = [];
  for (const varName of FATAL_VARS) {
    if (!process.env[varName]?.trim()) {
      fatalMissing.push(varName);
    }
  }

  if (fatalMissing.length > 0) {
    logger.error(`[Startup] FATAL: Missing required environment variables: ${fatalMissing.join(', ')}`);
    logger.error('[Startup] The server cannot start without these variables. Please set them and restart.');
    process.exit(1);
  }

  const degradedMissing: string[] = [];
  for (const { name, feature } of DEGRADED_VARS) {
    if (!process.env[name]?.trim()) {
      degradedMissing.push(name);
      logger.warn(`[Startup] Missing ${name} — ${feature} will be unavailable`);
    }
  }

  const optionalMissing: string[] = [];
  for (const varName of OPTIONAL_VARS) {
    if (!process.env[varName]?.trim()) {
      optionalMissing.push(varName);
    }
  }

  if (degradedMissing.length > 0) {
    logger.warn(`[Startup] Running in degraded mode — missing: ${degradedMissing.join(', ')}`);
    startupHealth.warnings.push(`Degraded env vars: ${degradedMissing.join(', ')}`);
  }

  if (optionalMissing.length > 0) {
    logger.info(`[Startup] Optional env vars not set: ${optionalMissing.join(', ')}`);
  }

  logger.info('[Startup] Environment validation complete');
}

export async function runStartupTasks(): Promise<void> {
  logger.info('[Startup] Running deferred database initialization...');

  startupHealth.database = 'pending';
  startupHealth.stripe = 'pending';
  startupHealth.realtime = 'pending';
  startupHealth.criticalFailures = [];
  startupHealth.warnings = [];
  startupHealth.startedAt = new Date().toISOString();
  delete startupHealth.completedAt;

  validateEnvironment();

  try {
    await waitForDatabaseReady();
  } catch {
    startupHealth.database = 'failed';
    startupHealth.criticalFailures.push('Database connection could not be established');
    startupHealth.completedAt = new Date().toISOString();
    return;
  }

  await initDatabaseConstraints(startupHealth);

  const parallelDbTasks = buildParallelDbTasks(startupHealth);
  await runWithConcurrency(parallelDbTasks, 3);
  logger.info('[Startup] Parallel DB initialization tasks complete');

  await verifyFeeProducts(startupHealth);
  await verifyIntegrityConstraintsStartup(startupHealth);

  await initStripe(startupHealth);

  await verifyResendConnector(startupHealth);
  await initSupabaseRealtime(startupHealth);
  await verifyStripeEnvironment(startupHealth);

  const postStripeTasks = buildPostStripeTasks();
  await runWithConcurrency(postStripeTasks, 3);

  startupHealth.completedAt = new Date().toISOString();

  if (startupHealth.criticalFailures.length > 0) {
    logger.error('[Startup] CRITICAL FAILURES', { extra: { failures: startupHealth.criticalFailures } });
  }
  if (startupHealth.warnings.length > 0) {
    logger.warn('[Startup] Warnings', { extra: { warnings: startupHealth.warnings } });
  }
}
