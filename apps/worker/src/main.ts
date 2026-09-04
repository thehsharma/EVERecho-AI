import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { loadConfig } from '@everecho/config';
import { runJobBatch } from '@everecho/pipeline';
import { createWorkerContext } from './context';

const cfg = loadConfig();
const log = pino({ level: cfg.env.LOG_LEVEL, name: 'everecho-worker' });
const ctx = createWorkerContext(cfg);
const workerId = `${hostname()}-${randomUUID().slice(0, 8)}`;

let running = true;
let inFlight = false;

const shutdown = async (signal: string) => {
  log.info({ signal }, 'draining before shutdown');
  running = false;
  // Let the batch in flight finish so its transaction commits rather than
  // rolling back and re-running work that had side effects on storage.
  const deadline = Date.now() + 30_000;
  while (inFlight && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  await ctx.db.close();
  await ctx.cache.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

log.info(
  {
    workerId,
    concurrency: cfg.env.WORKER_CONCURRENCY,
    providers: {
      llm: ctx.llm.name,
      stt: ctx.stt.name,
      ocr: ctx.ocr.name,
      storage: ctx.storage.name,
    },
  },
  'worker started',
);

// Poll rather than listen: the queue lives in PostgreSQL so that enqueueing is
// transactional with the domain change that caused it (see DECISION_LOG D-004).
while (running) {
  inFlight = true;
  try {
    const result = await runJobBatch(ctx, {
      workerId,
      limit: cfg.env.WORKER_CONCURRENCY,
      visibilityTimeoutMs: 5 * 60_000,
    });
    if (result.processed > 0) {
      log.info(result, 'batch complete');
    }
    inFlight = false;
    if (result.processed === 0) {
      await new Promise((resolve) => setTimeout(resolve, cfg.env.WORKER_POLL_INTERVAL_MS));
    }
  } catch (error) {
    inFlight = false;
    log.error({ err: error }, 'batch failed');
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
}
