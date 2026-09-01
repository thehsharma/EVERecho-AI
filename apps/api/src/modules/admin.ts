import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  archiveOperationalViewSchema,
  breakGlassGrantSchema,
  incidentSchema,
  requestBreakGlassSchema,
} from '@everecho/contracts';
import { recordAuditEvent } from '@everecho/db';
import { defineRoute } from '../http/route';
import { ApiError, notFound } from '../errors';
import type { AppContext } from '../context';

function requireAdmin(user: { isPlatformAdmin: boolean } | null): void {
  // Reported as "not found" so the existence of the admin surface is not
  // advertised to accounts that cannot use it.
  if (!user?.isPlatformAdmin) throw new ApiError('not_found', 'That was not found.');
}

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/admin/incidents',
    tag: 'admin',
    summary: 'Safety, security, accuracy, consent and availability incidents',
    description:
      'Incident records carry operational metadata only. None of them contains memory content.',
    auth: 'required',
    query: z.object({
      status: z.enum(['open', 'acknowledged', 'resolved', 'all']).default('open'),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: z.object({ incidents: z.array(incidentSchema) }),
    handler: async ({ query, user }) => {
      requireAdmin(user);
      const rows = await ctx.db.query<{
        id: string;
        kind: 'safety' | 'security' | 'accuracy' | 'consent' | 'availability';
        severity: 'low' | 'medium' | 'high' | 'critical';
        status: 'open' | 'acknowledged' | 'resolved';
        summary: string;
        archive_id: string | null;
        created_at: Date;
        acknowledged_at: Date | null;
        resolved_at: Date | null;
      }>(
        `SELECT * FROM incident WHERE ($1 = 'all' OR status = $1) ORDER BY created_at DESC LIMIT $2`,
        [query.status, query.limit],
      );
      return {
        incidents: rows.map((r) => ({
          id: r.id,
          kind: r.kind,
          severity: r.severity,
          status: r.status,
          summary: r.summary,
          // A short reference, never the archive id: support staff do not need
          // an identifier they could use to address the archive directly.
          archiveRef: r.archive_id ? `ARC-${r.archive_id.slice(0, 8)}` : null,
          createdAt: r.created_at.toISOString(),
          acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
          resolvedAt: r.resolved_at?.toISOString() ?? null,
        })),
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/admin/incidents/:incidentId',
    tag: 'admin',
    summary: 'Acknowledge or resolve an incident',
    auth: 'required',
    params: z.object({ incidentId: z.uuid() }),
    body: z.object({
      status: z.enum(['acknowledged', 'resolved']),
      resolutionNote: z.string().max(2000).optional(),
    }),
    response: z.object({ updated: z.literal(true) }),
    handler: async ({ params, body, user, request }) => {
      requireAdmin(user);
      const row = await ctx.db.maybeOne(
        `UPDATE incident SET status = $2,
                             acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN now() ELSE acknowledged_at END,
                             resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE NULL END,
                             resolution_note = coalesce($3, resolution_note)
         WHERE id = $1 RETURNING id`,
        [params.incidentId, body.status, body.resolutionNote ?? null],
      );
      if (!row) throw notFound('That incident was not found.');
      await recordAuditEvent(ctx.db, {
        archiveId: null,
        actorUserId: user!.id,
        actorDisplay: user!.displayName,
        action: 'admin.incident.manage',
        resourceType: 'incident',
        resourceId: params.incidentId,
        outcome: 'success',
        requestId: request.id,
        metadata: { status: body.status },
      });
      return { updated: true as const };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/admin/break-glass',
    tag: 'admin',
    summary: 'Request time-limited, purpose-limited access to one archive',
    description:
      'There is no route anywhere that grants an administrator general browsing of customer ' +
      'memories. This grants operational metadata for one archive, for a stated purpose, for a ' +
      'bounded time, and it is written to that archive’s own audit trail where the storyteller ' +
      'can see it.',
    auth: 'required',
    body: requestBreakGlassSchema,
    response: z.object({ grant: breakGlassGrantSchema }),
    status: 201,
    handler: async ({ body, user, request }) => {
      requireAdmin(user);
      const expiresAt = new Date(Date.now() + body.durationMinutes * 60_000);
      const row = await ctx.db.one<{ id: string; granted_at: Date; expires_at: Date }>(
        `INSERT INTO break_glass_grant (archive_id, admin_user_id, incident_id, purpose, expires_at)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, granted_at, expires_at`,
        [body.archiveId, user!.id, body.incidentId, body.purpose, expiresAt],
      );
      // Recorded against the archive, not only in an internal log: the point is
      // that the storyteller can see support looked at their archive.
      await recordAuditEvent(ctx.db, {
        archiveId: body.archiveId,
        actorUserId: user!.id,
        actorDisplay: `${user!.displayName} (support)`,
        action: 'admin.breakglass.request',
        resourceType: 'archive',
        resourceId: body.archiveId,
        outcome: 'success',
        requestId: request.id,
        metadata: { durationMinutes: body.durationMinutes, incidentId: body.incidentId },
      });
      return {
        grant: {
          id: row.id,
          archiveId: body.archiveId,
          purpose: body.purpose,
          grantedAt: row.granted_at.toISOString(),
          expiresAt: row.expires_at.toISOString(),
          revokedAt: null,
          scope: 'metadata_only' as const,
        },
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/admin/archives/:archiveId/operational',
    tag: 'admin',
    summary: 'Operational metadata for one archive, under a live grant',
    description:
      'Counts and states only. There is no field here that can carry a memory, a filename or a ' +
      'transcript, and the policy engine refuses the request without an unexpired grant.',
    auth: 'required',
    params: z.object({ archiveId: z.uuid() }),
    response: archiveOperationalViewSchema,
    handler: async ({ params, user, request }) => {
      requireAdmin(user);
      const { withArchiveAccess } = await import('../lib/access');
      return withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'admin.archive.metadata.read',
          resource: { type: 'archive', id: params.archiveId },
          auditOnAllow: true,
        },
        async ({ tx, archive }) => {
          const counts = await tx.one<{
            sources: number;
            memories: number;
            members: number;
            failed_jobs: number;
            last_activity: Date | null;
          }>(
            `SELECT
               (SELECT count(*) FROM source_asset WHERE archive_id = $1 AND deleted_at IS NULL)::int AS sources,
               (SELECT count(*) FROM memory WHERE archive_id = $1 AND deleted_at IS NULL)::int AS memories,
               (SELECT count(*) FROM membership WHERE archive_id = $1 AND status = 'active')::int AS members,
               (SELECT count(*) FROM processing_job WHERE archive_id = $1 AND status IN ('failed','dead_lettered'))::int AS failed_jobs,
               (SELECT max(created_at) FROM audit_event WHERE archive_id = $1) AS last_activity`,
            [params.archiveId],
          );
          const policy = await tx.maybeOne<{ mode: string }>(
            `SELECT mode FROM consent_policy WHERE archive_id = $1 AND superseded_at IS NULL`,
            [params.archiveId],
          );
          return {
            archiveRef: `ARC-${archive.id.slice(0, 8)}`,
            status: archive.status,
            createdAt: archive.created_at.toISOString(),
            consentMode: policy?.mode ?? null,
            counts: {
              sources: counts.sources,
              memories: counts.memories,
              members: counts.members,
              failedJobs: counts.failed_jobs,
            },
            lastActivityAt: counts.last_activity?.toISOString() ?? null,
          };
        },
      );
    },
  });
}
