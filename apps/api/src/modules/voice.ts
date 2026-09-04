import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { askVoiceRequestSchema, voiceAnswerSchema } from '@everecho/contracts';
import {
  PERSONA_REFUSAL,
  PERSONA_REFUSAL_WITHOUT_CLIP,
  PERSONA_REFUSAL_WITH_CLIP,
  isProhibitedRequest,
  selectClip,
  stripPersonaFraming,
  surroundingText,
  type Segment,
} from '@everecho/ai';
import { resolveRemembrance, type RemembranceClause } from '@everecho/consent';
import type { Transaction } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { allowedSensitivities } from './sources';
import type { AppContext } from '../context';

/**
 * Hearing the actual recording.
 *
 * The product's whole answer to the moment of loss. A question comes in; what
 * goes out is her real voice, from her real recording, or an honest statement
 * that there is nothing.
 *
 * The server never touches the audio. It returns a signed link to the original
 * file and a time range, and the browser plays that range. That is not an
 * optimisation — it is the guarantee. No code in this repository reads audio
 * bytes, so there is nothing here that could splice two true moments into a
 * sentence she never said.
 */

const archiveParams = z.object({ archiveId: z.uuid() });

/**
 * What the archive says in its own voice.
 *
 * Always attributable to the assistant, never to the person. Written in the
 * third person and read on the screen in a visibly different style, because a
 * bereaved person should never have to work out who is talking.
 */
const NOTHING_RECORDED =
  'I don’t have a recording of them answering that. I can only play what they actually said.';
const AUDIO_WITHHELD =
  'They asked that this not be played. Their words are here; their voice is not.';
const WITHHELD =
  'They decided this should stay closed. That was their choice, made while they could make it.';
const NOT_YET = 'They asked that this wait a while longer.';

export function registerVoiceRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/voice/ask',
    tag: 'memories',
    summary: 'Hear what they actually said',
    description:
      'Returns the moment in a real recording where they answered, with a few seconds of ' +
      'lead-in, and a link to the original file. Nothing is generated and nothing is edited: ' +
      'the response carries one contiguous range of one recording, or none.',
    auth: 'required',
    params: archiveParams,
    body: askVoiceRequestSchema,
    response: z.object({ answer: voiceAnswerSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'voice.listen',
          resource: { type: 'transcript' },
          auditOnAllow: true,
        },
        async ({ tx, decision, user, archive }) => {
          // A persona request is refused, always. What it is *not* is thrown
          // away: "pretend to be my mother and tell me about the move" is a
          // request the product refuses and a subject it can answer, and
          // discarding the subject makes a grieving person type their question
          // twice at the worst possible moment.
          //
          // So the framing is stripped and the remainder is used for
          // retrieval. The refusal does not soften — the reply is still in the
          // archive's own voice, and still says plainly that it will not
          // imagine anything. It just arrives with something in its hands.
          const persona = isProhibitedRequest(body.question);
          const subject = persona ? stripPersonaFraming(body.question) : body.question;

          if (persona) {
            await ctx.analytics.track('voice_clip_refused', {
              actorId: user.id,
              archiveId: params.archiveId,
              props: { personaRequest: true, hadSubject: subject.length > 0 },
            });
          }

          const isStoryteller = archive.storyteller_user_id === user.id;
          const directive = await loadDirective(tx, params.archiveId);

          // Playable recordings this reader is already permitted to see. The
          // sensitivity ceiling comes from the grant, exactly as it does for a
          // download: memorial mode never reaches past ordinary consent.
          const allowed = allowedSensitivities(decision.obligations.maxSensitivity);
          const rows = await tx.query<{
            segment_id: string;
            idx: number;
            start_ms: number | null;
            end_ms: number | null;
            text: string;
            source_asset_id: string;
            source_label: string;
            added_on: Date | null;
            memory_id: string | null;
            topics: string[] | null;
          }>(
            `SELECT ts.id AS segment_id, ts.idx, ts.start_ms, ts.end_ms,
                    COALESCE(ts.corrected_text, ts.text) AS text,
                    sa.id AS source_asset_id, sa.original_filename AS source_label,
                    sa.created_at AS added_on,
                    m.id AS memory_id, m.topics
               FROM transcript_segment ts
               JOIN transcript t ON t.id = ts.transcript_id
               JOIN source_asset sa ON sa.id = t.source_asset_id
               LEFT JOIN claim_evidence ce ON ce.transcript_segment_id = ts.id
               LEFT JOIN claim c ON c.id = ce.claim_id
               LEFT JOIN memory m ON m.id = c.memory_id AND m.deleted_at IS NULL
              WHERE ts.archive_id = $1
                AND sa.deleted_at IS NULL
                AND sa.kind = 'audio'
                AND t.status = 'ready'
                AND ts.start_ms IS NOT NULL
                AND ($2::boolean OR sa.sensitivity = ANY($3::text[]))
              ORDER BY ts.idx`,
            [params.archiveId, isStoryteller, allowed],
          );

          const segments: Segment[] = rows.map((r) => ({
            id: r.segment_id,
            idx: r.idx,
            startMs: r.start_ms,
            endMs: r.end_ms,
            text: r.text,
          }));

          const clip = subject.length > 0 ? selectClip(subject, segments) : null;
          if (!clip) {
            await ctx.analytics.track('voice_clip_offered', {
              actorId: user.id,
              archiveId: params.archiveId,
              props: { played: false },
            });
            return {
              answer: {
                clip: null,
                spokenByArchive: persona
                  ? `${PERSONA_REFUSAL} ${PERSONA_REFUSAL_WITHOUT_CLIP}`
                  : NOTHING_RECORDED,
                reasonCode: 'nothing_recorded' as const,
                quotedText: null,
              },
            };
          }

          const chosen = rows.find((r) => r.segment_id === clip.segmentId)!;

          // What she decided about this, in her own words, applied per clip
          // rather than once per session: a directive that was read at sign-in
          // would be a directive that stops being obeyed halfway through.
          const permitted = resolveRemembrance({
            directive,
            subject: {
              memoryId: chosen.memory_id,
              sourceAssetId: chosen.source_asset_id,
              topics: chosen.topics ?? [],
            },
            viewerUserId: user.id,
            now: new Date(),
          });

          if (!permitted.mayRead) {
            await ctx.analytics.track('voice_clip_offered', {
              actorId: user.id,
              archiveId: params.archiveId,
              props: { played: false, withheld: true },
            });
            const reasonCode =
              permitted.reasonCode === 'not_yet'
                ? ('not_yet' as const)
                : permitted.reasonCode === 'withheld_by_default'
                  ? ('withheld_by_default' as const)
                  : ('withheld_by_clause' as const);
            return {
              answer: {
                clip: null,
                // Told which, deliberately. "She asked us not to" is a fact
                // about her, and hiding it behind "nothing found" would
                // misrepresent somebody who cannot correct the record.
                spokenByArchive: reasonCode === 'not_yet' ? NOT_YET : WITHHELD,
                reasonCode,
                quotedText: null,
              },
            };
          }

          if (!permitted.mayHearVoice) {
            await ctx.analytics.track('voice_clip_offered', {
              actorId: user.id,
              archiveId: params.archiveId,
              props: { played: false, wordsOnly: true },
            });
            return {
              answer: {
                clip: null,
                spokenByArchive: AUDIO_WITHHELD,
                reasonCode: 'audio_withheld' as const,
                // The words survive. Being quoted and being heard were two
                // decisions, and she only refused the second.
                quotedText: clip.text,
              },
            };
          }

          const key = await tx.one<{ storage_key: string }>(
            `SELECT storage_key FROM source_asset WHERE id = $1 AND archive_id = $2`,
            [chosen.source_asset_id, params.archiveId],
          );
          const signed = await ctx.storage.signDownload(
            key.storage_key,
            ctx.cfg.env.STORAGE_SIGNED_URL_TTL_SECONDS,
          );
          const around = surroundingText(segments, clip.segmentId);

          await ctx.analytics.track('voice_clip_offered', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { played: true, clipMs: clip.endMs - clip.startMs },
          });

          return {
            answer: {
              clip: {
                segmentId: clip.segmentId,
                sourceAssetId: chosen.source_asset_id,
                audioUrl: signed.url,
                audioExpiresAt: signed.expiresAt,
                startMs: clip.startMs,
                endMs: clip.endMs,
                text: clip.text,
                before: around.before,
                after: around.after,
                addedOn: chosen.added_on?.toISOString() ?? null,
                sourceLabel: chosen.source_label,
              },
              // The refusal and the offer in one breath. A refusal that stops
              // before the offer is a door closing.
              spokenByArchive: persona ? `${PERSONA_REFUSAL} ${PERSONA_REFUSAL_WITH_CLIP}` : PLAYED,
              reasonCode: 'played' as const,
              quotedText: null,
            },
          };
        },
      ),
  });
}

const PLAYED = 'This is them, in their own recording.';

async function loadDirective(tx: Transaction, archiveId: string) {
  const row = await tx.maybeOne<{
    id: string;
    status: 'draft' | 'affirmed' | 'superseded' | 'activated';
    default_effect: 'permit' | 'withhold';
  }>(
    `SELECT id, status, default_effect FROM remembrance_directive
      WHERE archive_id = $1 AND status <> 'superseded'
      ORDER BY version DESC LIMIT 1`,
    [archiveId],
  );
  if (!row) return null;

  const clauses = await tx.query<{
    effect: 'permit' | 'withhold';
    scope: 'archive' | 'topic' | 'memory' | 'source';
    topic: string | null;
    memory_id: string | null;
    source_asset_id: string | null;
    audience_user_id: string | null;
    not_before: Date | null;
    allow_audio: boolean;
  }>(`SELECT * FROM remembrance_clause WHERE archive_id = $1 AND directive_id = $2`, [
    archiveId,
    row.id,
  ]);

  return {
    status: row.status,
    defaultEffect: row.default_effect,
    clauses: clauses.map((c): RemembranceClause => ({
      effect: c.effect,
      scope: c.scope,
      topic: c.topic,
      memoryId: c.memory_id,
      sourceAssetId: c.source_asset_id,
      audienceUserId: c.audience_user_id,
      notBefore: c.not_before,
      allowAudio: c.allow_audio,
    })),
  };
}
