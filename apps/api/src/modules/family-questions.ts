import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  askedQuestionSchema,
  createFamilyQuestionRequestSchema,
  familyQuestionSchema,
  respondToFamilyQuestionRequestSchema,
} from '@everecho/contracts';
import {
  attachAnswerSource,
  countCandidatesForResponse,
  decideFamilyQuestion,
  findCurrentLearningPolicy,
  findCurrentPolicy,
  findFamilyQuestion,
  insertFamilyQuestion,
  insertFamilyQuestionResponse,
  listAskedQuestions,
  listInboxQuestions,
  listResponsesForQuestions,
  toLearningPolicy,
  type FamilyQuestionResponseRow,
  type FamilyQuestionRow,
  type Transaction,
} from '@everecho/db';
import { resolveLearningObligations, type LearningObligations } from '@everecho/consent';
import { detectInjection } from '@everecho/ai';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, notFound, validationFailed } from '../errors';
import { extractCandidates, storeCandidates } from '../realtime/candidates';
import type { AppContext } from '../context';

/**
 * The family growth loop.
 *
 * One storyteller creates an archive; authorised relatives ask about it; the
 * answers the storyteller chooses to give become more archive. That loop is the
 * only thing here that compounds, which is why it is the first thing built.
 *
 * The shape of the flow is deliberate at three points:
 *
 * A question is not evidence. It never enters retrieval and never becomes a
 * fact. Only an answer becomes a source, and even then it becomes a *candidate*
 * that the storyteller must approve.
 *
 * A restricted topic is refused at the question rather than at the answer, so
 * a storyteller who has closed a subject is not asked to close it again every
 * time somebody raises it (see GROWTH_DECISION_LOG G-002).
 *
 * The asker sees the storyteller's own words, cited to the answer as a source.
 * No model composes the reply: a question put to a person should be answered by
 * that person, and running it through composition would replace a P1 direct
 * statement with a P3 synthesis of it (G-003).
 */

const archiveParams = z.object({ archiveId: z.uuid() });
const questionParams = archiveParams.extend({ questionId: z.uuid() });

export function registerFamilyQuestionRoutes(app: FastifyInstance, ctx: AppContext): void {
  // -------------------------------------------------------------------------
  // Asking
  // -------------------------------------------------------------------------
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/family-questions',
    tag: 'family',
    summary: 'Ask the storyteller something',
    description:
      'Puts a question in the storyteller’s private inbox. Nobody else in the archive can see ' +
      'it, and it never becomes part of the archive unless the storyteller answers and then ' +
      'approves what came of it. A question about a topic the storyteller has closed is ' +
      'refused here rather than put in front of them.',
    auth: 'required',
    params: archiveParams,
    body: createFamilyQuestionRequestSchema,
    response: z.object({ question: askedQuestionSchema }),
    status: 201,
    rateLimit: { max: 30, windowMs: 60_000 },
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'familyQuestion.create',
          resource: { type: 'family_question' },
          auditOnAllow: true,
        },
        async ({ tx, user, decision, subject }) => {
          // A question naming a closed subject is refused before it is stored,
          // so restricted material never lands in a table the storyteller has
          // to read. The topic hint and the question text are both checked:
          // choosing a different topic must not be a way round it.
          const restricted = subject.policy?.document.restrictedTopics ?? [];
          const offending = restricted.find(
            (topic) =>
              topic.trim().length > 0 &&
              (body.topic?.toLowerCase().includes(topic.toLowerCase()) ||
                body.body.toLowerCase().includes(topic.toLowerCase())),
          );
          if (offending) {
            throw conflict(
              'The storyteller has asked not to be asked about this subject.',
              'restricted_topic',
            );
          }

          const policy = await findCurrentPolicy(tx, params.archiveId);
          const question = await insertFamilyQuestion(tx, {
            archiveId: params.archiveId,
            askedByUserId: user.id,
            body: body.body,
            topic: body.topic ?? null,
            consentPolicyVersion: policy?.version ?? null,
          });

          await ctx.analytics.track('family_question_asked', {
            actorId: user.id,
            archiveId: params.archiveId,
            // Counts and booleans only. The question itself is never analytics.
            props: { hasTopic: Boolean(body.topic), length: body.body.length },
          });

          void decision;
          return { question: toAskedQuestion(question, null) };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // The asker's own view
  // -------------------------------------------------------------------------
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/family-questions/asked',
    tag: 'family',
    summary: 'Questions you asked, and any answers you were given',
    description:
      'Only your own questions. A declined question shows as closed with no reason: the ' +
      'storyteller’s reasons are their own.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ questions: z.array(askedQuestionSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'familyQuestion.read',
          resource: { type: 'family_question' },
        },
        async ({ tx, user }) => {
          const rows = await listAskedQuestions(tx, params.archiveId, user.id);
          const responses = await listResponsesForQuestions(
            tx,
            params.archiveId,
            rows.map((r) => r.id),
          );
          const byQuestion = new Map(responses.map((r) => [r.question_id, r]));

          const questions = await Promise.all(
            rows.map(async (row) => {
              const response = byQuestion.get(row.id) ?? null;
              const visible = response && (await visibleToAsker(tx, response, user.id));
              return toAskedQuestion(
                row as FamilyQuestionRow,
                visible ? response : null,
                visible
                  ? await sourceLabel(tx, params.archiveId, response.answer_source_asset_id)
                  : null,
              );
            }),
          );
          return { questions };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // The storyteller's inbox
  // -------------------------------------------------------------------------
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/family-questions',
    tag: 'family',
    summary: 'Questions your family has asked you',
    description:
      'The storyteller’s private inbox. Nobody else can read it, including the people who ' +
      'asked: they see only their own questions.',
    auth: 'required',
    params: archiveParams,
    query: z.object({
      status: z.enum(['pending', 'answered', 'declined', 'deferred', 'withdrawn']).optional(),
    }),
    response: z.object({ questions: z.array(familyQuestionSchema) }),
    handler: async ({ params, query, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'familyQuestion.read',
          resource: { type: 'family_question' },
        },
        async ({ tx, user, archive }) => {
          // Reading the inbox is the storyteller's alone. `familyQuestion.read`
          // is granted to readers so they can see their *own* questions, so the
          // separation is made here rather than in the matrix.
          if (archive.storyteller_user_id !== user.id) throw notFound();

          const rows = await listInboxQuestions(tx, params.archiveId, { status: query.status });
          const responses = await listResponsesForQuestions(
            tx,
            params.archiveId,
            rows.map((r) => r.id),
          );
          const byQuestion = new Map(responses.map((r) => [r.question_id, r]));

          const questions = await Promise.all(
            rows.map(async (row) => {
              const response = byQuestion.get(row.id) ?? null;
              const counts = response
                ? await countCandidatesForResponse(tx, params.archiveId, response.id)
                : { total: 0, pending: 0 };
              return toInboxQuestion(row, response, counts);
            }),
          );
          return { questions };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // Answering, declining, deferring
  // -------------------------------------------------------------------------
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/family-questions/:questionId/respond',
    tag: 'family',
    summary: 'Answer, decline or come back to it later',
    description:
      'Answering promotes what you said to a source, so it can be cited, exported and deleted ' +
      'like anything else — and produces suggestions for you to review. Nothing is added to ' +
      'the archive until you approve it. Declining tells the asker only that the question is ' +
      'closed; your reason stays with you.',
    auth: 'required',
    params: questionParams,
    body: respondToFamilyQuestionRequestSchema,
    response: z.object({ question: familyQuestionSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: body.kind === 'answer' ? 'familyQuestion.respond' : 'familyQuestion.decline',
          resource: { type: 'family_question', id: params.questionId },
          auditOnAllow: true,
          auditMetadata: { kind: body.kind },
        },
        async ({ tx, user, decision, subject }) => {
          const question = await findFamilyQuestion(tx, params.archiveId, params.questionId);
          if (!question) throw notFound();
          if (question.status !== 'pending') {
            throw conflict(
              'You have already decided on this question.',
              'question_already_decided',
            );
          }

          if (body.kind !== 'answer') {
            const response = await insertFamilyQuestionResponse(tx, {
              archiveId: params.archiveId,
              questionId: question.id,
              respondedByUserId: user.id,
              kind: body.kind,
              body: null,
              visibility: 'private',
              restrictedToUserIds: [],
              sensitivity: 'normal',
            });
            await decideFamilyQuestion(tx, {
              archiveId: params.archiveId,
              questionId: question.id,
              status: body.kind === 'decline' ? 'declined' : 'deferred',
              declineReason: body.reason ?? null,
            });
            await ctx.analytics.track('family_question_decided', {
              actorId: user.id,
              archiveId: params.archiveId,
              props: { answered: false, deferred: body.kind === 'defer' },
            });
            const fresh = await findFamilyQuestion(tx, params.archiveId, question.id);
            return {
              question: toInboxQuestion(
                { ...(fresh as FamilyQuestionRow), asked_by_display_name: '' } as never,
                response,
                { total: 0, pending: 0 },
              ),
            };
          }

          if (body.visibility === 'restricted' && (body.restrictedToUserIds ?? []).length === 0) {
            throw validationFailed('Choose at least one person to share this answer with.');
          }

          // An answer that reads like an instruction is still the storyteller's
          // own words and is stored as they wrote it — but it is flagged, so
          // that anything derived from it is treated as data rather than
          // direction downstream.
          const injectionFindings = detectInjection(body.body);

          const response = await insertFamilyQuestionResponse(tx, {
            archiveId: params.archiveId,
            questionId: question.id,
            respondedByUserId: user.id,
            kind: 'answer',
            body: body.body,
            visibility: body.visibility,
            restrictedToUserIds:
              body.visibility === 'restricted' ? (body.restrictedToUserIds ?? []) : [],
            sensitivity: body.sensitivity,
          });

          // The answer becomes a real source, with a real transcript and a real
          // segment, so retrieval, citation opening, export and deletion work
          // on it with no special cases (G-001).
          const { sourceAssetId, segmentId } = await promoteAnswerToSource(tx, {
            archiveId: params.archiveId,
            response,
            question,
            policyVersion: decision.policyVersion,
          });
          await attachAnswerSource(tx, params.archiveId, response.id, sourceAssetId);

          // Suggestions, never facts. The storyteller reviews each one.
          const learning = await resolveLearningForArchive(tx, params.archiveId, subject);
          let candidateCount = 0;
          if (learning.mayExtractCandidates) {
            const extracted = extractCandidates({
              text: body.body,
              allowedCategories: learning.allowedCandidateCategories,
            });
            const learningPolicy = await findCurrentLearningPolicy(tx, params.archiveId);
            const stored = await storeCandidates(tx, {
              archiveId: params.archiveId,
              origin: {
                kind: 'question_answer',
                responseId: response.id,
                sourceAssetId,
                transcriptSegmentId: segmentId,
              },
              candidates: extracted,
              obligations: learning,
              learningPolicyId: learningPolicy?.id ?? null,
              consentPolicyVersion: decision.policyVersion,
            });
            candidateCount = stored.length;
          }

          await decideFamilyQuestion(tx, {
            archiveId: params.archiveId,
            questionId: question.id,
            status: 'answered',
            declineReason: null,
          });

          await ctx.analytics.track('family_question_decided', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: {
              answered: true,
              candidates: candidateCount,
              restricted: body.visibility === 'restricted',
              flagged: injectionFindings.length > 0,
            },
          });

          const fresh = await findFamilyQuestion(tx, params.archiveId, question.id);
          const counts = await countCandidatesForResponse(tx, params.archiveId, response.id);
          return {
            question: toInboxQuestion(
              { ...(fresh as FamilyQuestionRow), asked_by_display_name: '' } as never,
              { ...response, answer_source_asset_id: sourceAssetId },
              counts,
            ),
          };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // Withdrawing
  // -------------------------------------------------------------------------
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/family-questions/:questionId/withdraw',
    tag: 'family',
    summary: 'Take back a question you asked',
    auth: 'required',
    params: questionParams,
    body: z.object({}),
    response: z.object({ question: askedQuestionSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'familyQuestion.withdraw',
          resource: { type: 'family_question', id: params.questionId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const question = await findFamilyQuestion(tx, params.archiveId, params.questionId);
          // Reported as missing rather than forbidden: confirming that somebody
          // else's question exists is itself a disclosure.
          if (!question || question.asked_by_user_id !== user.id) throw notFound();
          if (question.status !== 'pending') {
            throw conflict('This question has already been decided.', 'question_already_decided');
          }
          const updated = await decideFamilyQuestion(tx, {
            archiveId: params.archiveId,
            questionId: question.id,
            status: 'withdrawn',
            declineReason: null,
          });
          return { question: toAskedQuestion(updated ?? question, null) };
        },
      ),
  });
}

// ---------------------------------------------------------------------------
// Promotion, views and visibility
// ---------------------------------------------------------------------------

/**
 * The answer, as a source.
 *
 * Structurally identical to an uploaded recording or a conversation: a
 * `source_asset`, a `transcript`, a `transcript_segment`. Nothing goes to
 * object storage — the words live in `family_question_response` and are
 * mirrored here so a citation resolves, which avoids duplicating memory content
 * into a second store that deletion would then have to find.
 */
async function promoteAnswerToSource(
  tx: Transaction,
  input: {
    archiveId: string;
    response: FamilyQuestionResponseRow;
    question: FamilyQuestionRow;
    policyVersion: string;
  },
): Promise<{ sourceAssetId: string; segmentId: string | null }> {
  const storageKey = `question-answer/${input.response.id}`;
  const stamp = input.response.created_at.toISOString().slice(0, 16).replace('T', ' ');

  const source = await tx.one<{ id: string }>(
    `INSERT INTO source_asset
       (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
        scan_result, privacy, processing_stage, processed_at, sensitivity)
     VALUES ($1,'text','processed',$2,'text/plain',0,$3,'clean',$4,'ready', now(), $5)
     RETURNING id`,
    [
      input.archiveId,
      `Answer to a family question — ${stamp}`,
      storageKey,
      JSON.stringify({ excluded: false, note: 'Answer given to a family question.' }),
      input.response.sensitivity,
    ],
  );

  const transcript = await tx.one<{ id: string }>(
    `INSERT INTO transcript
       (archive_id, source_asset_id, provider, model_version, prompt_version, language,
        status, method, policy_version, completed_at)
     VALUES ($1,$2,'everecho-answer','v1','family-question-v1','en','ready','typed',$3, now())
     RETURNING id`,
    [input.archiveId, source.id, input.policyVersion],
  );

  const segment = await tx.one<{ id: string }>(
    `INSERT INTO transcript_segment (archive_id, transcript_id, idx, text)
     VALUES ($1,$2,0,$3) RETURNING id`,
    [input.archiveId, transcript.id, input.response.body ?? ''],
  );

  return { sourceAssetId: source.id, segmentId: segment.id };
}

/** The learning policy, intersected with consent as the ceiling. */
async function resolveLearningForArchive(
  tx: Transaction,
  archiveId: string,
  subject: { policy: { document: { activities: string[] } } | null },
): Promise<LearningObligations> {
  const row = await findCurrentLearningPolicy(tx, archiveId);
  const activities = subject.policy?.document.activities ?? [];
  return resolveLearningObligations({
    document: row ? toLearningPolicy(row).document : null,
    expired: false,
    consentAllowsProviderTranscription: activities.includes('transcription'),
    consentAllowsProviderGeneration: activities.includes('generation'),
    consentAllowsEmbedding: activities.includes('indexing'),
    consentDataCategories: [],
  });
}

/**
 * Whether this asker may see this answer.
 *
 * The response's own visibility narrows what the archive's consent already
 * permits; it can never widen it, and the recipient grant was already applied
 * by `authorize()` before this runs (G-005).
 */
async function visibleToAsker(
  tx: Transaction,
  response: FamilyQuestionResponseRow,
  askerUserId: string,
): Promise<boolean> {
  void tx;
  if (response.kind !== 'answer') return false;
  switch (response.visibility) {
    case 'private':
      return false;
    case 'asker_only':
    case 'all_authorised':
      return true;
    case 'restricted':
      return response.restricted_to_user_ids.includes(askerUserId);
  }
}

async function sourceLabel(
  tx: Transaction,
  archiveId: string,
  sourceAssetId: string | null,
): Promise<string | null> {
  if (!sourceAssetId) return null;
  const row = await tx.maybeOne<{ original_filename: string }>(
    `SELECT original_filename FROM source_asset WHERE archive_id = $1 AND id = $2`,
    [archiveId, sourceAssetId],
  );
  return row?.original_filename ?? null;
}

function toInboxQuestion(
  row: FamilyQuestionRow & { asked_by_display_name: string },
  response: FamilyQuestionResponseRow | null,
  counts: { total: number; pending: number },
) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    askedByUserId: row.asked_by_user_id,
    askedByDisplayName: row.asked_by_display_name || 'A family member',
    body: row.body,
    topic: row.topic,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    // Storyteller-only, and only ever reached through the inbox route.
    declineReason: row.decline_reason,
    response: response
      ? {
          id: response.id,
          kind: response.kind,
          body: response.body,
          visibility: response.visibility,
          sensitivity: response.sensitivity,
          createdAt: response.created_at.toISOString(),
          sourceId: response.answer_source_asset_id,
          candidateCount: counts.total,
          pendingCandidateCount: counts.pending,
        }
      : null,
  };
}

/**
 * The asker's view.
 *
 * Carries no decline reason, no visibility, no sensitivity and no candidate
 * counts. A private answer is indistinguishable from a decline here, because
 * to the person who asked it is one.
 */
function toAskedQuestion(
  row: Pick<FamilyQuestionRow, 'id' | 'body' | 'topic' | 'status' | 'created_at' | 'decided_at'>,
  response: FamilyQuestionResponseRow | null,
  label: string | null = null,
) {
  const answered = response?.kind === 'answer' && response.body !== null;
  return {
    id: row.id,
    body: row.body,
    topic: row.topic,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    answeredAt: answered ? (row.decided_at?.toISOString() ?? null) : null,
    answer:
      answered && response.answer_source_asset_id
        ? {
            body: response.body as string,
            sourceId: response.answer_source_asset_id,
            sourceLabel: label ?? 'Answer to a family question',
            answeredAt: response.created_at.toISOString(),
          }
        : null,
  };
}
