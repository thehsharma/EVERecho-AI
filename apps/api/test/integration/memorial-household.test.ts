import { registerMemorialHousehold } from '../../src/modules/memorial-household';
import { registerMemorialQuality, recordMemorialOutcome } from '../../src/modules/memorial-quality';
import { registerMemorialRoutes } from '../../src/modules/memorial';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { Database } from '@everecho/db';
import { config } from '@everecho/config';
import type { AppContext } from '../../src/context';
import { ApiError } from '../../src/errors';
import {
  registerMemorialProfileRoutes,
  reserveMemorialTurn,
} from '../../src/modules/memorial-profiles';

const cfg = config();
const db = new Database(cfg);
const owners = [randomUUID(), randomUUID(), randomUUID()];
const ctx = {
  cfg: { ...cfg, isProduction: false, env: { ...cfg.env, MEMORIAL_DAILY_TURN_LIMIT: 3 } },
  db,
} as AppContext;
const app = Fastify();
app.addHook('onRequest', async (request) => {
  const id = request.headers['x-test-owner'];
  request.user =
    typeof id === 'string'
      ? {
          id,
          email: 'test@example.com',
          displayName: 'Test',
          isPlatformAdmin: false,
          sessionId: 'test',
        }
      : null;
});
app.setErrorHandler((error, _req, reply) => {
  reply.code(error instanceof ApiError ? error.status : 500).send({ error: true });
});
registerMemorialProfileRoutes(app, ctx);
registerMemorialRoutes(app, ctx);
registerMemorialHousehold(app, ctx);
registerMemorialQuality(app, ctx);
beforeAll(async () => {
  for (const id of owners)
    await db.query('INSERT INTO app_user(id,email,display_name) VALUES($1,$2,$3)', [
      id,
      id + '@example.com',
      'Synthetic integration test',
    ]);
  await app.ready();
});
afterAll(async () => {
  await app.close();
  for (const id of owners) await db.query('DELETE FROM app_user WHERE id=$1', [id]);
  await db.close();
});

it('shares atomic allowances without sharing private measurements, and revokes membership', async () => {
  const call = (owner: number, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { 'x-test-owner': owners[owner]! },
      ...(payload ? { payload } : {}),
    });
  expect(
    (await call(0, 'POST', '/v1/memorial/household', { name: 'Test household' })).statusCode,
  ).toBe(200);
  const invite = await call(0, 'POST', '/v1/memorial/household/invite');
  expect(invite.statusCode).toBe(200);
  const code = invite.json().code;
  expect(
    (await call(1, 'POST', '/v1/memorial/household/join', { code, acknowledged: true })).statusCode,
  ).toBe(200);
  expect(
    (await call(2, 'POST', '/v1/memorial/household/join', { code, acknowledged: true })).statusCode,
  ).toBe(404);
  expect((await call(1, 'GET', '/v1/memorial/household')).json().household.members).toEqual([]);
  const attempts = await Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => reserveMemorialTurn(ctx, owners[i % 2]!)),
  );
  expect(attempts.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  const id = randomUUID();
  await recordMemorialOutcome(ctx, owners[0]!, id, {
    mode: 'local-preview',
    tone: 'warm',
    durationMs: 20,
    succeeded: true,
    speechCharacters: 15,
  });
  expect((await call(0, 'GET', '/v1/memorial/quality')).json()).toMatchObject({
    turns: 1,
    speechCharacters: 15,
  });
  expect((await call(1, 'GET', '/v1/memorial/quality')).json()).toMatchObject({ turns: 0 });
  expect(
    (await call(1, 'POST', '/v1/memorial/quality/' + id + '/feedback', { feedback: 'helpful' }))
      .statusCode,
  ).toBe(404);
  expect(
    (await call(0, 'POST', '/v1/memorial/quality/' + id + '/feedback', { feedback: 'helpful' }))
      .statusCode,
  ).toBe(200);
  const group = (await call(0, 'GET', '/v1/memorial/household')).json().household;
  const member = group.members.find((m: { self: boolean }) => !m.self);
  expect((await call(2, 'DELETE', '/v1/memorial/household/seats/' + member.id)).statusCode).toBe(
    404,
  );
  expect((await call(0, 'DELETE', '/v1/memorial/household/seats/' + member.id)).statusCode).toBe(
    200,
  );
  await expect(reserveMemorialTurn(ctx, owners[1]!)).resolves.toBeUndefined();
  expect((await call(1, 'GET', '/v1/memorial/household')).json().household).toBeNull();
  expect((await call(0, 'DELETE', '/v1/memorial/quality')).statusCode).toBe(200);
  expect((await call(0, 'GET', '/v1/memorial/quality')).json().turns).toBe(0);
});
