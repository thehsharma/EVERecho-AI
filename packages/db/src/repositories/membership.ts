import type { MembershipStatus, Role } from '@everecho/contracts';
import type { Queryable } from '../pool';

export interface MembershipRow {
  id: string;
  archive_id: string;
  user_id: string | null;
  email: string;
  display_name: string;
  role: Role;
  status: MembershipStatus;
  invited_by_user_id: string | null;
  granted_at: Date | null;
  revoked_at: Date | null;
  expires_at: Date | null;
}

/**
 * The caller's live relationship with an archive. Expiry is evaluated here
 * rather than trusted from the row, so a membership whose window has closed
 * reports `expired` even if nothing has swept it yet.
 */
export async function findMembership(
  q: Queryable,
  archiveId: string,
  userId: string,
): Promise<MembershipRow | null> {
  const row = await q.maybeOne<MembershipRow>(
    `SELECT * FROM membership
     WHERE archive_id = $1 AND user_id = $2 AND status IN ('active', 'pending')
     ORDER BY created_at DESC LIMIT 1`,
    [archiveId, userId],
  );
  if (!row) return null;
  if (row.expires_at && row.expires_at.getTime() < Date.now()) {
    return { ...row, status: 'expired' };
  }
  return row;
}

export async function listMemberships(q: Queryable, archiveId: string): Promise<MembershipRow[]> {
  return q.query<MembershipRow>(
    `SELECT * FROM membership WHERE archive_id = $1 ORDER BY
       CASE role WHEN 'storyteller' THEN 0 WHEN 'buyer' THEN 1 ELSE 2 END, created_at ASC`,
    [archiveId],
  );
}

export async function createMembership(
  q: Queryable,
  input: {
    archiveId: string;
    userId: string | null;
    email: string;
    displayName: string;
    role: Role;
    status: MembershipStatus;
    invitedByUserId: string | null;
    expiresAt?: string | null;
  },
): Promise<MembershipRow> {
  return q.one<MembershipRow>(
    `INSERT INTO membership (archive_id, user_id, email, display_name, role, status, invited_by_user_id, granted_at, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'active' THEN now() ELSE NULL END, $8)
     RETURNING *`,
    [
      input.archiveId,
      input.userId,
      input.email,
      input.displayName,
      input.role,
      input.status,
      input.invitedByUserId,
      input.expiresAt ?? null,
    ],
  );
}

export async function revokeMembership(q: Queryable, membershipId: string): Promise<MembershipRow | null> {
  return q.maybeOne<MembershipRow>(
    `UPDATE membership SET status = 'revoked', revoked_at = now(), updated_at = now()
     WHERE id = $1 AND status <> 'revoked' RETURNING *`,
    [membershipId],
  );
}
