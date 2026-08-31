import type { ArchiveStatus, LifeState, Role } from '@everecho/contracts';
import type { Queryable } from '../pool';

export interface ArchiveRow {
  id: string;
  household_id: string;
  subject_person_id: string;
  name: string;
  status: ArchiveStatus;
  buyer_user_id: string | null;
  storyteller_user_id: string | null;
  current_consent_policy_id: string | null;
  life_state: LifeState;
  data_region: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  subject_display_name: string;
}

const ARCHIVE_SELECT = `
  SELECT a.*, p.display_name AS subject_display_name
  FROM archive a
  JOIN person p ON p.id = a.subject_person_id
`;

export async function findArchive(q: Queryable, archiveId: string): Promise<ArchiveRow | null> {
  return q.maybeOne<ArchiveRow>(`${ARCHIVE_SELECT} WHERE a.id = $1`, [archiveId]);
}

export interface ArchiveSummaryRow extends ArchiveRow {
  role: Role;
  membership_status: string;
  consent_mode: string | null;
}

/**
 * Archives this user has a live relationship with. There is deliberately no
 * "list all archives" query anywhere in the codebase.
 *
 * `consent_policy` is under row-level security, so the mode is read separately
 * inside an archive scope rather than joined here; this listing is intentionally
 * usable outside any archive scope.
 */
export async function listArchivesForUser(q: Queryable, userId: string): Promise<ArchiveSummaryRow[]> {
  return q.query<ArchiveSummaryRow>(
    `SELECT a.*, p.display_name AS subject_display_name,
            m.role AS role, m.status AS membership_status,
            NULL::text AS consent_mode
     FROM archive a
     JOIN person p ON p.id = a.subject_person_id
     JOIN membership m ON m.archive_id = a.id AND m.user_id = $1
     WHERE m.status IN ('active', 'pending')
       AND a.status <> 'deleted'
     ORDER BY a.created_at DESC`,
    [userId],
  );
}

export async function updateArchiveStatus(
  q: Queryable,
  archiveId: string,
  status: ArchiveStatus,
): Promise<void> {
  await q.query(`UPDATE archive SET status = $2, updated_at = now() WHERE id = $1`, [archiveId, status]);
}

export async function hasActiveDisputeHold(q: Queryable, archiveId: string): Promise<boolean> {
  const row = await q.maybeOne(
    `SELECT 1 AS present FROM dispute_hold WHERE archive_id = $1 AND status = 'active' LIMIT 1`,
    [archiveId],
  );
  return row !== null;
}
