/**
 * Emits the OpenAPI document from the registered routes.
 *
 * The routes are built against the same Zod schemas that validate requests and
 * responses at runtime, so the specification describes what the server actually
 * does rather than what someone remembered to document.
 */
import { writeFile } from 'node:fs/promises';
import { loadConfig } from '@everecho/config';
import { Database } from '@everecho/db';
import { createContext } from '../context';
import { buildServer } from '../server';
import { buildOpenApiDocument, routeRegistry } from '../http/route';

const cfg = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
// Building the server registers every route; no database traffic is needed.
const db = new Database(cfg);
const app = await buildServer(createContext(cfg, db));

const document = buildOpenApiDocument({
  title: `${cfg.env.PRODUCT_NAME} API`,
  version: '0.1.0',
  serverUrl: cfg.env.API_PUBLIC_URL,
});

const output = process.argv[2] ?? 'openapi.generated.json';
await writeFile(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`${routeRegistry.length} routes written to ${output}`);

await app.close();
await db.close();
