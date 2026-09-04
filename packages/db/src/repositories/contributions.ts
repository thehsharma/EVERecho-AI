import type { Queryable } from '../pool';

/**
 * Contributor proposals.
 *
 * Every query here is archive-scoped and status-aware. There is no function
 * that applies a proposal: applying one is a domain operation with an
 * authorisation check and an audit trail, and giving the repository a
 * `applyProposal` would put the most consequential write in the product
 * somewhere a route could call it without deciding anything first.
 */

export interface ContributorProposalRow {
  id: string;
  archive_id: string;
  proposed_by_user_id: string;
  kind:
    | 'media'
    | 'date'
    | 'place'
    | 'person'
    | 'relationship'
    | 'correction'
    | 'note'
    | 'alternate_account';
  target_type: 'memory' | 'entity' | 'place' | 'event' | 'source_asset' | null;
  target_id: string | null;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  source_asset_id: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  sensitivity: 'normal' | 'sensitive' | 'restricted' | 'embargoed';
  contradicts_memory_ids: string[];
  resulting_memory_id: string | null;
  resulting_correction_id: string | null;
  reviewed_by_user_id: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  consent_policy_version: number | null;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
}

export interface ProposalEvidenceRow {
  id: string;
  archive_id: string;
  proposal_id: string;
  source_asset_id: string | null;
  quoted_text: string | null;
  locator: Record<string, unknown>;
  first_hand: boolean;
  note: string | null;
  created_at: Date;
}

export async function insertProposal(
  q: Queryable,
  input: {
    archiveId: string;
    proposedByUserId: string;
    kind: ContributorProposalRow['kind'];
    targetType: ContributorProposalRow['target_type'];
    targetId: string | null;
    title: string;
    body: string;
    payload: Record<string, unknown>;
    sourceAssetId: string | null;
    sensitivity: ContributorProposalRow['sensitivity'];
    contradictsMemoryIds: string[];
    consentPolicyVersion: number | null;
  },
): Promise<ContributorProposalRow> {
  return q.one<ContributorProposalRow>(
    `INSERT INTO contributor_proposal
       (archive_id, proposed_by_user_id, kind, target_type, target_id, title, body, payload,
        source_asset_id, sensitivity, contradicts_memory_ids, consent_policy_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [
      input.archiveId,
      input.proposedByUserId,
      input.kind,
      input.targetType,
      input.targetId,
      input.title,
      input.body,
      JSON.stringify(input.payload),
      input.sourceAssetId,
      input.sensitivity,
      input.contradictsMemoryIds,
      input.consentPolicyVersion,
    ],
  );
}

export async function insertProposalEvidence(
  q: Queryable,
  input: {
    archiveId: string;
    proposalId: string;
    sourceAssetId: string | null;
    quotedText: string | null;
    firstHand: boolean;
    note: string | null;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO proposal_evidence
       (archive_id, proposal_id, source_asset_id, quoted_text, first_hand, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.archiveId,
      input.proposalId,
      input.sourceAssetId,
      input.quotedText,
      input.firstHand,
      input.note,
    ],
  );
}

export async function findProposal(
  q: Queryable,
  archiveId: string,
  proposalId: string,
): Promise<ContributorProposalRow | null> {
  return q.maybeOne<ContributorProposalRow>(
    `SELECT * FROM contributor_proposal
      WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [archiveId, proposalId],
  );
}

export async function listProposals(
  q: Queryable,
  archiveId: string,
  options: { status?: string; proposedBy?: string; limit?: number } = {},
): Promise<(ContributorProposalRow & { proposed_by_display_name: string })[]> {
  return q.query(
    `SELECT p.*, coalesce(m.display_name, 'A contributor') AS proposed_by_display_name
       FROM contributor_proposal p
       LEFT JOIN membership m
         ON m.archive_id = p.archive_id AND m.user_id = p.proposed_by_user_id
      WHERE p.archive_id = $1 AND p.deleted_at IS NULL
        AND ($2::text IS NULL OR p.status = $2)
        AND ($3::uuid IS NULL OR p.proposed_by_user_id = $3)
      ORDER BY p.status = 'pending' DESC, p.created_at DESC
      LIMIT $4`,
    [archiveId, options.status ?? null, options.proposedBy ?? null, options.limit ?? 100],
  );
}

export async function listProposalEvidence(
  q: Queryable,
  archiveId: string,
  proposalIds: string[],
): Promise<ProposalEvidenceRow[]> {
  if (proposalIds.length === 0) return [];
  return q.query<ProposalEvidenceRow>(
    `SELECT * FROM proposal_evidence
      WHERE archive_id = $1 AND proposal_id = ANY($2::uuid[]) ORDER BY created_at`,
    [archiveId, proposalIds],
  );
}

/**
 * Records the storyteller's decision.
 *
 * Guarded on `status = 'pending'` so two clicks, or two tabs, cannot approve
 * the same proposal twice and apply its change twice.
 */
export async function decideProposal(
  q: Queryable,
  input: {
    archiveId: string;
    proposalId: string;
    status: 'approved' | 'rejected' | 'withdrawn';
    reviewedByUserId: string | null;
    note: string | null;
    resultingMemoryId?: string | null;
    resultingCorrectionId?: string | null;
  },
): Promise<ContributorProposalRow | null> {
  return q.maybeOne<ContributorProposalRow>(
    `UPDATE contributor_proposal
        SET status = $3,
            reviewed_by_user_id = $4,
            reviewed_at = CASE WHEN $3 = 'withdrawn' THEN NULL ELSE now() END,
            review_note = coalesce($5, review_note),
            resulting_memory_id = $6,
            resulting_correction_id = $7,
            updated_at = now()
      WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL AND status = 'pending'
      RETURNING *`,
    [
      input.archiveId,
      input.proposalId,
      input.status,
      input.status === 'withdrawn' ? null : input.reviewedByUserId,
      input.note,
      input.resultingMemoryId ?? null,
      input.resultingCorrectionId ?? null,
    ],
  );
}

/** What the target says today, so a reviewer sees both versions at once. */
export async function summariseTarget(
  q: Queryable,
  archiveId: string,
  targetType: string | null,
  targetId: string | null,
): Promise<string | null> {
  if (!targetType || !targetId) return null;
  switch (targetType) {
    case 'memory': {
      const row = await q.maybeOne<{ title: string; body: string }>(
        `SELECT title, body FROM memory WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [archiveId, targetId],
      );
      return row ? `${row.title} — ${row.body}` : null;
    }
    case 'entity': {
      const row = await q.maybeOne<{ display_name: string }>(
        `SELECT display_name FROM entity WHERE archive_id = $1 AND id = $2`,
        [archiveId, targetId],
      );
      return row?.display_name ?? null;
    }
    case 'place': {
      const row = await q.maybeOne<{ name: string }>(
        `SELECT name FROM place WHERE archive_id = $1 AND id = $2`,
        [archiveId, targetId],
      );
      return row?.name ?? null;
    }
    default:
      return null;
  }
}
