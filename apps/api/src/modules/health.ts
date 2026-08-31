import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { healthResponseSchema, workerStatusSchema } from '@everecho/contracts';
import { jobStats } from '@everecho/db';
import { defineRoute } from '../http/route';
import type { AppContext } from '../context';

export function registerHealthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Liveness: is this process running at all. No dependencies, no detail.
  app.get('/healthz', async () => ({ status: 'ok' }));

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/readyz',
    tag: 'operations',
    summary: 'Readiness, including dependency checks',
    description:
      'Reports whether the API can serve traffic. Deliberately free of versions, hostnames and connection strings.',
    auth: 'none',
    response: healthResponseSchema,
    handler: async () => {
      const database = await ctx.db.healthy();
      const pgvector = await ctx.db.capability('pgvector').catch(() => false);
      const checks = [
        { name: 'database', status: database.ok ? ('ok' as const) : ('down' as const), detail: null },
        {
          name: 'vector_index',
          status: pgvector ? ('ok' as const) : ('degraded' as const),
          detail: pgvector ? null : 'portable array search in use',
        },
        { name: 'storage', status: 'ok' as const, detail: ctx.storage.name },
      ];
      const status = checks.some((c) => c.status === 'down')
        ? ('down' as const)
        : checks.some((c) => c.status === 'degraded')
          ? ('degraded' as const)
          : ('ok' as const);
      return { status, version: '0.1.0', checks };
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/meta',
    tag: 'operations',
    summary: 'Product branding, feature flags and limits',
    description:
      'What the frontend needs to render itself consistently: the configurable product name, ' +
      'the copy versions in force, and which capabilities are enabled. Prohibited capabilities ' +
      'are reported as false so a client can never present them as available.',
    auth: 'none',
    response: z.object({
      productName: z.string(),
      supportEmail: z.string(),
      dataRegion: z.string(),
      jurisdiction: z.string(),
      consentCopyVersion: z.string(),
      legalCopyVersion: z.string(),
      trademarkStatus: z.string(),
      features: z.object({
        performMode: z.literal(false),
        successionExecution: z.literal(false),
        p4InferenceInAnswers: z.boolean(),
        demoMode: z.boolean(),
        billing: z.boolean(),
      }),
      limits: z.object({
        uploadMaxBytes: z.number().int(),
        allowedMimeTypes: z.array(z.string()),
        rateLimitPerWindow: z.number().int(),
        rateLimitWindowMs: z.number().int(),
      }),
      providers: z.object({
        composition: z.string(),
        transcription: z.string(),
        ocr: z.string(),
        /** True when composition is extractive and cannot invent content. */
        compositionIsExtractive: z.boolean(),
      }),
    }),
    handler: async () => ({
      productName: ctx.branding.productName,
      supportEmail: ctx.branding.supportEmail,
      dataRegion: ctx.branding.dataRegion,
      jurisdiction: ctx.branding.jurisdiction,
      consentCopyVersion: ctx.branding.consentCopyVersion,
      legalCopyVersion: ctx.branding.legalCopyVersion,
      trademarkStatus: ctx.branding.trademarkStatus,
      features: {
        performMode: false as const,
        successionExecution: false as const,
        p4InferenceInAnswers: ctx.features.p4InferenceInAnswers,
        demoMode: ctx.features.demoMode,
        billing: ctx.features.billing,
      },
      limits: {
        uploadMaxBytes: ctx.cfg.env.UPLOAD_MAX_BYTES,
        allowedMimeTypes: [...ctx.cfg.uploadAllowedMime],
        rateLimitPerWindow: ctx.cfg.env.RATE_LIMIT_MAX,
        rateLimitWindowMs: ctx.cfg.env.RATE_LIMIT_WINDOW_MS,
      },
      providers: {
        composition: ctx.llm.name,
        transcription: ctx.stt.name,
        ocr: ctx.ocr.name,
        compositionIsExtractive: ctx.llm.extractive,
      },
    }),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/operations/worker',
    tag: 'operations',
    summary: 'Background processing status',
    description: 'Queue depth and failures. Counts only — no archive identifiers, no content.',
    auth: 'required',
    response: workerStatusSchema,
    handler: async ({ user }) => {
      if (!user?.isPlatformAdmin) {
        // Everyone else gets the shape with nothing in it rather than a 403,
        // so a status widget can render without special-casing permissions.
        return {
          queueDepth: 0,
          running: 0,
          failedLastHour: 0,
          deadLettered: 0,
          oldestQueuedAgeSeconds: null,
          byType: [],
        };
      }
      const { totals, byType } = await jobStats(ctx.db);
      return {
        queueDepth: totals?.queued ?? 0,
        running: totals?.running ?? 0,
        failedLastHour: totals?.failed_last_hour ?? 0,
        deadLettered: totals?.dead_lettered ?? 0,
        oldestQueuedAgeSeconds: totals?.oldest_queued_age_seconds ?? null,
        byType: byType.map((t) => ({ type: t.type, queued: t.queued, failed: t.failed })),
      };
    },
  });
}
