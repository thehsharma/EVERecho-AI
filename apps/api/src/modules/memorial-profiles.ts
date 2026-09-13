import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Transaction } from '@everecho/db';
import { memorialProfileSchema, savedMemorialSchema } from '@everecho/contracts';
import type { AppContext } from '../context';
import { defineRoute } from '../http/route';
import { ApiError, forbidden, notFound } from '../errors';

export function withMemorialOwner<T>(
  ctx: AppContext,
  userId: string,
  fn: (tx: Transaction) => Promise<T>,
) {
  return ctx.db.transaction(async (tx) => {
    await tx.query("SET LOCAL TIME ZONE 'UTC'");
    await tx.query('SELECT set_config($1, $2, true)', ['everecho.memorial_user_id', userId]);
    return fn(tx);
  });
}

const rowSchema = z.object({ id: z.uuid(), profile: memorialProfileSchema, updated_at: z.date() });
const serialize = (row: unknown) => {
  const value = rowSchema.parse(row);
  return { id: value.id, profile: value.profile, updatedAt: value.updated_at.toISOString() };
};

async function dailyLimit(ctx: AppContext, tx: Transaction, userId: string) {
  const row = await tx.one<{ paid: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM family_subscription WHERE user_id=$1 AND status='active' AND current_end>now()) AS paid",
    [userId],
  );
  return row.paid
    ? ctx.cfg.env.MEMORIAL_FAMILY_DAILY_TURN_LIMIT
    : ctx.cfg.env.MEMORIAL_DAILY_TURN_LIMIT;
}

export async function reserveMemorialTurn(ctx: AppContext, userId: string) {
  return withMemorialOwner(ctx, userId, async (tx) => {
    const row = await tx.maybeOne(
      `INSERT INTO memorial_usage(user_id, turns) VALUES ($1,1)
       ON CONFLICT (user_id,day) DO UPDATE SET turns=memorial_usage.turns+1
       WHERE memorial_usage.turns < $2 RETURNING turns`,
      [userId, await dailyLimit(ctx, tx, userId)],
    );
    if (!row)
      throw new ApiError(
        'rate_limited',
        'Your daily AI conversation allowance is used. Local preview remains available; the allowance resets at midnight UTC.',
      );
  });
}

export function registerMemorialProfileRoutes(app: FastifyInstance, ctx: AppContext) {
  const local = () => {
    if (ctx.cfg.isProduction) throw forbidden('Memorial studio is an experimental local feature.');
  };
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/memorial/profiles',
    tag: 'memorial',
    summary: 'Your saved memorial profiles',
    auth: 'required',
    response: z.object({ profiles: z.array(savedMemorialSchema) }),
    handler: async ({ user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => ({
        profiles: (
          await tx.query(
            'SELECT id,profile,updated_at FROM memorial_profile WHERE user_id=$1 ORDER BY updated_at DESC',
            [user!.id],
          )
        ).map(serialize),
      }));
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/memorial/profiles',
    tag: 'memorial',
    summary: 'Save an authorized memorial profile',
    auth: 'required',
    body: z.object({
      id: z.uuid().optional(),
      profile: memorialProfileSchema,
      acknowledged: z.literal(true),
    }),
    response: savedMemorialSchema,
    handler: async ({ body, user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        if (body.id) {
          const row = await tx.maybeOne(
            'UPDATE memorial_profile SET profile=$3,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,profile,updated_at',
            [body.id, user!.id, JSON.stringify(body.profile)],
          );
          if (!row) throw notFound('That profile was not found.');
          return serialize(row);
        }
        // Lock the account so simultaneous creates cannot bypass the profile cap.
        await tx.query('SELECT id FROM app_user WHERE id=$1 FOR UPDATE', [user!.id]);
        const count = await tx.one<{ count: number }>(
          'SELECT count(*)::int AS count FROM memorial_profile WHERE user_id=$1',
          [user!.id],
        );
        if (count.count >= 20)
          throw new ApiError('conflict', 'This account already has 20 saved profiles.');
        return serialize(
          await tx.one(
            'INSERT INTO memorial_profile(user_id,profile) VALUES($1,$2) RETURNING id,profile,updated_at',
            [user!.id, JSON.stringify(body.profile)],
          ),
        );
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/memorial/profiles/:id',
    tag: 'memorial',
    summary: 'Delete your saved profile',
    auth: 'required',
    params: z.object({ id: z.uuid() }),
    response: z.object({ deleted: z.literal(true) }),
    handler: async ({ params, user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        const row = await tx.maybeOne(
          'DELETE FROM memorial_profile WHERE id=$1 AND user_id=$2 RETURNING id',
          [params.id, user!.id],
        );
        if (!row) throw notFound('That profile was not found.');
        return { deleted: true as const };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/memorial/usage',
    tag: 'memorial',
    summary: 'Daily hosted conversation allowance',
    auth: 'required',
    response: z.object({ used: z.number(), limit: z.number(), resetsAt: z.string() }),
    handler: async ({ user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        const row = await tx.one<{ used: number; resets_at: Date }>(
          `SELECT COALESCE((SELECT turns FROM memorial_usage WHERE user_id=$1 AND day=CURRENT_DATE),0) AS used, (CURRENT_DATE+1)::timestamptz AS resets_at`,
          [user!.id],
        );
        return {
          used: row.used,
          limit: await dailyLimit(ctx, tx, user!.id),
          resetsAt: row.resets_at.toISOString(),
        };
      });
    },
  });
}
