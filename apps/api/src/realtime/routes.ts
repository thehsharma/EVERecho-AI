import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  approveCandidateRequestSchema,
  correctTurnRequestSchema,
  createRealtimeSessionRequestSchema,
  interactionPreferenceSchema,
  learningPolicySchema,
  learningSummarySchema,
  memoryCandidateSchema,
  patchCandidateRequestSchema,
  putInteractionPreferenceRequestSchema,
  realtimeSessionSchema,
  realtimeTurnSchema,
  realtimeUsageSchema,
  reconnectTokenSchema,
  rejectCandidateRequestSchema,
  updateLearningPolicyRequestSchema,
} from '@everecho/contracts';
import {
  LearningPolicyError,
  compileLearningPolicy,
  defaultLearningDocument,
  diffLearningPolicies,
  isLowRiskPreference,
} from '@everecho/consent';
import {
  deleteInteractionPreference,
  findCandidate,
  findCurrentLearningPolicy,
  findSession,
  insertLearningPolicyVersion,
  listCandidateEvidence,
  listInteractionPreferences,
  listPendingCandidates,
  listTurns,
  mintReconnectToken,
  readUsage,
  recordLearningDecision,
  revokeReconnectTokens,
  upsertInteractionPreference,
} from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, notFound, validationFailed } from '../errors';
import type { AppContext } from '../context';
import { applyTransition, createStreamingProviders, usesExternalProvider } from './engine';
import { approveCandidate } from './approval';
import {
  toCandidateView,
  toLearningPolicyView,
  toPreferenceView,
  toSessionView,
  toTurnView,
} from './views';
import { ASSISTANT_IDENTITY } from './orchestrator';
import { summariseSession } from './summary';

const archiveParams = z.object({ archiveId: z.uuid() });
const sessionParams = archiveParams.extend({ sessionId: z.uuid() });
const candidateParams = archiveParams.extend({ candidateId: z.uuid() });

/** Short. A reconnect token is for resuming a dropped socket, not for later. */
const RECONNECT_TTL_SECONDS = 120;

export function registerRealtimeRoutes(app: FastifyInstance, ctx: AppContext): void {
  const providers = createStreamingProviders(ctx);
  const usesProvider = usesExternalProvider(providers);

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/realtime-sessions',
    tag: 'realtime',
    summary: 'Start a live conversation',
    description:
      'Interview mode is the storyteller being interviewed; assistant mode is an authorised ' +
      'reader asking the archive questions. The assistant identifies itself as AI, speaks in a ' +
      'generic voice that is never the storyteller’s, and abstains when the evidence does not ' +
      'support an answer.',
    auth: 'required',
    params: archiveParams,
    body: createRealtimeSessionRequestSchema,
    status: 201,
    response: z.object({ session: realtimeSessionSchema }),
    handler: async ({ params, body, request }) => {
      const action =
        body.mode === 'interview' ? 'realtime.interview.start' : 'realtime.assistant.start';

      return withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action,
          resource: { type: 'realtime_session' },
          auditOnAllow: true,
          usesProvider,
          auditMetadata: { mode: body.mode, language: body.language, textOnly: body.textOnly },
        },
        async ({ tx, decision, archive, user }) => {
          const learningRow = await findCurrentLearningPolicy(tx, params.archiveId);
          const learning = decision.obligations.learning;

          const { insertSession } = await import('@everecho/db');
          const row = await insertSession(tx, {
            archiveId: params.archiveId,
            mode: body.mode,
            language: body.language,
            textOnly: body.textOnly,
            startedByUserId: user.id,
            consentPolicyVersion: decision.policyVersion,
            learningPolicyId: learningRow?.id ?? null,
            learningPolicyVersion: learningRow?.version ?? null,
            capabilities: {
              mayStoreTranscript: learning.mayStoreTranscript,
              mayStoreAudio: learning.mayStoreAudio,
              mayExtractCandidates: learning.mayExtractCandidates,
              mayUseProviderSpeechToText: learning.mayUseProviderSpeechToText,
              mayUseProviderSpeechSynthesis: learning.mayUseProviderSpeechSynthesis,
              mayUseProviderComposition: learning.mayUseProviderComposition,
              mayAutoSavePreferences: learning.mayAutoSavePreferences,
            },
            ttsProvider: providers.tts.capabilities.name,
            ttsVoiceId: providers.tts.voiceId,
            limitToSourceIds: body.sourceIds ?? [],
          });

          await tx.query(
            `INSERT INTO realtime_session_participant (archive_id, session_id, user_id, role)
             VALUES ($1,$2,$3,$4)`,
            [
              params.archiveId,
              row.id,
              user.id,
              decision.obligations.mustAudit ? 'primary' : 'primary',
            ],
          );

          await ctx.analytics.track('realtime_session_started', {
            actorId: user.id,
            archiveId: params.archiveId,
            // A boolean, because the analytics schema admits only numbers,
            // booleans and a fixed severity enum. Free-text properties are the
            // route by which memory content reaches an analytics store, so the
            // contract does not have them.
            props: { interview: body.mode === 'interview' },
          });

          void archive;
          return { session: toSessionView(row) };
        },
      );
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId',
    tag: 'realtime',
    summary: 'Read a conversation’s current state',
    auth: 'required',
    params: sessionParams,
    response: z.object({ session: realtimeSessionSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'realtime.session.read',
          resource: { type: 'realtime_session', id: params.sessionId },
        },
        async ({ tx }) => {
          const row = await findSession(tx, params.archiveId, params.sessionId);
          if (!row) throw notFound();
          return { session: toSessionView(row) };
        },
      ),
  });

  for (const [suffix, trigger, summary] of [
    ['pause', 'PAUSE', 'Pause a live conversation'],
    ['resume', 'RESUME', 'Resume a paused conversation'],
  ] as const) {
    defineRoute(app, ctx, {
      method: 'POST',
      url: `/v1/archives/:archiveId/realtime-sessions/:sessionId/${suffix}`,
      tag: 'realtime',
      summary,
      description: 'Pause and exit are always available, and never require a reason.',
      auth: 'required',
      params: sessionParams,
      body: z.object({}).optional(),
      response: z.object({ session: realtimeSessionSchema }),
      handler: async ({ params, request }) =>
        withArchiveAccess(
          ctx,
          request,
          {
            archiveId: params.archiveId,
            action: 'realtime.session.connect',
            resource: { type: 'realtime_session', id: params.sessionId },
          },
          async ({ tx }) => {
            const row = await findSession(tx, params.archiveId, params.sessionId);
            if (!row) throw notFound();
            const { session } = await applyTransition(tx, row, trigger);
            return { session: toSessionView(session) };
          },
        ),
    });
  }

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId/end',
    tag: 'realtime',
    summary: 'End a conversation',
    description:
      'Ends the session, revokes its reconnect tokens, and produces a summary of what was heard ' +
      'and what is waiting for review. Nothing is approved by ending a session.',
    auth: 'required',
    params: sessionParams,
    body: z.object({ reason: z.string().max(120).optional() }).optional(),
    response: z.object({
      session: realtimeSessionSchema,
      summary: learningSummarySchema.nullable(),
    }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'realtime.session.end',
          resource: { type: 'realtime_session', id: params.sessionId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const row = await findSession(tx, params.archiveId, params.sessionId);
          if (!row) throw notFound();

          const ending = await applyTransition(tx, row, 'END', {
            endedReason: body?.reason ?? 'user_ended',
          });
          const ended = await applyTransition(tx, ending.session, 'ENDED', {
            endedReason: body?.reason ?? 'user_ended',
          });

          // A token minted before the session ended must not resume it.
          await revokeReconnectTokens(tx, params.archiveId, params.sessionId);

          const summary = await summariseSession(tx, {
            archiveId: params.archiveId,
            sessionId: params.sessionId,
          });

          return { session: toSessionView(ended.session), summary };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId/reconnect-token',
    tag: 'realtime',
    summary: 'Mint a short-lived token for resuming a dropped connection',
    description:
      'Bound to this actor, archive, session and mode, single-use, and valid for two minutes. ' +
      'Stored hashed, so a leaked database row is not a usable credential.',
    auth: 'required',
    params: sessionParams,
    body: z.object({}).optional(),
    response: z.object({ reconnect: reconnectTokenSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'realtime.session.connect',
          resource: { type: 'realtime_session', id: params.sessionId },
        },
        async ({ tx, user }) => {
          const row = await findSession(tx, params.archiveId, params.sessionId);
          if (!row) throw notFound();
          if (row.ended_at)
            throw conflict('This conversation has ended.', 'realtime_session_not_live');

          const minted = await mintReconnectToken(tx, {
            archiveId: params.archiveId,
            sessionId: params.sessionId,
            userId: user.id,
            mode: row.mode,
            ttlSeconds: RECONNECT_TTL_SECONDS,
          });
          return {
            reconnect: { token: minted.token, expiresAt: minted.expiresAt.toISOString() },
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId/turns',
    tag: 'realtime',
    summary: 'The conversation transcript',
    description:
      'Partial and cancelled turns are marked as such. Only final, uncancelled turns are ever ' +
      'eligible to become evidence.',
    auth: 'required',
    params: sessionParams,
    response: z.object({ turns: z.array(realtimeTurnSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'realtime.turn.read',
          resource: { type: 'realtime_turn' },
        },
        async ({ tx }) => {
          const rows = await listTurns(tx, params.archiveId, params.sessionId);
          return { turns: rows.map(toTurnView) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId/turns/:turnId/corrections',
    tag: 'realtime',
    summary: 'Correct what a transcript says',
    description:
      'Creates a new revision rather than overwriting. What someone actually said and what they ' +
      'later clarified are two different facts, and the archive keeps both.',
    auth: 'required',
    params: sessionParams.extend({ turnId: z.uuid() }),
    body: correctTurnRequestSchema,
    response: z.object({ turn: realtimeTurnSchema, revision: z.number().int() }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'realtime.turn.correct',
          resource: { type: 'realtime_turn', id: params.turnId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const turns = await listTurns(tx, params.archiveId, params.sessionId);
          const turn = turns.find((t) => t.id === params.turnId);
          if (!turn) throw notFound();

          const revision = await tx.one<{ revision: number }>(
            `INSERT INTO transcript_revision
               (archive_id, turn_id, revision, text, reason, corrected_by_user_id)
             VALUES ($1,$2,
               coalesce((SELECT max(revision) FROM transcript_revision WHERE turn_id = $2), 0) + 1,
               $3,$4,$5)
             RETURNING revision`,
            [params.archiveId, params.turnId, body.text, body.reason ?? null, user.id],
          );

          const updated = await tx.one(
            `UPDATE realtime_turn SET text = $3 WHERE archive_id = $1 AND id = $2 RETURNING *`,
            [params.archiveId, params.turnId, body.text],
          );

          return { turn: toTurnView(updated as never), revision: revision.revision };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId/usage',
    tag: 'realtime',
    summary: 'What this conversation cost',
    description: 'Provider usage and estimated cost. Carries no memory content.',
    auth: 'required',
    params: sessionParams,
    response: z.object({ usage: realtimeUsageSchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'realtime.session.read',
          resource: { type: 'realtime_session', id: params.sessionId },
        },
        async ({ tx }) => {
          const row = await readUsage(tx, params.archiveId, params.sessionId);
          if (!row) return { usage: null };
          return {
            usage: {
              sessionId: params.sessionId,
              sttSeconds: Number(row.stt_seconds),
              ttsCharacters: row.tts_characters,
              llmInputTokens: row.llm_input_tokens,
              llmOutputTokens: row.llm_output_tokens,
              transportSeconds: Number(row.transport_seconds),
              storedAudioBytes: Number(row.stored_audio_bytes),
              estimatedCostMinor: row.estimated_cost_minor,
              currency: row.currency,
            },
          };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // Candidates
  // -------------------------------------------------------------------------

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/realtime-sessions/:sessionId/candidates',
    tag: 'learning',
    summary: 'What the conversation suggested, awaiting review',
    description:
      'Proposals, never facts. Each carries the exact turn it came from, and nothing here is ' +
      'visible to family or reachable by search until the storyteller approves it.',
    auth: 'required',
    params: sessionParams,
    response: z.object({ candidates: z.array(memoryCandidateSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.candidate.read',
          resource: { type: 'memory_candidate' },
        },
        async ({ tx }) => {
          const rows = await listPendingCandidates(tx, params.archiveId, {
            sessionId: params.sessionId,
            limit: 100,
          });
          const evidence = await listCandidateEvidence(
            tx,
            rows.map((r) => r.id),
          );
          return { candidates: rows.map((r) => toCandidateView(r, evidence)) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/memory-candidates',
    tag: 'learning',
    summary: 'Everything awaiting the storyteller’s review',
    auth: 'required',
    params: archiveParams,
    response: z.object({ candidates: z.array(memoryCandidateSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.candidate.read',
          resource: { type: 'memory_candidate' },
        },
        async ({ tx }) => {
          const rows = await listPendingCandidates(tx, params.archiveId, { limit: 200 });
          const evidence = await listCandidateEvidence(
            tx,
            rows.map((r) => r.id),
          );
          return { candidates: rows.map((r) => toCandidateView(r, evidence)) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PATCH',
    url: '/v1/archives/:archiveId/memory-candidates/:candidateId',
    tag: 'learning',
    summary: 'Edit a suggestion before deciding on it',
    auth: 'required',
    params: candidateParams,
    body: patchCandidateRequestSchema,
    response: z.object({ candidate: memoryCandidateSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.candidate.edit',
          resource: { type: 'memory_candidate', id: params.candidateId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const existing = await findCandidate(tx, params.archiveId, params.candidateId);
          if (!existing) throw notFound();
          if (existing.status !== 'pending') {
            throw conflict('This suggestion has already been decided.', 'candidate_not_pending');
          }

          const updated = await tx.one(
            `UPDATE memory_candidate
                SET title = coalesce($3, title),
                    body = coalesce($4, body),
                    occurred_on_value = coalesce($5, occurred_on_value),
                    occurred_on_precision = coalesce($6, occurred_on_precision),
                    topics = coalesce($7, topics),
                    entity_names = coalesce($8, entity_names),
                    place_name = coalesce($9, place_name),
                    sensitivity = coalesce($10, sensitivity)
              WHERE archive_id = $1 AND id = $2
              RETURNING *`,
            [
              params.archiveId,
              params.candidateId,
              body.title ?? null,
              body.body ?? null,
              body.occurredOn?.value ?? null,
              body.occurredOn?.precision ?? null,
              body.topics ?? null,
              body.entityNames ?? null,
              body.placeName ?? null,
              body.sensitivity ?? null,
            ],
          );
          const evidence = await listCandidateEvidence(tx, [params.candidateId]);
          return { candidate: toCandidateView(updated as never, evidence) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/memory-candidates/:candidateId/approve',
    tag: 'learning',
    summary: 'Approve a suggestion into the archive',
    description:
      'The moment a conversation becomes family history. Creates a real memory with its claim ' +
      'and evidence, queues embedding so retrieval reflects it, and records who decided.',
    auth: 'required',
    params: candidateParams,
    body: approveCandidateRequestSchema,
    response: z.object({ memoryId: z.string(), candidate: memoryCandidateSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.candidate.approve',
          resource: { type: 'memory_candidate', id: params.candidateId },
          auditOnAllow: true,
        },
        async ({ tx, decision, user }) => {
          const result = await approveCandidate(ctx, tx, {
            archiveId: params.archiveId,
            candidateId: params.candidateId,
            userId: user.id,
            keepPrivate: body.keepPrivate,
            note: body.note ?? null,
            policyVersion: decision.policyVersion,
          });
          const evidence = await listCandidateEvidence(tx, [params.candidateId]);
          return {
            memoryId: result.memoryId,
            candidate: toCandidateView(result.candidate, evidence),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/memory-candidates/:candidateId/reject',
    tag: 'learning',
    summary: 'Reject a suggestion',
    description: 'Rejected material never reaches the archive and is never retried.',
    auth: 'required',
    params: candidateParams,
    body: rejectCandidateRequestSchema,
    response: z.object({ candidate: memoryCandidateSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.candidate.reject',
          resource: { type: 'memory_candidate', id: params.candidateId },
          auditOnAllow: true,
        },
        async ({ tx, decision, user }) => {
          const existing = await findCandidate(tx, params.archiveId, params.candidateId);
          if (!existing) throw notFound();
          if (existing.status !== 'pending') {
            throw conflict('This suggestion has already been decided.', 'candidate_not_pending');
          }

          const updated = await tx.one(
            `UPDATE memory_candidate
                SET status = 'rejected', reviewed_by_user_id = $3, reviewed_at = now(),
                    review_note = $4
              WHERE archive_id = $1 AND id = $2
              RETURNING *`,
            [params.archiveId, params.candidateId, user.id, body.note ?? null],
          );

          await recordLearningDecision(tx, {
            archiveId: params.archiveId,
            candidateId: params.candidateId,
            sessionId: existing.session_id,
            decision: 'rejected',
            decidedByUserId: user.id,
            consentPolicyVersion: decision.policyVersion,
            note: body.note ?? null,
          });

          const evidence = await listCandidateEvidence(tx, [params.candidateId]);
          return { candidate: toCandidateView(updated as never, evidence) };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // Learning policy
  // -------------------------------------------------------------------------

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/learning-policy',
    tag: 'learning',
    summary: 'What a conversation may be used for',
    description:
      'Separate from consent, which governs material already given. This governs what a ' +
      'conversation may become. Consent remains the ceiling over it.',
    auth: 'required',
    params: archiveParams,
    response: z.object({
      policy: learningPolicySchema.nullable(),
      defaultDocument: learningPolicySchema.shape.document,
      assistantIdentity: z.string(),
    }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.policy.read',
          resource: { type: 'learning_policy' },
        },
        async ({ tx }) => {
          const row = await findCurrentLearningPolicy(tx, params.archiveId);
          return {
            policy: row ? toLearningPolicyView(row) : null,
            defaultDocument: defaultLearningDocument(),
            assistantIdentity: ASSISTANT_IDENTITY,
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PUT',
    url: '/v1/archives/:archiveId/learning-policy',
    tag: 'learning',
    summary: 'Change what a conversation may be used for',
    description:
      'Writes a new version; nothing agreed to before is erased. Narrowing takes effect on the ' +
      'next authorisation check, which is every request, including work already in flight.',
    auth: 'required',
    params: archiveParams,
    body: updateLearningPolicyRequestSchema,
    response: z.object({ policy: learningPolicySchema, changes: z.array(z.string()) }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'learning.policy.update',
          resource: { type: 'learning_policy' },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          let compiled;
          try {
            compiled = compileLearningPolicy(body.document);
          } catch (error) {
            if (error instanceof LearningPolicyError) {
              throw validationFailed(
                error.message,
                error.issues.map((issue) => ({ path: 'document', message: issue })),
              );
            }
            throw error;
          }

          const previous = await findCurrentLearningPolicy(tx, params.archiveId);
          const row = await insertLearningPolicyVersion(tx, {
            archiveId: params.archiveId,
            document: compiled.document,
            policyHash: compiled.policyHash,
            policyEngineVersion: ctx.branding.policyEngineVersion,
            createdByUserId: user.id,
          });

          // Any narrowing must reach a live session immediately, so tokens
          // minted under the old policy stop working now rather than at expiry.
          await revokeReconnectTokens(tx, params.archiveId, null);

          return {
            policy: toLearningPolicyView(row),
            changes: diffLearningPolicies(previous?.document ?? null, compiled.document),
          };
        },
      ),
  });

  // -------------------------------------------------------------------------
  // Interaction preferences — per user, not per archive
  // -------------------------------------------------------------------------

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/me/interaction-preferences',
    tag: 'learning',
    summary: 'Interface preferences remembered for you',
    description:
      'Only interface preferences are ever kept this way: language, captions, pace. Nothing ' +
      'about anyone’s life is remembered without their review.',
    auth: 'required',
    response: z.object({ preferences: z.array(interactionPreferenceSchema) }),
    handler: async ({ user }) => {
      if (!user) throw notFound();
      const rows = await listInteractionPreferences(ctx.db, user.id);
      return { preferences: rows.map(toPreferenceView) };
    },
  });

  defineRoute(app, ctx, {
    method: 'PUT',
    url: '/v1/me/interaction-preferences',
    tag: 'learning',
    summary: 'Set an interface preference',
    auth: 'required',
    body: putInteractionPreferenceRequestSchema,
    response: z.object({ preference: interactionPreferenceSchema }),
    handler: async ({ body, user }) => {
      if (!user) throw notFound();
      // Checked here, and again by a CHECK constraint in the database. A bug in
      // this route cannot persist a key the policy does not name.
      if (!isLowRiskPreference(body.key)) {
        throw validationFailed('That is not something EverEcho remembers this way.', [
          { path: 'key', message: 'Only interface preferences can be stored here.' },
        ]);
      }
      const row = await upsertInteractionPreference(ctx.db, {
        userId: user.id,
        key: body.key,
        value: body.value,
        origin: 'explicit',
      });
      return { preference: toPreferenceView(row) };
    },
  });

  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/me/interaction-preferences/:preferenceId',
    tag: 'learning',
    summary: 'Forget an interface preference',
    auth: 'required',
    params: z.object({ preferenceId: z.uuid() }),
    response: z.object({ deleted: z.boolean() }),
    handler: async ({ params, user }) => {
      if (!user) throw notFound();
      const deleted = await deleteInteractionPreference(ctx.db, user.id, params.preferenceId);
      return { deleted };
    },
  });
}
