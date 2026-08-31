import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  consentPolicySchema,
  successionDirectiveSchema,
  teachBackQuestionSchema,
  teachBackResultSchema,
  teachBackSubmissionSchema,
  updateConsentRequestSchema,
  updateSuccessionDirectiveRequestSchema,
} from '@everecho/contracts';
import {
  CONSENT_EXPLANATION,
  ConsentPolicyError,
  TEACH_BACK_QUESTIONS,
  compileConsentPolicy,
  defaultConsentDocument,
  diffPolicies,
  evaluateTeachBack,
} from '@everecho/consent';
import {
  cancelJobsForArchive,
  findCurrentPolicy,
  insertPolicyVersion,
  listConsentRecords,
  listPolicyVersions,
  recordConsentAct,
  toConsentPolicy,
  updateArchiveStatus,
} from '@everecho/db';
import { cacheKeys } from '@everecho/adapters';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, validationFailed } from '../errors';
import { hashIp, userAgentFamily } from '../lib/session';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });

export function registerConsentRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/consent/teach-back',
    tag: 'consent',
    summary: 'The questions a storyteller answers before consenting',
    description:
      'Teach-back, not a checkbox. Correct answers are omitted from this response so the ' +
      'questions cannot be auto-completed by a client.',
    auth: 'none',
    response: z.object({
      explanation: z.object({ heading: z.string(), points: z.array(z.string()) }),
      consentCopyVersion: z.string(),
      questions: z.array(teachBackQuestionSchema.omit({ correctOptionId: true, explanation: true })),
    }),
    handler: async () => ({
      explanation: { heading: CONSENT_EXPLANATION.heading, points: [...CONSENT_EXPLANATION.points] },
      consentCopyVersion: ctx.branding.consentCopyVersion,
      questions: TEACH_BACK_QUESTIONS.map(({ id, prompt, options }) => ({ id, prompt, options })),
    }),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/consent/teach-back',
    tag: 'consent',
    summary: 'Submit teach-back answers',
    description:
      'Every attempt is recorded, passed or not. A wrong answer returns the explanation for it ' +
      'so the storyteller can read it again — this teaches rather than gates.',
    auth: 'required',
    params: archiveParams,
    body: teachBackSubmissionSchema,
    response: z.object({
      result: teachBackResultSchema,
      teaching: z.array(z.object({ questionId: z.string(), explanation: z.string() })),
    }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'consent.teachback.submit',
          resource: { type: 'consent_policy' },
        },
        async ({ tx, user }) => {
          const evaluation = evaluateTeachBack(body.answers);
          const attemptRow = await tx.one<{ attempt: number }>(
            `SELECT coalesce(max(attempt), 0) + 1 AS attempt FROM teach_back_result
             WHERE archive_id = $1 AND user_id = $2`,
            [params.archiveId, user.id],
          );
          const row = await tx.one<{ id: string; created_at: Date }>(
            `INSERT INTO teach_back_result (archive_id, user_id, attempt, answers, passed,
                                            incorrect_question_ids, consent_copy_version)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
            [
              params.archiveId,
              user.id,
              attemptRow.attempt,
              JSON.stringify(body.answers),
              evaluation.passed,
              evaluation.incorrectQuestionIds,
              ctx.branding.consentCopyVersion,
            ],
          );
          await recordConsentAct(tx, {
            archiveId: params.archiveId,
            consentPolicyId: null,
            actorUserId: user.id,
            action: evaluation.passed ? 'teachback_passed' : 'teachback_failed',
            summary: `Teach-back attempt ${attemptRow.attempt}`,
            ipHash: hashIp(request.ip, ctx.cfg.env.SESSION_SECRET),
            userAgentFamily: userAgentFamily(request.headers['user-agent']),
          });
          if (evaluation.passed) {
            await ctx.analytics.track('consent_teachback_completed', {
              actorId: user.id,
              archiveId: params.archiveId,
              props: { attempt: attemptRow.attempt },
            });
          }

          return {
            result: {
              id: row.id,
              passed: evaluation.passed,
              attempt: attemptRow.attempt,
              incorrectQuestionIds: evaluation.incorrectQuestionIds,
              consentCopyVersion: ctx.branding.consentCopyVersion,
              createdAt: row.created_at.toISOString(),
            },
            teaching: evaluation.teaching,
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/consent',
    tag: 'consent',
    summary: 'The consent policy in force',
    auth: 'required',
    params: archiveParams,
    response: z.object({
      policy: consentPolicySchema.nullable(),
      defaultDocument: z.unknown(),
      teachBackPassed: z.boolean(),
    }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'consent.read', resource: { type: 'consent_policy' } },
        async ({ tx, archive }) => {
          const row = await findCurrentPolicy(tx, archive.id);
          const teachBack = await tx.maybeOne<{ passed: boolean }>(
            `SELECT passed FROM teach_back_result
             WHERE archive_id = $1 AND passed = true ORDER BY created_at DESC LIMIT 1`,
            [archive.id],
          );
          return {
            policy: row ? toConsentPolicy(row) : null,
            defaultDocument: defaultConsentDocument(),
            teachBackPassed: teachBack !== null,
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PUT',
    url: '/v1/archives/:archiveId/consent',
    tag: 'consent',
    summary: 'Grant or change consent',
    description:
      'Writes a new, hashed policy version and supersedes the previous one; consent is never ' +
      'updated in place. Narrowing consent takes effect immediately — caches are cleared and ' +
      'queued processing that is no longer permitted is cancelled in the same transaction.',
    auth: 'required',
    params: archiveParams,
    body: updateConsentRequestSchema,
    response: z.object({
      policy: consentPolicySchema,
      changes: z.array(z.string()),
      cancelledJobs: z.number().int(),
    }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'consent.update',
          resource: { type: 'consent_policy' },
          auditOnAllow: true,
        },
        async ({ tx, archive, user }) => {
          const previousRow = await findCurrentPolicy(tx, archive.id);

          // A first grant always requires teach-back. Later changes require it
          // again only if the storyteller asked us to keep asking.
          const teachBack = await tx.maybeOne<{ passed: boolean }>(
            `SELECT passed FROM teach_back_result
             WHERE archive_id = $1 AND user_id = $2 AND passed = true ORDER BY created_at DESC LIMIT 1`,
            [archive.id, user.id],
          );
          const needsTeachBack =
            !previousRow || previousRow.document.allowFutureChangesWithoutTeachBack === false;
          if (needsTeachBack && !teachBack) {
            throw conflict(
              'Please complete the short set of questions about how this works before setting your permissions.',
            );
          }

          let compiled;
          try {
            compiled = compileConsentPolicy(body.document);
          } catch (error) {
            if (error instanceof ConsentPolicyError) {
              throw validationFailed(
                error.summary,
                error.issues.map((issue) => ({ path: 'document', message: issue })),
              );
            }
            throw error;
          }

          const row = await insertPolicyVersion(tx, {
            archiveId: archive.id,
            document: compiled.document,
            policyHash: compiled.policyHash,
            consentCopyVersion: ctx.branding.consentCopyVersion,
            legalCopyVersion: ctx.branding.legalCopyVersion,
            policyEngineVersion: ctx.branding.policyEngineVersion,
            createdByUserId: user.id,
          });

          const changes = diffPolicies(previousRow?.document ?? null, compiled.document);
          await recordConsentAct(tx, {
            archiveId: archive.id,
            consentPolicyId: row.id,
            actorUserId: user.id,
            action: previousRow ? 'updated' : 'granted',
            summary: changes.join(' '),
            ipHash: hashIp(request.ip, ctx.cfg.env.SESSION_SECRET),
            userAgentFamily: userAgentFamily(request.headers['user-agent']),
          });

          // Work already queued was authorised under the previous policy. Any
          // narrowing means it must not run: the worker re-checks too, but
          // cancelling here means it never gets that far.
          let cancelledJobs = 0;
          const narrowed =
            previousRow &&
            previousRow.document.activities.some((a) => !compiled.document.activities.includes(a));
          if (narrowed) {
            cancelledJobs = await cancelJobsForArchive(tx, archive.id, 'consent_narrowed');
          }
          await ctx.cache.deletePrefix(cacheKeys.archivePrefix(archive.id));

          if (archive.status === 'awaiting_storyteller' || archive.status === 'draft') {
            await updateArchiveStatus(tx, archive.id, 'active');
          }
          await ctx.analytics.track('consent_updated', {
            actorId: user.id,
            archiveId: archive.id,
            props: { version: row.version, cancelledJobs },
          });

          return { policy: toConsentPolicy(row), changes, cancelledJobs };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/consent/history',
    tag: 'consent',
    summary: 'Every consent version and act, oldest change still visible',
    auth: 'required',
    params: archiveParams,
    response: z.object({
      versions: z.array(consentPolicySchema),
      records: z.array(
        z.object({
          id: z.uuid(),
          action: z.string(),
          summary: z.string().nullable(),
          createdAt: z.iso.datetime(),
        }),
      ),
    }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'consent.history.read',
          resource: { type: 'consent_policy' },
        },
        async ({ tx }) => {
          const [versions, records] = await Promise.all([
            listPolicyVersions(tx, params.archiveId),
            listConsentRecords(tx, params.archiveId),
          ]);
          return {
            versions: versions.map(toConsentPolicy),
            records: records.map((r) => ({
              id: r.id,
              action: r.action,
              summary: r.summary,
              createdAt: r.created_at.toISOString(),
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/succession',
    tag: 'consent',
    summary: 'Recorded continuity directive',
    description:
      'A record of intent only. v0.1 never transitions an archive automatically, and never ' +
      'from inactivity. Execution is disabled in configuration, in the policy engine and by a ' +
      'database constraint, pending qualified legal review.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ directive: successionDirectiveSchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'succession.read',
          resource: { type: 'succession_directive' },
        },
        async ({ tx }) => {
          const row = await tx.maybeOne<SuccessionRow>(
            `SELECT * FROM succession_directive WHERE archive_id = $1`,
            [params.archiveId],
          );
          return { directive: row ? toDirective(row) : null };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PUT',
    url: '/v1/archives/:archiveId/succession',
    tag: 'consent',
    summary: 'Record a continuity directive',
    auth: 'required',
    params: archiveParams,
    body: updateSuccessionDirectiveRequestSchema,
    response: z.object({ directive: successionDirectiveSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'succession.update',
          resource: { type: 'succession_directive' },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const row = await tx.one<SuccessionRow>(
            `INSERT INTO succession_directive (archive_id, steward_email, instructions, cooling_period_days)
             VALUES ($1, $2, $3, coalesce($4, 30))
             ON CONFLICT (archive_id) DO UPDATE SET
               steward_email = EXCLUDED.steward_email,
               instructions = EXCLUDED.instructions,
               cooling_period_days = EXCLUDED.cooling_period_days,
               updated_at = now()
             RETURNING *`,
            [
              params.archiveId,
              body.stewardEmail ?? null,
              body.instructions ?? null,
              body.coolingPeriodDays ?? null,
            ],
          );
          return { directive: toDirective(row) };
        },
      ),
  });
}

interface SuccessionRow {
  id: string;
  archive_id: string;
  status: 'recorded' | 'under_review' | 'not_executable';
  steward_email: string | null;
  instructions: string | null;
  cooling_period_days: number;
  created_at: Date;
  updated_at: Date;
}

function toDirective(row: SuccessionRow) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    status: row.status,
    stewardEmail: row.steward_email,
    instructions: row.instructions,
    recipientOptInRequired: true as const,
    coolingPeriodDays: row.cooling_period_days,
    executionEnabled: false as const,
    legalReviewStatus: 'pending_qualified_legal_review' as const,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
