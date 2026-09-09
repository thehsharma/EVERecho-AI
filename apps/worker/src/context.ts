import { branding, config as loadSharedConfig, type AppConfig } from '@everecho/config';
import { Database, db as sharedDb } from '@everecho/db';
import { createCache, createEmail, createScanner, createStorage } from '@everecho/adapters';
import { createEmbeddings, createLlm, createOcr, createSpeechToText } from '@everecho/ai';
import type { PipelineContext } from '@everecho/pipeline';

/** The worker needs the same providers as the API, and nothing more. */
export function createWorkerContext(
  cfg: AppConfig = loadSharedConfig(),
  database?: Database,
): PipelineContext {
  return {
    cfg,
    db: database ?? sharedDb(cfg),
    storage: createStorage(cfg),
    scanner: createScanner(cfg),
    email: createEmail(cfg),
    cache: createCache(cfg),
    llm: createLlm(cfg),
    embeddings: createEmbeddings(cfg),
    stt: createSpeechToText(cfg),
    ocr: createOcr(cfg),
    branding: branding(cfg),
  };
}
