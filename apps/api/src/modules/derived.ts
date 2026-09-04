import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  biographySchema,
  timelineSchema,
  updateBiographySectionRequestSchema,
} from '@everecho/contracts';
import { enqueueJob } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound } from '../errors';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });

interface ArtifactRow {
  id: string;
  content: Record<string, unknown>;
  status: 'draft' | 'edited' | 'approved';
  model_version: string;
  prompt_version: string;
  policy_version: string;
  generated_at: Date;
}

export function registerDerivedRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/timeline',
    tag: 'timeline',
    summary: 'The life timeline, with its gaps stated honestly',
    description:
      'Undated material is listed separately rather than placed at a guessed year, and decades ' +
      'with no material are reported as gaps — the most useful thing the next interview can know.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ timeline: timelineSchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'timeline.read', resource: { type: 'timeline' } },
        async ({ tx }) => {
          const row = await tx.maybeOne<ArtifactRow>(
            `SELECT * FROM generated_artifact WHERE archive_id = $1 AND kind = 'timeline'`,
            [params.archiveId],
          );
          if (!row) {
            // Nothing built yet: queue it rather than returning a broken shell.
            await enqueueJob(tx, {
              archiveId: params.archiveId,
              type: 'build_timeline',
              payload: {},
            });
            return { timeline: null };
          }
          const content = row.content as {
            entries: unknown[];
            undatedEntries: unknown[];
            coverage: unknown;
          };
          return {
            timeline: {
              archiveId: params.archiveId,
              entries: content.entries as never,
              undatedEntries: content.undatedEntries as never,
              generatedAt: row.generated_at.toISOString(),
              coverage: content.coverage as never,
            },
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/biography',
    tag: 'biography',
    summary: 'The editable third-person biography draft',
    description:
      'Always labelled AI-assisted, always third person, always citing the memories each ' +
      'section drew on. It is a draft for the storyteller to correct, not a finished portrait.',
    auth: 'required',
    params: archiveParams,
    response: z.object({ biography: biographySchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'biography.read', resource: { type: 'biography' } },
        async ({ tx }) => {
          const row = await tx.maybeOne<ArtifactRow>(
            `SELECT * FROM generated_artifact WHERE archive_id = $1 AND kind = 'biography'`,
            [params.archiveId],
          );
          if (!row) return { biography: null };
          const content = row.content as { sections: unknown[]; wordCount: number };
          return {
            biography: {
              id: row.id,
              archiveId: params.archiveId,
              sections: content.sections as never,
              status: row.status,
              modelVersion: row.model_version,
              promptVersion: row.prompt_version,
              policyVersion: row.policy_version,
              generatedAt: row.generated_at.toISOString(),
              wordCount: content.wordCount ?? 0,
              aiAssisted: true as const,
            },
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/biography/generate',
    tag: 'biography',
    summary: 'Draft or redraft the biography from approved memories',
    auth: 'required',
    params: archiveParams,
    response: z.object({ queued: z.literal(true) }),
    status: 202,
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'biography.generate',
          resource: { type: 'biography' },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          await enqueueJob(tx, {
            archiveId: params.archiveId,
            type: 'compose_biography',
            payload: {},
          });
          return { queued: true as const };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PATCH',
    url: '/v1/archives/:archiveId/biography/sections/:sectionId',
    tag: 'biography',
    summary: 'Edit one section in the storyteller’s own words',
    description:
      'An edited section is marked as edited, so a reader can tell it apart from a draft.',
    auth: 'required',
    params: archiveParams.extend({ sectionId: z.string().min(1).max(80) }),
    body: updateBiographySectionRequestSchema,
    response: z.object({ updated: z.literal(true) }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'biography.update',
          resource: { type: 'biography', id: params.sectionId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const row = await tx.maybeOne<ArtifactRow>(
            `SELECT * FROM generated_artifact WHERE archive_id = $1 AND kind = 'biography'`,
            [params.archiveId],
          );
          if (!row) throw notFound('There is no biography draft yet.');

          const content = row.content as {
            sections: { id: string; heading: string; text: string; edited: boolean }[];
            wordCount: number;
          };
          const section = content.sections.find((s) => s.id === params.sectionId);
          if (!section) throw notFound('That section was not found.');

          const previous = { heading: section.heading, text: section.text };
          section.heading = body.heading ?? section.heading;
          section.text = body.text ?? section.text;
          section.edited = true;
          content.wordCount = content.sections.reduce(
            (sum, s) => sum + s.text.split(/\s+/).length,
            0,
          );

          await tx.query(
            `UPDATE generated_artifact SET content = $2, status = 'edited', updated_at = now() WHERE id = $1`,
            [row.id, JSON.stringify(content)],
          );
          await tx.query(
            `INSERT INTO correction (archive_id, target_type, target_id, previous_value, next_value,
                                     actor_user_id, actor_role, status)
             VALUES ($1, 'biography_section', $2, $3, $4, $5, 'storyteller', 'applied')`,
            [
              params.archiveId,
              row.id,
              JSON.stringify(previous),
              JSON.stringify({ heading: section.heading, text: section.text }),
              user.id,
            ],
          );
          return { updated: true as const };
        },
      ),
  });
}
