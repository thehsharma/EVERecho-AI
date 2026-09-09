import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { envSchema, type Env } from './schema';

/**
 * Loads a `.env` file if one exists, walking up from the current directory to
 * the repository root. Values already present in the environment always win, so
 * a deployment's real configuration is never shadowed by a file left on disk.
 *
 * Hand-rolled rather than a dependency: the format is four lines of parsing,
 * and configuration loading is not somewhere to add a supply-chain surface.
 */
function loadDotEnv(startDir = process.cwd()): void {
  let dir = resolve(startDir);
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        if (process.env[key] !== undefined) continue;
        let value = trimmed.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        process.env[key] = value;
      }
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Where a relative path in the configuration is relative *to*.
 *
 * `resolve('./var/storage')` resolves against `process.cwd()`, and the four
 * processes in this repository have four different working directories. That
 * meant the worker wrote uploads and exports to `apps/worker/var/storage`
 * while the API looked for them in `apps/api/var/storage`, so in local
 * development every recording was unplayable and every export was
 * undownloadable — for three releases, because nothing had ever asked one
 * process for a file another process wrote.
 *
 * Anchored to this file rather than to the caller: it is the one location that
 * does not change with whoever is running.
 */
function workspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/** Paths shared between processes, and therefore never process-relative. */
const SHARED_DIRECTORIES = ['STORAGE_LOCAL_DIR', 'EMAIL_OUTBOX_DIR'] as const;

export interface AppConfig {
  env: Env;
  isProduction: boolean;
  isTest: boolean;
  isDevelopment: boolean;
  uploadAllowedMime: readonly string[];
}

export class ConfigError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'ConfigError';
  }
}

/**
 * Production refuses to boot on dev defaults. Getting this wrong is the
 * difference between "a demo" and "a data breach", so it is a hard failure.
 */
const PRODUCTION_REQUIRED: readonly (keyof Env)[] = [
  'SESSION_SECRET',
  'STORAGE_SIGNING_SECRET',
  'DATABASE_URL',
  'API_PUBLIC_URL',
  'WEB_PUBLIC_URL',
];

const DEV_DEFAULT_MARKERS = ['dev-only', 'change-me', 'changeme', 'localhost'];

export function loadConfig(source?: Record<string, string | undefined>): AppConfig {
  // Only when reading the real environment; tests pass an explicit source.
  if (source === undefined) loadDotEnv();
  const parsed = envSchema.safeParse(source ?? process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(
      `Invalid environment configuration:\n  - ${issues.join('\n  - ')}`,
      issues,
    );
  }
  const env = parsed.data;

  // Made absolute before anything reads them, so every process agrees on where
  // a file is regardless of which directory it was started from.
  const root = workspaceRoot();
  for (const key of SHARED_DIRECTORIES) env[key] = resolve(root, env[key]);

  const issues: string[] = [];

  if (env.NODE_ENV === 'production') {
    for (const key of PRODUCTION_REQUIRED) {
      const value = String(env[key] ?? '');
      if (DEV_DEFAULT_MARKERS.some((m) => value.toLowerCase().includes(m))) {
        issues.push(`${key} still uses a development default and must be set in production`);
      }
    }
    if (!env.COOKIE_SECURE) issues.push('COOKIE_SECURE must be true in production');
    if (env.AUTH_DRIVER === 'local') {
      issues.push(
        'AUTH_DRIVER=local is a development-only credential store; configure AUTH_DRIVER=oidc for production',
      );
    }
    if (env.STORAGE_DRIVER === 'local') {
      issues.push(
        'STORAGE_DRIVER=local is not durable; configure STORAGE_DRIVER=s3 for production',
      );
    }
    if (!env.EXPORT_SIGNING_PRIVATE_KEY) {
      issues.push(
        'EXPORT_SIGNING_PRIVATE_KEY is required in production: an export nobody can check the origin of is not portable, it is merely downloadable',
      );
    }
    if (!env.AI_PROVIDER_NO_TRAINING) {
      issues.push(
        'AI_PROVIDER_NO_TRAINING must remain true: provider training on memories is prohibited',
      );
    }
  }

  // Prohibited in v0.1 regardless of environment (PRODUCT_CONSTITUTION).
  if (env.FEATURE_PERFORM_MODE) {
    issues.push(
      'FEATURE_PERFORM_MODE is prohibited in v0.1: voice cloning, avatars and persona simulation are out of scope',
    );
  }
  if (env.FEATURE_SUCCESSION_EXECUTION) {
    issues.push(
      'FEATURE_SUCCESSION_EXECUTION is disabled pending qualified legal review; directives may be recorded but not executed',
    );
  }

  if (env.STORAGE_DRIVER === 's3') {
    for (const key of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[key]) issues.push(`${key} is required when STORAGE_DRIVER=s3`);
    }
  }
  if (env.CACHE_DRIVER === 'redis' && !env.REDIS_URL) {
    issues.push('REDIS_URL is required when CACHE_DRIVER=redis');
  }
  if (env.AUTH_DRIVER === 'oidc') {
    for (const key of ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'] as const) {
      if (!env[key]) issues.push(`${key} is required when AUTH_DRIVER=oidc`);
    }
  }
  for (const [driver, key] of [
    [env.LLM_DRIVER, 'LLM_API_KEY'],
    [env.EMBEDDINGS_DRIVER, 'EMBEDDINGS_API_KEY'],
    [env.STT_DRIVER, 'STT_API_KEY'],
    [env.REALTIME_LLM_DRIVER, 'LLM_API_KEY'],
    [env.REALTIME_STT_DRIVER, 'DEEPGRAM_API_KEY'],
    [env.REALTIME_TTS_DRIVER, 'DEEPGRAM_API_KEY'],
  ] as const) {
    if (driver !== 'local' && !env[key])
      issues.push(`${key} is required when using a hosted provider`);
  }

  // Live audio leaves the deployment the moment a hosted real-time provider is
  // configured, so the no-training setting stops being advisory. Refused in
  // every environment rather than only in production: a developer pointing a
  // real microphone at a provider that may train on it is the case this is for.
  if (
    !env.AI_PROVIDER_NO_TRAINING &&
    (env.REALTIME_STT_DRIVER !== 'local' ||
      env.REALTIME_LLM_DRIVER !== 'local' ||
      env.REALTIME_TTS_DRIVER !== 'local')
  ) {
    issues.push(
      'AI_PROVIDER_NO_TRAINING must remain true when a hosted real-time provider is configured',
    );
  }

  if (issues.length > 0) {
    throw new ConfigError(
      `Invalid environment configuration:\n  - ${issues.join('\n  - ')}`,
      issues,
    );
  }

  return {
    env,
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
    isDevelopment: env.NODE_ENV === 'development',
    uploadAllowedMime: env.UPLOAD_ALLOWED_MIME.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

let cached: AppConfig | undefined;

/** Process-wide config. Call `loadConfig` directly in tests to avoid the cache. */
export function config(): AppConfig {
  cached ??= loadConfig();
  return cached;
}

export function resetConfigCache(): void {
  cached = undefined;
}
