import type { ConsentPolicy, ConsentPolicyDocument } from '@everecho/contracts';
import type { Queryable } from '../pool';

export interface ConsentPolicyRow {
  id: string;
  archive_id: string;
  version: number;
  mode: string;
  document: ConsentPolicyDocument;
  policy_hash: string;
  consent_copy_version: string;
  legal_copy_version: string;
  policy_engine_version: string;
  created_by_user_id: string | null;
  effective_from: Date;
  superseded_at: Date | null;
  created_at: Date;
}

export function toConsentPolicy(row: ConsentPolicyRow): ConsentPolicy {
  return {
    id: row.id,
    archiveId: row.archive_id,
    version: row.version,
    document: row.document,
    policyHash: row.policy_hash,
    consentCopyVersion: row.consent_copy_version,
    legalCopyVersion: row.legal_copy_version,
    policyEngineVersion: row.policy_engine_version,
    createdByUserId: row.created_by_user_id ?? '',
    effectiveFrom: row.effective_from.toISOString(),
    supersededAt: row.superseded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** Must be called inside an archive scope: consent_policy is under RLS. */
export async function findCurrentPolicy(
  q: Queryable,
  archiveId: string,
): Promise<ConsentPolicyRow | null> {
  return q.maybeOne<ConsentPolicyRow>(
    `SELECT * FROM consent_policy WHERE archive_id = $1 AND superseded_at IS NULL`,
    [archiveId],
  );
}

export async function listPolicyVersions(q: Queryable, archiveId: string): Promise<ConsentPolicyRow[]> {
  return q.query<ConsentPolicyRow>(
    `SELECT * FROM consent_policy WHERE archive_id = $1 ORDER BY version DESC`,
    [archiveId],
  );
}

/**
 * Writes a new version and supersedes the previous one in the same statement
 * pair, inside the caller's transaction. Consent is never updated in place.
 */
export async function insertPolicyVersion(
  q: Queryable,
  input: {
    archiveId: string;
    document: ConsentPolicyDocument;
    policyHash: string;
    consentCopyVersion: string;
    legalCopyVersion: string;
    policyEngineVersion: string;
    createdByUserId: string;
  },
): Promise<ConsentPolicyRow> {
  await q.query(
    `UPDATE consent_policy SET superseded_at = now()
     WHERE archive_id = $1 AND superseded_at IS NULL`,
    [input.archiveId],
  );
  const row = await q.one<ConsentPolicyRow>(
    `INSERT INTO consent_policy
       (archive_id, version, mode, document, policy_hash, consent_copy_version,
        legal_copy_version, policy_engine_version, created_by_user_id)
     VALUES ($1,
             (SELECT coalesce(max(version), 0) + 1 FROM consent_policy WHERE archive_id = $1),
             $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.archiveId,
      input.document.mode,
      JSON.stringify(input.document),
      input.policyHash,
      input.consentCopyVersion,
      input.legalCopyVersion,
      input.policyEngineVersion,
      input.createdByUserId,
    ],
  );
  await q.query(`UPDATE archive SET current_consent_policy_id = $2, updated_at = now() WHERE id = $1`, [
    input.archiveId,
    row.id,
  ]);
  return row;
}

export async function recordConsentAct(
  q: Queryable,
  input: {
    archiveId: string;
    consentPolicyId: string | null;
    actorUserId: string | null;
    action:
      | 'granted'
      | 'updated'
      | 'revoked'
      | 'declined'
      | 'teachback_passed'
      | 'teachback_failed';
    summary?: string | null;
    ipHash?: string | null;
    userAgentFamily?: string | null;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO consent_record (archive_id, consent_policy_id, actor_user_id, action, summary, ip_hash, user_agent_family)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.archiveId,
      input.consentPolicyId,
      input.actorUserId,
      input.action,
      input.summary ?? null,
      input.ipHash ?? null,
      input.userAgentFamily ?? null,
    ],
  );
}

export async function listConsentRecords(q: Queryable, archiveId: string) {
  return q.query<{
    id: string;
    action: string;
    summary: string | null;
    created_at: Date;
    consent_policy_id: string | null;
    actor_user_id: string | null;
  }>(
    `SELECT id, action, summary, created_at, consent_policy_id, actor_user_id
     FROM consent_record WHERE archive_id = $1 ORDER BY created_at DESC LIMIT 200`,
    [archiveId],
  );
}
