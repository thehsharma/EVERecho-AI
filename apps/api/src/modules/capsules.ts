import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  capsuleAccessEventSchema,
  capsuleSchema,
  createCapsuleRequestSchema,
  openCapsuleSchema,
} from '@everecho/contracts';
import type { Transaction } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, notFound, validationFailed } from '../errors';
import { allowedSensitivities } from './sources';
import type { AppContext } from '../context';

/**
 * Private story capsules.
 *
 * The failure this module is written against is a link that still works after
 * the storyteller changed their mind. So every read re-derives permission from
 * scratch — the grant, the window, the capsule's status, the archive's consent
 * and the sensitivity ceiling — and nothing is cached anywhere that a
 * revocation would have to chase.
 *
 * Four separate things must all say yes before a memory in a capsule is shown:
 *
 *   1. `authorize()` — the reader has a current recipient grant on the archive
 *   2. the capsule is active, open (past any embargo) and not expired
 *   3. this reader has an active grant on *this* capsule
 *   4. the memory is still approved and within their sensitivity ceiling
 *
 * The fourth is the one that is easy to forget and the reason a capsule cannot
 * widen consent: a memory whose sensitivity was raised after the capsule was
 * made stops appearing in it, without anybody editing the capsule.
 */

const archiveParams = z.object({ archiveId: z.uuid() });
const capsuleParams = archiveParams.extend({ capsuleId: z.uuid() });

export function registerCapsuleRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/capsules',
    tag: 'sharing',
    summary: 'Make a capsule for particular people',
    description:
      'Packages approved stories for named people. It can open on a date, close on a date, and ' +
      'be withdrawn at any moment. It never shares more than your permissions already allow: ' +
      'if you later make a story more private, it leaves the capsule on its own.',
    auth: 'required',
    params: archiveParams,
    body: createCapsuleRequestSchema,
    response: z.object({ capsule: capsuleSchema }),
    status: 201,
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'capsule.create',
          resource: { type: 'story_capsule' },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          // Approved memories only. A capsule is not a way round review.
          const approved = await tx.query<{ id: string }>(
            `SELECT id FROM memory
              WHERE archive_id = $1 AND id = ANY($2::uuid[])
                AND status = 'approved' AND deleted_at IS NULL`,
            [params.archiveId, body.memoryIds],
          );
          if (approved.length !== body.memoryIds.length) {
            throw validationFailed('A capsule can only contain stories you have already approved.');
          }

          // Named people who are actually members. Inviting somebody into a
          // capsule is not a way to give access to a stranger.
          const members = await tx.query<{ user_id: string }>(
            `SELECT user_id FROM membership
              WHERE archive_id = $1 AND user_id = ANY($2::uuid[]) AND status = 'active'`,
            [params.archiveId, body.recipientUserIds],
          );
          if (members.length !== body.recipientUserIds.length) {
            throw validationFailed(
              'Everyone in a capsule has to be someone you have already given access to.',
            );
          }

          const capsule = await tx.one<{ id: string }>(
            `INSERT INTO story_capsule
               (archive_id, created_by_user_id, title, note, embargo_until, expires_at,
                allow_download, consent_policy_version)
             VALUES ($1,$2,$3,$4,$5,$6,$7,
                     (SELECT version FROM consent_policy
                       WHERE archive_id = $1 AND superseded_at IS NULL LIMIT 1))
             RETURNING id`,
            [
              params.archiveId,
              user.id,
              body.title,
              body.note ?? null,
              body.embargoUntil ?? null,
              body.expiresAt ?? null,
              body.allowDownload,
            ],
          );

          for (const [index, memoryId] of body.memoryIds.entries()) {
            await tx.query(
              `INSERT INTO capsule_item (archive_id, capsule_id, memory_id, idx)
               VALUES ($1,$2,$3,$4)`,
              [params.archiveId, capsule.id, memoryId, index],
            );
          }
          for (const recipientId of body.recipientUserIds) {
            await tx.query(
              `INSERT INTO capsule_grant (archive_id, capsule_id, user_id) VALUES ($1,$2,$3)`,
              [params.archiveId, capsule.id, recipientId],
            );
          }

          await ctx.analytics.track('capsule_created', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: {
              items: body.memoryIds.length,
              recipients: body.recipientUserIds.length,
              embargoed: Boolean(body.embargoUntil),
              expiring: Boolean(body.expiresAt),
              downloadable: body.allowDownload,
            },
          });

          return { capsule: await loadCapsule(tx, params.archiveId, capsule.id) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/capsules',
    tag: 'sharing',
    summary: 'Capsules you made, or that were made for you',
    auth: 'required',
    params: archiveParams,
    response: z.object({ capsules: z.array(capsuleSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'capsule.read',
          resource: { type: 'story_capsule' },
        },
        async ({ tx, user, archive }) => {
          const isStoryteller = archive.storyteller_user_id === user.id;
          const rows = await tx.query<{ id: string }>(
            isStoryteller
              ? `SELECT id FROM story_capsule
                  WHERE archive_id = $1 AND deleted_at IS NULL ORDER BY created_at DESC`
              : `SELECT c.id FROM story_capsule c
                   JOIN capsule_grant g ON g.capsule_id = c.id
                  WHERE c.archive_id = $1 AND c.deleted_at IS NULL
                    AND g.user_id = $2 AND g.status = 'active' AND c.status = 'active'
                  ORDER BY c.created_at DESC`,
            isStoryteller ? [params.archiveId] : [params.archiveId, user.id],
          );
          const capsules = await Promise.all(
            rows.map((row) => loadCapsule(tx, params.archiveId, row.id)),
          );
          return { capsules };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/capsules/:capsuleId/open',
    tag: 'sharing',
    summary: 'Open a capsule that was made for you',
    description:
      'Every read re-checks everything: that it is still yours, that it is open, that it has ' +
      'not been withdrawn, and that each story in it is still one you are allowed to see. ' +
      'Nothing is cached, so withdrawing it takes effect on the next refresh.',
    auth: 'required',
    params: capsuleParams,
    response: z.object({ capsule: openCapsuleSchema }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'capsule.open',
          resource: { type: 'story_capsule', id: params.capsuleId },
        },
        async ({ tx, user, decision, archive }) => {
          const capsule = await requireOpenCapsule(ctx, tx, {
            archiveId: params.archiveId,
            capsuleId: params.capsuleId,
            userId: user.id,
          });

          // The sensitivity ceiling from the reader's own grant, applied to
          // what is in the capsule. A story made more private after the
          // capsule was built simply stops appearing in it.
          const ceiling = allowedSensitivities(decision.obligations.maxSensitivity);
          const memories = await tx.query<{
            id: string;
            title: string;
            body: string;
            occurred_on: string | null;
          }>(
            `SELECT m.id, m.title, m.body, m.occurred_on
               FROM capsule_item i
               JOIN memory m ON m.id = i.memory_id
              WHERE i.archive_id = $1 AND i.capsule_id = $2
                AND m.status = 'approved' AND m.deleted_at IS NULL
                AND m.sensitivity = ANY($3::text[])
              ORDER BY i.idx`,
            [params.archiveId, capsule.id, ceiling],
          );

          await recordAccess(tx, {
            archiveId: params.archiveId,
            capsuleId: capsule.id,
            userId: user.id,
            action: 'opened',
            reasonCode: null,
          });
          await ctx.analytics.track('capsule_opened', {
            actorId: user.id,
            archiveId: params.archiveId,
            props: { items: memories.length },
          });

          return {
            capsule: {
              id: capsule.id,
              title: capsule.title,
              note: capsule.note,
              from: archive.subject_display_name ?? 'the storyteller',
              allowDownload: capsule.allow_download,
              expiresAt: capsule.expires_at?.toISOString() ?? null,
              memories: memories.map((m) => ({
                id: m.id,
                title: m.title,
                body: m.body,
                occurredOn: m.occurred_on,
              })),
            },
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/capsules/:capsuleId/revoke',
    tag: 'sharing',
    summary: 'Withdraw a capsule',
    description: 'Takes effect immediately, for everyone, including anyone reading it right now.',
    auth: 'required',
    params: capsuleParams,
    body: z.object({ reason: z.string().trim().max(500).optional() }),
    response: z.object({ capsule: capsuleSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'capsule.revoke',
          resource: { type: 'story_capsule', id: params.capsuleId },
          auditOnAllow: true,
        },
        async ({ tx, user }) => {
          const updated = await tx.maybeOne<{ id: string }>(
            `UPDATE story_capsule
                SET status = 'revoked', revoked_at = now(), revoked_reason = $3, updated_at = now()
              WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL AND status = 'active'
              RETURNING id`,
            [params.archiveId, params.capsuleId, body.reason ?? null],
          );
          if (!updated) {
            const existing = await tx.maybeOne(
              `SELECT id FROM story_capsule WHERE archive_id = $1 AND id = $2`,
              [params.archiveId, params.capsuleId],
            );
            if (!existing) throw notFound();
            throw conflict('This has already been withdrawn.', 'capsule_revoked');
          }
          await ctx.analytics.track('capsule_revoked', {
            actorId: user.id,
            archiveId: params.archiveId,
          });
          return { capsule: await loadCapsule(tx, params.archiveId, params.capsuleId) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/capsules/:capsuleId/access',
    tag: 'sharing',
    summary: 'Who opened it, and who was turned away',
    description:
      'The refusals matter as much as the opens: somebody trying to read a capsule after you ' +
      'withdrew it is exactly the thing you have a right to know about.',
    auth: 'required',
    params: capsuleParams,
    response: z.object({ events: z.array(capsuleAccessEventSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          // Reading the access log is the storyteller's, like making the
          // capsule: it names who tried.
          action: 'capsule.update',
          resource: { type: 'story_capsule', id: params.capsuleId },
        },
        async ({ tx }) => {
          const rows = await tx.query<{
            id: string;
            action: 'opened' | 'refused' | 'downloaded';
            reason_code: string | null;
            created_at: Date;
            display_name: string | null;
          }>(
            `SELECT e.id, e.action, e.reason_code, e.created_at, m.display_name
               FROM capsule_access_event e
               LEFT JOIN membership m
                 ON m.archive_id = e.archive_id AND m.user_id = e.user_id
              WHERE e.archive_id = $1 AND e.capsule_id = $2
              ORDER BY e.created_at DESC LIMIT 200`,
            [params.archiveId, params.capsuleId],
          );
          return {
            events: rows.map((row) => ({
              id: row.id,
              action: row.action,
              displayName: row.display_name ?? 'Someone',
              reasonCode: row.reason_code,
              at: row.created_at.toISOString(),
            })),
          };
        },
      ),
  });
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

interface CapsuleRow {
  id: string;
  title: string;
  note: string | null;
  status: 'active' | 'revoked';
  embargo_until: Date | null;
  expires_at: Date | null;
  allow_download: boolean;
  created_at: Date;
  revoked_at: Date | null;
}

/**
 * Everything that must be true before a capsule opens.
 *
 * Written as one function called on every read rather than as a flag set when
 * the capsule was made, because every one of these can become false while
 * somebody has the page open.
 *
 * A refusal is recorded before it is thrown. The storyteller is the person who
 * most needs to know that somebody tried.
 */
async function requireOpenCapsule(
  ctx: AppContext,
  tx: Transaction,
  input: { archiveId: string; capsuleId: string; userId: string },
): Promise<CapsuleRow> {
  const capsule = await tx.maybeOne<CapsuleRow>(
    `SELECT id, title, note, status, embargo_until, expires_at, allow_download, created_at,
            revoked_at
       FROM story_capsule
      WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [input.archiveId, input.capsuleId],
  );
  // Reported as missing rather than forbidden: a 403 confirms it exists.
  if (!capsule) throw notFound();

  // Written on a separate connection, deliberately.
  //
  // The transaction this runs in is about to roll back with the refusal, and a
  // refusal that vanishes with it is a refusal nobody can audit — which would
  // make "somebody tried to open this after you withdrew it" unanswerable,
  // and that is the single thing the access log exists to answer.
  const refuse = async (reasonCode: string, message: string): Promise<never> => {
    await ctx.db
      .withArchiveScope(input.archiveId, (fresh) =>
        recordAccess(fresh, {
          archiveId: input.archiveId,
          capsuleId: capsule.id,
          userId: input.userId,
          action: 'refused',
          reasonCode,
        }),
      )
      .catch(() => undefined);
    throw conflict(message, reasonCode);
  };

  const grant = await tx.maybeOne<{ status: string }>(
    `SELECT status FROM capsule_grant
      WHERE archive_id = $1 AND capsule_id = $2 AND user_id = $3`,
    [input.archiveId, capsule.id, input.userId],
  );
  if (!grant || grant.status !== 'active') {
    await refuse('capsule_not_yours', 'This was not shared with you.');
  }
  if (capsule.status === 'revoked') {
    await refuse('capsule_revoked', 'The storyteller has withdrawn this.');
  }

  const now = Date.now();
  if (capsule.embargo_until && now < capsule.embargo_until.getTime()) {
    await refuse('capsule_embargoed', 'This is not open yet.');
  }
  if (capsule.expires_at && now > capsule.expires_at.getTime()) {
    await refuse('capsule_expired', 'This is no longer available.');
  }

  return capsule;
}

async function recordAccess(
  tx: Transaction,
  input: {
    archiveId: string;
    capsuleId: string;
    userId: string;
    action: 'opened' | 'refused' | 'downloaded';
    reasonCode: string | null;
  },
): Promise<void> {
  await tx.query(
    `INSERT INTO capsule_access_event (archive_id, capsule_id, user_id, action, reason_code)
     VALUES ($1,$2,$3,$4,$5)`,
    [input.archiveId, input.capsuleId, input.userId, input.action, input.reasonCode],
  );
}

async function loadCapsule(tx: Transaction, archiveId: string, capsuleId: string) {
  const row = await tx.one<CapsuleRow & { archive_id: string }>(
    `SELECT * FROM story_capsule WHERE archive_id = $1 AND id = $2`,
    [archiveId, capsuleId],
  );
  const items = await tx.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM capsule_item WHERE archive_id = $1 AND capsule_id = $2`,
    [archiveId, capsuleId],
  );
  const recipients = await tx.query<{
    user_id: string;
    status: 'active' | 'revoked';
    display_name: string | null;
  }>(
    `SELECT g.user_id, g.status, m.display_name
       FROM capsule_grant g
       LEFT JOIN membership m ON m.archive_id = g.archive_id AND m.user_id = g.user_id
      WHERE g.archive_id = $1 AND g.capsule_id = $2`,
    [archiveId, capsuleId],
  );

  return {
    id: row.id,
    archiveId: row.archive_id,
    title: row.title,
    note: row.note,
    status: row.status,
    embargoUntil: row.embargo_until?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null,
    allowDownload: row.allow_download,
    createdAt: row.created_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() ?? null,
    itemCount: items.n,
    recipients: recipients.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name ?? 'A family member',
      status: r.status,
    })),
  };
}
