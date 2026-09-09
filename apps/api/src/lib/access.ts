import type { FastifyRequest } from 'fastify';
import {
  authorize,
  type Actor,
  type Decision,
  type ResourceRef,
  type Subject,
} from '@everecho/consent';
import type { Action } from '@everecho/contracts';
import {
  findArchive,
  findCurrentLearningPolicy,
  findCurrentPolicy,
  findMembership,
  hasActiveDisputeHold,
  recordAuditEvent,
  toConsentPolicy,
  toLearningPolicy,
  type ArchiveRow,
  type MembershipRow,
  type Transaction,
} from '@everecho/db';
import type { AppContext } from '../context';
import { forbidden, notFound, unauthenticated } from '../errors';
import type { SessionUser } from './session';

export interface ArchiveAccess {
  tx: Transaction;
  archive: ArchiveRow;
  membership: MembershipRow | null;
  subject: Subject;
  decision: Extract<Decision, { effect: 'ALLOW' }>;
  user: SessionUser;
}

/**
 * The single gate every archive-scoped request passes through.
 *
 * It opens a transaction scoped to one archive (so row-level security applies),
 * assembles the actor and subject from the database rather than from anything
 * the client sent, calls the pure policy engine, records the decision in the
 * audit trail — allow or deny — and only then runs the handler.
 *
 * A route that forgets to authorise cannot exist: there is no other way to get
 * a transaction with an archive scope.
 */
export async function withArchiveAccess<T>(
  ctx: AppContext,
  request: FastifyRequest,
  input: {
    archiveId: string;
    action: Action;
    resource?: Partial<ResourceRef>;
    auditMetadata?: Record<string, unknown>;
    /** Recorded even on success. Reads default to not writing an audit row. */
    auditOnAllow?: boolean;
    /**
     * Whether this operation will send material to an external provider.
     * Callers derive it from the configured adapter, so a deployment running
     * entirely on local adapters never trips the provider consent gates.
     */
    usesProvider?: boolean;
  },
  handler: (access: ArchiveAccess) => Promise<T>,
): Promise<T> {
  const user = request.user;
  if (!user) throw unauthenticated();

  return ctx.db.withArchiveScope(input.archiveId, async (tx) => {
    const archive = await findArchive(tx, input.archiveId);

    // An archive the caller has no relationship with is reported as missing,
    // not as forbidden: a 403 would confirm that the id names something real.
    if (!archive) {
      // Written on a separate connection: this transaction is about to roll
      // back, and a refusal that vanishes with it is a refusal nobody can audit.
      await recordAuditEvent(ctx.db, {
        archiveId: null,
        actorUserId: user.id,
        actorDisplay: user.displayName,
        action: input.action,
        resourceType: input.resource?.type ?? 'archive',
        outcome: 'deny',
        reasonCode: 'not_found',
        requestId: request.id,
      });
      throw notFound();
    }

    // Sequential, not Promise.all: a single pg client executes one query at a
    // time, so concurrent queries on one transaction interleave on the wire.
    const membership = await findMembership(tx, input.archiveId, user.id);
    const policyRow = await findCurrentPolicy(tx, input.archiveId);
    const learningRow = await findCurrentLearningPolicy(tx, input.archiveId);
    const disputeHoldActive = await hasActiveDisputeHold(tx, input.archiveId);
    const breakGlass = user.isPlatformAdmin
      ? await findBreakGlass(tx, input.archiveId, user.id)
      : null;

    const actor: Actor = {
      userId: user.id,
      isPlatformAdmin: user.isPlatformAdmin,
      membership: membership
        ? {
            role: membership.role,
            status: membership.status,
            grantedAt: membership.granted_at?.toISOString() ?? null,
            expiresAt: membership.expires_at?.toISOString() ?? null,
          }
        : null,
      breakGlass,
    };

    const subject: Subject = {
      archiveId: archive.id,
      archiveStatus: archive.status,
      storytellerUserId: archive.storyteller_user_id,
      lifeState: archive.life_state,
      policy: policyRow ? toConsentPolicy(policyRow) : null,
      learningPolicy: learningRow ? toLearningPolicy(learningRow) : null,
      disputeHoldActive,
    };

    const resource: ResourceRef = {
      type: input.resource?.type ?? 'archive',
      archiveId: archive.id,
      ...input.resource,
    };

    const decision = authorize({
      actor,
      action: input.action,
      resource,
      subject,
      context: {
        now: new Date(),
        policyEngineVersion: ctx.branding.policyEngineVersion,
        requestId: request.id,
        usesProvider: input.usesProvider ?? false,
      },
    });

    if (decision.effect === 'DENY') {
      // Deliberately NOT on `tx`. Throwing below rolls this transaction back,
      // which would take the record of the refusal with it — and being able to
      // see that someone was turned away is half of trusting the permissions.
      await recordAuditEvent(ctx.db, {
        archiveId: archive.id,
        actorUserId: user.id,
        actorDisplay: user.displayName,
        action: input.action,
        resourceType: resource.type,
        resourceId: resource.id ?? null,
        outcome: 'deny',
        reasonCode: decision.reasonCode,
        policyVersion: decision.policyVersion,
        requestId: request.id,
        metadata: input.auditMetadata ?? {},
      });

      // Reasons that would disclose the archive's existence are reported as 404.
      if (decision.reasonCode === 'not_a_member' || decision.reasonCode === 'archive_deleted') {
        throw notFound();
      }
      throw forbidden(decision.explanation, decision.reasonCode, decision.policyVersion);
    }

    if (input.auditOnAllow ?? decision.obligations.mustLogAccess) {
      await recordAuditEvent(tx, {
        archiveId: archive.id,
        actorUserId: user.id,
        actorDisplay: user.displayName,
        action: input.action,
        resourceType: resource.type,
        resourceId: resource.id ?? null,
        outcome: 'allow',
        policyVersion: decision.policyVersion,
        requestId: request.id,
        metadata: input.auditMetadata ?? {},
      });
    }

    return handler({ tx, archive, membership, subject, decision, user });
  });
}

async function findBreakGlass(
  tx: Transaction,
  archiveId: string,
  adminUserId: string,
): Promise<Actor['breakGlass']> {
  const row = await tx.maybeOne<{ archive_id: string; expires_at: Date }>(
    `SELECT archive_id, expires_at FROM break_glass_grant
     WHERE archive_id = $1 AND admin_user_id = $2 AND revoked_at IS NULL AND expires_at > now()
     ORDER BY granted_at DESC LIMIT 1`,
    [archiveId, adminUserId],
  );
  if (!row) return null;
  return {
    archiveId: row.archive_id,
    expiresAt: row.expires_at.toISOString(),
    scope: 'metadata_only',
  };
}
