import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  activateDirectiveRequestSchema,
  addClauseRequestSchema,
  remembranceDirectiveSchema,
  upsertDirectiveRequestSchema,
} from '@everecho/contracts';
import { findMembership, recordAuditEvent, type Transaction } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { ApiError, conflict, notFound } from '../errors';
import type { AppContext } from '../context';

/**
 * The ante-mortem directive.
 *
 * What the storyteller decides, while alive and competent, about what may be
 * heard after they die. It is the permission model for the rest of this
 * release, which is why it is built first.
 *
 * The shape of the whole module follows from one asymmetry: while they are
 * alive this is a draft they may rewrite as often as they like, and the moment
 * a named human establishes that they have died it becomes the last word of
 * somebody who can no longer be asked. Nothing may edit it after that — not an
 * administrator, not the family, not a migration.
 */

function requireAdmin(user: { isPlatformAdmin: boolean } | null): void {
  // Reported as "not found" so the existence of this surface is not advertised
  // to accounts that cannot use it.
  if (!user?.isPlatformAdmin) throw new ApiError('not_found', 'That was not found.');
}

const archiveParams = z.object({ archiveId: z.uuid() });
const clauseParams = archiveParams.extend({ clauseId: z.uuid() });

interface DirectiveRow {
  id: string;
  version: number;
  status: 'draft' | 'affirmed' | 'superseded' | 'activated';
  default_effect: 'permit' | 'withhold';
  note: string | null;
  note_source_asset_id: string | null;
  affirmed_at: Date | null;
  activated_at: Date | null;
  created_at: Date;
}

interface ClauseRow {
  id: string;
  effect: 'permit' | 'withhold';
  scope: 'archive' | 'topic' | 'memory' | 'source';
  topic: string | null;
  memory_id: string | null;
  source_asset_id: string | null;
  audience_user_id: string | null;
  audience_display_name: string | null;
  not_before: Date | null;
  allow_audio: boolean;
  created_at: Date;
}

export function registerRemembranceRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/remembrance',
    tag: 'consent',
    summary: 'What the storyteller decided about after',
    description:
      'The directive in force, with every clause. Readable by anyone with access to the ' +
      'archive: being refused something without being told a decision exists is how people ' +
      'conclude the software is hiding something.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ directive: remembranceDirectiveSchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'remembrance.read',
          resource: { type: 'remembrance_directive' },
        },
        async ({ tx, membership }) => {
          const row = await currentDirective(tx, params.archiveId);
          if (!row) return { directive: null };
          return {
            directive: await toDirective(tx, params.archiveId, row, {
              // Editable only by the person it speaks for, and only while the
              // archive has not been activated. The server enforces both again
              // on every write.
              editable: membership?.role === 'storyteller' && row.status !== 'activated',
            }),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PUT',
    url: '/v1/archives/:archiveId/remembrance',
    tag: 'consent',
    summary: 'Say what should happen after, or change your mind',
    description:
      'Creates the directive, or revises it while you are alive. `defaultEffect` is required ' +
      'because there is no honest default: it says what happens when nothing you wrote covers ' +
      'what somebody is asking for.',
    auth: 'required',
    params: archiveParams,
    body: upsertDirectiveRequestSchema,
    response: z.object({ directive: remembranceDirectiveSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'remembrance.update',
          resource: { type: 'remembrance_directive' },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const existing = await currentDirective(tx, params.archiveId);
          await assertNotActivated(existing);

          if (existing) {
            const updated = await tx.one<DirectiveRow>(
              `UPDATE remembrance_directive
                  SET default_effect = $3, note = $4, note_source_asset_id = $5,
                      updated_at = now()
                WHERE archive_id = $1 AND id = $2
                RETURNING *`,
              [
                params.archiveId,
                existing.id,
                body.defaultEffect,
                body.note ?? null,
                body.noteSourceAssetId ?? null,
              ],
            );
            await ctx.analytics.track('remembrance_directive_saved', {
              archiveId: params.archiveId,
              props: { withholdingByDefault: body.defaultEffect === 'withhold', revised: true },
            });
            return {
              directive: await toDirective(tx, params.archiveId, updated, { editable: true }),
            };
          }

          const created = await tx.one<DirectiveRow>(
            `INSERT INTO remembrance_directive
               (archive_id, default_effect, note, note_source_asset_id)
             VALUES ($1,$2,$3,$4) RETURNING *`,
            [
              params.archiveId,
              body.defaultEffect,
              body.note ?? null,
              body.noteSourceAssetId ?? null,
            ],
          );
          await ctx.analytics.track('remembrance_directive_saved', {
            archiveId: params.archiveId,
            props: { withholdingByDefault: body.defaultEffect === 'withhold', revised: false },
          });
          return {
            directive: await toDirective(tx, params.archiveId, created, { editable: true }),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/remembrance/clauses',
    tag: 'consent',
    summary: 'Add one thing you have decided',
    description:
      'A permission or a refusal, about a topic, a story, a recording or everything, for one ' +
      'person or for everyone. “Not this, not her, not yet” is as easy to say as yes.',
    auth: 'required',
    params: archiveParams,
    body: addClauseRequestSchema,
    response: z.object({ directive: remembranceDirectiveSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'remembrance.update',
          resource: { type: 'remembrance_directive' },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const directive = await currentDirective(tx, params.archiveId);
          if (!directive) {
            throw conflict(
              'Say what should happen by default before adding anything specific.',
              'remembrance_no_directive',
            );
          }
          await assertNotActivated(directive);

          // An audience that is not a member of this archive cannot be named:
          // a directive narrows what consent already permits and can never
          // reach somebody consent has not admitted.
          if (body.audienceUserId) {
            const member = await findMembership(tx, params.archiveId, body.audienceUserId);
            if (!member || member.status !== 'active') throw notFound();
          }

          await tx.query(
            `INSERT INTO remembrance_clause
               (archive_id, directive_id, effect, scope, topic, memory_id, source_asset_id,
                audience_user_id, not_before, allow_audio)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              params.archiveId,
              directive.id,
              body.effect,
              body.scope,
              body.topic ?? null,
              body.memoryId ?? null,
              body.sourceAssetId ?? null,
              body.audienceUserId ?? null,
              body.notBefore ? new Date(body.notBefore) : null,
              body.allowAudio,
            ],
          );

          await ctx.analytics.track('remembrance_clause_added', {
            archiveId: params.archiveId,
            props: {
              withholding: body.effect === 'withhold',
              forOnePerson: Boolean(body.audienceUserId),
              audioWithheld: !body.allowAudio,
            },
          });

          return {
            directive: await toDirective(tx, params.archiveId, directive, { editable: true }),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/archives/:archiveId/remembrance/clauses/:clauseId',
    tag: 'consent',
    summary: 'Take one back',
    description: 'Only while you are alive. Nothing here changes after that, for anyone.',
    auth: 'required',
    params: clauseParams,
    response: z.object({ directive: remembranceDirectiveSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'remembrance.update',
          resource: { type: 'remembrance_directive', id: params.clauseId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const directive = await currentDirective(tx, params.archiveId);
          if (!directive) throw notFound();
          await assertNotActivated(directive);

          const removed = await tx.maybeOne<{ id: string }>(
            `DELETE FROM remembrance_clause
              WHERE archive_id = $1 AND directive_id = $2 AND id = $3
              RETURNING id`,
            [params.archiveId, directive.id, params.clauseId],
          );
          if (!removed) throw notFound();

          return {
            directive: await toDirective(tx, params.archiveId, directive, { editable: true }),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/remembrance/affirm',
    tag: 'consent',
    summary: 'Confirm this is what you want',
    description:
      'Affirming does not activate anything and does not restrict you now. It records that ' +
      'you read it back and meant it. You may still change any of it for as long as you live.',
    auth: 'required',
    params: archiveParams,
    body: z.object({}),
    response: z.object({ directive: remembranceDirectiveSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'remembrance.affirm',
          resource: { type: 'remembrance_directive' },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const directive = await currentDirective(tx, params.archiveId);
          if (!directive) throw notFound();
          await assertNotActivated(directive);

          const affirmed = await tx.one<DirectiveRow>(
            `UPDATE remembrance_directive
                SET status = 'affirmed', affirmed_at = now(), updated_at = now()
              WHERE archive_id = $1 AND id = $2
              RETURNING *`,
            [params.archiveId, directive.id],
          );
          await ctx.analytics.track('remembrance_directive_affirmed', {
            archiveId: params.archiveId,
            props: { withholdingByDefault: affirmed.default_effect === 'withhold' },
          });
          return {
            // Still editable. Affirming is not a lock; only death is.
            directive: await toDirective(tx, params.archiveId, affirmed, { editable: true }),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/admin/archives/:archiveId/remembrance/activate',
    tag: 'admin',
    summary: 'Record that the storyteller has died',
    description:
      'Restricted to the operator, and deliberately not reachable from the product. It requires ' +
      'a named human and a reference to documentary evidence held outside this system. There is ' +
      'no inactivity timer and no inferred death: releasing a living person’s archive to their ' +
      'family is not recoverable.',
    auth: 'required',
    params: archiveParams,
    body: activateDirectiveRequestSchema,
    response: z.object({ directive: remembranceDirectiveSchema }),
    handler: async ({ params, body, user, request }) => {
      requireAdmin(user);

      const result = await ctx.db.withArchiveScope(params.archiveId, async (tx) => {
        const directive = await currentDirective(tx, params.archiveId);
        if (!directive) throw notFound();
        if (directive.status === 'activated') {
          throw conflict('This has already been recorded.', 'remembrance_already_activated');
        }
        // A directive nobody confirmed is not a last word. Activating a draft
        // would enforce a half-finished thought against somebody who can no
        // longer finish it.
        if (directive.status !== 'affirmed') {
          throw conflict(
            'This directive was never confirmed by the storyteller and cannot be activated.',
            'remembrance_not_affirmed',
          );
        }

        const activated = await tx.one<DirectiveRow>(
          `UPDATE remembrance_directive
              SET status = 'activated', activated_at = now(), updated_at = now()
            WHERE archive_id = $1 AND id = $2
            RETURNING *`,
          [params.archiveId, directive.id],
        );

        await tx.query(
          `INSERT INTO remembrance_activation
             (archive_id, directive_id, kind, executed_by_user_id, executed_by_name,
              evidence_kind, evidence_reference, note)
           VALUES ($1,$2,'activated',$3,$4,$5,$6,$7)`,
          [
            params.archiveId,
            directive.id,
            user!.id,
            body.executedByName,
            body.evidenceKind,
            body.evidenceReference,
            body.note ?? null,
          ],
        );

        return toDirective(tx, params.archiveId, activated, { editable: false });
      });

      // Written against the archive, not only into an internal log: the family
      // is entitled to see who recorded this and on what evidence.
      await recordAuditEvent(ctx.db, {
        archiveId: params.archiveId,
        actorUserId: user!.id,
        actorDisplay: `${user!.displayName} (support)`,
        action: 'admin.remembrance.activate',
        resourceType: 'remembrance_directive',
        resourceId: result.id,
        outcome: 'success',
        requestId: request.id,
        // The reference, never the document, and never the note.
        metadata: {
          executedByName: body.executedByName,
          evidenceKind: body.evidenceKind,
          evidenceReference: body.evidenceReference,
        },
      });

      await ctx.analytics.track('remembrance_activated', {
        actorId: user!.id,
        archiveId: params.archiveId,
        props: { withholdingByDefault: result.defaultEffect === 'withhold' },
      });

      return { directive: result };
    },
  });
}

/** The directive in force, or the draft being written. */
async function currentDirective(tx: Transaction, archiveId: string): Promise<DirectiveRow | null> {
  return tx.maybeOne<DirectiveRow>(
    `SELECT * FROM remembrance_directive
      WHERE archive_id = $1 AND status <> 'superseded'
      ORDER BY version DESC LIMIT 1`,
    [archiveId],
  );
}

/**
 * The one rule that governs every write here.
 *
 * After activation the directive is the last word of somebody who cannot be
 * asked again. Nothing edits it: not an administrator, not the family, not a
 * well-meaning support ticket.
 */
async function assertNotActivated(directive: DirectiveRow | null): Promise<void> {
  if (directive?.status === 'activated') {
    throw conflict('This cannot be changed now.', 'remembrance_activated');
  }
}

async function toDirective(
  tx: Transaction,
  archiveId: string,
  row: DirectiveRow,
  options: { editable: boolean },
) {
  const clauses = await tx.query<ClauseRow>(
    `SELECT c.*, u.display_name AS audience_display_name
       FROM remembrance_clause c
       LEFT JOIN app_user u ON u.id = c.audience_user_id
      WHERE c.archive_id = $1 AND c.directive_id = $2
      ORDER BY c.effect DESC, c.created_at`,
    [archiveId, row.id],
  );

  return {
    id: row.id,
    version: row.version,
    status: row.status,
    defaultEffect: row.default_effect,
    note: row.note,
    noteSourceAssetId: row.note_source_asset_id,
    affirmedAt: row.affirmed_at?.toISOString() ?? null,
    activatedAt: row.activated_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    editable: options.editable,
    clauses: clauses.map((c) => ({
      id: c.id,
      effect: c.effect,
      scope: c.scope,
      topic: c.topic,
      memoryId: c.memory_id,
      sourceAssetId: c.source_asset_id,
      audienceUserId: c.audience_user_id,
      audienceDisplayName: c.audience_display_name,
      notBefore: c.not_before?.toISOString() ?? null,
      allowAudio: c.allow_audio,
      createdAt: c.created_at.toISOString(),
    })),
  };
}
