import { config as loadSharedConfig, branding, features, type AppConfig } from '@everecho/config';
import { Database, db as sharedDb } from '@everecho/db';
import { BreakerRegistry } from '@everecho/realtime';
import {
  createAnalytics,
  createBilling,
  createCache,
  createEmail,
  createScanner,
  createStorage,
  AnalyticsRecorder,
  type AnalyticsAdapter,
  type BillingAdapter,
  type CacheAdapter,
  type EmailAdapter,
  type ScanAdapter,
  type StorageAdapter,
} from '@everecho/adapters';
import {
  createEmbeddings,
  createLlm,
  createOcr,
  createSpeechToText,
  type EmbeddingAdapter,
  type LlmAdapter,
  type OcrAdapter,
  type SpeechToTextAdapter,
} from '@everecho/ai';

/**
 * Everything the application depends on, assembled once and passed explicitly.
 * No module reaches for a global; swapping any provider is a change here only.
 */
export interface AppContext {
  cfg: AppConfig;
  db: Database;
  storage: StorageAdapter;
  email: EmailAdapter;
  billing: BillingAdapter;
  scanner: ScanAdapter;
  cache: CacheAdapter;
  analytics: AnalyticsRecorder;
  analyticsAdapter: AnalyticsAdapter;
  llm: LlmAdapter;
  embeddings: EmbeddingAdapter;
  stt: SpeechToTextAdapter;
  ocr: OcrAdapter;
  branding: ReturnType<typeof branding>;
  features: ReturnType<typeof features>;
  /**
   * Provider circuit breakers, one per provider, for the life of the process.
   *
   * On the context rather than inside the realtime module because a breaker
   * that is recreated per session learns that a provider is down once per
   * conversation, which is once per conversation too late.
   */
  breakers: BreakerRegistry;
}

export function createContext(
  cfg: AppConfig = loadSharedConfig(),
  database?: Database,
): AppContext {
  const db = database ?? sharedDb(cfg);
  const analyticsAdapter = createAnalytics(cfg, async (event) => {
    // Analytics rows are archive-agnostic and carry only opaque ids.
    await db.query(
      `INSERT INTO analytics_event (name, opaque_actor_id, opaque_archive_id, props, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        event.name,
        event.opaqueActorId,
        event.opaqueArchiveId,
        JSON.stringify(event.props),
        event.occurredAt,
      ],
    );
  });

  return {
    cfg,
    db,
    storage: createStorage(cfg),
    email: createEmail(cfg),
    billing: createBilling(cfg),
    scanner: createScanner(cfg),
    cache: createCache(cfg),
    analyticsAdapter,
    // Salted with the session secret so analytics ids cannot be recomputed by
    // anyone holding only the analytics store.
    analytics: new AnalyticsRecorder(analyticsAdapter, cfg.env.SESSION_SECRET),
    llm: createLlm(cfg),
    embeddings: createEmbeddings(cfg),
    stt: createSpeechToText(cfg),
    ocr: createOcr(cfg),
    branding: branding(cfg),
    features: features(cfg),
    breakers: new BreakerRegistry({
      threshold: cfg.env.REALTIME_BREAKER_THRESHOLD,
      cooldownMs: cfg.env.REALTIME_BREAKER_COOLDOWN_MS,
    }),
  };
}
