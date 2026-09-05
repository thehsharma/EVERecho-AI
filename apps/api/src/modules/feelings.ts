import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { memoryFeelingSchema, upsertFeelingRequestSchema } from '@everecho/contracts';
import type { Transaction } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, notFound } from '../errors';
import type { AppContext } from '../context';

/**
 * How the storyteller felt about their own memory.
 *
 * The archive has always kept what happened and never how it felt, which is
 * most of what anybody wants from somebody's life story. This is the missing
 * half, and there is exactly one way it can be filled in: the person says it,
 * about themselves.
 *
 * There is no sentiment analysis in this module, or anywhere else in this
 * codebase, and there will not be. Deciding from a recording that somebody
 * sounded sad, and writing that into their archive, is putting a claim about
 * their inner life into their mouth — a fabrication that happens to be about
 * feelings rather than facts, which does not make it a smaller one. Every row
 * this module writes came from the storyteller's own hands.
 */

const memoryParams = z.object({ archiveId: z.uuid(), memoryId: z.uuid() });

interface FeelingRow {
  id: string;
  memory_id: string;
  body: string;
  source_asset_id: string | null;
  transcript_segment_id: string | null;
  shared: boolean;
  created_at: Date;
  updated_at: Date;
}

const toFeeling = (row: FeelingRow) => ({
  id: row.id,
  memoryId: row.memory_id,
  body: row.body,
  sourceAssetId: row.source_asset_id,
  transcriptSegmentId: row.transcript_segment_id,
  shared: row.shared,
  createdAt: row.created_at.toISOString(),
  updatedAt: row.updated_at.toISOString(),
});

export function registerFeelingRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/memories/:memoryId/feeling',
    tag: 'memories',
    summary: 'How they felt about this, in their own words',
    description:
      'Present only when the storyteller wrote one and chose to share it. Never inferred from ' +
      'the text, never detected from the recording: an emotion in this archive is always a ' +
      'first-person statement.',
    auth: 'required',
    params: memoryParams,
    response: z.object({ feeling: memoryFeelingSchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memory.feeling.read',
          resource: { type: 'memory', id: params.memoryId },
        },
        async ({ tx, user, archive }) => {
          const row = await findFeeling(tx, params.archiveId, params.memoryId);
          if (!row) return { feeling: null };

          // A note kept private is theirs alone. Reported as absent rather than
          // as withheld: telling the family that a feeling exists but they may
          // not see it invites exactly the speculation the person was avoiding.
          const isStoryteller = archive.storyteller_user_id === user.id;
          if (!row.shared && !isStoryteller) return { feeling: null };

          return { feeling: toFeeling(row) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PUT',
    url: '/v1/archives/:archiveId/memories/:memoryId/feeling',
    tag: 'memories',
    summary: 'Say how you felt about it',
    description:
      'Yours, about your own memory, in your own words. Optional always, and you decide in the ' +
      'same breath whether anybody else sees it.',
    auth: 'required',
    params: memoryParams,
    body: upsertFeelingRequestSchema,
    response: z.object({ feeling: memoryFeelingSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memory.feeling.write',
          resource: { type: 'memory', id: params.memoryId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const memory = await tx.maybeOne<{ id: string; status: string }>(
            `SELECT id, status FROM memory
              WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [params.archiveId, params.memoryId],
          );
          if (!memory) throw notFound();

          // A feeling about something still in review would be a feeling about
          // a draft, and the draft may not survive.
          if (memory.status !== 'approved') {
            throw conflict(
              'You can say how you felt once the story itself is kept.',
              'memory_not_approved',
            );
          }

          let transcriptSegmentId: string | null = null;
          if (body.sourceAssetId) {
            // The recording has to be theirs, in this archive, and already
            // transcribed — otherwise the note claims a source that cannot be
            // played or cited.
            const segment = await tx.maybeOne<{ id: string }>(
              `SELECT ts.id
                 FROM transcript_segment ts
                 JOIN transcript t ON t.id = ts.transcript_id
                WHERE ts.archive_id = $1 AND t.source_asset_id = $2 AND t.status = 'ready'
                ORDER BY ts.idx LIMIT 1`,
              [params.archiveId, body.sourceAssetId],
            );
            if (!segment) throw notFound();
            transcriptSegmentId = segment.id;
          }

          const row = await tx.one<FeelingRow>(
            `INSERT INTO memory_feeling
               (archive_id, memory_id, body, shared, source_asset_id, transcript_segment_id)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (memory_id) DO UPDATE
               SET body = EXCLUDED.body,
                   shared = EXCLUDED.shared,
                   source_asset_id = EXCLUDED.source_asset_id,
                   transcript_segment_id = EXCLUDED.transcript_segment_id,
                   updated_at = now()
             RETURNING *`,
            [
              params.archiveId,
              params.memoryId,
              body.body,
              body.shared,
              body.sourceAssetId ?? null,
              transcriptSegmentId,
            ],
          );

          await ctx.analytics.track('memory_feeling_saved', {
            archiveId: params.archiveId,
            // Whether one exists and whether it is shared. Never what it says:
            // this is the most private text in the archive.
            props: { shared: row.shared, spoken: row.source_asset_id !== null },
          });

          return { feeling: toFeeling(row) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/archives/:archiveId/memories/:memoryId/feeling',
    tag: 'memories',
    summary: 'Take it back',
    description: 'Removes it entirely. The story itself is untouched.',
    auth: 'required',
    params: memoryParams,
    response: z.object({ removed: z.literal(true) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memory.feeling.write',
          resource: { type: 'memory', id: params.memoryId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const removed = await tx.maybeOne<{ id: string }>(
            `DELETE FROM memory_feeling
              WHERE archive_id = $1 AND memory_id = $2 RETURNING id`,
            [params.archiveId, params.memoryId],
          );
          if (!removed) throw notFound();
          return { removed: true as const };
        },
      ),
  });
}

export async function findFeeling(
  tx: Transaction,
  archiveId: string,
  memoryId: string,
): Promise<FeelingRow | null> {
  return tx.maybeOne<FeelingRow>(
    `SELECT * FROM memory_feeling WHERE archive_id = $1 AND memory_id = $2`,
    [archiveId, memoryId],
  );
}
