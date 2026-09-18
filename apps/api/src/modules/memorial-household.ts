import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { defineRoute } from '../http/route';
import { withMemorialOwner } from './memorial-profiles';
import { ApiError, forbidden, notFound } from '../errors';
type Seat = {
  id: string;
  household_id: string;
  owner_user_id: string;
  user_id: string | null;
  expires_at: Date | null;
};
export async function allowanceOwner(ctx: AppContext, userId: string) {
  const seat = await withMemorialOwner(ctx, userId, (tx) =>
    tx.maybeOne<Seat>('SELECT * FROM memorial_household_seat WHERE user_id=$1', [userId]),
  );
  return seat?.owner_user_id ?? userId;
}
export function registerMemorialHousehold(app: FastifyInstance, ctx: AppContext) {
  const local = () => {
    if (ctx.cfg.isProduction) throw forbidden('Household conversation sharing is a local feature.');
  };
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/memorial/household',
    auth: 'required',
    tag: 'memorial',
    summary: 'Your shared conversation allowance',
    response: z.object({
      household: z
        .object({
          id: z.uuid(),
          name: z.string(),
          isOwner: z.boolean(),
          members: z.array(
            z.object({ id: z.uuid(), label: z.string(), pending: z.boolean(), self: z.boolean() }),
          ),
        })
        .nullable(),
    }),
    handler: async ({ user }) => {
      local();
      const seat = await withMemorialOwner(ctx, user!.id, (tx) =>
        tx.maybeOne<Seat>('SELECT * FROM memorial_household_seat WHERE user_id=$1', [user!.id]),
      );
      if (!seat) return { household: null };
      return withMemorialOwner(ctx, seat.owner_user_id, async (tx) => {
        const group = await tx.maybeOne<{ id: string; name: string }>(
          'SELECT id,name FROM memorial_household WHERE id=$1',
          [seat.household_id],
        );
        if (!group) return { household: null };
        const seats =
          seat.owner_user_id === user!.id
            ? await tx.query<Seat & { label: string }>(
                "SELECT s.*,coalesce(u.display_name,'Unused invitation') AS label FROM memorial_household_seat s LEFT JOIN app_user u ON u.id=s.user_id WHERE s.household_id=$1 AND (s.user_id IS NOT NULL OR s.expires_at>now()) ORDER BY s.id",
                [seat.household_id],
              )
            : [];
        return {
          household: {
            ...group,
            isOwner: seat.owner_user_id === user!.id,
            members: seats.map((s) => ({
              id: s.id,
              label: s.label,
              pending: !s.user_id,
              self: s.user_id === user!.id,
            })),
          },
        };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/memorial/household',
    auth: 'required',
    tag: 'memorial',
    summary: 'Create a household allowance pool',
    body: z.object({ name: z.string().trim().min(1).max(80) }),
    response: z.object({ created: z.literal(true) }),
    handler: async ({ user, body }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        await tx.query('SELECT id FROM app_user WHERE id=$1 FOR UPDATE', [user!.id]);
        if (
          await tx.maybeOne('SELECT id FROM memorial_household_seat WHERE user_id=$1', [user!.id])
        )
          throw new ApiError('conflict', 'Leave your current household before creating another.');
        const group = await tx.one<{ id: string }>(
          'INSERT INTO memorial_household(owner_user_id,name) VALUES($1,$2) RETURNING id',
          [user!.id, body.name],
        );
        await tx.query(
          'INSERT INTO memorial_household_seat(household_id,owner_user_id,user_id) VALUES($1,$2,$2)',
          [group.id, user!.id],
        );
        return { created: true as const };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/memorial/household/invite',
    auth: 'required',
    tag: 'memorial',
    summary: 'Create a single-use invitation code',
    response: z.object({ code: z.string(), expiresAt: z.string() }),
    handler: async ({ user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        const group = await tx.maybeOne<{ id: string }>(
          'SELECT id FROM memorial_household WHERE owner_user_id=$1 FOR UPDATE',
          [user!.id],
        );
        if (!group) throw notFound();
        await tx.query(
          'DELETE FROM memorial_household_seat WHERE household_id=$1 AND user_id IS NULL AND expires_at<now()',
          [group.id],
        );
        const count = await tx.one<{ n: number }>(
          'SELECT count(*)::int AS n FROM memorial_household_seat WHERE household_id=$1',
          [group.id],
        );
        if (count.n >= 10)
          throw new ApiError('conflict', 'This household already has ten seats or invitations.');
        const code = randomBytes(32).toString('base64url');
        const expires = new Date(Date.now() + 7 * 86400000);
        await tx.query(
          'INSERT INTO memorial_household_seat(household_id,owner_user_id,invite_hash,expires_at) VALUES($1,$2,$3,$4)',
          [group.id, user!.id, createHash('sha256').update(code).digest('hex'), expires],
        );
        return { code, expiresAt: expires.toISOString() };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/memorial/household/join',
    auth: 'required',
    tag: 'memorial',
    summary: 'Accept a household invitation',
    body: z.object({ code: z.string().min(40).max(100), acknowledged: z.literal(true) }),
    response: z.object({ joined: z.literal(true) }),
    handler: async ({ user, body }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        await tx.query('SELECT id FROM app_user WHERE id=$1 FOR UPDATE', [user!.id]);
        if (
          await tx.maybeOne('SELECT id FROM memorial_household_seat WHERE user_id=$1', [user!.id])
        )
          throw new ApiError('conflict', 'Leave your current household before joining another.');
        const hash = createHash('sha256').update(body.code).digest('hex');
        await tx.query("SELECT set_config('everecho.household_invite_hash',$1,true)", [hash]);
        const row = await tx.maybeOne<Seat>(
          'SELECT * FROM memorial_household_seat WHERE invite_hash=$1 AND user_id IS NULL AND expires_at>now() FOR UPDATE',
          [hash],
        );
        if (!row) throw notFound('That invitation is expired or already used.');
        await tx.query(
          'UPDATE memorial_household_seat SET user_id=$2,invite_hash=NULL,expires_at=NULL WHERE id=$1',
          [row.id, user!.id],
        );
        return { joined: true as const };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/memorial/household/seats/:id',
    auth: 'required',
    tag: 'memorial',
    summary: 'Revoke a household seat or invitation',
    params: z.object({ id: z.uuid() }),
    response: z.object({ removed: z.literal(true) }),
    handler: async ({ user, params }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        const row = await tx.maybeOne(
          'DELETE FROM memorial_household_seat WHERE id=$1 AND owner_user_id=$2 AND user_id IS DISTINCT FROM $2::uuid RETURNING id',
          [params.id, user!.id],
        );
        if (!row) throw notFound();
        return { removed: true as const };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/memorial/household',
    auth: 'required',
    tag: 'memorial',
    summary: 'Leave or close a household allowance pool',
    response: z.object({ left: z.literal(true) }),
    handler: async ({ user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        await tx.query('DELETE FROM memorial_household WHERE owner_user_id=$1', [user!.id]);
        await tx.query('DELETE FROM memorial_household_seat WHERE user_id=$1', [user!.id]);
        return { left: true as const };
      });
    },
  });
}
