import { loadConfig } from '@everecho/config';
import { Database } from '../pool';
import { migrate, resetSchema } from '../migrate';

const cfg = loadConfig();
if (cfg.isProduction) {
  console.error('Refusing to reset the schema in production.');
  process.exit(1);
}

const database = new Database(cfg);
console.log('Dropping and recreating the public schema…');
await resetSchema(database);
await migrate(database, { log: (m) => console.log(m) });
console.log('Schema reset.');
await database.close();
