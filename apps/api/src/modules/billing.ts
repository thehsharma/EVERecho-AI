import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { billingSummarySchema, createReservationRequestSchema } from '@everecho/contracts';
import { LocalBillingAdapter } from '@everecho/adapters';
import { recordAuditEvent } from '@everecho/db';
import { defineRoute } from '../http/route';
import { ApiError, notFound } from '../errors';
import type { AppContext } from '../context';

interface ReservationRow {
  id: string;
  user_id: string;
  status: 'pending' | 'paid' | 'refunded' | 'failed' | 'cancelled';
  currency: 'INR' | 'USD';
  amount_minor: number;
  provider_ref: string | null;
  created_at: Date;
  paid_at: Date | null;
  refunded_at: Date | null;
}

function toReservation(row: ReservationRow, checkoutUrl: string | null = null) {
  return {
    id: row.id,
    status: row.status,
    currency: row.currency,
    amountMinor: row.amount_minor,
    refundable: true as const,
    checkoutUrl,
    providerRef: row.provider_ref,
    createdAt: row.created_at.toISOString(),
    paidAt: row.paid_at?.toISOString() ?? null,
    refundedAt: row.refunded_at?.toISOString() ?? null,
  };
}

export function registerBillingRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/billing/reservations',
    tag: 'billing',
    summary: 'Place a refundable reservation',
    description:
      'A deposit is a signal of intent, not a lock-in: it is refundable by design and the ' +
      'refund needs no justification. No card details ever reach EverEcho.',
    auth: 'required',
    body: createReservationRequestSchema,
    response: z.object({ reservation: z.unknown() }),
    status: 201,
    handler: async ({ body, user, request }) => {
      if (!ctx.features.billing) throw new ApiError('not_found', 'That was not found.');

      return ctx.db.transaction(async (tx) => {
        const existing = await tx.maybeOne<ReservationRow>(
          `SELECT * FROM reservation WHERE user_id = $1 AND idempotency_key = $2`,
          [user!.id, body.idempotencyKey],
        );
        if (existing) return { reservation: toReservation(existing) };

        const row = await tx.one<ReservationRow>(
          `INSERT INTO reservation (user_id, archive_id, currency, amount_minor, provider, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            user!.id,
            body.archiveId ?? null,
            body.currency,
            ctx.cfg.env.BILLING_RESERVATION_AMOUNT_MINOR,
            ctx.billing.name,
            body.idempotencyKey,
          ],
        );

        const checkout = await ctx.billing.createReservationCheckout({
          reservationId: row.id,
          amountMinor: row.amount_minor,
          currency: row.currency,
          customerEmail: user!.email,
          returnUrl: `${ctx.cfg.env.WEB_PUBLIC_URL}/account/billing`,
        });
        await tx.query(`UPDATE reservation SET provider_ref = $2 WHERE id = $1`, [
          row.id,
          checkout.providerRef,
        ]);
        await ctx.analytics.track('reservation_started', { actorId: user!.id });

        return {
          reservation: toReservation({ ...row, provider_ref: checkout.providerRef }, checkout.checkoutUrl),
        };
      });
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/billing',
    tag: 'billing',
    summary: 'Reservations and subscription state',
    auth: 'required',
    response: billingSummarySchema,
    handler: async ({ user }) => {
      const rows = await ctx.db.query<ReservationRow>(
        `SELECT * FROM reservation WHERE user_id = $1 ORDER BY created_at DESC`,
        [user!.id],
      );
      return {
        provider: ctx.billing.name,
        testMode: ctx.billing.testMode,
        currency: ctx.cfg.env.BILLING_CURRENCY,
        reservationAmountMinor: ctx.cfg.env.BILLING_RESERVATION_AMOUNT_MINOR,
        reservations: rows.map((r) => toReservation(r)),
        subscription: null,
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/billing/reservations/:reservationId/refund',
    tag: 'billing',
    summary: 'Refund a reservation',
    description: 'No reason required. Asking for one would make the refund a negotiation.',
    auth: 'required',
    params: z.object({ reservationId: z.uuid() }),
    response: z.object({ refunded: z.literal(true) }),
    handler: async ({ params, user, request }) => {
      const row = await ctx.db.maybeOne<ReservationRow>(
        `SELECT * FROM reservation WHERE id = $1 AND user_id = $2`,
        [params.reservationId, user!.id],
      );
      if (!row) throw notFound('That reservation was not found.');
      if (row.status !== 'paid') throw new ApiError('conflict', 'That reservation has not been paid.');

      if (row.provider_ref) await ctx.billing.refundReservation(row.provider_ref);
      await ctx.db.query(
        `UPDATE reservation SET status = 'refunded', refunded_at = now() WHERE id = $1`,
        [row.id],
      );
      await recordAuditEvent(ctx.db, {
        archiveId: null,
        actorUserId: user!.id,
        actorDisplay: user!.displayName,
        action: 'billing.refund',
        resourceType: 'billing',
        resourceId: row.id,
        outcome: 'success',
        requestId: request.id,
      });
      return { refunded: true as const };
    },
  });

  /**
   * Provider webhooks. Signature-verified and processed exactly once: a
   * replayed event finds its id already recorded and changes nothing.
   * CSRF is not applicable here — the signature is the authentication.
   */
  app.route({
    method: 'POST',
    url: '/v1/webhooks/billing',
    config: { rawBody: true },
    handler: async (request, reply) => {
      const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? {});
      const signature = request.headers['x-signature'];
      const event = ctx.billing.verifyWebhook(raw, typeof signature === 'string' ? signature : undefined);

      if (!event) {
        await ctx.db.query(
          `INSERT INTO security_event (kind, severity, request_id, metadata)
           VALUES ('webhook_signature_invalid', 'medium', $1, $2)`,
          [request.id, JSON.stringify({ provider: ctx.billing.name })],
        );
        reply.status(400);
        return { error: { code: 'validation_failed', message: 'Signature could not be verified.', requestId: request.id } };
      }

      const inserted = await ctx.db.query<{ id: string }>(
        `INSERT INTO webhook_event (provider, provider_event_id, signature_verified, event_type, payload)
         VALUES ($1,$2,true,$3,$4)
         ON CONFLICT (provider, provider_event_id) DO NOTHING
         RETURNING id`,
        [ctx.billing.name, event.providerEventId, event.eventType, raw.slice(0, 20_000)],
      );
      if (inserted.length === 0) {
        // Already handled. Acknowledging is what stops the provider retrying.
        reply.status(200);
        return { received: true, duplicate: true };
      }

      if (event.eventType === 'reservation.paid') {
        await ctx.db.query(
          `UPDATE reservation SET status = 'paid', paid_at = now()
           WHERE provider_ref = $1 AND status = 'pending'`,
          [event.providerRef],
        );
        await ctx.analytics.track('deposit_completed', {});
      } else if (event.eventType === 'reservation.refunded') {
        await ctx.db.query(
          `UPDATE reservation SET status = 'refunded', refunded_at = now() WHERE provider_ref = $1`,
          [event.providerRef],
        );
      } else if (event.eventType === 'reservation.failed') {
        await ctx.db.query(`UPDATE reservation SET status = 'failed' WHERE provider_ref = $1`, [
          event.providerRef,
        ]);
      }

      await ctx.db.query(`UPDATE webhook_event SET processed_at = now() WHERE id = $1`, [
        inserted[0]!.id,
      ]);
      reply.status(200);
      return { received: true, duplicate: false };
    },
  });

  /** Exposes the local adapter's signing so the demo checkout page can call back. */
  if (ctx.billing instanceof LocalBillingAdapter && !ctx.cfg.isProduction) {
    const local = ctx.billing;
    defineRoute(app, ctx, {
      method: 'POST',
      url: '/v1/billing/local-checkout/complete',
      tag: 'billing',
      summary: 'Complete a local test checkout (development only)',
      description:
        'Signs and posts the same webhook a real provider would send, so the signature check ' +
        'and the idempotent replay path are exercised rather than bypassed.',
      auth: 'required',
      body: z.object({ providerRef: z.string().min(1), outcome: z.enum(['paid', 'failed']) }),
      response: z.object({ signature: z.string(), payload: z.string() }),
      handler: async ({ body }) => {
        const payload = JSON.stringify({
          id: `evt_${body.providerRef}_${body.outcome}`,
          type: `reservation.${body.outcome}`,
          providerRef: body.providerRef,
        });
        return { signature: local.sign(payload), payload };
      },
    });
  }
}
