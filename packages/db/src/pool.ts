import pg from 'pg';
import { config, type AppConfig } from '@everecho/config';

const { Pool, types } = pg;

// int8 arrives as a string by default to avoid precision loss. Our bigints are
// byte sizes and counts, comfortably inside Number.MAX_SAFE_INTEGER.
types.setTypeParser(20, (v: string) => Number(v));
// numeric -> number for the same reason.
types.setTypeParser(1700, (v: string) => Number(v));

export type QueryParams = readonly unknown[];

export interface Queryable {
  query<T extends object = Record<string, unknown>>(
    sql: string,
    params?: QueryParams,
  ): Promise<T[]>;
  /** Exactly one row, or a thrown error naming what was expected. */
  one<T extends object = Record<string, unknown>>(sql: string, params?: QueryParams): Promise<T>;
  maybeOne<T extends object = Record<string, unknown>>(
    sql: string,
    params?: QueryParams,
  ): Promise<T | null>;
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'DatabaseError';
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

class QueryRunner implements Queryable {
  constructor(private readonly runner: pg.Pool | pg.PoolClient) {}

  async query<T extends object = Record<string, unknown>>(
    sql: string,
    params: QueryParams = [],
  ): Promise<T[]> {
    const result = await this.runner.query(sql, params as unknown[]);
    return result.rows as T[];
  }

  async one<T extends object = Record<string, unknown>>(
    sql: string,
    params: QueryParams = [],
  ): Promise<T> {
    const rows = await this.query<T>(sql, params);
    const row = rows[0];
    if (!row) throw new NotFoundError('row');
    return row;
  }

  async maybeOne<T extends object = Record<string, unknown>>(
    sql: string,
    params: QueryParams = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}

export interface Transaction extends Queryable {
  /** The archive this transaction is scoped to, if any. */
  readonly archiveId: string | null;
}

export class Database implements Queryable {
  private readonly pool: pg.Pool;
  private readonly runner: QueryRunner;

  constructor(private readonly cfg: AppConfig = config()) {
    this.pool = new Pool({
      connectionString: cfg.env.DATABASE_URL,
      max: cfg.env.DATABASE_POOL_MAX,
      statement_timeout: cfg.env.DATABASE_STATEMENT_TIMEOUT_MS,
      application_name: 'everecho',
    });
    // A pool error with no listener terminates the process in Node.
    this.pool.on('error', () => {});
    this.runner = new QueryRunner(this.pool);
  }

  query<T extends object = Record<string, unknown>>(sql: string, params?: QueryParams) {
    return this.runner.query<T>(sql, params);
  }
  one<T extends object = Record<string, unknown>>(sql: string, params?: QueryParams) {
    return this.runner.one<T>(sql, params);
  }
  maybeOne<T extends object = Record<string, unknown>>(sql: string, params?: QueryParams) {
    return this.runner.maybeOne<T>(sql, params);
  }

  /** Atomic unit of work. Rolls back on any thrown error. */
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.runTransaction(null, fn);
  }

  /**
   * Runs `fn` with row-level security scoped to one archive.
   *
   * Everything inside sees only that archive's content, enforced by the
   * database rather than by remembering to add a `WHERE archive_id = …`. This
   * sits *behind* authorize(): the policy engine decides whether the caller may
   * act, and this makes a mistake in that decision non-catastrophic.
   */
  async withArchiveScope<T>(archiveId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    if (!/^[0-9a-f-]{36}$/i.test(archiveId)) {
      throw new DatabaseError(`Refusing to scope to a malformed archive id`);
    }
    return this.runTransaction(archiveId, fn);
  }

  private async runTransaction<T>(
    archiveId: string | null,
    fn: (tx: Transaction) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (archiveId) {
        // set_config with a bind parameter: never string-interpolated.
        await client.query('SELECT set_config($1, $2, true)', ['everecho.archive_id', archiveId]);
      }
      const runner = new QueryRunner(client);
      const tx: Transaction = {
        archiveId,
        query: runner.query.bind(runner),
        one: runner.one.bind(runner),
        maybeOne: runner.maybeOne.bind(runner),
      };
      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // The original error is the one worth surfacing.
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async healthy(): Promise<{ ok: boolean; detail: string | null }> {
    try {
      await this.pool.query('SELECT 1');
      return { ok: true, detail: null };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : 'unknown error' };
    }
  }

  async capability(name: string): Promise<boolean> {
    const row = await this.maybeOne<{ available: boolean }>(
      'SELECT available FROM db_capability WHERE name = $1',
      [name],
    );
    return row?.available ?? false;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  get poolSize(): number {
    return this.pool.totalCount;
  }
}

let shared: Database | undefined;

export function db(cfg?: AppConfig): Database {
  shared ??= new Database(cfg);
  return shared;
}

export async function closeSharedDb(): Promise<void> {
  if (shared) {
    await shared.close();
    shared = undefined;
  }
}
