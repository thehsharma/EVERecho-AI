import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { defineRoute } from '../http/route';
import { forbidden, notFound } from '../errors';
import { withMemorialOwner } from './memorial-profiles';
export async function recordMemorialOutcome(
  ctx: AppContext,
  userId: string,
  id: string,
  data: {
    mode: 'local-preview' | 'ai-simulation';
    tone: string;
    durationMs: number;
    speechCharacters?: number;
    audioBytes?: number;
    succeeded: boolean;
    voiceFailed?: boolean;
  },
) {
  await withMemorialOwner(ctx, userId, async (tx) => {
    await tx.query(
      "DELETE FROM memorial_turn WHERE user_id=$1 AND created_at<now()-interval '30 days'",
      [userId],
    );
    await tx.query(
      'INSERT INTO memorial_turn(id,user_id,mode,tone,duration_ms,speech_characters,audio_bytes,succeeded,voice_failed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        id,
        userId,
        data.mode,
        data.tone,
        Math.min(2147483647, Math.max(0, Math.round(data.durationMs))),
        data.speechCharacters ?? 0,
        data.audioBytes ?? 0,
        data.succeeded,
        data.voiceFailed ?? false,
      ],
    );
  });
}
export function registerMemorialQuality(app: FastifyInstance, ctx: AppContext) {
  const local = () => {
    if (ctx.cfg.isProduction) throw forbidden('Memorial studio is local only.');
  };
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/memorial/quality',
    auth: 'required',
    tag: 'memorial',
    summary: 'Your recent conversation quality and usage',
    response: z.object({
      turns: z.number(),
      hosted: z.number(),
      failed: z.number(),
      voiceFailed: z.number(),
      averageResponseMs: z.number(),
      speechCharacters: z.number(),
      audioBytes: z.number(),
      helpful: z.number(),
      reported: z.number(),
    }),
    handler: async ({ user }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        const row = await tx.one<{
          turns: number;
          hosted: number;
          failed: number;
          voice_failed: number;
          average_ms: number;
          speech_characters: number;
          audio_bytes: number;
          helpful: number;
          reported: number;
        }>(
          `
    SELECT count(*)::int AS turns,count(*) FILTER(WHERE mode='ai-simulation')::int AS hosted,
    count(*) FILTER(WHERE NOT succeeded)::int AS failed,count(*) FILTER(WHERE voice_failed)::int AS voice_failed,
    coalesce(round(avg(duration_ms) FILTER(WHERE succeeded)),0)::int AS average_ms,
    coalesce(sum(speech_characters),0)::bigint AS speech_characters,coalesce(sum(audio_bytes),0)::bigint AS audio_bytes,
    count(*) FILTER(WHERE feedback='helpful')::int AS helpful,count(*) FILTER(WHERE feedback IS NOT NULL AND feedback<>'helpful')::int AS reported
    FROM memorial_turn WHERE user_id=$1 AND created_at>=now()-interval '30 days'`,
          [user!.id],
        );
        return {
          turns: row.turns,
          hosted: row.hosted,
          failed: row.failed,
          voiceFailed: row.voice_failed,
          averageResponseMs: row.average_ms,
          speechCharacters: Number(row.speech_characters),
          audioBytes: Number(row.audio_bytes),
          helpful: row.helpful,
          reported: row.reported,
        };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/memorial/quality/:id/feedback',
    auth: 'required',
    tag: 'memorial',
    summary: 'Rate a reply without storing its text',
    params: z.object({ id: z.uuid() }),
    body: z.object({
      feedback: z.enum(['helpful', 'wrong_tone', 'invented_detail', 'unfamiliar_style']),
    }),
    response: z.object({ saved: z.literal(true) }),
    handler: async ({ user, params, body }) => {
      local();
      return withMemorialOwner(ctx, user!.id, async (tx) => {
        const row = await tx.maybeOne(
          "UPDATE memorial_turn SET feedback=$3 WHERE id=$1 AND user_id=$2 AND succeeded=true AND created_at>=now()-interval '30 days' RETURNING id",
          [params.id, user!.id, body.feedback],
        );
        if (!row) throw notFound();
        return { saved: true as const };
      });
    },
  });
  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/memorial/quality',
    auth: 'required',
    tag: 'memorial',
    summary: 'Delete your conversation measurements',
    response: z.object({ deleted: z.literal(true) }),
    handler: async ({ user }) => {
      local();
      await withMemorialOwner(ctx, user!.id, (tx) =>
        tx.query('DELETE FROM memorial_turn WHERE user_id=$1', [user!.id]),
      );
      return { deleted: true as const };
    },
  });
}
