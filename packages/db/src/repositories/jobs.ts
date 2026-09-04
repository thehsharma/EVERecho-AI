import type { JobStatus, JobType } from '@everecho/contracts';
import type { Queryable } from '../pool';

export interface JobRow {
  id: string;
  archive_id: string | null;
  type: JobType;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  idempotency_key: string | null;
  created_at: Date;
}

/**
 * Enqueues inside the caller's transaction.
 *
 * This is the reason the queue lives in PostgreSQL: the row that describes the
 * work and the work item itself commit together. A source that exists with no
 * job to process it is an archive that silently loses a recording.
 */
export async function enqueueJob(
  q: Queryable,
  input: {
    archiveId: string | null;
    type: JobType;
    payload: Record<string, unknown>;
    idempotencyKey?: string | null;
    runAfter?: Date | null;
    maxAttempts?: number;
  },
): Promise<JobRow | null> {
  const rows = await q.query<JobRow>(
    `INSERT INTO processing_job (archive_id, type, payload, idempotency_key, run_after, max_attempts)
     VALUES ($1, $2, $3, $4, coalesce($5, now()), coalesce($6, 5))
     ON CONFLICT (type, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      input.archiveId,
      input.type,
      JSON.stringify(input.payload),
      input.idempotencyKey ?? null,
      input.runAfter ?? null,
      input.maxAttempts ?? null,
    ],
  );
  // A null return means the job was already enqueued; that is a success.
  return rows[0] ?? null;
}

/**
 * Claims due jobs with SKIP LOCKED so several workers can poll the same table
 * without coordinating, and a crashed worker's lock expires rather than
 * stranding the job.
 */
export async function claimJobs(
  q: Queryable,
  options: { workerId: string; limit: number; visibilityTimeoutMs: number },
): Promise<JobRow[]> {
  return q.query<JobRow>(
    `UPDATE processing_job SET
       status = 'running',
       attempts = attempts + 1,
       locked_at = now(),
       locked_by = $1,
       updated_at = now()
     WHERE id IN (
       SELECT id FROM processing_job
       WHERE (status = 'queued' AND run_after <= now())
          OR (status = 'running' AND locked_at < now() - make_interval(secs => $3))
       ORDER BY run_after
       FOR UPDATE SKIP LOCKED
       LIMIT $2
     )
     RETURNING *`,
    [options.workerId, options.limit, options.visibilityTimeoutMs / 1000],
  );
}

export async function completeJob(q: Queryable, jobId: string): Promise<void> {
  await q.query(
    `UPDATE processing_job SET status = 'succeeded', completed_at = now(), locked_by = NULL,
                              locked_at = NULL, updated_at = now(), last_error = NULL
     WHERE id = $1`,
    [jobId],
  );
}

/**
 * Exponential backoff, then the dead-letter state. A dead-lettered job is
 * visible in the worker status endpoint and in the admin incident view: work
 * that gave up must be findable, not merely absent.
 */
export async function failJob(
  q: Queryable,
  job: { id: string; attempts: number; max_attempts: number },
  error: string,
): Promise<'retrying' | 'dead_lettered'> {
  const exhausted = job.attempts >= job.max_attempts;
  const backoffSeconds = Math.min(3600, 2 ** Math.min(job.attempts, 10) * 5);
  await q.query(
    exhausted
      ? `UPDATE processing_job SET status = 'dead_lettered', dead_lettered_at = now(),
                                   last_error = $2, locked_by = NULL, locked_at = NULL, updated_at = now()
         WHERE id = $1`
      : `UPDATE processing_job SET status = 'queued', last_error = $2, locked_by = NULL, locked_at = NULL,
                                   run_after = now() + make_interval(secs => $3), updated_at = now()
         WHERE id = $1`,
    exhausted ? [job.id, error.slice(0, 2000)] : [job.id, error.slice(0, 2000), backoffSeconds],
  );
  return exhausted ? 'dead_lettered' : 'retrying';
}

export async function cancelJobsForArchive(
  q: Queryable,
  archiveId: string,
  reason: string,
): Promise<number> {
  const rows = await q.query<{ id: string }>(
    `UPDATE processing_job SET status = 'cancelled', last_error = $2, updated_at = now()
     WHERE archive_id = $1 AND status IN ('queued', 'running') RETURNING id`,
    [archiveId, reason],
  );
  return rows.length;
}

export async function jobStats(q: Queryable) {
  const [totals] = await q.query<{
    queued: number;
    running: number;
    failed_last_hour: number;
    dead_lettered: number;
    oldest_queued_age_seconds: number | null;
  }>(
    `SELECT
       count(*) FILTER (WHERE status = 'queued')::int AS queued,
       count(*) FILTER (WHERE status = 'running')::int AS running,
       count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '1 hour')::int AS failed_last_hour,
       count(*) FILTER (WHERE status = 'dead_lettered')::int AS dead_lettered,
       extract(epoch FROM now() - min(run_after) FILTER (WHERE status = 'queued'))::int AS oldest_queued_age_seconds
     FROM processing_job`,
  );
  const byType = await q.query<{ type: string; queued: number; failed: number }>(
    `SELECT type,
            count(*) FILTER (WHERE status = 'queued')::int AS queued,
            count(*) FILTER (WHERE status IN ('failed','dead_lettered'))::int AS failed
     FROM processing_job GROUP BY type ORDER BY type`,
  );
  return { totals, byType };
}
