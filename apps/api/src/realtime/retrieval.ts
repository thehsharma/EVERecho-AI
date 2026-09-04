import { contentTokens, stableHash, type EvidencePassage } from '@everecho/ai';
import type { Transaction } from '@everecho/db';
import type { AppContext } from '../context';
import { allowedSensitivities } from '../modules/sources';

/**
 * Retrieval for a live conversation.
 *
 * The same shape as the question-answering path, and for the same reason: the
 * consent obligations are part of the `WHERE` clause, so material the reader
 * may not see is never loaded into a process that can reach a model.
 *
 * Filtering after retrieval would be too late even in a voice session — in
 * fact especially in one, because a model that has read restricted text can
 * leak it through paraphrase, hesitation, or the shape of a refusal.
 */
export interface RetrievedEvidence {
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

const LEXICAL_WEIGHT = 0.6;
const SEMANTIC_WEIGHT = 0.4;

export async function retrieveForTurn(
  ctx: AppContext,
  tx: Transaction,
  input: {
    archiveId: string;
    question: string;
    maxSensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
    excludedSourceIds: readonly string[];
    restrictedTopics: readonly string[];
    limitToSourceIds: readonly string[];
    limit: number;
  },
): Promise<RetrievedEvidence[]> {
  const [queryVector] = await ctx.embeddings.embed([input.question]);

  // OR semantics, as in the REST path: requiring every term makes a single
  // unfamiliar word read to a family member as an empty archive rather than a
  // phrasing mismatch.
  const tsQuery =
    contentTokens(input.question)
      .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((token) => token.length > 1)
      .join(' | ') || 'zzzznomatch';

  const usePgvector = await ctx.db.capability('pgvector').catch(() => false);
  const similarity = usePgvector
    ? `1 - min(me.embedding_v <=> $3::vector)`
    : `1 - min(everecho_cosine_distance(me.embedding, $3::real[]))`;

  return tx.query<RetrievedEvidence>(
    `WITH scored AS (
       SELECT m.id AS memory_id, m.title AS memory_title, m.sensitivity,
              ts_rank(m.search_tsv, to_tsquery('english', $2)) AS lexical,
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
     ORDER BY score DESC, c.created_at ASC, c.id ASC
     LIMIT $8`,
    [
      input.archiveId,
      tsQuery,
      queryVector ?? [],
      allowedSensitivities(input.maxSensitivity),
      input.restrictedTopics,
      input.excludedSourceIds,
      input.limitToSourceIds,
      input.limit,
    ],
  );
}

export function toPassages(rows: readonly RetrievedEvidence[]): EvidencePassage[] {
  return rows.map((r) => ({
    id: r.claim_id,
    text: r.quoted_text || r.claim_text,
    sourceId: r.source_asset_id,
    memoryId: r.memory_id,
    transcriptSegmentId: r.transcript_segment_id,
    locator: r.locator,
  }));
}

/**
 * Records what was retrieved before composition.
 *
 * This is what makes a spoken answer reproducible months later: an
 * investigator can ask what evidence the system actually had, rather than
 * inferring it from what it said.
 */
export async function storeSnapshot(
  tx: Transaction,
  input: {
    archiveId: string;
    question: string;
    rows: readonly RetrievedEvidence[];
    policyVersion: string;
    maxSensitivity: string;
  },
): Promise<string> {
  const row = await tx.one<{ id: string }>(
    `INSERT INTO retrieval_snapshot
       (archive_id, query_hash, candidate_ids, policy_version, max_sensitivity)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      input.archiveId,
      stableHash(input.question),
      JSON.stringify(input.rows.map((r) => r.claim_id)),
      input.policyVersion,
      input.maxSensitivity,
    ],
  );
  return row.id;
}
