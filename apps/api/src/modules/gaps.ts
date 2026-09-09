import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  answerGapRequestSchema,
  dismissGapRequestSchema,
  memoryGapSchema,
} from '@everecho/contracts';
import { detectGaps, promptForGap } from '@everecho/ai';
import { findCurrentLearningPolicy, toLearningPolicy, type Transaction } from '@everecho/db';
import { resolveLearningObligations } from '@everecho/consent';
import { detectInjection } from '@everecho/ai';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound } from '../errors';
import { extractCandidates, storeCandidates } from '../realtime/candidates';
import type { AppContext } from '../context';

/**
 * The coverage radar.
 *
 * What the archive mentions and never explains — an unnamed person, a date
 * given as a feeling, a story promised and not told. Detection is pure and
 * runs over approved memories only, so nothing here can surface material the
 * storyteller has not already accepted.
 *
 * Three things this deliberately does not do, each of which would be easy and
 * would make the product worse:
 *
 * It does not score. There is no percentage, no streak, no "your archive is
 * 40% complete". A person cannot be behind on their own life.
 *
 * It does not infer. "You have not talked about your father" is a claim about
 * somebody's life; "you said 'he told us to leave' and never said who" is a
 * fact about a sentence. Only the second exists here.
 *
 * It does not nag. Every item can be put away for a while or for good, and
 * `never_ask` means never — a dismissal that quietly returns next month is not
 * a dismissal.
 */

const archiveParams = z.object({ archiveId: z.uuid() });
const gapParams = archiveParams.extend({ gapId: z.uuid() });

export function registerGapRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/gaps',
    tag: 'memories',
    summary: 'Things you might like to say more about',
    description:
      'Places where the archive mentions something without explaining it. It is a list of ' +
      'questions, not a measure of how complete your life is — there is no score here and ' +
      'there never will be. Anything you put away stays away.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ gaps: z.array(memoryGapSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memoryGap.read',
          resource: { type: 'memory_gap' },
        },
        async ({ tx }) => {
          // Approved memories only. A gap detected from something still in
          // review would be asking about material the storyteller has not
          // accepted yet.
          const memories = await tx.query<{ id: string; body: string }>(
            `SELECT id, body FROM memory
              WHERE archive_id = $1 AND status = 'approved' AND deleted_at IS NULL`,
            [params.archiveId],
          );

          const detected = detectGaps(memories);
          for (const gap of detected) {
            // Idempotent by (kind, reference): noticing the same thing again
            // must not resurrect something already put away.
            await tx.query(
              `INSERT INTO memory_gap (archive_id, kind, reference, memory_id)
               VALUES ($1,$2,$3,$4)
               ON CONFLICT (archive_id, kind, lower(reference)) DO NOTHING`,
              [params.archiveId, gap.kind, gap.reference, gap.memoryId],
            );
          }

          const rows = await tx.query<{
            id: string;
            kind: Parameters<typeof promptForGap>[0]['kind'];
            reference: string;
            memory_id: string | null;
            status: 'open' | 'dismissed' | 'snoozed' | 'resolved';
            snoozed_until: Date | null;
            created_at: Date;
          }>(
            `SELECT id, kind, reference, memory_id, status, snoozed_until, created_at
               FROM memory_gap
              WHERE archive_id = $1
                AND never_ask = false
                AND status IN ('open','snoozed')
                AND (snoozed_until IS NULL OR snoozed_until <= now())
              ORDER BY created_at DESC LIMIT 50`,
            [params.archiveId],
          );

          await ctx.analytics.track('memory_gap_offered', {
            archiveId: params.archiveId,
            props: { offered: rows.length },
          });

          return {
            gaps: rows.map((row) => ({
              id: row.id,
              kind: row.kind,
              reference: row.reference,
              memoryId: row.memory_id,
              prompt: promptForGap({
                kind: row.kind,
                reference: row.reference,
                memoryId: row.memory_id,
              }),
              status: row.status,
              snoozedUntil: row.snoozed_until?.toISOString() ?? null,
              createdAt: row.created_at.toISOString(),
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/gaps/:gapId/answer',
    tag: 'memories',
    summary: 'Say more about one, in your own words',
    description:
      'Your answer becomes a source in your archive, exactly like a recording or an upload. ' +
      'It does not become a memory. Anything it suggests goes to the same review queue as ' +
      'everything else, and you decide on each one.',
    auth: 'required',
    params: gapParams,
    body: answerGapRequestSchema,
    response: z.object({
      answered: z.literal(true),
      sourceAssetId: z.uuid(),
      candidateCount: z.number().int().min(0),
    }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memoryGap.answer',
          resource: { type: 'memory_gap', id: params.gapId },
          auditOnAllow: true,
        },
        async ({ tx, subject, decision, user }) => {
          const gap = await tx.maybeOne<{ id: string; kind: string; never_ask: boolean }>(
            `SELECT id, kind, never_ask FROM memory_gap WHERE archive_id = $1 AND id = $2`,
            [params.archiveId, params.gapId],
          );
          // A gap that was put away for good is gone. Answering it by id would
          // be a way back in, so it is refused like anything else that is not
          // there.
          if (!gap || gap.never_ask) throw notFound();

          // Anything the storyteller types is content, and content from a text
          // box can contain instructions aimed at whatever reads it next. The
          // finding is counted, never quoted.
          const injectionFindings = detectInjection(body.body);

          const { sourceAssetId, segmentId } = await promoteGapAnswerToSource(tx, {
            archiveId: params.archiveId,
            gapId: gap.id,
            body: body.body,
            policyVersion: decision.policyVersion,
          });

          // Suggestions, never facts. Extraction is gated by the learning
          // policy intersected with consent, so an archive that has not agreed
          // to it gets a source and nothing else.
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
                kind: 'gap_answer',
                gapId: gap.id,
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

          await tx.query(
            `UPDATE memory_gap
                SET status = 'resolved', snoozed_until = NULL, answered_at = now(),
                    answer_source_asset_id = $3, updated_at = now()
              WHERE archive_id = $1 AND id = $2`,
            [params.archiveId, gap.id, sourceAssetId],
          );

          await ctx.analytics.track('memory_gap_answered', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { candidates: candidateCount, flagged: injectionFindings.length > 0 },
          });

          return { answered: true as const, sourceAssetId, candidateCount };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/gaps/:gapId/dismiss',
    tag: 'memories',
    summary: 'Put one away, for a while or for good',
    description:
      '“Not now” hides it for as long as you say. “Never ask again” means exactly that: it ' +
      'does not come back, and nothing about it is offered to you again.',
    auth: 'required',
    params: gapParams,
    body: dismissGapRequestSchema,
    response: z.object({ dismissed: z.literal(true) }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'memoryGap.dismiss',
          resource: { type: 'memory_gap', id: params.gapId },
        },
        async ({ tx }) => {
          const snoozeUntil =
            body.decision === 'snooze'
              ? new Date(Date.now() + (body.snoozeDays ?? 30) * 86_400_000)
              : null;

          const updated = await tx.maybeOne<{ id: string }>(
            `UPDATE memory_gap
                SET status = $3,
                    snoozed_until = $4,
                    never_ask = ($3 = 'dismissed'),
                    updated_at = now()
              WHERE archive_id = $1 AND id = $2
              RETURNING id`,
            [
              params.archiveId,
              params.gapId,
              body.decision === 'snooze'
                ? 'snoozed'
                : body.decision === 'never'
                  ? 'dismissed'
                  : 'resolved',
              snoozeUntil,
            ],
          );
          if (!updated) throw notFound();

          await ctx.analytics.track('memory_gap_dismissed', {
            archiveId: params.archiveId,
            props: { forever: body.decision === 'never', snoozed: body.decision === 'snooze' },
          });
          return { dismissed: true as const };
        },
      ),
  });
}

/**
 * The answer, promoted to a real source.
 *
 * Same shape as an answer to a family question: a `source_asset`, a
 * `transcript`, a `transcript_segment`. Nothing goes to object storage — the
 * words live in the segment, which is what citation, export and deletion
 * already know how to find. A second store would be a second place for
 * deletion to miss.
 */
async function promoteGapAnswerToSource(
  tx: Transaction,
  input: { archiveId: string; gapId: string; body: string; policyVersion: string },
): Promise<{ sourceAssetId: string; segmentId: string | null }> {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');

  const source = await tx.one<{ id: string }>(
    `INSERT INTO source_asset
       (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
        scan_result, privacy, processing_stage, processed_at, sensitivity)
     VALUES ($1,'text','processed',$2,'text/plain',0,$3,'clean',$4,'ready', now(),'normal')
     RETURNING id`,
    [
      input.archiveId,
      // No part of the gap's wording goes in the filename. A source list is a
      // place people take screenshots of.
      `Something you said more about — ${stamp}`,
      `gap-answer/${input.gapId}`,
      JSON.stringify({ excluded: false, note: 'Answer to a coverage question.' }),
    ],
  );

  const transcript = await tx.one<{ id: string }>(
    `INSERT INTO transcript
       (archive_id, source_asset_id, provider, model_version, prompt_version, language,
        status, method, policy_version, completed_at)
     VALUES ($1,$2,'everecho-answer','v1','memory-gap-v1','en','ready','typed',$3, now())
     RETURNING id`,
    [input.archiveId, source.id, input.policyVersion],
  );

  const segment = await tx.one<{ id: string }>(
    `INSERT INTO transcript_segment (archive_id, transcript_id, idx, text)
     VALUES ($1,$2,0,$3) RETURNING id`,
    [input.archiveId, transcript.id, input.body],
  );

  return { sourceAssetId: source.id, segmentId: segment.id };
}

/** The learning policy, intersected with consent as the ceiling. */
async function resolveLearningForArchive(
  tx: Transaction,
  archiveId: string,
  subject: { policy: { document: { activities: string[] } } | null },
) {
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
