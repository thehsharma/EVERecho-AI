import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  createProposalRequestSchema,
  proposalSchema,
  reviewProposalRequestSchema,
} from '@everecho/contracts';
import {
  decideProposal,
  enqueueJob,
  findCurrentPolicy,
  findProposal,
  insertProposal,
  insertProposalEvidence,
  listProposalEvidence,
  listProposals,
  summariseTarget,
  type ContributorProposalRow,
  type ProposalEvidenceRow,
  type Transaction,
} from '@everecho/db';
import { contentTokens } from '@everecho/ai';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, notFound } from '../errors';
import type { AppContext } from '../context';

/**
 * The contributor loop.
 *
 * A relative can add to somebody else's archive — photographs, dates, places,
 * people, corrections, context, and the awkward one: "I remember it
 * differently". None of it takes effect when they submit it.
 *
 * The rule the whole module exists to enforce is that a contributor never
 * overwrites the storyteller. Approving a *correction* keeps the previous
 * value in the correction record and bumps the memory's version, so the
 * original survives and the change is attributable. Approving an *alternate
 * account* changes nothing at all: it creates a second memory beside the
 * first, linked by a contradiction, because a family that remembers something
 * two ways is not a family where one person is wrong — and a product that
 * silently picks a winner has decided something that was not its to decide.
 */

const archiveParams = z.object({ archiveId: z.uuid() });
const proposalParams = archiveParams.extend({ proposalId: z.uuid() });

export function registerContributionRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/contributions',
    tag: 'family',
    summary: 'Propose something to the storyteller',
    description:
      'Adds a suggestion to the storyteller’s review queue: a photograph, a date, a person, a ' +
      'correction, or a different recollection. Nothing you propose changes the archive. The ' +
      'storyteller decides on each one, and what they already have is never overwritten.',
    auth: 'required',
    params: archiveParams,
    body: createProposalRequestSchema,
    response: z.object({ proposal: proposalSchema }),
    status: 201,
    rateLimit: { max: 30, windowMs: 60_000 },
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contribution.create',
          resource: { type: 'contributor_proposal' },
          auditOnAllow: true,
          auditMetadata: { kind: body.kind },
        },
        async ({ tx, user }) => {
          // A correction to something that is not there is not a correction.
          if (body.targetType && body.targetId) {
            const summary = await summariseTarget(
              tx,
              params.archiveId,
              body.targetType,
              body.targetId,
            );
            if (summary === null) {
              throw conflict(
                'What this is about is no longer in the archive.',
                'proposal_target_missing',
              );
            }
          }

          // Disagreements are surfaced to the storyteller, never settled here.
          const contradicts = await findContradictedMemories(tx, params.archiveId, body);

          const policy = await findCurrentPolicy(tx, params.archiveId);
          const proposal = await insertProposal(tx, {
            archiveId: params.archiveId,
            proposedByUserId: user.id,
            kind: body.kind,
            targetType: body.targetType ?? null,
            targetId: body.targetId ?? null,
            title: body.title,
            body: body.body,
            payload: body.payload,
            sourceAssetId: body.sourceId ?? null,
            sensitivity: body.sensitivity,
            contradictsMemoryIds: contradicts,
            consentPolicyVersion: policy?.version ?? null,
          });

          for (const item of body.evidence) {
            await insertProposalEvidence(tx, {
              archiveId: params.archiveId,
              proposalId: proposal.id,
              sourceAssetId: item.sourceId ?? null,
              quotedText: item.quotedText ?? null,
              firstHand: item.firstHand,
              note: item.note ?? null,
            });
          }

          await ctx.analytics.track('contribution_proposed', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: {
              evidenceCount: body.evidence.length,
              contradicts: contradicts.length,
              hasSource: Boolean(body.sourceId),
            },
          });

          const evidence = await listProposalEvidence(tx, params.archiveId, [proposal.id]);
          return {
            proposal: toProposal(
              { ...proposal, proposed_by_display_name: user.displayName },
              evidence,
              null,
            ),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/contributions',
    tag: 'family',
    summary: 'What has been proposed, and what became of it',
    description:
      'The storyteller sees everything. Everyone else sees their own proposals and the ' +
      'decisions made on them — the review trail is part of trusting the archive, not a ' +
      'private queue.',
    auth: 'required',
    params: archiveParams,
    query: z.object({
      status: z.enum(['pending', 'approved', 'rejected', 'withdrawn']).optional(),
    }),
    response: z.object({ proposals: z.array(proposalSchema) }),
    handler: async ({ params, query, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contribution.read',
          resource: { type: 'contributor_proposal' },
        },
        async ({ tx, user, archive }) => {
          const isStoryteller = archive.storyteller_user_id === user.id;
          const rows = await listProposals(tx, params.archiveId, {
            status: query.status,
            // Everyone else sees only what they themselves proposed.
            proposedBy: isStoryteller ? undefined : user.id,
          });
          const evidence = await listProposalEvidence(
            tx,
            params.archiveId,
            rows.map((r) => r.id),
          );
          const byProposal = new Map<string, ProposalEvidenceRow[]>();
          for (const item of evidence) {
            byProposal.set(item.proposal_id, [...(byProposal.get(item.proposal_id) ?? []), item]);
          }

          const proposals = await Promise.all(
            rows.map(async (row) => {
              const summary = await summariseTarget(
                tx,
                params.archiveId,
                row.target_type,
                row.target_id,
              );
              return toProposal(row, byProposal.get(row.id) ?? [], summary);
            }),
          );
          return { proposals };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/contributions/:proposalId/approve',
    tag: 'family',
    summary: 'Accept a suggestion',
    description:
      'What this does depends on the kind. A correction records the previous value and bumps ' +
      'the version, so what you said before is still there. A different recollection is added ' +
      'beside yours and linked to it as a disagreement — nothing you said is replaced.',
    auth: 'required',
    params: proposalParams,
    body: reviewProposalRequestSchema,
    response: z.object({ proposal: proposalSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contribution.approve',
          resource: { type: 'contributor_proposal', id: params.proposalId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const proposal = await findProposal(tx, params.archiveId, params.proposalId);
          if (!proposal) throw notFound();
          if (proposal.status !== 'pending') {
            throw conflict('You have already decided on this one.', 'proposal_already_decided');
          }

          const applied = await applyProposal(ctx, tx, { proposal, approverUserId: user.id });

          const decided = await decideProposal(tx, {
            archiveId: params.archiveId,
            proposalId: proposal.id,
            status: 'approved',
            reviewedByUserId: user.id,
            note: body.note ?? null,
            resultingMemoryId: applied.memoryId,
            resultingCorrectionId: applied.correctionId,
          });
          if (!decided) {
            throw conflict('You have already decided on this one.', 'proposal_already_decided');
          }

          await ctx.analytics.track('contribution_decided', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { approved: true, createdMemory: Boolean(applied.memoryId) },
          });

          const evidence = await listProposalEvidence(tx, params.archiveId, [proposal.id]);
          const summary = await summariseTarget(
            tx,
            params.archiveId,
            decided.target_type,
            decided.target_id,
          );
          return {
            proposal: toProposal({ ...decided, proposed_by_display_name: '' }, evidence, summary),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/contributions/:proposalId/reject',
    tag: 'family',
    summary: 'Decline a suggestion',
    auth: 'required',
    params: proposalParams,
    body: reviewProposalRequestSchema,
    response: z.object({ proposal: proposalSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contribution.reject',
          resource: { type: 'contributor_proposal', id: params.proposalId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const decided = await decideProposal(tx, {
            archiveId: params.archiveId,
            proposalId: params.proposalId,
            status: 'rejected',
            reviewedByUserId: user.id,
            note: body.note ?? null,
          });
          if (!decided) {
            const existing = await findProposal(tx, params.archiveId, params.proposalId);
            if (!existing) throw notFound();
            throw conflict('You have already decided on this one.', 'proposal_already_decided');
          }
          await ctx.analytics.track('contribution_decided', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { approved: false, createdMemory: false },
          });
          const evidence = await listProposalEvidence(tx, params.archiveId, [decided.id]);
          return {
            proposal: toProposal({ ...decided, proposed_by_display_name: '' }, evidence, null),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/contributions/:proposalId/withdraw',
    tag: 'family',
    summary: 'Take back something you proposed',
    auth: 'required',
    params: proposalParams,
    body: z.object({}),
    response: z.object({ proposal: proposalSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'contribution.withdraw',
          resource: { type: 'contributor_proposal', id: params.proposalId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const proposal = await findProposal(tx, params.archiveId, params.proposalId);
          // Missing rather than forbidden: confirming somebody else's proposal
          // exists is itself a disclosure.
          if (!proposal || proposal.proposed_by_user_id !== user.id) throw notFound();
          const decided = await decideProposal(tx, {
            archiveId: params.archiveId,
            proposalId: proposal.id,
            status: 'withdrawn',
            reviewedByUserId: null,
            note: null,
          });
          if (!decided) {
            throw conflict(
              'The storyteller has already decided on this one.',
              'proposal_already_decided',
            );
          }
          const evidence = await listProposalEvidence(tx, params.archiveId, [decided.id]);
          return {
            proposal: toProposal({ ...decided, proposed_by_display_name: '' }, evidence, null),
          };
        },
      ),
  });
}

// ---------------------------------------------------------------------------
// Applying an approved proposal
// ---------------------------------------------------------------------------

/**
 * What approving actually does, by kind.
 *
 * The two kinds that touch existing material are deliberately different, and
 * the difference is the point of the whole feature.
 */
async function applyProposal(
  ctx: AppContext,
  tx: Transaction,
  input: { proposal: ContributorProposalRow; approverUserId: string },
): Promise<{ memoryId: string | null; correctionId: string | null }> {
  const { proposal } = input;

  if (proposal.kind === 'correction' && proposal.target_type === 'memory' && proposal.target_id) {
    const before = await tx.maybeOne<{ title: string; body: string; version: number }>(
      `SELECT title, body, version FROM memory
        WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [proposal.archive_id, proposal.target_id],
    );
    if (!before) {
      throw conflict('What this was about is no longer in the archive.', 'proposal_target_missing');
    }

    // The previous value is kept in full. This is the record that makes the
    // change reversible and attributable, and it is written before the change.
    const correction = await tx.one<{ id: string }>(
      `INSERT INTO correction
         (archive_id, target_type, target_id, previous_value, next_value, actor_user_id,
          actor_role, reason, status, reviewed_at)
       VALUES ($1,'memory',$2,$3,$4,$5,'contributor',$6,'applied', now())
       RETURNING id`,
      [
        proposal.archive_id,
        proposal.target_id,
        JSON.stringify({ title: before.title, body: before.body, version: before.version }),
        JSON.stringify({ body: proposal.body }),
        proposal.proposed_by_user_id,
        proposal.title,
      ],
    );

    await tx.query(
      `UPDATE memory
          SET body = $3, version = version + 1, was_corrected = true, updated_at = now()
        WHERE archive_id = $1 AND id = $2`,
      [proposal.archive_id, proposal.target_id, proposal.body],
    );

    // Retrieval has to reflect the corrected words, not the ones they replaced.
    await enqueueJob(tx, {
      archiveId: proposal.archive_id,
      type: 'embed_memory',
      payload: { memoryId: proposal.target_id },
      idempotencyKey: `embed:${proposal.target_id}:correction:${correction.id}`,
    });

    return { memoryId: null, correctionId: correction.id };
  }

  if (proposal.kind === 'alternate_account') {
    // Nothing is overwritten. A second memory stands beside the first, marked
    // as somebody else's recollection, and the two are linked as a
    // disagreement for a reader to see.
    //
    // The proposal itself becomes the source, for the same reason a
    // conversation and an answer do: a family member reading this must be able
    // to open it and find that it came from Ravi, not from Kamala. An
    // unattributed second account is how an archive quietly acquires a version
    // of events nobody said.
    const sourceAssetId = await promoteProposalToSource(tx, proposal);

    const memory = await tx.one<{ id: string }>(
      `INSERT INTO memory
         (archive_id, title, body, status, origin, sensitivity, evidence_class, topics,
          approved_at, approved_by_user_id)
       VALUES ($1,$2,$3,'approved','contributor_proposed',$4,'P3_SUPPORTED_SYNTHESIS',$5,
               now(), $6)
       RETURNING id`,
      [
        proposal.archive_id,
        proposal.title,
        proposal.body,
        proposal.sensitivity,
        contentTokens(proposal.body).slice(0, 8),
        input.approverUserId,
      ],
    );

    const claim = await tx.one<{ id: string }>(
      `INSERT INTO claim (archive_id, memory_id, text, evidence_class, status, topics)
       VALUES ($1,$2,$3,'P3_SUPPORTED_SYNTHESIS','approved',$4) RETURNING id`,
      [proposal.archive_id, memory.id, proposal.body, contentTokens(proposal.body).slice(0, 8)],
    );

    const segment = await tx.maybeOne<{ id: string }>(
      `SELECT s.id FROM transcript_segment s
         JOIN transcript t ON t.id = s.transcript_id
        WHERE t.archive_id = $1 AND t.source_asset_id = $2 LIMIT 1`,
      [proposal.archive_id, sourceAssetId],
    );
    await tx.query(
      `INSERT INTO claim_evidence
         (archive_id, claim_id, source_asset_id, transcript_segment_id, locator, quoted_text,
          extraction_method, model_version, prompt_version, policy_version, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,'contributor_proposal','v1','contribution-v1',$7,0.5)`,
      [
        proposal.archive_id,
        claim.id,
        sourceAssetId,
        segment?.id ?? null,
        JSON.stringify(
          segment ? { kind: 'transcript_segment', segmentId: segment.id } : { kind: 'whole_asset' },
        ),
        proposal.body,
        String(proposal.consent_policy_version ?? 'unknown'),
      ],
    );

    // Linked to what it disagrees with, left open. Resolving it is the
    // storyteller's to do, or nobody's — families disagree about the past, and
    // a product that settles that has decided who was right.
    if (proposal.target_type === 'memory' && proposal.target_id) {
      const targetClaim = await tx.maybeOne<{ id: string }>(
        `SELECT id FROM claim
          WHERE archive_id = $1 AND memory_id = $2 AND status = 'approved' LIMIT 1`,
        [proposal.archive_id, proposal.target_id],
      );
      if (targetClaim) {
        await tx.query(
          `INSERT INTO contradiction (archive_id, claim_a_id, claim_b_id, kind, status, detail)
           VALUES ($1,$2,$3,'fact_conflict','open',$4)`,
          [
            proposal.archive_id,
            targetClaim.id,
            claim.id,
            'A family member remembers this differently. Both accounts are kept.',
          ],
        );
      }
    }

    await enqueueJob(tx, {
      archiveId: proposal.archive_id,
      type: 'embed_memory',
      payload: { memoryId: memory.id },
      idempotencyKey: `embed:${memory.id}:alternate`,
    });

    void ctx;
    return { memoryId: memory.id, correctionId: null };
  }

  // Everything else — a photograph, a date, a place, a person, a note — is
  // recorded as accepted context. It does not silently become a claim about
  // the storyteller's life; the storyteller can write one from it if they want
  // to, and the proposal stays as its provenance.
  return { memoryId: null, correctionId: null };
}

/**
 * Approved memories a proposal disagrees with.
 *
 * Not a similarity score. An alternate account *is* a disagreement — that is
 * what "I remember it differently" means — so the memory it names is the
 * contradiction, and no threshold could tell us more than the contributor
 * already did by choosing that kind. A correction is not a disagreement at
 * all: it is somebody offering a fix, and recording it as a contradiction
 * would leave a permanent mark on a memory that was simply improved.
 *
 * Surfaced to the storyteller, never resolved for them.
 */
async function findContradictedMemories(
  tx: Transaction,
  archiveId: string,
  body: { kind: string; targetType?: string; targetId?: string },
): Promise<string[]> {
  if (body.kind !== 'alternate_account') return [];
  if (body.targetType !== 'memory' || !body.targetId) return [];

  const target = await tx.maybeOne<{ id: string }>(
    `SELECT id FROM memory WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [archiveId, body.targetId],
  );
  return target ? [target.id] : [];
}

function toProposal(
  row: ContributorProposalRow & { proposed_by_display_name: string },
  evidence: ProposalEvidenceRow[],
  targetSummary: string | null,
) {
  return {
    id: row.id,
    archiveId: row.archive_id,
    proposedByUserId: row.proposed_by_user_id,
    proposedByDisplayName: row.proposed_by_display_name || 'A contributor',
    kind: row.kind,
    targetType: row.target_type,
    targetId: row.target_id,
    targetSummary,
    title: row.title,
    body: row.body,
    payload: row.payload,
    sourceId: row.source_asset_id,
    status: row.status,
    sensitivity: row.sensitivity,
    contradictsMemoryIds: row.contradicts_memory_ids,
    resultingMemoryId: row.resulting_memory_id,
    resultingCorrectionId: row.resulting_correction_id,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewNote: row.review_note,
    createdAt: row.created_at.toISOString(),
    evidence: evidence.map((item) => ({
      id: item.id,
      sourceId: item.source_asset_id,
      quotedText: item.quoted_text,
      firstHand: item.first_hand,
      note: item.note,
    })),
  };
}

/**
 * The proposal, as a source.
 *
 * Same shape as a conversation or an answer: a `source_asset`, a `transcript`,
 * a `transcript_segment`. Nothing goes to object storage — the words live in
 * `contributor_proposal` and are mirrored here so a citation resolves and
 * deletion has one place to look.
 */
async function promoteProposalToSource(
  tx: Transaction,
  proposal: ContributorProposalRow,
): Promise<string> {
  const storageKey = `contribution/${proposal.id}`;
  const existing = await tx.maybeOne<{ id: string }>(
    `SELECT id FROM source_asset WHERE archive_id = $1 AND storage_key = $2 AND deleted_at IS NULL`,
    [proposal.archive_id, storageKey],
  );
  if (existing) return existing.id;

  const stamp = proposal.created_at.toISOString().slice(0, 16).replace('T', ' ');
  const source = await tx.one<{ id: string }>(
    `INSERT INTO source_asset
       (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
        scan_result, privacy, processing_stage, processed_at, sensitivity)
     VALUES ($1,'text','processed',$2,'text/plain',0,$3,'clean',$4,'ready', now(), $5)
     RETURNING id`,
    [
      proposal.archive_id,
      `A family member’s account — ${stamp}`,
      storageKey,
      JSON.stringify({ excluded: false, note: 'Proposed by a contributor and approved.' }),
      proposal.sensitivity,
    ],
  );

  const transcript = await tx.one<{ id: string }>(
    `INSERT INTO transcript
       (archive_id, source_asset_id, provider, model_version, prompt_version, language,
        status, method, policy_version, completed_at)
     VALUES ($1,$2,'everecho-contribution','v1','contribution-v1','en','ready','typed',$3, now())
     RETURNING id`,
    [proposal.archive_id, source.id, String(proposal.consent_policy_version ?? 'unknown')],
  );

  await tx.query(
    `INSERT INTO transcript_segment (archive_id, transcript_id, idx, text)
     VALUES ($1,$2,0,$3)`,
    [proposal.archive_id, transcript.id, proposal.body],
  );

  return source.id;
}
