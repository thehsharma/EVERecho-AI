import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  auditEventSchema,
  createDeletionRequestSchema,
  createExportRequestSchema,
  deletionRequestSchema,
  exportJobSchema,
} from '@everecho/contracts';
import { enqueueJob, listAuditEvents } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound, validationFailed } from '../errors';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });

interface ExportRow {
  id: string;
  archive_id: string;
  status: 'queued' | 'running' | 'ready' | 'failed' | 'expired';
  requested_by_user_id: string | null;
  storage_key: string | null;
  checksum_sha256: string | null;
  byte_size: number | null;
  manifest: Record<string, number> | null;
  error: string | null;
  created_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
}

export function registerLifecycleRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/exports',
    tag: 'lifecycle',
    summary: 'Export everything, in open formats',
    description:
      'Produces a .zip containing every original file, the memories and claims with their ' +
      'evidence, the permission history, and a manifest with a checksum for each file. It opens ' +
      'without EverEcho and without any software a family would have to install.',
    auth: 'required',
    params: archiveParams,
    body: createExportRequestSchema,
    response: z.object({ export: exportJobSchema }),
    status: 202,
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'export.create',
          resource: { type: 'export_job' },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const row = await tx.one<ExportRow>(
            `INSERT INTO export_job (archive_id, requested_by_user_id, options, status)
             VALUES ($1, $2, $3, 'queued') RETURNING *`,
            [params.archiveId, user.id, JSON.stringify(body)],
          );
          await enqueueJob(tx, {
            archiveId: params.archiveId,
            type: 'run_export',
            payload: { exportJobId: row.id },
            idempotencyKey: `export:${row.id}`,
          });
          await ctx.analytics.track('export_requested', {
            actorId: user.id,
            archiveId: params.archiveId,
          });
          return { export: await toExport(ctx, row) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/exports',
    tag: 'lifecycle',
    summary: 'Export history and download links',
    auth: 'required',
    params: archiveParams,
    response: z.object({ exports: z.array(exportJobSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'export.read', resource: { type: 'export_job' } },
        async ({ tx, user }) => {
          const rows = await tx.query<ExportRow>(
            `SELECT * FROM export_job WHERE archive_id = $1 AND requested_by_user_id = $2
             ORDER BY created_at DESC LIMIT 20`,
            [params.archiveId, user.id],
          );
          return { exports: await Promise.all(rows.map((row) => toExport(ctx, row))) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/deletion-requests',
    tag: 'lifecycle',
    summary: 'Delete an archive, a source, or one story',
    description:
      'Deletion runs as a recorded, resumable plan whose progress the requester can watch. ' +
      'Derived content goes first and originals last, so nothing is left pointing at a file ' +
      'that is already gone. An audit record that the deletion happened is kept by design.',
    auth: 'required',
    params: archiveParams,
    body: createDeletionRequestSchema,
    response: z.object({ deletionRequest: deletionRequestSchema }),
    status: 202,
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: body.scope === 'archive' ? 'archive.delete' : 'deletion.request',
          resource: { type: 'deletion_request' },
          auditOnAllow: true,
          auditMetadata: { scope: body.scope },
        },
        async ({ tx, archive, user }) => {
          // Typed confirmation: deletion is irreversible and should feel like it.
          const expected = body.scope === 'archive' ? archive.name : 'delete';
          if (body.confirmationPhrase.trim().toLowerCase() !== expected.trim().toLowerCase()) {
            throw validationFailed(
              body.scope === 'archive'
                ? `To confirm, type the archive's name exactly: ${archive.name}`
                : 'To confirm, type: delete',
            );
          }

          const row = await tx.one<DeletionRow>(
            `INSERT INTO deletion_request (archive_id, requested_by_user_id, scope, target_id, reason, steps)
             VALUES ($1,$2,$3,$4,$5,'[]'::jsonb) RETURNING *`,
            [params.archiveId, user.id, body.scope, body.targetId ?? null, body.reason ?? null],
          );
          await enqueueJob(tx, {
            archiveId: params.archiveId,
            type: 'run_deletion',
            payload: { deletionRequestId: row.id },
            idempotencyKey: `deletion:${row.id}`,
          });
          await ctx.analytics.track('deletion_requested', {
            actorId: user.id,
            archiveId: params.archiveId,
          });
          return { deletionRequest: toDeletion(row) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/deletion-requests',
    tag: 'lifecycle',
    summary: 'Deletion progress, step by step',
    auth: 'required',
    params: archiveParams,
    response: z.object({ deletionRequests: z.array(deletionRequestSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'deletion.read',
          resource: { type: 'deletion_request' },
        },
        async ({ tx }) => {
          const rows = await tx.query<DeletionRow>(
            `SELECT * FROM deletion_request WHERE archive_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [params.archiveId],
          );
          return { deletionRequests: rows.map(toDeletion) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/audit',
    tag: 'lifecycle',
    summary: 'Who did what, and what was refused',
    description:
      'Refusals are recorded as well as successes: being able to see that someone was turned ' +
      'away is part of trusting that the permissions work.',
    auth: 'required',
    params: archiveParams,
    query: z.object({
      limit: z.coerce.number().int().min(1).max(200).default(100),
      before: z.iso.datetime().optional(),
    }),
    response: z.object({ events: z.array(auditEventSchema) }),
    handler: async ({ params, query, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'audit.read', resource: { type: 'audit_event' } },
        async ({ tx }) => {
          const rows = await listAuditEvents(tx, params.archiveId, {
            limit: query.limit,
            before: query.before ?? null,
          });
          return {
            events: rows.map((r) => ({
              id: r.id,
              archiveId: r.archive_id,
              actorUserId: r.actor_user_id,
              actorDisplayName: r.actor_display,
              action: r.action,
              resourceType: r.resource_type,
              resourceId: r.resource_id,
              outcome: r.outcome,
              reasonCode: r.reason_code,
              policyVersion: r.policy_version,
              requestId: r.request_id,
              createdAt: r.created_at.toISOString(),
              metadata: r.metadata,
            })),
          };
        },
      ),
  });
}

interface DeletionRow {
  id: string;
  archive_id: string;
  scope: 'archive' | 'source' | 'memory';
  target_id: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  requested_by_user_id: string | null;
  steps: unknown[];
  created_at: Date;
  completed_at: Date | null;
}

function toDeletion(row: DeletionRow) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    scope: row.scope,
    targetId: row.target_id,
    status: row.status,
    requestedByUserId: row.requested_by_user_id ?? '',
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    steps: row.steps as never,
  };
}

async function toExport(ctx: AppContext, row: ExportRow) {
  // Download links are minted on read and expire quickly; none is ever stored.
  const download =
    row.status === 'ready' && row.storage_key
      ? await ctx.storage.signDownload(row.storage_key, ctx.cfg.env.STORAGE_SIGNED_URL_TTL_SECONDS)
      : null;
  return {
    id: row.id,
    archiveId: row.archive_id,
    status: row.status,
    requestedByUserId: row.requested_by_user_id ?? '',
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
    downloadUrl: download?.url ?? null,
    expiresAt: download?.expiresAt ?? row.expires_at?.toISOString() ?? null,
    checksum: row.checksum_sha256
      ? { algorithm: 'sha256' as const, value: row.checksum_sha256 }
      : null,
    byteSize: row.byte_size,
    manifest: row.manifest
      ? {
          sourceCount: row.manifest.sourceCount ?? 0,
          memoryCount: row.manifest.memoryCount ?? 0,
          claimCount: row.manifest.claimCount ?? 0,
          transcriptCount: row.manifest.transcriptCount ?? 0,
          permissionCount: row.manifest.permissionCount ?? 0,
        }
      : null,
    error: row.error,
  };
}

export { notFound };
