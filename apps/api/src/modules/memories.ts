import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  claimSchema,
  contradictionSchema,
  correctionSchema,
  entitySchema,
  eventSchema,
  memorySchema,
  relationshipSchema,
  resolveContradictionRequestSchema,
  reviewMemoryRequestSchema,
  updateMemoryRequestSchema,
} from '@everecho/contracts';
import { enqueueJob } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound } from '../errors';
import { allowedSensitivities } from './sources';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });
const memoryParams = archiveParams.extend({ memoryId: z.uuid() });

interface MemoryRow {
  id: string;
  archive_id: string;
  title: string;
  body: string;
  status: 'candidate' | 'approved' | 'rejected' | 'superseded';
  sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
  evidence_class: string;
  origin: 'interview' | 'upload_extraction' | 'storyteller_written' | 'contributor_proposed';
  occurred_on: string | null;
  occurred_precision: string | null;
  place_id: string | null;
  place_name: string | null;
  topics: string[];
  version: number;
  was_corrected: boolean;
  created_at: Date;
  approved_at: Date | null;
  approved_by_user_id: string | null;
  entity_ids: string[];
}

interface ClaimRow {
  id: string;
  memory_id: string | null;
  text: string;
  evidence_class: string;
  status: 'candidate' | 'approved' | 'rejected' | 'superseded';
  sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
  created_at: Date;
  superseded_by_claim_id: string | null;
  evidence: {
    id: string;
    sourceAssetId: string;
    sourceKind: string;
    sourceFilename: string;
    transcriptSegmentId: string | null;
    locator: Record<string, unknown>;
    quotedText: string;
    extractionMethod: string;
    modelVersion: string;
    promptVersion: string;
    confidence: number;
  }[];
  contradiction_ids: string[];
}

const MEMORY_SELECT = `
  SELECT m.*, p.name AS place_name,
         coalesce(array_agg(DISTINCT me.entity_id) FILTER (WHERE me.entity_id IS NOT NULL), '{}') AS entity_ids
  FROM memory m
  LEFT JOIN place p ON p.id = m.place_id
  LEFT JOIN memory_entity me ON me.memory_id = m.id
`;

const CLAIM_SELECT = `
  SELECT c.id, c.memory_id, c.text, c.evidence_class, c.status, c.sensitivity, c.created_at,
         c.superseded_by_claim_id,
         coalesce(json_agg(json_build_object(
           'id', e.id, 'sourceAssetId', e.source_asset_id, 'sourceKind', s.kind,
           'sourceFilename', s.original_filename, 'transcriptSegmentId', e.transcript_segment_id,
           'locator', e.locator, 'quotedText', e.quoted_text, 'extractionMethod', e.extraction_method,
           'modelVersion', e.model_version, 'promptVersion', e.prompt_version, 'confidence', e.confidence
         ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence,
         coalesce(array_agg(DISTINCT x.id) FILTER (WHERE x.id IS NOT NULL), '{}') AS contradiction_ids
  FROM claim c
  LEFT JOIN claim_evidence e ON e.claim_id = c.id
  LEFT JOIN source_asset s ON s.id = e.source_asset_id
  LEFT JOIN contradiction x ON (x.claim_a_id = c.id OR x.claim_b_id = c.id) AND x.status = 'open'
`;

function toClaim(row: ClaimRow, archiveId: string) {
  return {
    id: row.id,
    archiveId,
    memoryId: row.memory_id,
    text: row.text,
    evidenceClass: row.evidence_class as never,
    status: row.status,
    sensitivity: row.sensitivity,
    evidence: row.evidence.map((e) => ({
      id: e.id,
      sourceAssetId: e.sourceAssetId,
      sourceKind: e.sourceKind ?? 'unknown',
      sourceFilename: e.sourceFilename ?? 'source',
      transcriptSegmentId: e.transcriptSegmentId,
      locator: e.locator as never,
      quotedText: e.quotedText,
      extractionMethod: e.extractionMethod,
      modelVersion: e.modelVersion,
      promptVersion: e.promptVersion,
      confidence: e.confidence,
    })),
    contradictionIds: row.contradiction_ids,
    createdAt: row.created_at.toISOString(),
    supersededByClaimId: row.superseded_by_claim_id,
  };
}

function toMemory(row: MemoryRow, claims: ReturnType<typeof toClaim>[]) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    title: row.title,
    body: row.body,
    status: row.status,
    sensitivity: row.sensitivity,
    evidenceClass: row.evidence_class as never,
    occurredAt: row.occurred_on
      ? { value: row.occurred_on, precision: (row.occurred_precision ?? 'year') as never }
      : null,
    placeId: row.place_id,
    placeName: row.place_name,
    entityIds: row.entity_ids,
    claims,
    version: row.version,
    origin: row.origin,
    wasCorrected: row.was_corrected,
    createdAt: row.created_at.toISOString(),
    approvedAt: row.approved_at?.toISOString() ?? null,
    approvedByUserId: row.approved_by_user_id,
  };
}

export function registerMemoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/memories',
    tag: 'memories',
    summary: 'Story cards',
    description:
      'Candidates are visible to the storyteller only. Everyone else sees approved memories, ' +
      'filtered to the sensitivity their grant allows — the filter is built from the policy ' +
      'decision itself, so it cannot drift from the authorisation.',
    auth: 'required',
    params: archiveParams,
    query: z.object({
      status: z.enum(['candidate', 'approved', 'all']).default('approved'),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: z.object({ memories: z.array(memorySchema), candidateCount: z.number().int() }),
    handler: async ({ params, query, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'memory.read', resource: { type: 'memory' } },
        async ({ tx, decision, user, archive }) => {
          const isStoryteller = archive.storyteller_user_id === user.id;
          const wanted = isStoryteller ? query.status : 'approved';

          const rows = await tx.query<MemoryRow>(
            `${MEMORY_SELECT}
             WHERE m.archive_id = $1 AND m.deleted_at IS NULL
               AND ($2 = 'all' OR m.status = $2)
               AND ($3 OR m.sensitivity = ANY($4::text[]))
             GROUP BY m.id, p.name
             ORDER BY m.occurred_on NULLS LAST, m.created_at DESC
             LIMIT $5`,
            [
              params.archiveId,
              wanted,
              isStoryteller,
              allowedSensitivities(decision.obligations.maxSensitivity),
              query.limit,
            ],
          );

          const claims =
            rows.length === 0
              ? []
              : await tx.query<ClaimRow>(
                  `${CLAIM_SELECT} WHERE c.memory_id = ANY($1::uuid[]) GROUP BY c.id`,
                  [rows.map((r) => r.id)],
                );
          const byMemory = new Map<string, ReturnType<typeof toClaim>[]>();
          for (const claim of claims) {
            const list = byMemory.get(claim.memory_id ?? '') ?? [];
            list.push(toClaim(claim, params.archiveId));
            byMemory.set(claim.memory_id ?? '', list);
          }

          const candidateCount = isStoryteller
            ? (
                await tx.one<{ count: number }>(
                  `SELECT count(*)::int AS count FROM memory
                   WHERE archive_id = $1 AND status = 'candidate' AND deleted_at IS NULL`,
                  [params.archiveId],
                )
              ).count
            : 0;

          return {
            memories: rows.map((row) => toMemory(row, byMemory.get(row.id) ?? [])),
            candidateCount,
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/memories/:memoryId',
    tag: 'memories',
    summary: 'One story card with all of its claims and evidence',
    auth: 'required',
    params: memoryParams,
    response: z.object({ memory: memorySchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memory.read',
          resource: { type: 'memory', id: params.memoryId },
        },
        async ({ tx, decision, user, archive }) => {
          const row = await tx.maybeOne<MemoryRow>(
            `${MEMORY_SELECT} WHERE m.id = $1 AND m.archive_id = $2 AND m.deleted_at IS NULL
             GROUP BY m.id, p.name`,
            [params.memoryId, params.archiveId],
          );
          if (!row) throw notFound('That story was not found.');

          const isStoryteller = archive.storyteller_user_id === user.id;
          if (!isStoryteller) {
            if (row.status !== 'approved') throw notFound('That story was not found.');
            if (
              !allowedSensitivities(decision.obligations.maxSensitivity).includes(row.sensitivity)
            ) {
              throw notFound('That story was not found.');
            }
          }

          const claims = await tx.query<ClaimRow>(
            `${CLAIM_SELECT} WHERE c.memory_id = $1 GROUP BY c.id`,
            [row.id],
          );
          return {
            memory: toMemory(
              row,
              claims.map((c) => toClaim(c, params.archiveId)),
            ),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PATCH',
    url: '/v1/archives/:archiveId/memories/:memoryId',
    tag: 'memories',
    summary: 'Correct a story card',
    description:
      'The previous version is kept as a correction record; nothing is overwritten silently.',
    auth: 'required',
    params: memoryParams,
    body: updateMemoryRequestSchema,
    response: z.object({ memory: memorySchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memory.update',
          resource: { type: 'memory', id: params.memoryId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const previous = await tx.maybeOne<MemoryRow>(
            `${MEMORY_SELECT} WHERE m.id = $1 AND m.archive_id = $2 GROUP BY m.id, p.name`,
            [params.memoryId, params.archiveId],
          );
          if (!previous) throw notFound('That story was not found.');

          const updated = await tx.one<MemoryRow>(
            `UPDATE memory SET
               title = coalesce($3, title),
               body = coalesce($4, body),
               occurred_on = coalesce($5, occurred_on),
               occurred_precision = coalesce($6, occurred_precision),
               sensitivity = coalesce($7, sensitivity),
               version = version + 1,
               was_corrected = true,
               updated_at = now()
             WHERE id = $1 AND archive_id = $2
             RETURNING *, NULL::text AS place_name, '{}'::uuid[] AS entity_ids`,
            [
              params.memoryId,
              params.archiveId,
              body.title ?? null,
              body.body ?? null,
              body.occurredAt?.value ?? null,
              body.occurredAt?.precision ?? null,
              body.sensitivity ?? null,
            ],
          );

          await tx.query(
            `INSERT INTO correction (archive_id, target_type, target_id, previous_value, next_value,
                                     actor_user_id, actor_role, reason, status)
             VALUES ($1, 'memory', $2, $3, $4, $5, 'storyteller', $6, 'applied')`,
            [
              params.archiveId,
              params.memoryId,
              JSON.stringify({
                title: previous.title,
                body: previous.body,
                occurredOn: previous.occurred_on,
              }),
              JSON.stringify({
                title: updated.title,
                body: updated.body,
                occurredOn: updated.occurred_on,
              }),
              user.id,
              body.reason ?? null,
            ],
          );

          // An approved memory that changed must be re-indexed, or search would
          // keep answering from the text the storyteller just corrected.
          if (updated.status === 'approved') {
            await enqueueJob(tx, {
              archiveId: params.archiveId,
              type: 'embed_memory',
              payload: { memoryId: params.memoryId },
              idempotencyKey: `embed:${params.memoryId}:v${updated.version}`,
            });
          }
          return { memory: toMemory(updated, []) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/memories/:memoryId/review',
    tag: 'memories',
    summary: 'Approve or reject a candidate story',
    description:
      'Approval is what makes a memory searchable and answerable. Until then it exists only for ' +
      'the storyteller to read, and no answer can draw on it.',
    auth: 'required',
    params: memoryParams,
    body: reviewMemoryRequestSchema,
    response: z.object({ memory: memorySchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memory.review',
          resource: { type: 'memory', id: params.memoryId },
          auditOnAllow: true,
          auditMetadata: { decision: body.decision },
        },
        async ({ tx, user }) => {
          const status = body.decision === 'approve' ? 'approved' : 'rejected';
          const row = await tx.maybeOne<MemoryRow>(
            `UPDATE memory SET status = $3,
                               approved_at = CASE WHEN $3 = 'approved' THEN now() ELSE NULL END,
                               approved_by_user_id = CASE WHEN $3 = 'approved' THEN $4::uuid ELSE NULL END,
                               updated_at = now()
             WHERE id = $1 AND archive_id = $2
             RETURNING *, NULL::text AS place_name, '{}'::uuid[] AS entity_ids`,
            [params.memoryId, params.archiveId, status, user.id],
          );
          if (!row) throw notFound('That story was not found.');

          await tx.query(`UPDATE claim SET status = $3 WHERE memory_id = $1 AND archive_id = $2`, [
            params.memoryId,
            params.archiveId,
            status,
          ]);

          if (status === 'approved') {
            await enqueueJob(tx, {
              archiveId: params.archiveId,
              type: 'embed_memory',
              payload: { memoryId: params.memoryId },
              idempotencyKey: `embed:${params.memoryId}:v${row.version}`,
            });
            await enqueueJob(tx, {
              archiveId: params.archiveId,
              type: 'build_timeline',
              payload: {},
            });
            await ctx.analytics.track('memory_approved', {
              actorId: user.id,
              archiveId: params.archiveId,
            });
          } else {
            await tx.query(`DELETE FROM memory_embedding WHERE memory_id = $1`, [params.memoryId]);
          }
          return { memory: toMemory(row, []) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/people',
    tag: 'memories',
    summary: 'People, organisations and their relationships',
    auth: 'required',
    params: archiveParams,
    response: z.object({
      entities: z.array(entitySchema),
      relationships: z.array(relationshipSchema),
    }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'entity.read', resource: { type: 'entity' } },
        async ({ tx }) => {
          const entities = await tx.query<{
            id: string;
            kind: 'person' | 'organisation' | 'object';
            name: string;
            aliases: string[];
            notes: string | null;
            status: 'candidate' | 'approved' | 'rejected' | 'superseded';
            mention_count: number;
          }>(
            `SELECT e.id, e.kind, e.name, e.aliases, e.notes, e.status,
                    count(me.memory_id)::int AS mention_count
             FROM entity e LEFT JOIN memory_entity me ON me.entity_id = e.id
             WHERE e.archive_id = $1 GROUP BY e.id ORDER BY mention_count DESC, e.name`,
            [params.archiveId],
          );
          const relationships = await tx.query<{
            id: string;
            from_entity_id: string;
            from_name: string;
            to_entity_id: string;
            to_name: string;
            kind: string;
            status: 'candidate' | 'approved' | 'rejected' | 'superseded';
            notes: string | null;
          }>(
            `SELECT r.id, r.from_entity_id, a.name AS from_name, r.to_entity_id, b.name AS to_name,
                    r.kind, r.status, r.notes
             FROM relationship r
             JOIN entity a ON a.id = r.from_entity_id
             JOIN entity b ON b.id = r.to_entity_id
             WHERE r.archive_id = $1`,
            [params.archiveId],
          );
          return {
            entities: entities.map((e) => ({
              id: e.id,
              archiveId: params.archiveId,
              kind: e.kind,
              name: e.name,
              aliases: e.aliases,
              notes: e.notes,
              status: e.status,
              mentionCount: e.mention_count,
            })),
            relationships: relationships.map((r) => ({
              id: r.id,
              fromEntityId: r.from_entity_id,
              fromEntityName: r.from_name,
              toEntityId: r.to_entity_id,
              toEntityName: r.to_name,
              kind: r.kind,
              status: r.status,
              notes: r.notes,
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/contradictions',
    tag: 'memories',
    summary: 'Accounts that cannot both be true',
    description:
      'Surfaced for the storyteller to resolve, never silently reconciled. An answer that ' +
      'touches an open contradiction says so and cites both sides.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ contradictions: z.array(contradictionSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contradiction.read',
          resource: { type: 'contradiction' },
        },
        async ({ tx }) => {
          const rows = await tx.query<{
            id: string;
            claim_a_id: string;
            claim_a_text: string;
            claim_b_id: string;
            claim_b_text: string;
            kind: 'date_conflict' | 'place_conflict' | 'fact_conflict' | 'relationship_conflict';
            status: 'open' | 'resolved' | 'accepted';
            detected_at: Date;
          }>(
            `SELECT x.id, x.claim_a_id, a.text AS claim_a_text, x.claim_b_id, b.text AS claim_b_text,
                    x.kind, x.status, x.detected_at
             FROM contradiction x
             JOIN claim a ON a.id = x.claim_a_id
             JOIN claim b ON b.id = x.claim_b_id
             WHERE x.archive_id = $1 ORDER BY x.detected_at DESC`,
            [params.archiveId],
          );
          return {
            contradictions: rows.map((r) => ({
              id: r.id,
              claimAId: r.claim_a_id,
              claimAText: r.claim_a_text,
              claimBId: r.claim_b_id,
              claimBText: r.claim_b_text,
              kind: r.kind,
              status: r.status,
              detectedAt: r.detected_at.toISOString(),
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/contradictions/:contradictionId/resolve',
    tag: 'memories',
    summary: 'Say which account is right, or that both are',
    auth: 'required',
    params: archiveParams.extend({ contradictionId: z.uuid() }),
    body: resolveContradictionRequestSchema,
    response: z.object({ resolved: z.literal(true) }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contradiction.resolve',
          resource: { type: 'contradiction', id: params.contradictionId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const row = await tx.maybeOne<{ claim_a_id: string; claim_b_id: string }>(
            `UPDATE contradiction
             SET status = CASE WHEN $3 = 'both_true' THEN 'accepted' ELSE 'resolved' END,
                 resolved_at = now(), resolution = $4
             WHERE id = $1 AND archive_id = $2 RETURNING claim_a_id, claim_b_id`,
            [params.contradictionId, params.archiveId, body.resolution, body.note ?? null],
          );
          if (!row) throw notFound('That was not found.');

          // Superseding keeps both claims: the rejected one stays as history,
          // pointing at the one the storyteller says is right.
          if (body.resolution === 'prefer_a' || body.resolution === 'prefer_b') {
            const winner = body.resolution === 'prefer_a' ? row.claim_a_id : row.claim_b_id;
            const loser = body.resolution === 'prefer_a' ? row.claim_b_id : row.claim_a_id;
            await tx.query(
              `UPDATE claim SET status = 'superseded', superseded_by_claim_id = $2 WHERE id = $1`,
              [loser, winner],
            );
          }
          return { resolved: true as const };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/corrections',
    tag: 'memories',
    summary: 'Every correction ever made',
    auth: 'required',
    params: archiveParams,
    response: z.object({ corrections: z.array(correctionSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'correction.read',
          resource: { type: 'correction' },
        },
        async ({ tx }) => {
          const rows = await tx.query<{
            id: string;
            target_type: string;
            target_id: string;
            actor_user_id: string | null;
            actor_display: string | null;
            reason: string | null;
            previous_value: unknown;
            next_value: unknown;
            created_at: Date;
          }>(
            `SELECT c.id, c.target_type, c.target_id, c.actor_user_id, u.display_name AS actor_display,
                    c.reason, c.previous_value, c.next_value, c.created_at
             FROM correction c LEFT JOIN app_user u ON u.id = c.actor_user_id
             WHERE c.archive_id = $1 ORDER BY c.created_at DESC LIMIT 200`,
            [params.archiveId],
          );
          return {
            corrections: rows.map((r) => ({
              id: r.id,
              targetType: r.target_type,
              targetId: r.target_id,
              actorUserId: r.actor_user_id,
              actorDisplayName: r.actor_display ?? 'Unknown',
              reason: r.reason,
              previous: r.previous_value,
              next: r.next_value,
              createdAt: r.created_at.toISOString(),
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/events',
    tag: 'memories',
    summary: 'Dated life events',
    auth: 'required',
    params: archiveParams,
    response: z.object({ events: z.array(eventSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'event.read', resource: { type: 'event' } },
        async ({ tx }) => {
          const rows = await tx.query<{
            id: string;
            memory_id: string | null;
            title: string;
            start_date: string | null;
            start_precision: string | null;
            end_date: string | null;
            end_precision: string | null;
            place_id: string | null;
            place_name: string | null;
            status: 'candidate' | 'approved' | 'rejected' | 'superseded';
            evidence_class: string;
          }>(
            `SELECT e.*, p.name AS place_name FROM life_event e
             LEFT JOIN place p ON p.id = e.place_id
             WHERE e.archive_id = $1 ORDER BY e.start_date NULLS LAST`,
            [params.archiveId],
          );
          return {
            events: rows.map((e) => ({
              id: e.id,
              archiveId: params.archiveId,
              memoryId: e.memory_id,
              title: e.title,
              startDate: e.start_date
                ? { value: e.start_date, precision: (e.start_precision ?? 'year') as never }
                : null,
              endDate: e.end_date
                ? { value: e.end_date, precision: (e.end_precision ?? 'year') as never }
                : null,
              placeId: e.place_id,
              placeName: e.place_name,
              status: e.status,
              evidenceClass: e.evidence_class as never,
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/claims/:claimId',
    tag: 'memories',
    summary: 'One claim with the exact source passage behind it',
    description: 'What the inspect-source panel opens when a citation is clicked.',
    auth: 'required',
    params: archiveParams.extend({ claimId: z.uuid() }),
    response: z.object({ claim: claimSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'citation.open',
          resource: { type: 'memory', id: params.claimId },
          auditOnAllow: true,
        },
        async ({ tx, decision, user, archive }) => {
          const row = await tx.maybeOne<ClaimRow>(
            `${CLAIM_SELECT} WHERE c.id = $1 AND c.archive_id = $2 GROUP BY c.id`,
            [params.claimId, params.archiveId],
          );
          if (!row) throw notFound('That citation was not found.');

          const isStoryteller = archive.storyteller_user_id === user.id;
          if (!isStoryteller) {
            if (row.status !== 'approved') throw notFound('That citation was not found.');
            if (
              !allowedSensitivities(decision.obligations.maxSensitivity).includes(row.sensitivity)
            ) {
              throw notFound('That citation was not found.');
            }
          }
          await ctx.analytics.track('citation_opened', {
            actorId: user.id,
            archiveId: params.archiveId,
          });
          return { claim: toClaim(row, params.archiveId) };
        },
      ),
  });
}
