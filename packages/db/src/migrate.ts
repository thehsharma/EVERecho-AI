import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database } from './pool';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export interface MigrationResult {
  name: string;
  status: 'applied' | 'skipped' | 'optional_failed';
  detail?: string;
  durationMs: number;
}

/**
 * Migrations are numbered SQL files applied in order, each inside its own
 * transaction, each recorded with a checksum. A file that changes after being
 * applied is a hard error: silently diverging schemas are how staging and
 * production stop matching.
 *
 * A file named `*.optional.sql` may fail without failing the run. That is how
 * pgvector is handled: the extension is unavailable on plenty of managed
 * PostgreSQL instances, and the portable path does not need it.
 */
export async function migrate(
  db: Database,
  options: { log?: (message: string) => void } = {},
): Promise<MigrationResult[]> {
  const log = options.log ?? (() => {});

  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      name        text PRIMARY KEY,
      checksum    text NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now(),
      duration_ms integer NOT NULL DEFAULT 0
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Map(
    (
      await db.query<{ name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migration',
      )
    ).map((r) => [r.name, r.checksum]),
  );

  const results: MigrationResult[] = [];

  for (const name of files) {
    const sql = await readFile(join(MIGRATIONS_DIR, name), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const previous = applied.get(name);

    if (previous) {
      if (previous !== checksum) {
        throw new Error(
          `Migration ${name} has changed since it was applied.\n` +
            `Migrations are immutable once run — add a new migration instead of editing this one.`,
        );
      }
      results.push({ name, status: 'skipped', durationMs: 0 });
      continue;
    }

    const optional = name.includes('.optional.');
    const started = Date.now();
    try {
      await db.transaction(async (tx) => {
        await tx.query(sql);
        await tx.query(
          'INSERT INTO schema_migration (name, checksum, duration_ms) VALUES ($1, $2, $3)',
          [name, checksum, Date.now() - started],
        );
      });
      results.push({ name, status: 'applied', durationMs: Date.now() - started });
      log(`  applied  ${name}`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!optional) {
        throw new Error(`Migration ${name} failed: ${detail}`);
      }
      results.push({ name, status: 'optional_failed', detail, durationMs: Date.now() - started });
      log(`  skipped  ${name} (optional, unavailable here: ${detail.split('\n')[0]})`);
    }
  }

  await recordCapabilities(db, results);
  return results;
}

/**
 * Records what this database can actually do, so the retrieval layer selects a
 * query path from evidence rather than from an assumption in configuration.
 */
async function recordCapabilities(db: Database, results: MigrationResult[]): Promise<void> {
  const vectorMigration = results.find((r) => r.name.includes('vector'));
  const pgvectorAvailable =
    vectorMigration === undefined
      ? await hasVectorColumn(db)
      : vectorMigration.status !== 'optional_failed';

  await db.query(
    `INSERT INTO db_capability (name, available, detail, detected_at)
     VALUES ('pgvector', $1, $2, now())
     ON CONFLICT (name) DO UPDATE SET available = EXCLUDED.available,
                                      detail = EXCLUDED.detail,
                                      detected_at = now()`,
    [
      pgvectorAvailable,
      pgvectorAvailable
        ? 'vector column and index available'
        : (vectorMigration?.detail?.split('\n')[0] ?? 'extension not installed'),
    ],
  );
}

async function hasVectorColumn(db: Database): Promise<boolean> {
  const row = await db.maybeOne(
    `SELECT 1 AS present FROM information_schema.columns
     WHERE table_name = 'memory_embedding' AND column_name = 'embedding_v'`,
  );
  return row !== null;
}

/** Drops every object this application owns. Development and test only. */
export async function resetSchema(db: Database): Promise<void> {
  await db.query('DROP SCHEMA public CASCADE');
  await db.query('CREATE SCHEMA public');
}
