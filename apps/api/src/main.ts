import { loadConfig } from '@everecho/config';
import { createContext } from './context';
import { buildServer } from './server';

const cfg = loadConfig();
const ctx = createContext(cfg);
const app = await buildServer(ctx);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await ctx.db.close();
  await ctx.cache.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await app.listen({ host: cfg.env.API_HOST, port: cfg.env.API_PORT });
  app.log.info(
    {
      storage: ctx.storage.name,
      llm: ctx.llm.name,
      embeddings: ctx.embeddings.name,
      stt: ctx.stt.name,
      ocr: ctx.ocr.name,
      email: ctx.email.name,
      billing: ctx.billing.name,
    },
    'providers in use',
  );
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
