import { createHmac } from 'node:crypto';
import { registerMemorialRoutes } from '../../src/modules/memorial';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Database } from '@everecho/db';
import { config } from '@everecho/config';
import type { AppContext } from '../../src/context';
import { ApiError } from '../../src/errors';
import {
  registerMemorialProfileRoutes,
  withMemorialOwner,
  reserveMemorialTurn,
} from '../../src/modules/memorial-profiles';

const cfg = config();
const db = new Database(cfg);
const owners = [randomUUID(), randomUUID()];
const ctx = {
  cfg: { ...cfg, isProduction: false, env: { ...cfg.env, MEMORIAL_DAILY_TURN_LIMIT: 3 } },
  db,
} as AppContext;
const app = Fastify();
const profile = {
  name: 'Synthetic test',
  relationship: 'family',
  language: 'en',
  personality: 'warm',
  memories: 'A fictional garden.',
  phrases: '',
  tone: 'gentle',
};
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
describe('memorial account isolation', () => {
  it('persists profiles while denying another account read, update and delete', async () => {
    const made = await app.inject({
      method: 'POST',
      url: '/v1/memorial/profiles',
      headers: { 'x-test-owner': owners[0]! },
      payload: { profile, acknowledged: true },
    });
    expect(made.statusCode).toBe(200);
    const id = made.json().id;
    const own = await app.inject({
      method: 'GET',
      url: '/v1/memorial/profiles',
      headers: { 'x-test-owner': owners[0]! },
    });
    expect(own.json().profiles.some((p: { id: string }) => p.id === id)).toBe(true);
    const other = await app.inject({
      method: 'GET',
      url: '/v1/memorial/profiles',
      headers: { 'x-test-owner': owners[1]! },
    });
    expect(other.json().profiles).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/memorial/profiles',
          headers: { 'x-test-owner': owners[1]! },
          payload: { id, profile, acknowledged: true },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v1/memorial/profiles/' + id,
          headers: { 'x-test-owner': owners[1]! },
        })
      ).statusCode,
    ).toBe(404);
    // Even a forgotten WHERE clause cannot expose another owner's profile.
    expect(
      await withMemorialOwner(ctx, owners[1]!, (tx) => tx.query('SELECT id FROM memorial_profile')),
    ).toEqual([]);
    expect(await db.query('SELECT id FROM memorial_profile')).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: '/v1/memorial/profiles/' + id,
          headers: { 'x-test-owner': owners[0]! },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('rejects anonymous and unacknowledged profile saves', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/memorial/profiles',
          payload: { profile, acknowledged: true },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/memorial/profiles',
          headers: { 'x-test-owner': owners[0]! },
          payload: { profile, acknowledged: false },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('enforces the allowance atomically under parallel requests', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, () => reserveMemorialTurn(ctx, owners[0]!)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(5);
    const usage = await app.inject({
      method: 'GET',
      url: '/v1/memorial/usage',
      headers: { 'x-test-owner': owners[0]! },
    });
    expect(usage.json()).toMatchObject({ used: 3, limit: 3 });
    const other = await app.inject({
      method: 'GET',
      url: '/v1/memorial/usage',
      headers: { 'x-test-owner': owners[1]! },
    });
    expect(other.json().used).toBe(0);
  });
});

it('revokes existing voice tokens and isolates voice ownership', async () => {
  const voiceId = 'test' + randomUUID().replaceAll('-', '');
  await withMemorialOwner(ctx, owners[0]!, (tx) =>
    tx.query('INSERT INTO memorial_voice(voice_id,user_id,name,verified) VALUES($1,$2,$3,true)', [
      voiceId,
      owners[0],
      'Synthetic voice',
    ]),
  );
  const payload = Buffer.from(
    JSON.stringify({ userId: owners[0], voiceId, expires: Date.now() + 60000 }),
  ).toString('base64url');
  const token =
    payload +
    '.' +
    createHmac('sha256', cfg.env.SESSION_SECRET).update(payload).digest('base64url');
  const turn = {
    profile,
    history: [],
    message: 'garden',
    acknowledged: true,
    allowCloud: false,
    voiceToken: token,
  };
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/memorial/respond',
        headers: { 'x-test-owner': owners[0]! },
        payload: turn,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/memorial/respond',
        headers: { 'x-test-owner': owners[1]! },
        payload: turn,
      })
    ).statusCode,
  ).toBe(403);
  await app.inject({
    method: 'DELETE',
    url: '/v1/memorial/voices/' + voiceId,
    headers: { 'x-test-owner': owners[0]! },
  });
  expect(
    (
      await app.inject({
        method: 'POST',
        url: '/v1/memorial/respond',
        headers: { 'x-test-owner': owners[0]! },
        payload: turn,
      })
    ).statusCode,
  ).toBe(403);
});
it('expires paid allowances without needing a cancellation webhook', async () => {
  await db.query(
    "INSERT INTO family_subscription(user_id,status,current_end) VALUES($1,'active',now()+interval '1 day')",
    [owners[1]],
  );
  const url = '/v1/memorial/usage';
  const headers = { 'x-test-owner': owners[1]! };
  expect((await app.inject({ method: 'GET', url, headers })).json().limit).toBe(
    ctx.cfg.env.MEMORIAL_FAMILY_DAILY_TURN_LIMIT,
  );
  await db.query(
    "UPDATE family_subscription SET current_end=now()-interval '1 day' WHERE user_id=$1",
    [owners[1]],
  );
  expect((await app.inject({ method: 'GET', url, headers })).json().limit).toBe(3);
});
