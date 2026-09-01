import { loadConfig } from '@everecho/config';
import { Database } from '../pool';
import { migrate } from '../migrate';

const cfg = loadConfig();
const database = new Database(cfg);

console.log(`Migrating ${redactUrl(cfg.env.DATABASE_URL)}`);
try {
  const results = await migrate(database, { log: (m) => console.log(m) });
  const applied = results.filter((r) => r.status === 'applied').length;
  const optionalFailed = results.filter((r) => r.status === 'optional_failed');
  const skipped = results.filter((r) => r.status === 'skipped').length;
  console.log(
    `\n${applied} applied, ${skipped} already present, ${optionalFailed.length} optional unavailable.`,
  );
  for (const r of optionalFailed) {
    console.log(`Optional migration unavailable: ${r.name}`);
  }
  const pgvector = await database.capability('pgvector');
  console.log(
    `pgvector: ${pgvector ? 'available (indexed vector search)' : 'not available (portable array search)'}`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await database.close();
}

function redactUrl(url: string): string {
  return url.replace(/\/\/([^:]+):[^@]*@/, '//$1:***@');
}
