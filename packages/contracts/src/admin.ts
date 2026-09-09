import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

export const incidentKindSchema = z.enum([
  'safety',
  'security',
  'accuracy',
  'consent',
  'availability',
]);

export const incidentSchema = z.object({
  id: idSchema,
  kind: incidentKindSchema,
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  /** Metadata only. An incident record never carries memory content. */
  summary: z.string(),
  archiveRef: z.string().nullable(),
  createdAt: timestampSchema,
  acknowledgedAt: timestampSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
});
export type Incident = z.infer<typeof incidentSchema>;

/**
 * Break-glass access. Purpose-limited, time-bound, audited, and visible to the
 * storyteller. There is no route that grants an administrator general browsing.
 */
export const requestBreakGlassSchema = z.object({
  archiveId: idSchema,
  purpose: z.string().min(20).max(1000),
  durationMinutes: z.number().int().min(5).max(240),
  incidentId: idSchema,
});

export const breakGlassGrantSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  purpose: z.string(),
  grantedAt: timestampSchema,
  expiresAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
  /** Support may read operational metadata only, never memory bodies. */
  scope: z.literal('metadata_only'),
});

export const archiveOperationalViewSchema = z.object({
  archiveRef: z.string(),
  status: z.string(),
  createdAt: timestampSchema,
  consentMode: z.string().nullable(),
  counts: z.object({
    sources: z.number().int(),
    memories: z.number().int(),
    members: z.number().int(),
    failedJobs: z.number().int(),
  }),
  lastActivityAt: timestampSchema.nullable(),
});

export const workerStatusSchema = z.object({
  queueDepth: z.number().int(),
  running: z.number().int(),
  failedLastHour: z.number().int(),
  deadLettered: z.number().int(),
  oldestQueuedAgeSeconds: z.number().int().nullable(),
  byType: z.array(
    z.object({ type: z.string(), queued: z.number().int(), failed: z.number().int() }),
  ),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded', 'down']),
  version: z.string(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.enum(['ok', 'degraded', 'down']),
      detail: z.string().nullable(),
    }),
  ),
});
