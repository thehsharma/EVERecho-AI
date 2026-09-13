import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { loadConfig } from '@everecho/config';
import type { AppContext } from '../../src/context';
import { ApiError } from '../../src/errors';
import {
  registerFamilySubscriptions,
  verifyRazorpaySignature,
} from '../../src/modules/family-subscriptions';
const raw = Buffer.from('{"event":"subscription.activated"}');
const secret = 'test-webhook-secret';
afterEach(() => vi.unstubAllGlobals());
describe('Razorpay subscription boundaries', () => {
  it('verifies exact raw bytes and rejects tampering', () => {
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(verifyRazorpaySignature(raw, signature, secret)).toBe(true);
    expect(verifyRazorpaySignature(Buffer.concat([raw, Buffer.from(' ')]), signature, secret)).toBe(
      false,
    );
    expect(verifyRazorpaySignature(raw, 'invalid', secret)).toBe(false);
    expect(verifyRazorpaySignature(raw, signature, 'wrong')).toBe(false);
  });
  it('leaves unconfigured checkout disabled without calling the provider', async () => {
    const app = Fastify();
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    app.addHook('onRequest', async (r) => {
      r.user = {
        id: 'test',
        email: 'test@example.com',
        displayName: 'Test',
        sessionId: 'test',
        isPlatformAdmin: false,
      };
    });
    app.setErrorHandler((e, _r, reply) =>
      reply.code(e instanceof ApiError ? e.status : 500).send({ error: true }),
    );
    registerFamilySubscriptions(app, {
      cfg: loadConfig({ NODE_ENV: 'test' }),
      db: { maybeOne: async () => null },
    } as unknown as AppContext);
    try {
      const status = await app.inject({ method: 'GET', url: '/v1/family-subscription' });
      expect(status.json()).toMatchObject({ configured: false, plan: null });
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/family-subscription/checkout',
            payload: { acknowledged: true },
          })
        ).statusCode,
      ).toBe(409);
      expect(fetch).not.toHaveBeenCalled();
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/webhooks/razorpay',
            headers: { 'content-type': 'application/json' },
            payload: raw,
          })
        ).statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});

it('accepts a signed raw webhook and refreshes current provider state', async () => {
  const app = Fastify();
  const query = vi.fn(async (_sql: string, _params?: unknown[]) => [{ event_id: 'evt-test' }]);
  const remote = vi.fn(
    async () =>
      new Response(JSON.stringify({ id: 'sub_test', status: 'active', current_end: 2000000000 }), {
        status: 200,
      }),
  );
  vi.stubGlobal('fetch', remote);
  const cfg = loadConfig({
    NODE_ENV: 'test',
    RAZORPAY_KEY_ID: 'rzp_test_example',
    RAZORPAY_KEY_SECRET: 'secret',
    RAZORPAY_WEBHOOK_SECRET: secret,
    RAZORPAY_FAMILY_PLAN_ID: 'plan_test',
  });
  registerFamilySubscriptions(app, {
    cfg,
    db: {
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ maybeOne: async () => ({ id: 'row', provider_id: 'sub_test' }), query }),
    },
  } as unknown as AppContext);
  const body =
    '{ "event": "subscription.activated", "payload": {"subscription":{"entity":{"id":"sub_test"}}}}';
  const signature = createHmac('sha256', secret).update(body).digest('hex');
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/webhooks/razorpay',
      headers: {
        'content-type': 'application/json',
        'x-razorpay-signature': signature,
        'x-razorpay-event-id': 'evt-test',
      },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(remote).toHaveBeenCalledOnce();
    expect(query.mock.calls.some((call) => String(call[0]).includes('current_end'))).toBe(true);
  } finally {
    await app.close();
  }
});
