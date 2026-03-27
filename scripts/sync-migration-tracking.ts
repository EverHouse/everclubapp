import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import pg from "pg";

const DATABASE_URL = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.log("[MigrationSync] No DATABASE_URL — skipping migration tracking sync");
  process.exit(0);
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface MigrationCheck {
  type: "table" | "function";
  name: string;
}

const MIGRATION_EXISTENCE_CHECKS: Record<string, MigrationCheck> = {
  "0064_add_merch_items": { type: "table", name: "merch_items" },
  "0065_add_webhook_dead_letter_queue": { type: "table", name: "webhook_dead_letter_queue" },
  "0066_update_booking_exclusion_statuses": { type: "function", name: "booking_time_range" },
  "0067_add_fee_products": { type: "table", name: "fee_products" },
};

async function objectExists(client: pg.Client, check: MigrationCheck): Promise<boolean> {
  if (check.type === "table") {
    const result = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1) AS exists`,
      [check.name]
    );
    return result.rows[0]?.exists === true;
  }
  if (check.type === "function") {
    const result = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = $1) AS exists`,
      [check.name]
    );
    return result.rows[0]?.exists === true;
  }
  return true;
}

async function syncMigrationTracking() {
  const journalPath = join(process.cwd(), "drizzle", "meta", "_journal.json");
  const journal: { entries: JournalEntry[] } = JSON.parse(readFileSync(journalPath, "utf-8"));

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    const appTableCheck = await client.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS has_users`
    );
    if (!appTableCheck.rows[0]?.has_users) {
      console.log("[MigrationSync] Fresh database (no 'users' table) — skipping backfill so migrations run normally");
      return;
    }

    await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);

    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS drizzle_migrations_hash_idx ON drizzle."__drizzle_migrations" (hash)`
    );

    const existing = await client.query<{ hash: string }>(
      `SELECT hash FROM drizzle."__drizzle_migrations"`
    );
    const existingHashes = new Set(existing.rows.map((r) => r.hash));

    const isInitialSeed = existingHashes.size === 0;

    if (!isInitialSeed) {
      let cleaned = 0;
      for (const entry of journal.entries) {
        const check = MIGRATION_EXISTENCE_CHECKS[entry.tag];
        if (!check) continue;

        const sqlPath = join(process.cwd(), "drizzle", `${entry.tag}.sql`);
        let content: string;
        try {
          content = readFileSync(sqlPath, "utf-8");
        } catch {
          continue;
        }
        const hash = createHash("md5").update(content).digest("hex");

        if (existingHashes.has(hash)) {
          const exists = await objectExists(client, check);
          if (!exists) {
            await client.query(
              `DELETE FROM drizzle."__drizzle_migrations" WHERE hash = $1`,
              [hash]
            );
            existingHashes.delete(hash);
            cleaned++;
            console.log(`[MigrationSync] Removed phantom tracking for ${entry.tag} (${check.type} '${check.name}' does not exist)`);
          }
        }
      }

      console.log(
        `[MigrationSync] Existing DB — skipped bulk seed. ${existingHashes.size} tracked, ${cleaned} phantom entries removed. New migrations will run via Drizzle migrate.`
      );
      return;
    }

    let inserted = 0;
    let missing = 0;
    for (const entry of journal.entries) {
      const sqlPath = join(process.cwd(), "drizzle", `${entry.tag}.sql`);
      let content: string;
      try {
        content = readFileSync(sqlPath, "utf-8");
      } catch {
        console.error(`[MigrationSync] FATAL: Missing SQL file for journal entry: ${entry.tag}`);
        missing++;
        continue;
      }

      const hash = createHash("md5").update(content).digest("hex");

      if (existingHashes.has(hash)) {
        continue;
      }

      const check = MIGRATION_EXISTENCE_CHECKS[entry.tag];
      if (check) {
        const exists = await objectExists(client, check);
        if (!exists) {
          console.log(`[MigrationSync] Skipping ${entry.tag} — ${check.type} '${check.name}' does not exist, will run via Drizzle migrate`);
          continue;
        }
      }

      await client.query(
        `INSERT INTO drizzle."__drizzle_migrations" (hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [hash, entry.when]
      );
      existingHashes.add(hash);
      inserted++;
    }

    if (missing > 0) {
      throw new Error(`${missing} journal entries have no matching SQL file — build cannot continue`);
    }

    console.log(
      `[MigrationSync] Initial seed done: ${journal.entries.length} journal entries, ${inserted} registered`
    );
  } finally {
    await client.end();
  }
}

syncMigrationTracking().catch((err) => {
  console.error("[MigrationSync] Failed:", err.message);
  process.exit(1);
});
