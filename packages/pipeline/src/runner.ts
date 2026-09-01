import { claimJobs, completeJob, failJob, type JobRow } from '@everecho/db';
import { ConsentRevokedError, type PipelineContext } from './context';
import {
  embedMemory,
  extractCandidates,
  ocrSource,
  scanSource,
  transcribeSource,
  type JobArgs,
} from './handlers/ingest';
import { buildTimeline, composeBiography } from './handlers/derive';
import { runDeletion, runExport, sendNotification } from './handlers/lifecycle';

type Handler = (args: JobArgs) => Promise<void>;

export const HANDLERS: Record<string, Handler> = {
  scan_source: scanSource,
  transcribe_source: transcribeSource,
  ocr_source: ocrSource,
  extract_candidates: extractCandidates,
  embed_memory: embedMemory,
  build_timeline: buildTimeline,
  compose_biography: composeBiography,
  run_export: runExport,
  run_deletion: runDeletion,
  send_notification: sendNotification,
};

export interface RunResult {
  processed: number;
  succeeded: number;
  failed: number;
  deadLettered: number;
  stopped: number;
}

/**
 * Claims a batch of due jobs and runs each one in its own archive-scoped
 * transaction, so a failure rolls back only that job's work.
 *
 * Consent revocation is not a failure: if the storyteller has withdrawn
 * permission since the job was queued, the job stops and is marked cancelled
 * rather than retried until it dead-letters.
 */
export async function runJobBatch(
  ctx: PipelineContext,
  options: { workerId: string; limit?: number; visibilityTimeoutMs?: number } ,
): Promise<RunResult> {
  const jobs = await claimJobs(ctx.db, {
    workerId: options.workerId,
    limit: options.limit ?? 5,
    visibilityTimeoutMs: options.visibilityTimeoutMs ?? 5 * 60_000,
  });

  const result: RunResult = { processed: 0, succeeded: 0, failed: 0, deadLettered: 0, stopped: 0 };

  for (const job of jobs) {
    result.processed += 1;
    try {
      await runOne(ctx, job);
      await completeJob(ctx.db, job.id);
      result.succeeded += 1;
    } catch (error) {
      if (error instanceof ConsentRevokedError) {
        await ctx.db.query(
          `UPDATE processing_job SET status = 'cancelled', last_error = $2, updated_at = now() WHERE id = $1`,
          [job.id, error.reasonCode],
        );
        result.stopped += 1;
        continue;
      }
      const outcome = await failJob(ctx.db, job, error instanceof Error ? error.message : String(error));
      if (outcome === 'dead_lettered') {
        result.deadLettered += 1;
        await ctx.db.query(
          `INSERT INTO incident (kind, severity, summary, archive_id)
           VALUES ('availability', 'medium', $1, $2)`,
          [`Background job "${job.type}" gave up after ${job.attempts} attempts`, job.archive_id],
        );
      } else {
        result.failed += 1;
      }
    }
  }
  return result;
}

async function runOne(ctx: PipelineContext, job: JobRow): Promise<void> {
  const handler = HANDLERS[job.type];
  if (!handler) throw new Error(`No handler is registered for job type "${job.type}"`);
  if (!job.archive_id) throw new Error(`Job ${job.type} has no archive scope`);

  await ctx.db.withArchiveScope(job.archive_id, async (tx) => {
    await handler({ ctx, tx, archiveId: job.archive_id!, payload: job.payload });
  });
}

/** Drains the queue until nothing is due. Used by tests and by one-shot runs. */
export async function drainQueue(
  ctx: PipelineContext,
  options: { workerId?: string; maxBatches?: number } = {},
): Promise<RunResult> {
  const total: RunResult = { processed: 0, succeeded: 0, failed: 0, deadLettered: 0, stopped: 0 };
  for (let i = 0; i < (options.maxBatches ?? 50); i += 1) {
    const batch = await runJobBatch(ctx, { workerId: options.workerId ?? 'drain', limit: 20 });
    total.processed += batch.processed;
    total.succeeded += batch.succeeded;
    total.failed += batch.failed;
    total.deadLettered += batch.deadLettered;
    total.stopped += batch.stopped;
    if (batch.processed === 0) break;
  }
  return total;
}
