import type { Queryable } from '../pool';

export interface AuditInput {
  archiveId: string | null;
  actorUserId: string | null;
  actorDisplay?: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome: 'allow' | 'deny' | 'success' | 'failure';
  reasonCode?: string | null;
  policyVersion?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Keys whose values are memory-adjacent and must never reach an audit row, a
 * log line or a support dashboard. Redaction happens on write, not on read:
 * a redaction applied at read time has already been written to disk.
 */
const FORBIDDEN_METADATA_KEYS = new Set([
  'body',
  'text',
  'title',
  'question',
  'answer',
  'transcript',
  'quotedText',
  'quoted_text',
  'caption',
  'filename',
  'originalFilename',
  'original_filename',
  'summary',
  'note',
  'personalNote',
  'responseText',
  'email',
  'password',
  'token',
]);

export function redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      // Keep the shape of what happened without the content of it.
      safe[`${key}Length`] = typeof value === 'string' ? value.length : null;
      continue;
    }
    if (typeof value === 'string' && value.length > 200) {
      safe[key] = `${value.slice(0, 40)}…`;
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      safe[key] = redactMetadata(value as Record<string, unknown>);
      continue;
    }
    safe[key] = value;
  }
  return safe;
}

export async function recordAuditEvent(q: Queryable, input: AuditInput): Promise<void> {
  await q.query(
    `INSERT INTO audit_event
       (archive_id, actor_user_id, actor_display, action, resource_type, resource_id,
        outcome, reason_code, policy_version, request_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      input.archiveId,
      input.actorUserId,
      input.actorDisplay ?? 'system',
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.outcome,
      input.reasonCode ?? null,
      input.policyVersion ?? null,
      input.requestId ?? null,
      JSON.stringify(redactMetadata(input.metadata ?? {})),
    ],
  );
}

export async function listAuditEvents(
  q: Queryable,
  archiveId: string,
  options: { limit: number; before?: string | null },
) {
  return q.query<{
    id: string;
    archive_id: string | null;
    actor_user_id: string | null;
    actor_display: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    outcome: 'allow' | 'deny' | 'success' | 'failure';
    reason_code: string | null;
    policy_version: string | null;
    request_id: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
  }>(
    `SELECT * FROM audit_event
     WHERE archive_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
     ORDER BY created_at DESC LIMIT $3`,
    [archiveId, options.before ?? null, options.limit],
  );
}
