function parseWebhookJson(raw: Buffer): unknown {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
}
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { defineRoute } from '../http/route';
import { ApiError, notFound } from '../errors';

export function verifyRazorpaySignature(raw: Buffer, signature: unknown, secret: string): boolean {
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(
    createHmac('sha256', secret).update(raw).digest(),
    Buffer.from(signature, 'hex'),
  );
}
const remoteSubscription = z.object({
  id: z.string().regex(/^sub_[a-zA-Z0-9]+$/),
  status: z.enum([
    'created',
    'authenticated',
    'active',
    'pending',
    'halted',
    'cancelled',
    'completed',
    'expired',
    'paused',
  ]),
  short_url: z.string().nullish(),
  current_end: z.number().int().nullable().optional(),
});
interface Row {
  id: string;
  provider_id: string | null;
  status: string;
  checkout_url: string | null;
}
export function registerFamilySubscriptions(app: FastifyInstance, ctx: AppContext) {
  const env = ctx.cfg.env;
  const enabled = Boolean(
    env.RAZORPAY_KEY_ID &&
    env.RAZORPAY_KEY_SECRET &&
    env.RAZORPAY_WEBHOOK_SECRET &&
    env.RAZORPAY_FAMILY_PLAN_ID,
  );
  async function provider(path: string, body?: object) {
    if (!enabled) throw new ApiError('conflict', 'Family subscriptions are not configured yet.');
    try {
      const response = await fetch('https://api.razorpay.com/v1/' + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          authorization:
            'Basic ' +
            Buffer.from(env.RAZORPAY_KEY_ID + ':' + env.RAZORPAY_KEY_SECRET).toString('base64'),
          'content-type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error();
      return (await response.json()) as unknown;
    } catch {
      throw new ApiError(
        'provider_unavailable',
        'Razorpay could not complete the request. Please try later or contact support.',
      );
    }
  }
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/family-subscription',
    tag: 'billing',
    summary: 'Family subscription and plan',
    auth: 'required',
    response: z.object({
      configured: z.boolean(),
      testMode: z.boolean(),
      cycles: z.number(),
      subscription: z.object({ status: z.string(), checkoutUrl: z.string().nullable() }).nullable(),
      plan: z
        .object({
          name: z.string(),
          amount: z.number(),
          currency: z.string(),
          period: z.string(),
          interval: z.number(),
        })
        .nullable(),
    }),
    handler: async ({ user }) => {
      const row = await ctx.db.maybeOne<Row>(
        'SELECT * FROM family_subscription WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1',
        [user!.id],
      );
      let plan = null;
      if (enabled) {
        const value = z
          .object({
            period: z.string(),
            interval: z.number(),
            item: z.object({ name: z.string(), amount: z.number(), currency: z.string() }),
          })
          .parse(await provider('plans/' + encodeURIComponent(env.RAZORPAY_FAMILY_PLAN_ID!)));
        plan = { ...value.item, period: value.period, interval: value.interval };
      }
      return {
        configured: enabled,
        testMode: !env.RAZORPAY_KEY_ID?.startsWith('rzp_live_'),
        cycles: env.RAZORPAY_SUBSCRIPTION_CYCLES,
        subscription: row ? { status: row.status, checkoutUrl: row.checkout_url } : null,
        plan,
      };
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/family-subscription/checkout',
    tag: 'billing',
    summary: 'Create a hosted Razorpay subscription checkout',
    auth: 'required',
    rateLimit: { max: 3, windowMs: 60000 },
    body: z.object({ acknowledged: z.literal(true) }),
    response: z.object({ checkoutUrl: z.string() }),
    handler: async ({ user }) => {
      if (!enabled) throw new ApiError('conflict', 'Family subscriptions are not configured yet.');
      const reserved = await ctx.db.transaction(async (tx) => {
        await tx.query('SELECT id FROM app_user WHERE id=$1 FOR UPDATE', [user!.id]);
        const existing = await tx.maybeOne<Row>(
          "SELECT * FROM family_subscription WHERE user_id=$1 AND status NOT IN ('cancelled','completed','expired')",
          [user!.id],
        );
        if (existing) return { row: existing, created: false };
        return {
          row: await tx.one<Row>(
            'INSERT INTO family_subscription(user_id) VALUES($1) RETURNING *',
            [user!.id],
          ),
          created: true,
        };
      });
      if (!reserved.created) {
        if (reserved.row.status === 'created' && reserved.row.checkout_url)
          return { checkoutUrl: reserved.row.checkout_url };
        throw new ApiError(
          'conflict',
          'A subscription or checkout is already in progress. Refresh its status or contact support; no duplicate checkout was created.',
        );
      }
      try {
        const remote = remoteSubscription.parse(
          await provider('subscriptions', {
            plan_id: env.RAZORPAY_FAMILY_PLAN_ID,
            total_count: env.RAZORPAY_SUBSCRIPTION_CYCLES,
            quantity: 1,
            customer_notify: 0,
            notes: { everecho_reference: reserved.row.id },
          }),
        );
        const url = new URL(remote.short_url ?? '');
        if (url.protocol !== 'https:' || url.hostname !== 'rzp.io') throw new Error();
        await ctx.db.query(
          'UPDATE family_subscription SET provider_id=$2,status=$3,checkout_url=$4,updated_at=now() WHERE id=$1',
          [reserved.row.id, remote.id, remote.status, url.toString()],
        );
        return { checkoutUrl: url.toString() };
      } catch {
        // The provider may have created the subscription before a timeout. Never retry blindly.
        await ctx.db.query(
          "UPDATE family_subscription SET status='reconciliation_required',updated_at=now() WHERE id=$1",
          [reserved.row.id],
        );
        throw new ApiError(
          'provider_unavailable',
          'Checkout needs a support check before retrying. You have not been granted a paid entitlement.',
        );
      }
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/family-subscription/refresh',
    tag: 'billing',
    summary: 'Refresh subscription from Razorpay',
    auth: 'required',
    rateLimit: { max: 6, windowMs: 60000 },
    response: z.object({ status: z.string() }),
    handler: async ({ user }) =>
      ctx.db.transaction(async (tx) => {
        const row = await tx.maybeOne<Row>(
          'SELECT * FROM family_subscription WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1 FOR UPDATE',
          [user!.id],
        );
        if (!row?.provider_id) throw notFound('There is no connected subscription to refresh.');
        const remote = remoteSubscription.parse(
          await provider('subscriptions/' + encodeURIComponent(row.provider_id)),
        );
        await tx.query(
          'UPDATE family_subscription SET status=$2,current_end=$3,updated_at=now() WHERE id=$1',
          [row.id, remote.status, remote.current_end ? new Date(remote.current_end * 1000) : null],
        );
        return { status: remote.status };
      }),
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/family-subscription/cancel',
    tag: 'billing',
    summary: 'Cancel a family subscription at the end of its cycle',
    auth: 'required',
    body: z.object({ acknowledged: z.literal(true) }),
    response: z.object({ requested: z.literal(true) }),
    handler: async ({ user }) => {
      const row = await ctx.db.maybeOne<Row>(
        'SELECT * FROM family_subscription WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1',
        [user!.id],
      );
      if (!row?.provider_id) throw notFound('No connected subscription was found.');
      await provider('subscriptions/' + encodeURIComponent(row.provider_id) + '/cancel', {
        cancel_at_cycle_end: 1,
      });
      return { requested: true as const };
    },
  });
  // A scoped parser preserves the exact bytes used by Razorpay's HMAC.
  void app.register(async (hooks) => {
    hooks.removeContentTypeParser('application/json');
    hooks.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    hooks.post('/v1/webhooks/razorpay', { bodyLimit: 65536 }, async (request, reply) => {
      const raw = request.body;
      if (
        !enabled ||
        !Buffer.isBuffer(raw) ||
        !verifyRazorpaySignature(
          raw,
          request.headers['x-razorpay-signature'],
          env.RAZORPAY_WEBHOOK_SECRET!,
        )
      )
        return reply.code(400).send({ received: false });
      const eventId = request.headers['x-razorpay-event-id'];
      if (typeof eventId !== 'string' || eventId.length > 200)
        return reply.code(400).send({ received: false });
      const event = z
        .object({
          event: z.string(),
          payload: z.object({
            subscription: z.object({
              entity: z.object({ id: z.string().regex(/^sub_[a-zA-Z0-9]+$/) }),
            }),
          }),
        })
        .safeParse(parseWebhookJson(raw));
      if (!event.success) return reply.code(400).send({ received: false });
      await ctx.db.transaction(async (tx) => {
        const row = await tx.maybeOne<Row>(
          'SELECT * FROM family_subscription WHERE provider_id=$1 FOR UPDATE',
          [event.data.payload.subscription.entity.id],
        );
        if (!row) throw new ApiError('provider_unavailable', 'Subscription not reconciled yet.');
        const inserted = await tx.query(
          'INSERT INTO family_subscription_event(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id',
          [eventId],
        );
        if (!inserted.length) return;
        // Fetch current state rather than applying potentially out-of-order webhook state.
        const remote = remoteSubscription.parse(
          await provider('subscriptions/' + encodeURIComponent(row.provider_id!)),
        );
        await tx.query(
          'UPDATE family_subscription SET status=$2,current_end=$3,updated_at=now() WHERE id=$1',
          [row.id, remote.status, remote.current_end ? new Date(remote.current_end * 1000) : null],
        );
      });
      return { received: true };
    });
  });
}
