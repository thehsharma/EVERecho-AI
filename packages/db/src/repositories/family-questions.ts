import type { Queryable } from '../pool';

/**
 * Family questions and the answers a storyteller chooses to give.
 *
 * Two rules are enforced here rather than left to callers, because both are
 * one forgotten `WHERE` clause away from being broken:
 *
 * `decline_reason` is never selected by any asker-facing query. It is the
 * storyteller's private note about why they said no, and a private decline
 * that leaks its reason is not private.
 *
 * A question is only ever read by the person who asked it or by the
 * storyteller. There is no query here that returns another member's questions,
 * so a route cannot accidentally expose one.
 */

export interface FamilyQuestionRow {
  id: string;
  archive_id: string;
  asked_by_user_id: string;
  body: string;
  topic: string | null;
  status: 'pending' | 'answered' | 'declined' | 'deferred' | 'withdrawn';
  decided_at: Date | null;
  decline_reason: string | null;
  consent_policy_version: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface FamilyQuestionResponseRow {
  id: string;
  archive_id: string;
  question_id: string;
  responded_by_user_id: string;
  kind: 'answer' | 'decline' | 'defer';
  body: string | null;
  visibility: 'asker_only' | 'all_authorised' | 'restricted' | 'private';
  restricted_to_user_ids: string[];
  answer_source_asset_id: string | null;
  sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
  created_at: Date;
  deleted_at: Date | null;
}

export async function insertFamilyQuestion(
  q: Queryable,
  input: {
    archiveId: string;
    askedByUserId: string;
    body: string;
    topic: string | null;
    consentPolicyVersion: number | null;
  },
): Promise<FamilyQuestionRow> {
  return q.one<FamilyQuestionRow>(
    `INSERT INTO family_question
       (archive_id, asked_by_user_id, body, topic, consent_policy_version)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [input.archiveId, input.askedByUserId, input.body, input.topic, input.consentPolicyVersion],
  );
}

export async function findFamilyQuestion(
  q: Queryable,
  archiveId: string,
  questionId: string,
): Promise<FamilyQuestionRow | null> {
  return q.maybeOne<FamilyQuestionRow>(
    `SELECT * FROM family_question
      WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [archiveId, questionId],
  );
}

/** The storyteller's inbox. Everything, including their own private notes. */
export async function listInboxQuestions(
  q: Queryable,
  archiveId: string,
  options: { status?: string; limit?: number } = {},
): Promise<(FamilyQuestionRow & { asked_by_display_name: string })[]> {
  return q.query(
    `SELECT fq.*, coalesce(m.display_name, 'A family member') AS asked_by_display_name
       FROM family_question fq
       LEFT JOIN membership m
         ON m.archive_id = fq.archive_id AND m.user_id = fq.asked_by_user_id
      WHERE fq.archive_id = $1 AND fq.deleted_at IS NULL
        AND ($2::text IS NULL OR fq.status = $2)
      ORDER BY fq.status = 'pending' DESC, fq.created_at DESC
      LIMIT $3`,
    [archiveId, options.status ?? null, options.limit ?? 100],
  );
}

/**
 * The asker's own questions.
 *
 * `decline_reason` is deliberately not selected. Adding it here would carry a
 * storyteller's private note into an asker-facing view with no further check.
 */
export async function listAskedQuestions(
  q: Queryable,
  archiveId: string,
  askerUserId: string,
  limit = 100,
): Promise<Omit<FamilyQuestionRow, 'decline_reason'>[]> {
  return q.query(
    `SELECT id, archive_id, asked_by_user_id, body, topic, status, decided_at,
            consent_policy_version, created_at, updated_at, deleted_at
       FROM family_question
      WHERE archive_id = $1 AND asked_by_user_id = $2 AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT $3`,
    [archiveId, askerUserId, limit],
  );
}

export async function insertFamilyQuestionResponse(
  q: Queryable,
  input: {
    archiveId: string;
    questionId: string;
    respondedByUserId: string;
    kind: 'answer' | 'decline' | 'defer';
    body: string | null;
    visibility: 'asker_only' | 'all_authorised' | 'restricted' | 'private';
    restrictedToUserIds: string[];
    sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
  },
): Promise<FamilyQuestionResponseRow> {
  return q.one<FamilyQuestionResponseRow>(
    `INSERT INTO family_question_response
       (archive_id, question_id, responded_by_user_id, kind, body, visibility,
        restricted_to_user_ids, sensitivity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [
      input.archiveId,
      input.questionId,
      input.respondedByUserId,
      input.kind,
      input.body,
      input.visibility,
      input.restrictedToUserIds,
      input.sensitivity,
    ],
  );
}

export async function findResponseForQuestion(
  q: Queryable,
  archiveId: string,
  questionId: string,
): Promise<FamilyQuestionResponseRow | null> {
  return q.maybeOne<FamilyQuestionResponseRow>(
    `SELECT * FROM family_question_response
      WHERE archive_id = $1 AND question_id = $2 AND deleted_at IS NULL`,
    [archiveId, questionId],
  );
}

export async function listResponsesForQuestions(
  q: Queryable,
  archiveId: string,
  questionIds: string[],
): Promise<FamilyQuestionResponseRow[]> {
  if (questionIds.length === 0) return [];
  return q.query<FamilyQuestionResponseRow>(
    `SELECT * FROM family_question_response
      WHERE archive_id = $1 AND question_id = ANY($2::uuid[]) AND deleted_at IS NULL`,
    [archiveId, questionIds],
  );
}

export async function attachAnswerSource(
  q: Queryable,
  archiveId: string,
  responseId: string,
  sourceAssetId: string,
): Promise<void> {
  await q.query(
    `UPDATE family_question_response SET answer_source_asset_id = $3
      WHERE archive_id = $1 AND id = $2`,
    [archiveId, responseId, sourceAssetId],
  );
}

/**
 * Records the storyteller's decision on the question itself.
 *
 * Separate from inserting the response so that the question's status and the
 * response are written in one transaction: a question marked answered with no
 * answer, or an answer attached to a question still showing as pending, are
 * both states a person would have to be told about.
 */
export async function decideFamilyQuestion(
  q: Queryable,
  input: {
    archiveId: string;
    questionId: string;
    status: 'answered' | 'declined' | 'deferred' | 'withdrawn';
    declineReason: string | null;
  },
): Promise<FamilyQuestionRow | null> {
  return q.maybeOne<FamilyQuestionRow>(
    `UPDATE family_question
        SET status = $3, decided_at = now(), updated_at = now(),
            decline_reason = coalesce($4, decline_reason)
      WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL AND status = 'pending'
      RETURNING *`,
    [input.archiveId, input.questionId, input.status, input.declineReason],
  );
}

/** How many suggestions came from one answer, and how many still await review. */
export async function countCandidatesForResponse(
  q: Queryable,
  archiveId: string,
  responseId: string,
): Promise<{ total: number; pending: number }> {
  const row = await q.maybeOne<{ total: number; pending: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE status = 'pending')::int AS pending
       FROM memory_candidate
      WHERE archive_id = $1 AND family_question_response_id = $2 AND deleted_at IS NULL`,
    [archiveId, responseId],
  );
  return { total: row?.total ?? 0, pending: row?.pending ?? 0 };
}
