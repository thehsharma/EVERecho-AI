import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  askQuestionRequestSchema,
  generatedResponseSchema,
  searchRequestSchema,
  searchResultSchema,
} from '@everecho/contracts';
import {
  PROHIBITED_REQUEST_MESSAGE,
  contentTokens,
  isProhibitedRequest,
  stableHash,
  truncate,
  verifyClaim,
  type EvidencePassage,
} from '@everecho/ai';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound } from '../errors';
import { allowedSensitivities } from './sources';
import type { AppContext } from '../context';
import type { Transaction } from '@everecho/db';

const archiveParams = z.object({ archiveId: z.uuid() });

const ABSTENTION_TEXT =
  'I don’t have enough evidence in this archive to answer that reliably.';

/** Retrieval weights: lexical matching is the more trustworthy signal here. */
const LEXICAL_WEIGHT = 0.6;
const SEMANTIC_WEIGHT = 0.4;

interface RetrievedClaim {
  claim_id: string;
  claim_text: string;
  memory_id: string;
  memory_title: string;
  sensitivity: string;
  source_asset_id: string;
  source_filename: string;
  source_kind: string;
  transcript_segment_id: string | null;
  locator: Record<string, unknown>;
  quoted_text: string;
  score: number;
  contradiction_ids: string[];
}

/**
 * Loads only evidence this reader is permitted to see.
 *
 * The consent filter is part of the `WHERE` clause, so unauthorised material is
 * never loaded into a process that can reach a model. Filtering after
 * generation would be too late: a model that has read restricted text can leak
 * it through paraphrase.
 */
async function retrieveAuthorisedEvidence(
  ctx: AppContext,
  tx: Transaction,
  input: {
    archiveId: string;
    question: string;
    maxSensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
    excludedSourceIds: readonly string[];
    restrictedTopics: readonly string[];
    limitToSourceIds?: readonly string[];
    limit: number;
  },
): Promise<RetrievedClaim[]> {
  const [queryVector] = await ctx.embeddings.embed([input.question]);
  const usePgvector = await ctx.db.capability('pgvector').catch(() => false);

  // One query, one ranking. Only the similarity expression differs by capability.
  const similarity = usePgvector
    ? `1 - min(me.embedding_v <=> $3::vector)`
    : `1 - min(everecho_cosine_distance(me.embedding, $3::real[]))`;

  return tx.query<RetrievedClaim>(
    `WITH scored AS (
       SELECT m.id AS memory_id, m.title AS memory_title, m.sensitivity,
              ts_rank(m.search_tsv, websearch_to_tsquery('english', $2)) AS lexical,
              coalesce(${similarity}, 0) AS semantic
       FROM memory m
       LEFT JOIN memory_embedding me ON me.memory_id = m.id
       WHERE m.archive_id = $1
         AND m.status = 'approved'
         AND m.deleted_at IS NULL
         AND m.sensitivity = ANY($4::text[])
         AND NOT (m.topics && $5::text[])
       GROUP BY m.id
     )
     SELECT c.id AS claim_id, c.text AS claim_text, s.memory_id, s.memory_title, s.sensitivity,
            e.source_asset_id, sa.original_filename AS source_filename, sa.kind AS source_kind,
            e.transcript_segment_id, e.locator, e.quoted_text,
            (${LEXICAL_WEIGHT} * s.lexical + ${SEMANTIC_WEIGHT} * s.semantic) AS score,
            coalesce(array_agg(DISTINCT x.id) FILTER (WHERE x.id IS NOT NULL), '{}') AS contradiction_ids
     FROM scored s
     JOIN claim c ON c.memory_id = s.memory_id AND c.status = 'approved'
     JOIN claim_evidence e ON e.claim_id = c.id
     JOIN source_asset sa ON sa.id = e.source_asset_id
     LEFT JOIN contradiction x ON (x.claim_a_id = c.id OR x.claim_b_id = c.id) AND x.status = 'open'
     WHERE NOT (e.source_asset_id = ANY($6::uuid[]))
       AND sa.deleted_at IS NULL
       AND (sa.embargo_until IS NULL OR sa.embargo_until <= now())
       AND ($7::uuid[] = '{}' OR e.source_asset_id = ANY($7::uuid[]))
       AND (s.lexical > 0 OR s.semantic > 0.15)
     GROUP BY c.id, s.memory_id, s.memory_title, s.sensitivity, e.source_asset_id,
              sa.original_filename, sa.kind, e.transcript_segment_id, e.locator, e.quoted_text,
              s.lexical, s.semantic
     ORDER BY score DESC
     LIMIT $8`,
    [
      input.archiveId,
      input.question,
      queryVector ?? [],
      allowedSensitivities(input.maxSensitivity),
      input.restrictedTopics,
      input.excludedSourceIds,
      input.limitToSourceIds ?? [],
      input.limit,
    ],
  );
}

export function registerQaRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/questions',
    tag: 'questions',
    summary: 'Ask a question about the storyteller',
    description:
      'Answers are assembled only from approved memories this reader is permitted to see, in ' +
      'the third person, with claim-level citations. When the evidence does not support an ' +
      'answer, the system abstains rather than producing something plausible.',
    auth: 'required',
    params: archiveParams,
    body: askQuestionRequestSchema,
    response: z.object({ response: generatedResponseSchema }),
    handler: async ({ params, body, request }) => {
      const topics = contentTokens(body.question).slice(0, 12);

      return withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'question.ask',
          resource: { type: 'question', topics },
          auditOnAllow: true,
          auditMetadata: { questionLength: body.question.length },
        },
        async ({ tx, decision, subject, archive, user }) => {
          await ctx.analytics.track('question_asked', { actorId: user.id, archiveId: params.archiveId });

          // Refused before anything is retrieved: a request to impersonate the
          // storyteller must not cause their memories to be loaded at all.
          if (isProhibitedRequest(body.question)) {
            return {
              response: await storeResponse(ctx, tx, {
                archiveId: params.archiveId,
                userId: user.id,
                question: body.question,
                answerText: PROHIBITED_REQUEST_MESSAGE,
                abstentionReason: 'prohibited_request',
                claims: [],
                policyVersion: decision.policyVersion,
                snapshotId: null,
              }),
            };
          }

          const retrieved = await retrieveAuthorisedEvidence(ctx, tx, {
            archiveId: params.archiveId,
            question: body.question,
            maxSensitivity: decision.obligations.maxSensitivity,
            excludedSourceIds: decision.obligations.excludedSourceIds,
            restrictedTopics: decision.obligations.restrictedTopics,
            limitToSourceIds: body.sourceIds,
            limit: 24,
          });

          const snapshot = await tx.one<{ id: string }>(
            `INSERT INTO retrieval_snapshot (archive_id, query_hash, candidate_ids, policy_version, max_sensitivity)
             VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [
              params.archiveId,
              stableHash(body.question),
              JSON.stringify(retrieved.map((r) => r.claim_id)),
              decision.policyVersion,
              decision.obligations.maxSensitivity,
            ],
          );

          if (retrieved.length === 0) {
            return {
              response: await storeResponse(ctx, tx, {
                archiveId: params.archiveId,
                userId: user.id,
                question: body.question,
                answerText: ABSTENTION_TEXT,
                abstentionReason: 'no_evidence',
                claims: [],
                policyVersion: decision.policyVersion,
                snapshotId: snapshot.id,
              }),
            };
          }

          const passages: EvidencePassage[] = retrieved.map((r) => ({
            id: r.claim_id,
            text: r.quoted_text || r.claim_text,
            sourceId: r.source_asset_id,
            memoryId: r.memory_id,
            transcriptSegmentId: r.transcript_segment_id,
            locator: r.locator,
          }));

          const draft = await ctx.llm.composeAnswer({
            question: body.question,
            passages,
            subjectName: archive.subject_display_name,
          });

          // Every material claim is checked against the evidence it cites.
          // Anything that fails is dropped before the reader ever sees it.
          const byId = new Map(retrieved.map((r) => [r.claim_id, r]));
          const verified = draft.claims
            .map((claim) => verifyClaim(claim, passages))
            .filter((claim) => claim.verified);

          if (verified.length === 0) {
            return {
              response: await storeResponse(ctx, tx, {
                archiveId: params.archiveId,
                userId: user.id,
                question: body.question,
                answerText: ABSTENTION_TEXT,
                abstentionReason: draft.abstain ? 'no_evidence' : 'insufficient_evidence',
                claims: [],
                policyVersion: decision.policyVersion,
                snapshotId: snapshot.id,
              }),
            };
          }

          const responseClaims = verified.map((claim, index) => {
            const citations = claim.evidenceIds.flatMap((id) => {
              const source = byId.get(id);
              if (!source) return [];
              return [
                {
                  sourceId: source.source_asset_id,
                  sourceFilename: source.source_filename,
                  sourceKind: source.source_kind,
                  locator: source.locator as never,
                  quotedText: source.quoted_text,
                  memoryId: source.memory_id,
                },
              ];
            });
            return {
              index,
              text: claim.text,
              evidenceClass: claim.evidenceClass,
              sourceIds: [...new Set(citations.map((c) => c.sourceId))],
              citations,
              confidence: claim.confidence,
              contradictionIds: [
                ...new Set(claim.evidenceIds.flatMap((id) => byId.get(id)?.contradiction_ids ?? [])),
              ],
              verified: true,
            };
          });

          const conflicted = responseClaims.some((c) => c.contradictionIds.length > 0);
          const answerText = [
            responseClaims.map((c) => c.text).join(' '),
            conflicted
              ? '\n\nNote: the recordings disagree about part of this. Both accounts are cited above.'
              : '',
          ]
            .join('')
            .trim();

          await ctx.analytics.track('cited_answer_viewed', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { claims: responseClaims.length },
          });

          return {
            response: await storeResponse(ctx, tx, {
              archiveId: params.archiveId,
              userId: user.id,
              question: body.question,
              answerText,
              abstentionReason: null,
              claims: responseClaims,
              policyVersion: decision.policyVersion,
              snapshotId: snapshot.id,
            }),
          };
        },
      );
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/responses/:responseId',
    tag: 'questions',
    summary: 'A previously generated answer, with its citations',
    auth: 'required',
    params: archiveParams.extend({ responseId: z.uuid() }),
    response: z.object({ response: generatedResponseSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'response.read',
          resource: { type: 'generated_response', id: params.responseId },
        },
        async ({ tx, user }) => {
          const row = await tx.maybeOne<ResponseRow>(
            `SELECT * FROM generated_response WHERE id = $1 AND archive_id = $2 AND actor_user_id = $3`,
            [params.responseId, params.archiveId, user.id],
          );
          if (!row) throw notFound('That answer was not found.');
          const claims = await tx.query<ResponseClaimRow>(
            `SELECT * FROM response_claim WHERE generated_response_id = $1 ORDER BY idx`,
            [row.id],
          );
          return { response: toResponse(row, claims) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/search',
    tag: 'questions',
    summary: 'Search approved memories',
    description:
      'Available at consent mode "explore". Returns the storyteller’s own words with the ' +
      'sources they came from; it composes nothing.',
    auth: 'required',
    params: archiveParams,
    query: searchRequestSchema,
    response: z.object({ results: z.array(searchResultSchema) }),
    handler: async ({ params, query, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'search.query', resource: { type: 'search', topics: contentTokens(query.query).slice(0, 12) } },
        async ({ tx, decision }) => {
          const retrieved = await retrieveAuthorisedEvidence(ctx, tx, {
            archiveId: params.archiveId,
            question: query.query,
            maxSensitivity: decision.obligations.maxSensitivity,
            excludedSourceIds: decision.obligations.excludedSourceIds,
            restrictedTopics: decision.obligations.restrictedTopics,
            limit: query.limit * 3,
          });

          const seen = new Set<string>();
          const results = [];
          for (const row of retrieved) {
            if (seen.has(row.memory_id)) continue;
            seen.add(row.memory_id);
            const memory = await tx.one<{ occurred_on: string | null; evidence_class: string }>(
              `SELECT occurred_on, evidence_class FROM memory WHERE id = $1`,
              [row.memory_id],
            );
            results.push({
              memoryId: row.memory_id,
              title: row.memory_title,
              snippet: truncate(row.quoted_text || row.claim_text, 240),
              score: Number(row.score.toFixed(4)),
              evidenceClass: memory.evidence_class as never,
              sourceIds: [row.source_asset_id],
              occurredAt: memory.occurred_on,
            });
            if (results.length >= query.limit) break;
          }
          return { results };
        },
      ),
  });
}

interface ResponseRow {
  id: string;
  archive_id: string;
  answer_mode: 'grounded' | 'abstained';
  answer_text: string;
  abstained: boolean;
  abstention_reason: string | null;
  policy_version: string;
  retrieval_snapshot_id: string | null;
  model_and_prompt_version: string;
  created_at: Date;
}

interface ResponseClaimRow {
  idx: number;
  text: string;
  evidence_class: string;
  confidence: number;
  verified: boolean;
  source_ids: string[];
  citations: unknown[];
  contradiction_ids: string[];
}

async function storeResponse(
  ctx: AppContext,
  tx: Transaction,
  input: {
    archiveId: string;
    userId: string;
    question: string;
    answerText: string;
    abstentionReason: string | null;
    claims: {
      index: number;
      text: string;
      evidenceClass: string;
      sourceIds: string[];
      citations: unknown[];
      confidence: number;
      contradictionIds: string[];
      verified: boolean;
    }[];
    policyVersion: string;
    snapshotId: string | null;
  },
) {
  const abstained = input.abstentionReason !== null;
  const row = await tx.one<ResponseRow>(
    `INSERT INTO generated_response
       (archive_id, actor_user_id, question_hash, question_text, answer_mode, answer_text,
        abstained, abstention_reason, policy_version, retrieval_snapshot_id, model_and_prompt_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [
      input.archiveId,
      input.userId,
      createHash('sha256').update(input.question).digest('hex'),
      input.question,
      abstained ? 'abstained' : 'grounded',
      input.answerText,
      abstained,
      input.abstentionReason,
      input.policyVersion,
      input.snapshotId,
      `${ctx.llm.name}@${ctx.llm.modelVersion}/compose-2026-01`,
    ],
  );

  const claimRows: ResponseClaimRow[] = [];
  for (const claim of input.claims) {
    const stored = await tx.one<ResponseClaimRow>(
      `INSERT INTO response_claim (archive_id, generated_response_id, idx, text, evidence_class,
                                   confidence, verified, source_ids, citations, contradiction_ids)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        input.archiveId,
        row.id,
        claim.index,
        claim.text,
        claim.evidenceClass,
        claim.confidence,
        claim.verified,
        claim.sourceIds,
        JSON.stringify(claim.citations),
        claim.contradictionIds,
      ],
    );
    claimRows.push(stored);
  }

  if (abstained) {
    await ctx.analytics.track('answer_abstained', {
      archiveId: input.archiveId,
      props: { reason: null },
    });
  }
  return toResponse(row, claimRows);
}

function toResponse(row: ResponseRow, claims: ResponseClaimRow[]) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    answerMode: row.answer_mode,
    answerText: row.answer_text,
    claims: claims.map((c) => ({
      index: c.idx,
      text: c.text,
      evidenceClass: c.evidence_class as never,
      sourceIds: c.source_ids,
      citations: c.citations as never,
      confidence: c.confidence,
      contradictionIds: c.contradiction_ids,
      verified: c.verified,
    })),
    abstained: row.abstained,
    abstentionReason: row.abstention_reason as never,
    policyVersion: row.policy_version,
    retrievalSnapshotId: row.retrieval_snapshot_id ?? row.id,
    modelAndPromptVersion: row.model_and_prompt_version,
    createdAt: row.created_at.toISOString(),
    aiAssisted: true as const,
    perspective: 'third_person' as const,
  };
}
