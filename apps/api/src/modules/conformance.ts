import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import type { AppContext } from '../context';

/**
 * The conformance adapter, implemented against this product.
 *
 * `@everecho/conformance` defines what it means for a memorial system not to
 * fabricate the dead, as runnable cases. These five endpoints are how any
 * system — including this one — submits itself to be measured.
 *
 * EverEcho runs the suite against itself in CI and must score 100%. That is
 * the only thing that makes publishing the suite honest: a standard its author
 * does not meet is marketing.
 *
 * Note what these endpoints are *not*. They add no capability. Each one is a
 * thin translation of an existing authorised route into the shape the suite
 * expects, and every one of them goes through `withArchiveAccess` exactly as
 * the route it wraps does. Conformance is not a way in.
 */

const archiveParams = z.object({ archiveId: z.uuid() });

const answerSchema = z.object({
  text: z.string(),
  abstained: z.boolean(),
  citedClaims: z.number().int().min(0),
});

const audioAnswerSchema = z.object({
  text: z.string(),
  clip: z
    .object({
      sourceIds: z.array(z.string()),
      ranges: z.array(z.object({ startMs: z.number().int(), endMs: z.number().int() })),
      text: z.string(),
    })
    .nullable(),
});

export function registerConformanceRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/conformance/describe',
    tag: 'memories',
    summary: 'What this system claims it can do',
    description:
      'Part of the @everecho/conformance adapter. Declaring a capability means the suite will ' +
      'test it; declining one means those cases are skipped and reported as skipped, never as ' +
      'passed.',
    auth: 'required',
    params: archiveParams,
    response: z.object({
      system: z.string(),
      version: z.string(),
      languages: z.array(z.string()),
      audio: z.boolean(),
      news: z.boolean(),
    }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'question.ask', resource: { type: 'archive' } },
        async () => ({
          system: 'EverEcho',
          version: '0.5.0',
          // Only what is actually built. Hindi and Hinglish are planned and
          // are therefore not declared: declaring a language the product does
          // not serve would buy a skipped case rather than a passed one, and
          // would be a lie either way.
          languages: ['en'],
          audio: true,
          news: true,
        }),
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/conformance/ask',
    tag: 'memories',
    summary: 'A text question, in the conformance shape',
    auth: 'required',
    params: archiveParams,
    body: z.object({ question: z.string().min(1).max(2000), language: z.string().optional() }),
    response: answerSchema,
    handler: async ({ params, body, request }) => {
      const response = await request.server.inject({
        method: 'POST',
        url: `/v1/archives/${params.archiveId}/questions`,
        headers: {
          cookie: request.headers.cookie ?? '',
          'x-csrf-token': (request.headers['x-csrf-token'] as string) ?? '',
          'content-type': 'application/json',
        },
        payload: { question: body.question },
      });
      const parsed = response.json() as {
        response?: { answerText: string; abstained: boolean; claims: { citations: unknown[] }[] };
      };
      const answer = parsed.response;
      if (!answer) {
        // A refusal at the HTTP layer is still an abstention as far as the
        // suite is concerned: nothing was asserted about the person.
        return { text: '', abstained: true, citedClaims: 0 };
      }
      return {
        text: answer.answerText,
        abstained: answer.abstained,
        citedClaims: answer.claims.filter((c) => c.citations.length > 0).length,
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/conformance/listen',
    tag: 'memories',
    summary: 'An audio question, in the conformance shape',
    auth: 'required',
    params: archiveParams,
    body: z.object({ question: z.string().min(1).max(2000), language: z.string().optional() }),
    response: audioAnswerSchema,
    handler: async ({ params, body, request }) => {
      const response = await request.server.inject({
        method: 'POST',
        url: `/v1/archives/${params.archiveId}/voice/ask`,
        headers: {
          cookie: request.headers.cookie ?? '',
          'x-csrf-token': (request.headers['x-csrf-token'] as string) ?? '',
          'content-type': 'application/json',
        },
        payload: { question: body.question },
      });
      return toAudioAnswer(response.json());
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/conformance/tell',
    tag: 'memories',
    summary: 'Sharing news, in the conformance shape',
    auth: 'required',
    params: archiveParams,
    body: z.object({ news: z.string().min(1).max(2000), language: z.string().optional() }),
    response: audioAnswerSchema,
    handler: async ({ params, body, request }) => {
      const response = await request.server.inject({
        method: 'POST',
        url: `/v1/archives/${params.archiveId}/voice/tell`,
        headers: {
          cookie: request.headers.cookie ?? '',
          'x-csrf-token': (request.headers['x-csrf-token'] as string) ?? '',
          'content-type': 'application/json',
        },
        payload: { news: body.news },
      });
      return toAudioAnswer(response.json());
    },
  });
}

/**
 * Translates a voice answer into the suite's shape.
 *
 * `sourceIds` and `ranges` are arrays in the wire format because the suite has
 * to be able to *detect* a system that returns two. This one structurally
 * cannot — `OriginalAudio` is nominally typed and no function joins two — so
 * these arrays always have exactly one element, and the case that checks it
 * passes for a reason rather than by luck.
 */
function toAudioAnswer(payload: unknown) {
  const answer = (payload as { answer?: { spokenByArchive?: string; clip?: Clip | null } }).answer;
  if (!answer) return { text: '', clip: null };
  const clip = answer.clip;
  return {
    text: answer.spokenByArchive ?? '',
    clip: clip
      ? {
          sourceIds: [clip.sourceAssetId],
          ranges: [{ startMs: clip.startMs, endMs: clip.endMs }],
          text: clip.text,
        }
      : null,
  };
}

interface Clip {
  sourceAssetId: string;
  startMs: number;
  endMs: number;
  text: string;
}
