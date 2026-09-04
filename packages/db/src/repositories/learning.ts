import type { LearningPolicy, LearningPolicyDocument } from '@everecho/contracts';
import type { Queryable } from '../pool';

export interface LearningPolicyRow {
  id: string;
  archive_id: string;
  version: number;
  document: LearningPolicyDocument;
  policy_hash: string;
  policy_engine_version: string;
  created_by_user_id: string | null;
  effective_from: Date;
  superseded_at: Date | null;
  created_at: Date;
}

export function toLearningPolicy(row: LearningPolicyRow): LearningPolicy {
  return {
    id: row.id,
    archiveId: row.archive_id,
    version: row.version,
    document: row.document,
    policyHash: row.policy_hash,
    policyEngineVersion: row.policy_engine_version,
    createdByUserId: row.created_by_user_id ?? '',
    effectiveFrom: row.effective_from.toISOString(),
    supersededAt: row.superseded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** Must be called inside an archive scope: learning_policy is under RLS. */
export async function findCurrentLearningPolicy(
  q: Queryable,
  archiveId: string,
): Promise<LearningPolicyRow | null> {
  return q.maybeOne<LearningPolicyRow>(
    `SELECT * FROM learning_policy WHERE archive_id = $1 AND superseded_at IS NULL`,
    [archiveId],
  );
}

export async function listLearningPolicyVersions(
  q: Queryable,
  archiveId: string,
): Promise<LearningPolicyRow[]> {
  return q.query<LearningPolicyRow>(
    `SELECT * FROM learning_policy WHERE archive_id = $1 ORDER BY version DESC`,
    [archiveId],
  );
}

/**
 * Writes a new version and supersedes the previous one in the same statement
 * pair, inside the caller's transaction. A learning policy is never updated in
 * place, for the same reason a consent policy is not: the storyteller must be
 * able to see what they agreed to before, not only what they agree to now.
 */
export async function insertLearningPolicyVersion(
  q: Queryable,
  input: {
    archiveId: string;
    document: LearningPolicyDocument;
    policyHash: string;
    policyEngineVersion: string;
    createdByUserId: string;
  },
): Promise<LearningPolicyRow> {
  await q.query(
    `UPDATE learning_policy SET superseded_at = now()
     WHERE archive_id = $1 AND superseded_at IS NULL`,
    [input.archiveId],
  );
  return q.one<LearningPolicyRow>(
    `INSERT INTO learning_policy
       (archive_id, version, document, policy_hash, policy_engine_version, created_by_user_id)
     VALUES (
       $1,
       coalesce((SELECT max(version) FROM learning_policy WHERE archive_id = $1), 0) + 1,
       $2, $3, $4, $5
     )
     RETURNING *`,
    [
      input.archiveId,
      JSON.stringify(input.document),
      input.policyHash,
      input.policyEngineVersion,
      input.createdByUserId,
    ],
  );
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

export interface MemoryCandidateRow {
  id: string;
  archive_id: string;
  session_id: string | null;
  kind: string;
  status: string;
  title: string;
  body: string;
  occurred_on_value: string | null;
  occurred_on_precision: string | null;
  topics: string[];
  entity_names: string[];
  place_name: string | null;
  data_categories: string[];
  sensitivity: string;
  evidence_class: string;
  confidence: number;
  duplicate_of_memory_id: string | null;
  duplicate_of_candidate_id: string | null;
  contradicts_memory_ids: string[];
  extractor_name: string;
  extractor_version: string;
  prompt_version: string;
  requires_storyteller_review: boolean;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  approved_memory_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
}

export interface CandidateEvidenceRow {
  id: string;
  archive_id: string;
  candidate_id: string;
  turn_id: string | null;
  source_asset_id: string | null;
  transcript_segment_id: string | null;
  locator: Record<string, unknown>;
  quoted_text: string;
  first_hand: boolean;
  speaker_label: string | null;
  created_at: Date;
}

export async function listPendingCandidates(
  q: Queryable,
  archiveId: string,
  input: { sessionId?: string | null; limit: number },
): Promise<MemoryCandidateRow[]> {
  return q.query<MemoryCandidateRow>(
    `SELECT * FROM memory_candidate
     WHERE archive_id = $1
       AND deleted_at IS NULL
       AND status = 'pending'
       AND ($2::uuid IS NULL OR session_id = $2::uuid)
     ORDER BY created_at ASC, id ASC
     LIMIT $3`,
    [archiveId, input.sessionId ?? null, input.limit],
  );
}

export async function findCandidate(
  q: Queryable,
  archiveId: string,
  candidateId: string,
): Promise<MemoryCandidateRow | null> {
  return q.maybeOne<MemoryCandidateRow>(
    `SELECT * FROM memory_candidate
     WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [archiveId, candidateId],
  );
}

export async function listCandidateEvidence(
  q: Queryable,
  candidateIds: readonly string[],
): Promise<CandidateEvidenceRow[]> {
  if (candidateIds.length === 0) return [];
  return q.query<CandidateEvidenceRow>(
    `SELECT * FROM memory_candidate_evidence
     WHERE candidate_id = ANY($1::uuid[])
     ORDER BY created_at ASC, id ASC`,
    [candidateIds],
  );
}

export async function recordLearningDecision(
  q: Queryable,
  input: {
    archiveId: string;
    candidateId?: string | null;
    sessionId?: string | null;
    decision: 'approved' | 'rejected' | 'auto_saved' | 'withdrawn' | 'deduplicated' | 'deferred';
    decidedByUserId?: string | null;
    decidedBy?: 'user' | 'system';
    learningPolicyId?: string | null;
    consentPolicyVersion?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO learning_decision
       (archive_id, candidate_id, session_id, decision, decided_by_user_id, decided_by,
        learning_policy_id, consent_policy_version, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      input.archiveId,
      input.candidateId ?? null,
      input.sessionId ?? null,
      input.decision,
      input.decidedByUserId ?? null,
      input.decidedBy ?? 'user',
      input.learningPolicyId ?? null,
      input.consentPolicyVersion ?? null,
      input.note ?? null,
    ],
  );
}

// ---------------------------------------------------------------------------
// Interaction preferences (per user, not per archive)
// ---------------------------------------------------------------------------

export interface InteractionPreferenceRow {
  id: string;
  user_id: string;
  key: string;
  value: string;
  origin: string;
  learning_policy_version: number | null;
  created_at: Date;
  updated_at: Date;
}

export async function listInteractionPreferences(
  q: Queryable,
  userId: string,
): Promise<InteractionPreferenceRow[]> {
  return q.query<InteractionPreferenceRow>(
    `SELECT * FROM interaction_preference WHERE user_id = $1 ORDER BY key ASC`,
    [userId],
  );
}

export async function upsertInteractionPreference(
  q: Queryable,
  input: {
    userId: string;
    key: string;
    value: string;
    origin: 'explicit' | 'auto_saved';
    learningPolicyVersion?: number | null;
  },
): Promise<InteractionPreferenceRow> {
  return q.one<InteractionPreferenceRow>(
    `INSERT INTO interaction_preference (user_id, key, value, origin, learning_policy_version)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (user_id, key) DO UPDATE
       SET value = EXCLUDED.value,
           origin = EXCLUDED.origin,
           learning_policy_version = EXCLUDED.learning_policy_version,
           updated_at = now()
     RETURNING *`,
    [input.userId, input.key, input.value, input.origin, input.learningPolicyVersion ?? null],
  );
}

export async function deleteInteractionPreference(
  q: Queryable,
  userId: string,
  preferenceId: string,
): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    `DELETE FROM interaction_preference WHERE user_id = $1 AND id = $2 RETURNING id`,
    [userId, preferenceId],
  );
  return rows.length > 0;
}
