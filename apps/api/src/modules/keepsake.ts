import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { renderKeepsake, type KeepsakeStory } from '../lib/keepsake';
import { allowedSensitivities } from './sources';
import { notFound } from '../errors';
export function registerKeepsake(app: FastifyInstance, ctx: AppContext) {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/keepsake',
    auth: 'required',
    tag: 'lifecycle',
    summary: 'Download selected approved, exportable stories as a readable keepsake',
    params: z.object({ archiveId: z.uuid() }),
    body: z.object({
      title: z.string().trim().min(1).max(120),
      dedication: z.string().trim().max(500),
      memoryIds: z
        .array(z.uuid())
        .min(1)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length),
    }),
    response: z.object({ html: z.string(), count: z.number() }),
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
        async ({ tx, decision }) => {
          const rows = await tx.query<{
            id: string;
            title: string;
            body: string;
            date: string | null;
            place: string | null;
          }>(
            `
      SELECT m.id,m.title,m.body,m.occurred_on::text AS date,p.name AS place
      FROM memory m LEFT JOIN place p ON p.id=m.place_id
      WHERE m.archive_id=$1 AND m.id=ANY($2::uuid[]) AND m.status='approved'
       AND m.deleted_at IS NULL AND m.sensitivity=ANY($3::text[])
       AND NOT EXISTS (SELECT 1 FROM unnest(m.topics) topic CROSS JOIN unnest($5::text[]) restricted WHERE length(trim(restricted))>0 AND (strpos(lower(topic),lower(trim(restricted)))>0 OR strpos(lower(trim(restricted)),lower(topic))>0))
       AND NOT EXISTS (
        SELECT 1 FROM claim c JOIN claim_evidence e ON e.claim_id=c.id
        LEFT JOIN source_asset s ON s.id=e.source_asset_id
        WHERE c.memory_id=m.id AND (s.id IS NULL OR s.deleted_at IS NOT NULL
          OR s.status IN ('rejected','deleted','uploading','quarantined','scanning')
          OR (s.privacy->>'allowExport') IS DISTINCT FROM 'true'
          OR s.id=ANY($4::uuid[]) OR NOT(s.sensitivity=ANY($3::text[]))
          OR (s.embargo_until IS NOT NULL AND s.embargo_until>now()))
       )
      ORDER BY array_position($2::uuid[],m.id)`,
            [
              params.archiveId,
              body.memoryIds,
              allowedSensitivities(decision.obligations.maxSensitivity),
              decision.obligations.excludedSourceIds,
              decision.obligations.restrictedTopics,
            ],
          );
          if (rows.length !== body.memoryIds.length)
            throw notFound(
              'One or more stories are no longer approved or available for export. Refresh your selection.',
            );
          const refs = await tx.query<{ memory_id: string; original_filename: string }>(
            `SELECT DISTINCT c.memory_id,s.original_filename FROM claim c JOIN claim_evidence e ON e.claim_id=c.id JOIN source_asset s ON s.id=e.source_asset_id WHERE c.archive_id=$1 AND c.memory_id=ANY($2::uuid[]) AND c.status='approved' AND c.sensitivity=ANY($3::text[])`,
            [
              params.archiveId,
              body.memoryIds,
              allowedSensitivities(decision.obligations.maxSensitivity),
            ],
          );
          const stories: KeepsakeStory[] = rows.map((r) => ({
            ...r,
            sources: refs.filter((x) => x.memory_id === r.id).map((x) => x.original_filename),
          }));
          return {
            html: renderKeepsake(body.title, body.dedication, stories),
            count: stories.length,
          };
        },
      ),
  });
}
