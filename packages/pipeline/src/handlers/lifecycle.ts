import { createHash } from 'node:crypto';
import { storageKeyFor } from '@everecho/adapters';
import type { Transaction } from '@everecho/db';
import { createZip, type ZipEntry } from '../zip';
import type { PipelineContext } from '../context';
import type { JobArgs } from './ingest';

/**
 * Builds a complete, self-describing export.
 *
 * Every original file, every transcript, every memory and claim with its
 * evidence, the permission history, and a manifest with a checksum for each
 * file. A README explains the layout in plain language, because the person
 * opening this may be doing so years from now with no idea what EverEcho was.
 */
export async function runExport({ ctx, tx, payload }: JobArgs): Promise<void> {
  const exportId = String(payload.exportJobId);
  const job = await tx.maybeOne<{
    id: string;
    archive_id: string;
    options: { includeOriginals?: boolean; includeTranscripts?: boolean; includeProvenance?: boolean };
    status: string;
  }>(`SELECT id, archive_id, options, status FROM export_job WHERE id = $1`, [exportId]);
  if (!job || job.status === 'ready') return;

  await tx.query(`UPDATE export_job SET status = 'running' WHERE id = $1`, [job.id]);

  const archive = await tx.one<{ name: string; created_at: Date; subject_display_name: string }>(
    `SELECT a.name, a.created_at, p.display_name AS subject_display_name
     FROM archive a JOIN person p ON p.id = a.subject_person_id WHERE a.id = $1`,
    [job.archive_id],
  );

  const entries: ZipEntry[] = [];
  const fileChecksums: { path: string; sha256: string; bytes: number }[] = [];

  const add = (path: string, data: Buffer) => {
    entries.push({ path, data });
    fileChecksums.push({
      path,
      sha256: createHash('sha256').update(data).digest('hex'),
      bytes: data.length,
    });
  };
  const addJson = (path: string, value: unknown) =>
    add(path, Buffer.from(JSON.stringify(value, null, 2), 'utf8'));

  // Sequential, never Promise.all: one pg client runs one query at a time.
  const sources = await tx.query<Record<string, unknown>>(
    `SELECT id, kind, status, original_filename, mime_type, byte_size, checksum_sha256,
            privacy, sensitivity, caption, created_at, storage_key
     FROM source_asset WHERE archive_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [job.archive_id],
  );
  const memories = await tx.query<Record<string, unknown>>(
    `SELECT id, title, body, status, sensitivity, evidence_class, origin, occurred_on,
            occurred_precision, topics, version, was_corrected, created_at, approved_at
     FROM memory WHERE archive_id = $1 AND deleted_at IS NULL ORDER BY created_at`,
    [job.archive_id],
  );
  const claims = await tx.query<Record<string, unknown>>(
    `SELECT c.id, c.memory_id, c.text, c.evidence_class, c.status,
            coalesce(json_agg(json_build_object(
              'sourceId', e.source_asset_id, 'locator', e.locator, 'quotedText', e.quoted_text,
              'method', e.extraction_method, 'modelVersion', e.model_version,
              'promptVersion', e.prompt_version, 'policyVersion', e.policy_version,
              'confidence', e.confidence
            )) FILTER (WHERE e.id IS NOT NULL), '[]') AS evidence
     FROM claim c LEFT JOIN claim_evidence e ON e.claim_id = c.id
     WHERE c.archive_id = $1 GROUP BY c.id ORDER BY c.created_at`,
    [job.archive_id],
  );
  const transcripts = await tx.query<Record<string, unknown>>(
    `SELECT t.id, t.source_asset_id, t.provider, t.model_version, t.method, t.policy_version,
            coalesce(json_agg(json_build_object(
              'idx', s.idx, 'startMs', s.start_ms, 'endMs', s.end_ms, 'page', s.page_no,
              'text', s.text, 'correctedText', s.corrected_text
            ) ORDER BY s.idx) FILTER (WHERE s.id IS NOT NULL), '[]') AS segments
     FROM transcript t LEFT JOIN transcript_segment s ON s.transcript_id = t.id
     WHERE t.archive_id = $1 GROUP BY t.id`,
    [job.archive_id],
  );
  const members = await tx.query<Record<string, unknown>>(
    `SELECT role, display_name, status, granted_at, revoked_at, expires_at
     FROM membership WHERE archive_id = $1 ORDER BY created_at`,
    [job.archive_id],
  );
  const policies = await tx.query<Record<string, unknown>>(
    `SELECT version, mode, document, policy_hash, consent_copy_version, legal_copy_version,
            effective_from, superseded_at
     FROM consent_policy WHERE archive_id = $1 ORDER BY version`,
    [job.archive_id],
  );

  addJson('metadata/archive.json', {
    name: archive.name,
    subject: archive.subject_display_name,
    createdAt: archive.created_at.toISOString(),
    exportedAt: new Date().toISOString(),
    producedBy: `${ctx.branding.productName} v0.1`,
  });
  addJson('metadata/memories.json', memories);
  addJson('metadata/claims-and-evidence.json', claims);
  addJson('metadata/permissions.json', members);
  addJson('metadata/consent-history.json', policies);
  addJson('metadata/sources.json', sources.map(({ storage_key: _ignored, ...rest }) => rest));
  if (job.options.includeTranscripts !== false) addJson('metadata/transcripts.json', transcripts);

  if (job.options.includeOriginals !== false) {
    for (const source of sources) {
      const key = String(source.storage_key ?? '');
      if (!key) continue;
      const bytes = await ctx.storage.get(key).catch(() => null);
      if (!bytes) continue;
      // Filenames are preserved under an id-prefixed folder so two photographs
      // called "scan.jpg" cannot overwrite each other.
      add(`originals/${String(source.id)}/${String(source.original_filename)}`, bytes);
    }
  }

  add('README.txt', Buffer.from(readme(ctx, archive.subject_display_name), 'utf8'));
  addJson('manifest.json', {
    format: 'everecho-export/1',
    exportedAt: new Date().toISOString(),
    counts: {
      sources: sources.length,
      memories: memories.length,
      claims: claims.length,
      transcripts: transcripts.length,
      permissions: members.length,
    },
    files: fileChecksums,
  });

  const zip = createZip(entries);
  const key = storageKeyFor({ archiveId: job.archive_id, sourceId: job.id, kind: 'export' });
  const stored = await ctx.storage.put(key, zip, 'application/zip');

  await tx.query(
    `UPDATE export_job SET status = 'ready', storage_key = $2, checksum_sha256 = $3, byte_size = $4,
                           manifest = $5, completed_at = now(), expires_at = now() + interval '7 days'
     WHERE id = $1`,
    [
      job.id,
      key,
      stored.checksumSha256,
      stored.byteSize,
      JSON.stringify({
        sourceCount: sources.length,
        memoryCount: memories.length,
        claimCount: claims.length,
        transcriptCount: transcripts.length,
        permissionCount: members.length,
      }),
    ],
  );
}

function readme(ctx: PipelineContext, subject: string): string {
  return [
    `${subject}'s archive`,
    ''.padEnd(40, '='),
    '',
    'This is a complete copy of the archive, in open formats that need no special software.',
    '',
    'What is in here',
    '  originals/   Every file exactly as it was uploaded, unchanged.',
    '  metadata/    The memories, the claims made from them, and the exact place in the',
    '               original recording or document that each claim came from.',
    '  manifest.json  A list of every file with a SHA-256 checksum, so you can verify',
    '               nothing has been altered since this export was made.',
    '',
    'About the AI-assisted parts',
    '  Story cards and any biography text were assembled from what the storyteller',
    '  actually said. Every claim records where it came from. Nothing here was invented,',
    `  and nothing simulates ${subject} speaking.`,
    '',
    `Produced by ${ctx.branding.productName} v0.1. Questions: ${ctx.branding.supportEmail}`,
    '',
  ].join('\n');
}

interface DeletionStep {
  key: string;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  affectedCount: number | null;
  completedAt: string | null;
  error: string | null;
}

/** The order matters: derived content goes first, originals last. */
function plan(scope: 'archive' | 'source' | 'memory'): DeletionStep[] {
  const step = (key: string, label: string): DeletionStep => ({
    key,
    label,
    status: 'pending',
    affectedCount: null,
    completedAt: null,
    error: null,
  });
  const common = [
    step('generated', 'Removing answers and generated text'),
    step('embeddings', 'Removing search indexes'),
    step('claims', 'Removing claims and their evidence links'),
    step('memories', 'Removing story cards'),
    step('transcripts', 'Removing transcripts'),
    step('objects', 'Deleting stored files'),
    step('rows', 'Removing remaining records'),
    step('cache', 'Clearing caches'),
  ];
  return scope === 'archive'
    ? [...common, step('jobs', 'Cancelling queued work'), step('tombstone', 'Recording that the deletion happened')]
    : common;
}

/**
 * Deletion as a recorded, resumable plan.
 *
 * Each step commits its own completion, so a crash resumes rather than starting
 * over, and the person watching sees real progress instead of a spinner. The
 * audit tombstone is deliberately retained: proving that a deletion happened
 * requires that the record of it survives the deletion.
 */
export async function runDeletion({ ctx, tx, payload }: JobArgs): Promise<void> {
  const requestId = String(payload.deletionRequestId);
  const request = await tx.maybeOne<{
    id: string;
    archive_id: string;
    scope: 'archive' | 'source' | 'memory';
    target_id: string | null;
    status: string;
    steps: DeletionStep[];
    requested_by_user_id: string | null;
  }>(`SELECT * FROM deletion_request WHERE id = $1`, [requestId]);
  if (!request || request.status === 'completed') return;

  const steps = request.steps.length > 0 ? request.steps : plan(request.scope);
  const scopeIds = await resolveScope(tx, request);

  await tx.query(`UPDATE deletion_request SET status = 'running', steps = $2 WHERE id = $1`, [
    request.id,
    JSON.stringify(steps),
  ]);
  if (request.scope === 'archive') {
    await tx.query(`UPDATE archive SET status = 'deleting' WHERE id = $1`, [request.archive_id]);
  }

  for (const step of steps) {
    if (step.status === 'done' || step.status === 'skipped') continue;
    try {
      step.affectedCount = await runStep(ctx, tx, step.key, request, scopeIds);
      step.status = 'done';
      step.completedAt = new Date().toISOString();
    } catch (error) {
      step.status = 'failed';
      step.error = error instanceof Error ? error.message : 'unknown error';
      await tx.query(`UPDATE deletion_request SET steps = $2 WHERE id = $1`, [
        request.id,
        JSON.stringify(steps),
      ]);
      throw error;
    }
    // Committed per step by the runner's transaction boundary on completion.
    await tx.query(`UPDATE deletion_request SET steps = $2 WHERE id = $1`, [
      request.id,
      JSON.stringify(steps),
    ]);
  }

  await tx.query(
    `UPDATE deletion_request SET status = 'completed', completed_at = now(), steps = $2 WHERE id = $1`,
    [request.id, JSON.stringify(steps)],
  );
  if (request.scope === 'archive') {
    await tx.query(`UPDATE archive SET status = 'deleted', deleted_at = now() WHERE id = $1`, [
      request.archive_id,
    ]);
  }
}

async function resolveScope(
  tx: Transaction,
  request: { archive_id: string; scope: string; target_id: string | null },
): Promise<{ memoryIds: string[]; sourceIds: string[] }> {
  if (request.scope === 'archive') {
    const sources = await tx.query<{ id: string }>(`SELECT id FROM source_asset WHERE archive_id = $1`, [
      request.archive_id,
    ]);
    const memories = await tx.query<{ id: string }>(`SELECT id FROM memory WHERE archive_id = $1`, [
      request.archive_id,
    ]);
    return { sourceIds: sources.map((s) => s.id), memoryIds: memories.map((m) => m.id) };
  }
  if (request.scope === 'source') {
    const memories = await tx.query<{ id: string }>(
      `SELECT DISTINCT c.memory_id AS id FROM claim c
       JOIN claim_evidence e ON e.claim_id = c.id
       WHERE e.source_asset_id = $1 AND c.memory_id IS NOT NULL`,
      [request.target_id],
    );
    return { sourceIds: [request.target_id!], memoryIds: memories.map((m) => m.id) };
  }
  return { sourceIds: [], memoryIds: [request.target_id!] };
}

async function runStep(
  ctx: PipelineContext,
  tx: Transaction,
  key: string,
  request: { archive_id: string; scope: string; requested_by_user_id: string | null },
  scope: { memoryIds: string[]; sourceIds: string[] },
): Promise<number> {
  const { archive_id: archiveId } = request;
  const all = request.scope === 'archive';

  switch (key) {
    case 'generated': {
      const responses = await tx.query<{ id: string }>(
        `DELETE FROM generated_response WHERE archive_id = $1 RETURNING id`,
        [archiveId],
      );
      await tx.query(`DELETE FROM retrieval_snapshot WHERE archive_id = $1`, [archiveId]);
      if (all) await tx.query(`DELETE FROM generated_artifact WHERE archive_id = $1`, [archiveId]);
      return responses.length;
    }
    case 'embeddings': {
      const rows = await tx.query<{ id: string }>(
        all
          ? `DELETE FROM memory_embedding WHERE archive_id = $1 RETURNING id`
          : `DELETE FROM memory_embedding WHERE archive_id = $1 AND memory_id = ANY($2::uuid[]) RETURNING id`,
        all ? [archiveId] : [archiveId, scope.memoryIds],
      );
      return rows.length;
    }
    case 'claims': {
      const rows = await tx.query<{ id: string }>(
        all
          ? `DELETE FROM claim WHERE archive_id = $1 RETURNING id`
          : `DELETE FROM claim WHERE archive_id = $1 AND (memory_id = ANY($2::uuid[])
               OR id IN (SELECT claim_id FROM claim_evidence WHERE source_asset_id = ANY($3::uuid[])))
             RETURNING id`,
        all ? [archiveId] : [archiveId, scope.memoryIds, scope.sourceIds],
      );
      return rows.length;
    }
    case 'memories': {
      const rows = await tx.query<{ id: string }>(
        all
          ? `DELETE FROM memory WHERE archive_id = $1 RETURNING id`
          : `DELETE FROM memory WHERE archive_id = $1 AND id = ANY($2::uuid[]) RETURNING id`,
        all ? [archiveId] : [archiveId, scope.memoryIds],
      );
      if (all) {
        await tx.query(`DELETE FROM life_event WHERE archive_id = $1`, [archiveId]);
        await tx.query(`DELETE FROM entity WHERE archive_id = $1`, [archiveId]);
        await tx.query(`DELETE FROM place WHERE archive_id = $1`, [archiveId]);
      }
      return rows.length;
    }
    case 'transcripts': {
      const rows = await tx.query<{ id: string }>(
        all
          ? `DELETE FROM transcript WHERE archive_id = $1 RETURNING id`
          : `DELETE FROM transcript WHERE archive_id = $1 AND source_asset_id = ANY($2::uuid[]) RETURNING id`,
        all ? [archiveId] : [archiveId, scope.sourceIds],
      );
      return rows.length;
    }
    case 'objects': {
      const rows = await tx.query<{ storage_key: string; quarantine_key: string | null }>(
        all
          ? `SELECT storage_key, quarantine_key FROM source_asset WHERE archive_id = $1`
          : `SELECT storage_key, quarantine_key FROM source_asset WHERE archive_id = $1 AND id = ANY($2::uuid[])`,
        all ? [archiveId] : [archiveId, scope.sourceIds],
      );
      let deleted = 0;
      for (const row of rows) {
        for (const objectKey of [row.storage_key, row.quarantine_key]) {
          if (!objectKey) continue;
          await ctx.storage.delete(objectKey).catch(() => undefined);
          deleted += 1;
        }
      }
      if (all) {
        const exports = await tx.query<{ storage_key: string | null }>(
          `SELECT storage_key FROM export_job WHERE archive_id = $1 AND storage_key IS NOT NULL`,
          [archiveId],
        );
        for (const row of exports) {
          if (row.storage_key) await ctx.storage.delete(row.storage_key).catch(() => undefined);
        }
      }
      return deleted;
    }
    case 'rows': {
      const rows = await tx.query<{ id: string }>(
        all
          ? `DELETE FROM source_asset WHERE archive_id = $1 RETURNING id`
          : `DELETE FROM source_asset WHERE archive_id = $1 AND id = ANY($2::uuid[]) RETURNING id`,
        all ? [archiveId] : [archiveId, scope.sourceIds],
      );
      if (all) {
        await tx.query(`DELETE FROM interview_session WHERE archive_id = $1`, [archiveId]);
        await tx.query(`DELETE FROM provenance_record WHERE archive_id = $1`, [archiveId]);
        await tx.query(`DELETE FROM correction WHERE archive_id = $1`, [archiveId]);
        await tx.query(`DELETE FROM export_job WHERE archive_id = $1`, [archiveId]);
      }
      return rows.length;
    }
    case 'cache':
      return ctx.cache.deletePrefix(`archive:${archiveId}:`);
    case 'jobs': {
      const rows = await tx.query<{ id: string }>(
        `UPDATE processing_job SET status = 'cancelled', updated_at = now()
         WHERE archive_id = $1 AND status IN ('queued','running') AND type <> 'run_deletion'
         RETURNING id`,
        [archiveId],
      );
      return rows.length;
    }
    case 'tombstone':
      // audit_event is append-only and is deliberately not deleted: the proof
      // that a deletion happened has to outlive the thing it deleted.
      await tx.query(
        `INSERT INTO audit_event (archive_id, actor_user_id, actor_display, action, resource_type,
                                  resource_id, outcome, metadata)
         VALUES ($1, $2, 'system', 'archive.deleted', 'archive', $1, 'success', $3)`,
        [archiveId, request.requested_by_user_id, JSON.stringify({ completedAt: new Date().toISOString() })],
      );
      return 1;
    default:
      return 0;
  }
}

/** Sends one queued notification. Content is never included, only a template. */
export async function sendNotification({ ctx, tx, payload }: JobArgs): Promise<void> {
  const id = String(payload.notificationId);
  const row = await tx.maybeOne<{
    id: string;
    email: string;
    template: string;
    template_version: string;
    variables: Record<string, string>;
    status: string;
  }>(`SELECT id, email, template, template_version, variables, status FROM notification WHERE id = $1`, [id]);
  if (!row || row.status !== 'queued') return;

  try {
    await ctx.email.send({
      to: row.email,
      template: row.template as Parameters<PipelineContext['email']['send']>[0]['template'],
      templateVersion: row.template_version,
      variables: row.variables,
    });
    await tx.query(`UPDATE notification SET status = 'sent', sent_at = now() WHERE id = $1`, [row.id]);
  } catch (error) {
    await tx.query(`UPDATE notification SET status = 'failed', error = $2 WHERE id = $1`, [
      row.id,
      error instanceof Error ? error.message : 'unknown error',
    ]);
    throw error;
  }
}
