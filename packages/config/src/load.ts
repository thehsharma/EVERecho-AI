import { envSchema, type Env } from './schema';

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

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new ConfigError(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`, issues);
  }
  const env = parsed.data;
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
      issues.push('STORAGE_DRIVER=local is not durable; configure STORAGE_DRIVER=s3 for production');
    }
    if (!env.AI_PROVIDER_NO_TRAINING) {
      issues.push('AI_PROVIDER_NO_TRAINING must remain true: provider training on memories is prohibited');
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
  ] as const) {
    if (driver !== 'local' && !env[key]) issues.push(`${key} is required when using a hosted provider`);
  }

  if (issues.length > 0) {
    throw new ConfigError(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`, issues);
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
