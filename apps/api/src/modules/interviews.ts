import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  answerInterviewPromptRequestSchema,
  interviewSessionSchema,
  startInterviewRequestSchema,
} from '@everecho/contracts';
import {
  INTERVIEW_PROMPT_VERSION,
  SAFETY_MESSAGE,
  detectsDistress,
  emergencyResourcesFor,
} from '@everecho/ai';
import { enqueueJob, findCurrentPolicy } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound } from '../errors';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });
const sessionParams = archiveParams.extend({ sessionId: z.uuid() });

interface SessionRow {
  id: string;
  archive_id: string;
  mode: 'text' | 'audio';
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  started_at: Date;
  ended_at: Date | null;
  summary_text: string | null;
  summary_approved: boolean;
  safety_notice_shown_at: Date | null;
}

export function registerInterviewRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/interviews',
    tag: 'interviews',
    summary: 'Begin a guided interview',
    auth: 'required',
    params: archiveParams,
    body: startInterviewRequestSchema,
    response: z.object({ session: interviewSessionSchema }),
    status: 201,
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'interview.start',
          resource: { type: 'interview_session' },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const session = await tx.one<SessionRow>(
            `INSERT INTO interview_session (archive_id, mode, created_by_user_id, prompt_version)
             VALUES ($1, $2, $3, $4) RETURNING *`,
            [params.archiveId, body.mode, user.id, INTERVIEW_PROMPT_VERSION],
          );
          const prompt = await nextPrompt(ctx, tx, params.archiveId, session.id, null);
          await ctx.analytics.track('interview_started', {
            actorId: user.id,
            archiveId: params.archiveId,
          });
          return { session: await toSession(tx, session, prompt) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/interviews/:sessionId',
    tag: 'interviews',
    summary: 'An interview session and its current question',
    auth: 'required',
    params: sessionParams,
    response: z.object({ session: interviewSessionSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'interview.read',
          resource: { type: 'interview_session', id: params.sessionId },
        },
        async ({ tx }) => {
          const session = await tx.maybeOne<SessionRow>(
            `SELECT * FROM interview_session WHERE id = $1 AND archive_id = $2`,
            [params.sessionId, params.archiveId],
          );
          if (!session) throw notFound('That session was not found.');
          const current = await tx.maybeOne<PromptRow>(
            `SELECT p.* FROM interview_prompt p
             LEFT JOIN interview_response r ON r.interview_prompt_id = p.id
             WHERE p.interview_session_id = $1 AND r.id IS NULL
             ORDER BY p.idx LIMIT 1`,
            [params.sessionId],
          );
          return { session: await toSession(tx, session, current) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/interviews/:sessionId/answer',
    tag: 'interviews',
    summary: 'Answer, skip, decline or pause',
    description:
      'Every question can be skipped, and "I would rather not answer" is recorded as a choice ' +
      'rather than a gap to be chased. If the answer contains language suggesting the ' +
      'storyteller is in danger, the interview stops and region-appropriate emergency ' +
      'information is returned instead of a next question.',
    auth: 'required',
    params: sessionParams,
    body: answerInterviewPromptRequestSchema,
    response: z.object({ session: interviewSessionSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'interview.answer',
          resource: { type: 'interview_session', id: params.sessionId },
          auditMetadata: { action: body.action },
        },
        async ({ tx }) => {
          const session = await tx.maybeOne<SessionRow>(
            `SELECT * FROM interview_session WHERE id = $1 AND archive_id = $2 FOR UPDATE`,
            [params.sessionId, params.archiveId],
          );
          if (!session) throw notFound('That session was not found.');

          await tx.query(
            `INSERT INTO interview_response (archive_id, interview_session_id, interview_prompt_id,
                                             response_text, source_asset_id, action)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (interview_prompt_id) DO UPDATE SET
               response_text = EXCLUDED.response_text,
               source_asset_id = EXCLUDED.source_asset_id,
               action = EXCLUDED.action`,
            [
              params.archiveId,
              session.id,
              body.promptId,
              body.responseText ?? null,
              body.sourceAssetId ?? null,
              body.action,
            ],
          );

          // Safety comes before the interview. Nothing about what was said is
          // stored in the safety record — only that the moment happened.
          if (body.responseText && detectsDistress(body.responseText)) {
            await tx.query(
              `UPDATE interview_session SET status = 'paused', safety_notice_shown_at = now() WHERE id = $1`,
              [session.id],
            );
            await tx.query(
              `INSERT INTO safety_event (archive_id, kind, severity, context)
               VALUES ($1, 'distress_language', 'high', $2)`,
              [params.archiveId, JSON.stringify({ stage: 'interview', region: ctx.cfg.env.SAFETY_EMERGENCY_INFO_REGION })],
            );
            await ctx.analytics.track('safety_incident', { archiveId: params.archiveId });
            const paused = await tx.one<SessionRow>(
              `SELECT * FROM interview_session WHERE id = $1`,
              [session.id],
            );
            return { session: await toSession(tx, paused, null) };
          }

          if (body.action === 'pause') {
            const paused = await tx.one<SessionRow>(
              `UPDATE interview_session SET status = 'paused' WHERE id = $1 RETURNING *`,
              [session.id],
            );
            return { session: await toSession(tx, paused, null) };
          }

          const prompt = await nextPrompt(ctx, tx, params.archiveId, session.id, body.responseText ?? null);
          return { session: await toSession(tx, session, prompt) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/interviews/:sessionId/finish',
    tag: 'interviews',
    summary: 'End the session and draft a correctable summary',
    description:
      'The summary is a draft in the storyteller’s own words, quoted. It becomes part of the ' +
      'archive only when they approve it.',
    auth: 'required',
    params: sessionParams,
    response: z.object({ session: interviewSessionSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'interview.answer',
          resource: { type: 'interview_session', id: params.sessionId },
        },
        async ({ tx, archive, user }) => {
          const responses = await tx.query<{ response_text: string | null }>(
            `SELECT response_text FROM interview_response
             WHERE interview_session_id = $1 AND action = 'answer' AND response_text IS NOT NULL
             ORDER BY created_at`,
            [params.sessionId],
          );
          const summary = await ctx.llm.summariseSession({
            responses: responses.map((r) => r.response_text ?? ''),
            subjectName: archive.subject_display_name,
          });
          const session = await tx.one<SessionRow>(
            `UPDATE interview_session SET status = 'completed', ended_at = now(), summary_text = $2
             WHERE id = $1 AND archive_id = $3 RETURNING *`,
            [params.sessionId, summary, params.archiveId],
          );
          await ctx.analytics.track('interview_completed', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { answered: responses.length },
          });
          return { session: await toSession(tx, session, null) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/interviews/:sessionId/approve-summary',
    tag: 'interviews',
    summary: 'Approve the session summary, turning answers into story cards',
    auth: 'required',
    params: sessionParams,
    body: z.object({ summaryText: z.string().max(20_000).optional() }),
    response: z.object({ session: interviewSessionSchema, memoriesCreated: z.number().int() }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'interview.summary.approve',
          resource: { type: 'interview_session', id: params.sessionId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const session = await tx.one<SessionRow>(
            `UPDATE interview_session
             SET summary_approved = true, summary_text = coalesce($2, summary_text)
             WHERE id = $1 AND archive_id = $3 RETURNING *`,
            [params.sessionId, body.summaryText ?? null, params.archiveId],
          );

          // Typed answers become candidate story cards with the answer itself
          // as the evidence: the storyteller wrote it, so it is a direct statement.
          const answers = await tx.query<{ id: string; response_text: string; question_text: string }>(
            `SELECT r.id, r.response_text, p.question_text
             FROM interview_response r JOIN interview_prompt p ON p.id = r.interview_prompt_id
             WHERE r.interview_session_id = $1 AND r.action = 'answer'
               AND r.response_text IS NOT NULL AND length(r.response_text) > 20`,
            [params.sessionId],
          );

          let created = 0;
          for (const answer of answers) {
            const existing = await tx.maybeOne(
              `SELECT 1 AS present FROM memory WHERE archive_id = $1 AND body = $2`,
              [params.archiveId, answer.response_text],
            );
            if (existing) continue;

            const memory = await tx.one<{ id: string }>(
              `INSERT INTO memory (archive_id, title, body, status, origin, evidence_class)
               VALUES ($1, $2, $3, 'candidate', 'interview', 'P1_DIRECT_STATEMENT') RETURNING id`,
              [params.archiveId, answer.question_text.slice(0, 200), answer.response_text],
            );
            const claim = await tx.one<{ id: string }>(
              `INSERT INTO claim (archive_id, memory_id, text, evidence_class, status)
               VALUES ($1, $2, $3, 'P1_DIRECT_STATEMENT', 'candidate') RETURNING id`,
              [params.archiveId, memory.id, answer.response_text.slice(0, 2000)],
            );
            await tx.query(
              `INSERT INTO provenance_record (archive_id, subject_type, subject_id, record)
               VALUES ($1, 'interview_claim', $2, $3)`,
              [
                params.archiveId,
                claim.id,
                JSON.stringify({ interviewResponseId: answer.id, question: answer.question_text }),
              ],
            );
            created += 1;
          }
          return { session: await toSession(tx, session, null), memoriesCreated: created };
        },
      ),
  });
}

interface PromptRow {
  id: string;
  idx: number;
  topic: string;
  question_text: string;
  prompt_version: string;
}

/** Chooses and stores the next question, honouring restricted topics. */
async function nextPrompt(
  ctx: AppContext,
  tx: Parameters<typeof findCurrentPolicy>[0],
  archiveId: string,
  sessionId: string,
  lastResponseText: string | null,
): Promise<PromptRow> {
  const asked = await tx.query<{ topic: string; question_text: string; idx: number }>(
    `SELECT topic, question_text, idx FROM interview_prompt WHERE interview_session_id = $1 ORDER BY idx`,
    [sessionId],
  );
  const policy = await findCurrentPolicy(tx, archiveId);

  const question = await ctx.llm.nextQuestion({
    coveredTopics: [...new Set(asked.map((a) => a.topic))],
    lastResponseText,
    restrictedTopics: policy?.document.restrictedTopics ?? [],
    askedQuestions: asked.map((a) => a.question_text),
  });

  return tx.one<PromptRow>(
    `INSERT INTO interview_prompt (archive_id, interview_session_id, idx, topic, question_text, prompt_version)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [
      archiveId,
      sessionId,
      (asked.at(-1)?.idx ?? -1) + 1,
      question.topic,
      question.questionText,
      INTERVIEW_PROMPT_VERSION,
    ],
  );
}

async function toSession(
  tx: Parameters<typeof findCurrentPolicy>[0],
  session: SessionRow,
  prompt: PromptRow | null,
) {
  const counts = await tx.one<{ answered: number; skipped: number; topics: string[] }>(
    `SELECT
       count(*) FILTER (WHERE r.action = 'answer')::int AS answered,
       count(*) FILTER (WHERE r.action IN ('skip','prefer_not_to_answer'))::int AS skipped,
       coalesce(array_agg(DISTINCT p.topic) FILTER (WHERE r.action = 'answer'), '{}') AS topics
     FROM interview_response r JOIN interview_prompt p ON p.id = r.interview_prompt_id
     WHERE r.interview_session_id = $1`,
    [session.id],
  );

  const region = process.env.SAFETY_EMERGENCY_INFO_REGION ?? 'IN';
  return {
    id: session.id,
    archiveId: session.archive_id,
    mode: session.mode,
    status: session.status,
    startedAt: session.started_at.toISOString(),
    endedAt: session.ended_at?.toISOString() ?? null,
    promptsAnswered: counts.answered,
    promptsSkipped: counts.skipped,
    topicsCovered: counts.topics as never,
    currentPrompt: prompt
      ? {
          id: prompt.id,
          index: prompt.idx,
          topic: prompt.topic as never,
          questionText: prompt.question_text,
          promptVersion: prompt.prompt_version,
          skippable: true as const,
          sensitivityNotice: null,
        }
      : null,
    summaryText: session.summary_text,
    summaryApproved: session.summary_approved,
    safetyNotice: session.safety_notice_shown_at
      ? {
          shown: true,
          region,
          message: SAFETY_MESSAGE,
          resources: emergencyResourcesFor(region),
        }
      : null,
  };
}
