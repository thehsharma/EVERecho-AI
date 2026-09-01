import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  correctSegmentRequestSchema,
  createUploadRequestSchema,
  sourceAssetSchema,
  sourcePrivacyChoicesSchema,
  transcriptSchema,
  uploadTicketSchema,
} from '@everecho/contracts';
import { enqueueJob, recordAuditEvent } from '@everecho/db';
import { storageKeyFor } from '@everecho/adapters';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { ApiError, notFound, validationFailed } from '../errors';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });
const sourceParams = archiveParams.extend({ sourceId: z.uuid() });

interface SourceRow {
  id: string;
  archive_id: string;
  kind: 'audio' | 'video' | 'photo' | 'document' | 'text';
  status:
    | 'uploading'
    | 'quarantined'
    | 'scanning'
    | 'rejected'
    | 'stored'
    | 'processing'
    | 'processed'
    | 'processing_failed'
    | 'deleted';
  original_filename: string;
  mime_type: string;
  byte_size: number;
  checksum_sha256: string | null;
  privacy: z.infer<typeof sourcePrivacyChoicesSchema>;
  caption: string | null;
  scan_result: 'pending' | 'clean' | 'infected' | 'unsupported' | 'error';
  uploaded_by_user_id: string | null;
  created_at: Date;
  processed_at: Date | null;
  processing_stage: 'queued' | 'scanning' | 'transcribing' | 'extracting' | 'ready' | 'failed' | 'skipped';
  processing_detail: string | null;
  processing_attempts: number;
  sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
  embargo_until: Date | null;
  transcript_id: string | null;
}

function toSourceAsset(row: SourceRow) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    kind: row.kind,
    status: row.status,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    checksum: row.checksum_sha256
      ? { algorithm: 'sha256' as const, value: row.checksum_sha256 }
      : null,
    privacy: row.privacy,
    caption: row.caption,
    scanResult: row.scan_result,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: row.created_at.toISOString(),
    processedAt: row.processed_at?.toISOString() ?? null,
    processing: {
      stage: row.processing_stage,
      detail: row.processing_detail,
      attempts: row.processing_attempts,
    },
    transcriptId: row.transcript_id,
  };
}

const SOURCE_SELECT = `
  SELECT s.*, t.id AS transcript_id
  FROM source_asset s
  LEFT JOIN LATERAL (
    SELECT id FROM transcript WHERE source_asset_id = s.id ORDER BY created_at DESC LIMIT 1
  ) t ON true
`;

export function registerSourceRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/sources',
    tag: 'sources',
    summary: 'Reserve an upload and get a short-lived signed link',
    description:
      'Creates the source record and returns an expiring, signed upload URL. Nothing is ' +
      'processed on arrival: the bytes land in quarantine and are scanned before anything ' +
      'else may touch them.',
    auth: 'required',
    params: archiveParams,
    body: createUploadRequestSchema,
    response: z.object({ ticket: uploadTicketSchema, source: sourceAssetSchema }),
    status: 201,
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'source.upload',
          resource: { type: 'source_asset', dataCategories: body.privacy.dataCategories },
          auditOnAllow: true,
          auditMetadata: { kind: body.kind, byteSize: body.byteSize, mimeType: body.mimeType },
        },
        async ({ tx, user }) => {
          if (!ctx.cfg.uploadAllowedMime.includes(body.mimeType)) {
            throw new ApiError('unsupported_media_type', 'That file type is not accepted.');
          }
          if (body.byteSize > ctx.cfg.env.UPLOAD_MAX_BYTES) {
            throw new ApiError('payload_too_large', 'That file is larger than the limit.');
          }

          const existing = await tx.maybeOne<SourceRow>(
            `${SOURCE_SELECT} WHERE s.archive_id = $1 AND s.idempotency_key = $2`,
            [params.archiveId, body.idempotencyKey],
          );

          const row =
            existing ??
            (await tx.one<SourceRow>(
              `INSERT INTO source_asset
                 (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
                  quarantine_key, privacy, sensitivity, embargo_until, caption, uploaded_by_user_id,
                  idempotency_key, processing_stage)
               VALUES ($1,$2,'uploading',$3,$4,$5,'','',$6,$7,$8,$9,$10,$11,'queued')
               RETURNING *, NULL::uuid AS transcript_id`,
              [
                params.archiveId,
                body.kind,
                body.filename,
                body.mimeType,
                body.byteSize,
                JSON.stringify(body.privacy),
                body.privacy.sensitivity,
                body.privacy.embargoUntil ?? null,
                body.caption ?? null,
                user.id,
                body.idempotencyKey,
              ],
            ));

          const quarantineKey = storageKeyFor({
            archiveId: params.archiveId,
            sourceId: row.id,
            kind: 'quarantine',
          });
          await tx.query(`UPDATE source_asset SET quarantine_key = $2 WHERE id = $1`, [row.id, quarantineKey]);

          const signed = await ctx.storage.signUpload(
            quarantineKey,
            body.mimeType,
            ctx.cfg.env.STORAGE_SIGNED_URL_TTL_SECONDS,
          );
          return {
            ticket: {
              sourceId: row.id,
              uploadUrl: signed.url,
              // Upload signing always yields PUT; the union in SignedUrl covers
              // download too, and narrowing here keeps the contract honest.
              method: 'PUT' as const,
              headers: signed.headers,
              expiresAt: signed.expiresAt,
              maxBytes: ctx.cfg.env.UPLOAD_MAX_BYTES,
            },
            source: toSourceAsset({ ...row, quarantine_key: quarantineKey } as SourceRow),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/sources/:sourceId/complete',
    tag: 'sources',
    summary: 'Confirm the bytes arrived, and start processing',
    description:
      'Verifies the stored object, records its checksum as the immutable original, and queues ' +
      'a malware scan. The scan job is enqueued in the same transaction as the state change, so ' +
      'a source can never exist with no work scheduled for it.',
    auth: 'required',
    params: sourceParams,
    body: z.object({
      /**
       * Text captured alongside a recording — the browser's live transcription
       * during an interview. Real content, stored as such, never invented.
       */
      sidecarText: z.string().max(200_000).optional(),
      durationMs: z.number().int().min(0).optional(),
    }),
    response: z.object({ source: sourceAssetSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'source.upload',
          resource: { type: 'source_asset', id: params.sourceId, sourceId: params.sourceId },
        },
        async ({ tx }) => {
          const row = await tx.maybeOne<SourceRow & { quarantine_key: string }>(
            `${SOURCE_SELECT} WHERE s.id = $1 AND s.archive_id = $2`,
            [params.sourceId, params.archiveId],
          );
          if (!row) throw notFound('That upload was not found.');
          if (row.status !== 'uploading') return { source: toSourceAsset(row) };

          const head = await ctx.storage.head(row.quarantine_key);
          if (!head) throw validationFailed('The file did not finish uploading. Please try again.');

          const bytes = await ctx.storage.get(row.quarantine_key);
          const { createHash } = await import('node:crypto');
          const checksum = createHash('sha256').update(bytes).digest('hex');

          const updated = await tx.one<SourceRow>(
            `UPDATE source_asset
             SET status = 'quarantined', byte_size = $2, checksum_sha256 = $3,
                 processing_stage = 'scanning', updated_at = now()
             WHERE id = $1 RETURNING *, NULL::uuid AS transcript_id`,
            [row.id, head.byteSize, checksum],
          );

          if (body.sidecarText) {
            // Stored as its own transcript-shaped record so the pipeline treats
            // it exactly like any other text, with its own provenance.
            await tx.query(
              `INSERT INTO provenance_record (archive_id, subject_type, subject_id, record)
               VALUES ($1, 'sidecar_text', $2, $3)`,
              [
                params.archiveId,
                row.id,
                JSON.stringify({ text: body.sidecarText, durationMs: body.durationMs ?? null, capturedBy: 'browser' }),
              ],
            );
          }

          await enqueueJob(tx, {
            archiveId: params.archiveId,
            type: 'scan_source',
            payload: { sourceId: row.id },
            idempotencyKey: `scan:${row.id}`,
          });
          await ctx.analytics.track('source_uploaded', {
            archiveId: params.archiveId,
            props: { byteSize: head.byteSize },
          });

          return { source: toSourceAsset(updated) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/sources',
    tag: 'sources',
    summary: 'Sources in this archive',
    auth: 'required',
    params: archiveParams,
    query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }),
    response: z.object({ sources: z.array(sourceAssetSchema) }),
    handler: async ({ params, query, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'source.read', resource: { type: 'source_asset' } },
        async ({ tx, decision, subject, user, archive }) => {
          const isStoryteller = archive.storyteller_user_id === user.id;
          const rows = await tx.query<SourceRow>(
            `${SOURCE_SELECT}
             WHERE s.archive_id = $1
               AND s.deleted_at IS NULL
               AND ($2 OR (
                 s.sensitivity = ANY($3::text[])
                 AND NOT (s.id = ANY($4::uuid[]))
                 AND (s.embargo_until IS NULL OR s.embargo_until <= now())
               ))
             ORDER BY s.created_at DESC LIMIT $5`,
            [
              params.archiveId,
              isStoryteller,
              allowedSensitivities(decision.obligations.maxSensitivity),
              subject.policy?.document.excludedSourceIds ?? [],
              query.limit,
            ],
          );
          return { sources: rows.map(toSourceAsset) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/sources/:sourceId/download',
    tag: 'sources',
    summary: 'A short-lived link to the original file',
    description:
      'Issued only after the consent policy permits this reader to see this source, and the ' +
      'access is written to the audit trail before the link is returned.',
    auth: 'required',
    params: sourceParams,
    response: z.object({ url: z.string(), expiresAt: z.iso.datetime() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'source.download',
          resource: { type: 'source_asset', id: params.sourceId, sourceId: params.sourceId },
          auditOnAllow: true,
        },
        async ({ tx, decision, user, archive }) => {
          const row = await tx.maybeOne<{
            storage_key: string;
            quarantine_key: string | null;
            status: string;
            sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
            embargo_until: Date | null;
          }>(
            `SELECT storage_key, quarantine_key, status, sensitivity, embargo_until
             FROM source_asset WHERE id = $1 AND archive_id = $2 AND deleted_at IS NULL`,
            [params.sourceId, params.archiveId],
          );
          if (!row || row.status === 'deleted') throw notFound('That source was not found.');

          // Re-check this specific source against the grant: the route-level
          // decision was made before we knew which source was being asked for.
          const isStoryteller = archive.storyteller_user_id === user.id;
          if (!isStoryteller) {
            if (!allowedSensitivities(decision.obligations.maxSensitivity).includes(row.sensitivity)) {
              throw new ApiError(
                'forbidden',
                'This material is more private than what you have been given access to.',
                { reasonCode: 'sensitivity_above_grant' },
              );
            }
            if (row.embargo_until && row.embargo_until.getTime() > Date.now()) {
              throw new ApiError('forbidden', 'The storyteller has held this material back until a later date.', {
                reasonCode: 'source_embargoed',
              });
            }
          }
          if (row.status === 'quarantined' || row.status === 'scanning') {
            throw new ApiError('processing_failed', 'This file is still being checked. Try again shortly.');
          }

          const key = row.storage_key || row.quarantine_key || '';
          const signed = await ctx.storage.signDownload(key, ctx.cfg.env.STORAGE_SIGNED_URL_TTL_SECONDS);
          return { url: signed.url, expiresAt: signed.expiresAt };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PATCH',
    url: '/v1/archives/:archiveId/sources/:sourceId/privacy',
    tag: 'sources',
    summary: 'Change what may be done with one source',
    auth: 'required',
    params: sourceParams,
    body: sourcePrivacyChoicesSchema,
    response: z.object({ source: sourceAssetSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'source.update_privacy',
          resource: { type: 'source_asset', id: params.sourceId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const row = await tx.maybeOne<SourceRow>(
            `UPDATE source_asset SET privacy = $3, sensitivity = $4, embargo_until = $5, updated_at = now()
             WHERE id = $1 AND archive_id = $2
             RETURNING *, NULL::uuid AS transcript_id`,
            [
              params.sourceId,
              params.archiveId,
              JSON.stringify(body),
              body.sensitivity,
              body.embargoUntil ?? null,
            ],
          );
          if (!row) throw notFound('That source was not found.');
          return { source: toSourceAsset(row) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/sources/:sourceId/transcript',
    tag: 'sources',
    summary: 'The transcript for a source, with corrections applied',
    auth: 'required',
    params: sourceParams,
    response: z.object({ transcript: transcriptSchema.nullable() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'transcript.read',
          resource: { type: 'transcript', sourceId: params.sourceId },
        },
        async ({ tx }) => {
          const transcript = await tx.maybeOne<{
            id: string;
            source_asset_id: string;
            provider: string;
            model_version: string;
            language: string;
            status: 'pending' | 'ready' | 'failed';
            created_at: Date;
          }>(
            `SELECT id, source_asset_id, provider, model_version, language, status, created_at
             FROM transcript WHERE source_asset_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [params.sourceId],
          );
          if (!transcript) return { transcript: null };

          const segments = await tx.query<{
            id: string;
            idx: number;
            start_ms: number | null;
            end_ms: number | null;
            page_no: number | null;
            text: string;
            confidence: number | null;
            corrected_text: string | null;
          }>(
            `SELECT id, idx, start_ms, end_ms, page_no, text, confidence, corrected_text
             FROM transcript_segment WHERE transcript_id = $1 ORDER BY idx`,
            [transcript.id],
          );

          return {
            transcript: {
              id: transcript.id,
              sourceAssetId: transcript.source_asset_id,
              provider: transcript.provider,
              modelVersion: transcript.model_version,
              language: transcript.language,
              status: transcript.status,
              createdAt: transcript.created_at.toISOString(),
              segments: segments.map((s) => ({
                id: s.id,
                index: s.idx,
                startMs: s.start_ms,
                endMs: s.end_ms,
                page: s.page_no,
                text: s.text,
                confidence: s.confidence,
                correctedText: s.corrected_text,
              })),
            },
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PATCH',
    url: '/v1/archives/:archiveId/transcript-segments/:segmentId',
    tag: 'sources',
    summary: 'Correct a line of a transcript',
    description:
      'The machine transcript is kept alongside the correction rather than replaced. Nothing ' +
      'about the original source is ever rewritten.',
    auth: 'required',
    params: archiveParams.extend({ segmentId: z.uuid() }),
    body: correctSegmentRequestSchema,
    response: z.object({ segmentId: z.uuid(), correctedText: z.string() }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'transcript.correct',
          resource: { type: 'transcript', id: params.segmentId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const previous = await tx.maybeOne<{ text: string; corrected_text: string | null }>(
            `SELECT text, corrected_text FROM transcript_segment WHERE id = $1 AND archive_id = $2`,
            [params.segmentId, params.archiveId],
          );
          if (!previous) throw notFound('That line was not found.');

          await tx.query(
            `UPDATE transcript_segment
             SET corrected_text = $2, corrected_by_user_id = $3, corrected_at = now()
             WHERE id = $1`,
            [params.segmentId, body.correctedText, user.id],
          );
          await tx.query(
            `INSERT INTO correction (archive_id, target_type, target_id, previous_value, next_value,
                                     actor_user_id, actor_role, reason, status)
             VALUES ($1, 'transcript_segment', $2, $3, $4, $5, 'storyteller', $6, 'applied')`,
            [
              params.archiveId,
              params.segmentId,
              JSON.stringify({ text: previous.corrected_text ?? previous.text }),
              JSON.stringify({ text: body.correctedText }),
              user.id,
              body.reason ?? null,
            ],
          );
          return { segmentId: params.segmentId, correctedText: body.correctedText };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'DELETE',
    url: '/v1/archives/:archiveId/sources/:sourceId',
    tag: 'sources',
    summary: 'Delete a source and everything derived from it',
    auth: 'required',
    params: sourceParams,
    response: z.object({ deletionRequestId: z.uuid() }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'source.delete',
          resource: { type: 'source_asset', id: params.sourceId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const row = await tx.one<{ id: string }>(
            `INSERT INTO deletion_request (archive_id, requested_by_user_id, scope, target_id, status, steps)
             VALUES ($1, $2, 'source', $3, 'pending', '[]'::jsonb) RETURNING id`,
            [params.archiveId, user.id, params.sourceId],
          );
          await enqueueJob(tx, {
            archiveId: params.archiveId,
            type: 'run_deletion',
            payload: { deletionRequestId: row.id },
            idempotencyKey: `deletion:${row.id}`,
          });
          await recordAuditEvent(tx, {
            archiveId: params.archiveId,
            actorUserId: user.id,
            actorDisplay: user.displayName,
            action: 'source.delete',
            resourceType: 'source_asset',
            resourceId: params.sourceId,
            outcome: 'success',
            requestId: request.id,
          });
          return { deletionRequestId: row.id };
        },
      ),
  });
}

/** Sensitivity levels at or below a grant's ceiling. */
export function allowedSensitivities(max: 'normal' | 'sensitive' | 'restricted' | 'embargoed'): string[] {
  const order = ['normal', 'sensitive', 'restricted', 'embargoed'];
  return order.slice(0, order.indexOf(max) + 1);
}
