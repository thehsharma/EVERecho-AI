import { z } from 'zod';

/**
 * Every environment variable EverEcho reads is declared here exactly once.
 * Nothing in the codebase may touch `process.env` directly outside this package.
 */

const bool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])])
  .transform((v) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(v)));

const int = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

/** A secret must be long enough to be worth calling a secret. */
const secret = (min = 32) =>
  z
    .string()
    .min(min, `must be at least ${min} characters`)
    .refine((v) => !/^(changeme|password|secret|test)$/i.test(v), 'must not be a placeholder value');

export const NODE_ENVS = ['development', 'test', 'production'] as const;

export const envSchema = z.object({
  // ---- Runtime ------------------------------------------------------------
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // ---- Branding / legal copy (see packages/config/src/branding.ts) --------
  PRODUCT_NAME: z.string().min(1).default('EverEcho'),
  PRODUCT_CODENAME: z.string().min(1).default('everecho'),
  SUPPORT_EMAIL: z.email().default('support@everecho.example'),
  DATA_REGION: z.string().min(1).default('local'),
  JURISDICTION: z.string().min(1).default('IN'),
  CONSENT_COPY_VERSION: z.string().min(1).default('consent-copy-2026-01'),
  LEGAL_COPY_VERSION: z.string().min(1).default('legal-copy-2026-01-draft'),
  POLICY_ENGINE_VERSION: z.string().min(1).default('policy-1'),

  // ---- HTTP ---------------------------------------------------------------
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: int(1, 65535).default(4000),
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
  TRUST_PROXY: bool.default(false),
  RATE_LIMIT_WINDOW_MS: int(1000, 3_600_000).default(60_000),
  RATE_LIMIT_MAX: int(1, 100_000).default(300),
  RATE_LIMIT_AUTH_MAX: int(1, 10_000).default(20),

  // ---- Database -----------------------------------------------------------
  DATABASE_URL: z.string().min(1).default('postgres://everecho:everecho@localhost:5432/everecho'),
  DATABASE_POOL_MAX: int(1, 200).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: int(100, 600_000).default(15_000),

  // ---- Cache / queue ------------------------------------------------------
  CACHE_DRIVER: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().optional(),
  QUEUE_DRIVER: z.enum(['postgres']).default('postgres'),
  WORKER_CONCURRENCY: int(1, 64).default(2),
  WORKER_POLL_INTERVAL_MS: int(50, 60_000).default(500),
  WORKER_MAX_ATTEMPTS: int(1, 20).default(5),

  // ---- Object storage -----------------------------------------------------
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./var/storage'),
  STORAGE_SIGNING_SECRET: secret().default('dev-only-storage-signing-secret-change-me'),
  STORAGE_SIGNED_URL_TTL_SECONDS: int(10, 86_400).default(300),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),

  // ---- Uploads ------------------------------------------------------------
  UPLOAD_MAX_BYTES: int(1024, 5_368_709_120).default(524_288_000),
  UPLOAD_ALLOWED_MIME: z
    .string()
    .default(
      'image/jpeg,image/png,image/webp,image/heic,image/tiff,application/pdf,text/plain,audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg,video/mp4,video/webm,video/quicktime',
    ),

  // ---- Auth ---------------------------------------------------------------
  AUTH_DRIVER: z.enum(['local', 'oidc']).default('local'),
  SESSION_SECRET: secret().default('dev-only-session-secret-change-me-please'),
  SESSION_TTL_SECONDS: int(300, 31_536_000).default(1_209_600),
  SESSION_COOKIE_NAME: z.string().default('everecho_session'),
  COOKIE_SECURE: bool.default(false),
  COOKIE_DOMAIN: z.string().optional(),
  PASSWORD_MIN_LENGTH: int(8, 128).default(12),
  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),

  // ---- AI providers -------------------------------------------------------
  LLM_DRIVER: z.enum(['local', 'anthropic', 'openai']).default('local'),
  LLM_MODEL: z.string().default('local-deterministic-v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_BASE_URL: z.string().optional(),
  EMBEDDINGS_DRIVER: z.enum(['local', 'openai', 'voyage']).default('local'),
  EMBEDDINGS_MODEL: z.string().default('local-hashed-v1'),
  EMBEDDINGS_DIM: int(16, 4096).default(256),
  EMBEDDINGS_API_KEY: z.string().optional(),
  STT_DRIVER: z.enum(['local', 'whisper', 'deepgram']).default('local'),
  STT_MODEL: z.string().default('local-deterministic-v1'),
  STT_API_KEY: z.string().optional(),
  OCR_DRIVER: z.enum(['local', 'tesseract', 'textract']).default('local'),
  OCR_MODEL: z.string().default('local-deterministic-v1'),
  OCR_API_KEY: z.string().optional(),
  /** Providers must be configured never to train on customer data. */
  AI_PROVIDER_NO_TRAINING: bool.default(true),
  AI_PROVIDER_RETENTION_DAYS: int(0, 3650).default(0),

  // ---- Email / notifications ---------------------------------------------
  EMAIL_DRIVER: z.enum(['local', 'smtp', 'resend']).default('local'),
  EMAIL_FROM: z.email().default('no-reply@everecho.example'),
  EMAIL_OUTBOX_DIR: z.string().default('./var/outbox'),
  SMTP_URL: z.string().optional(),
  EMAIL_API_KEY: z.string().optional(),

  // ---- Billing ------------------------------------------------------------
  BILLING_DRIVER: z.enum(['local', 'stripe']).default('local'),
  BILLING_CURRENCY: z.enum(['INR', 'USD']).default('INR'),
  BILLING_RESERVATION_AMOUNT_MINOR: int(0, 100_000_000).default(199_900),
  BILLING_WEBHOOK_SECRET: z.string().default('dev-only-billing-webhook-secret'),
  BILLING_API_KEY: z.string().optional(),

  // ---- Malware scanning ---------------------------------------------------
  SCAN_DRIVER: z.enum(['local', 'clamav']).default('local'),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: int(1, 65535).optional(),

  // ---- Analytics / observability -----------------------------------------
  ANALYTICS_DRIVER: z.enum(['local', 'posthog', 'none']).default('local'),
  ANALYTICS_API_KEY: z.string().optional(),
  ERROR_MONITOR_DRIVER: z.enum(['local', 'sentry', 'none']).default('local'),
  ERROR_MONITOR_DSN: z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().default('everecho'),

  // ---- Feature flags ------------------------------------------------------
  /** Consent mode "perform" (voice/avatar/persona). Prohibited in v0.1. */
  FEATURE_PERFORM_MODE: bool.default(false),
  /** P4 model inference in customer-visible answers. Off by default. */
  FEATURE_P4_INFERENCE_IN_ANSWERS: bool.default(false),
  /** Succession transitions require legal review before they may execute. */
  FEATURE_SUCCESSION_EXECUTION: bool.default(false),
  FEATURE_DEMO_MODE: bool.default(true),
  FEATURE_BILLING: bool.default(true),
  FEATURE_ADMIN_TOOLS: bool.default(true),

  // ---- Safety -------------------------------------------------------------
  SAFETY_EMERGENCY_INFO_REGION: z.string().default('IN'),
  SAFETY_ESCALATION_EMAIL: z.email().default('safety@everecho.example'),
});

export type Env = z.infer<typeof envSchema>;
