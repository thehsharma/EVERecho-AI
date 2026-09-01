import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  createInvitationRequestSchema,
  invitationPreviewSchema,
  invitationSchema,
  respondToInvitationRequestSchema,
} from '@everecho/contracts';
import { createMembership, recordAuditEvent, updateArchiveStatus } from '@everecho/db';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { conflict, notFound, unauthenticated, validationFailed } from '../errors';
import { hashOpaqueToken, issueOpaqueToken } from '../lib/session';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });

const TEMPLATE_BY_ROLE = {
  storyteller: 'storyteller_invitation',
  family: 'family_invitation',
  contributor: 'contributor_invitation',
  steward: 'steward_invitation',
  buyer: 'family_invitation',
} as const;

export function registerInvitationRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/invitations',
    tag: 'invitations',
    summary: 'Invite someone to this archive',
    description:
      'Sends an invitation link. The link discloses nothing about the archive’s contents to ' +
      'whoever holds it, and the invitee decides for themselves — a storyteller can decline ' +
      'privately, and the reason is never shown to the person who invited them.',
    auth: 'required',
    params: archiveParams,
    body: createInvitationRequestSchema,
    response: z.object({ invitation: invitationSchema }),
    status: 201,
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'invitation.create',
          resource: { type: 'invitation' },
          auditOnAllow: true,
          auditMetadata: { role: body.role },
        },
        async ({ tx, archive, user }) => {
          if (body.role === 'storyteller' && archive.storyteller_user_id) {
            throw conflict('This archive already has a storyteller.');
          }
          const idempotencyKey = request.headers['idempotency-key'];
          const { token, tokenHash } = issueOpaqueToken();
          const expiresAt = new Date(Date.now() + body.expiresInDays * 86_400_000);

          const rows = await tx.query<{
            id: string;
            email: string;
            display_name: string;
            role: typeof body.role;
            status: 'sent';
            created_at: Date;
            expires_at: Date;
          }>(
            `INSERT INTO invitation (archive_id, email, display_name, role, token_hash, personal_note,
                                     created_by_user_id, idempotency_key, expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (archive_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
             RETURNING id, email, display_name, role, status, created_at, expires_at`,
            [
              params.archiveId,
              body.email,
              body.displayName,
              body.role,
              tokenHash,
              body.personalNote ?? null,
              user.id,
              typeof idempotencyKey === 'string' ? idempotencyKey : null,
              expiresAt,
            ],
          );

          const invitation = rows[0];
          if (!invitation) {
            // Replayed request: the invitation already exists and no second
            // email is sent. Re-sending would read as pressure.
            const existing = await tx.one<{
              id: string;
              email: string;
              display_name: string;
              role: typeof body.role;
              status: 'sent' | 'accepted' | 'declined' | 'revoked' | 'expired';
              created_at: Date;
              expires_at: Date;
              accepted_at: Date | null;
              declined_at: Date | null;
            }>(
              `SELECT id, email, display_name, role, status, created_at, expires_at, accepted_at, declined_at
               FROM invitation WHERE archive_id = $1 AND idempotency_key = $2`,
              [params.archiveId, typeof idempotencyKey === 'string' ? idempotencyKey : null],
            );
            return { invitation: toInvitation(existing, params.archiveId) };
          }

          if (body.role === 'storyteller') {
            await updateArchiveStatus(tx, params.archiveId, 'awaiting_storyteller');
          }

          await ctx.email.send({
            to: body.email,
            template: TEMPLATE_BY_ROLE[body.role],
            templateVersion: 'email-2026-01',
            variables: {
              productName: ctx.branding.productName,
              recipientName: body.displayName,
              inviterName: user.displayName,
              storytellerName: archive.subject_display_name,
              link: `${ctx.cfg.env.WEB_PUBLIC_URL}/invitations/${token}`,
              expiresOn: expiresAt.toISOString().slice(0, 10),
            },
          });
          await ctx.analytics.track('invitation_sent', {
            actorId: user.id,
            archiveId: params.archiveId,
          });

          return {
            invitation: toInvitation(
              { ...invitation, accepted_at: null, declined_at: null },
              params.archiveId,
            ),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/invitations',
    tag: 'invitations',
    summary: 'Invitations sent for this archive',
    auth: 'required',
    params: archiveParams,
    response: z.object({ invitations: z.array(invitationSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'invitation.read',
          resource: { type: 'invitation' },
        },
        async ({ tx }) => {
          const rows = await tx.query<Parameters<typeof toInvitation>[0]>(
            `SELECT id, email, display_name, role, status, created_at, expires_at, accepted_at, declined_at
             FROM invitation WHERE archive_id = $1 ORDER BY created_at DESC`,
            [params.archiveId],
          );
          return { invitations: rows.map((r) => toInvitation(r, params.archiveId)) };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives/:archiveId/invitations/:invitationId/revoke',
    tag: 'invitations',
    summary: 'Withdraw an invitation that has not been answered',
    auth: 'required',
    params: archiveParams.extend({ invitationId: z.uuid() }),
    response: z.object({ revoked: z.literal(true) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: 'invitation.revoke',
          resource: { type: 'invitation', id: params.invitationId },
          auditOnAllow: true,
        },
        async ({ tx }) => {
          const row = await tx.maybeOne(
            `UPDATE invitation SET status = 'revoked'
             WHERE id = $1 AND archive_id = $2 AND status = 'sent' RETURNING id`,
            [params.invitationId, params.archiveId],
          );
          if (!row) throw notFound('That invitation was not found, or has already been answered.');
          return { revoked: true as const };
        },
      ),
  });

  // ---- Token-addressed routes: the invitee may not have an account yet ----

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/invitations/:token',
    tag: 'invitations',
    summary: 'What an invitation says, before signing in',
    description:
      'Deliberately thin. Holding an invitation link must not disclose any archive content — ' +
      'only who invited you, about whom, and in what capacity.',
    auth: 'none',
    params: z.object({ token: z.string().min(20).max(200) }),
    response: invitationPreviewSchema,
    handler: async ({ params }) => {
      const row = await ctx.db.maybeOne<{
        id: string;
        role: 'storyteller' | 'buyer' | 'family' | 'contributor' | 'steward';
        personal_note: string | null;
        expires_at: Date;
        status: string;
        archive_name: string;
        subject_display_name: string;
        inviter_name: string | null;
      }>(
        `SELECT i.id, i.role, i.personal_note, i.expires_at, i.status,
                a.name AS archive_name, p.display_name AS subject_display_name,
                u.display_name AS inviter_name
         FROM invitation i
         JOIN archive a ON a.id = i.archive_id
         JOIN person p ON p.id = a.subject_person_id
         LEFT JOIN app_user u ON u.id = i.created_by_user_id
         WHERE i.token_hash = $1`,
        [hashOpaqueToken(params.token)],
      );

      if (!row || row.status !== 'sent' || row.expires_at.getTime() < Date.now()) {
        throw notFound('This invitation link is no longer valid.');
      }
      return {
        invitationId: row.id,
        role: row.role,
        archiveName: row.archive_name,
        subjectDisplayName: row.subject_display_name,
        invitedByDisplayName: row.inviter_name ?? 'Someone in your family',
        personalNote: row.personal_note,
        expiresAt: row.expires_at.toISOString(),
        productName: ctx.branding.productName,
        requiresTeachBack: row.role === 'storyteller',
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/invitations/:token/respond',
    tag: 'invitations',
    summary: 'Accept or decline an invitation',
    description:
      'The decision belongs to the invitee alone. A decline records the reason for them only; ' +
      'the person who invited them is told that the invitation was not taken up, and nothing more.',
    auth: 'required',
    params: z.object({ token: z.string().min(20).max(200) }),
    body: respondToInvitationRequestSchema,
    response: z.object({
      decision: z.enum(['accept', 'decline']),
      archiveId: z.uuid(),
      role: z.string(),
      nextStep: z.enum(['teach_back', 'archive', 'none']),
    }),
    handler: async ({ params, body, user, request }) => {
      if (!user) throw unauthenticated();

      return ctx.db.transaction(async (tx) => {
        const invitation = await tx.maybeOne<{
          id: string;
          archive_id: string;
          email: string;
          display_name: string;
          role: 'storyteller' | 'buyer' | 'family' | 'contributor' | 'steward';
          status: string;
          expires_at: Date;
          created_by_user_id: string | null;
        }>(
          `SELECT id, archive_id, email, display_name, role, status, expires_at, created_by_user_id
           FROM invitation WHERE token_hash = $1 FOR UPDATE`,
          [hashOpaqueToken(params.token)],
        );

        if (
          !invitation ||
          invitation.status !== 'sent' ||
          invitation.expires_at.getTime() < Date.now()
        ) {
          throw notFound('This invitation link is no longer valid.');
        }
        // The invitation is addressed to a person, not transferable to whoever
        // opens the link while signed in as someone else.
        if (invitation.email !== user.email) {
          throw validationFailed(
            'This invitation was sent to a different email address. Sign in with that address to respond.',
          );
        }

        const inviter = invitation.created_by_user_id
          ? await tx.maybeOne<{ email: string }>(`SELECT email FROM app_user WHERE id = $1`, [
              invitation.created_by_user_id,
            ])
          : null;

        if (body.decision === 'decline') {
          await tx.query(
            `UPDATE invitation SET status = 'declined', declined_at = now(), decline_reason = $2 WHERE id = $1`,
            [invitation.id, body.declineReason ?? null],
          );
          if (invitation.role === 'storyteller') {
            await updateArchiveStatus(tx, invitation.archive_id, 'declined');
          }
          await recordAuditEvent(tx, {
            archiveId: invitation.archive_id,
            actorUserId: user.id,
            actorDisplay: user.displayName,
            action: 'invitation.respond',
            resourceType: 'invitation',
            resourceId: invitation.id,
            outcome: 'success',
            requestId: request.id,
            metadata: { decision: 'decline' },
          });
          if (inviter) {
            // No reason, no name, no encouragement to try again.
            await ctx.email.send({
              to: inviter.email,
              template: 'invitation_declined',
              templateVersion: 'email-2026-01',
              variables: { productName: ctx.branding.productName },
            });
          }
          await ctx.analytics.track('invitation_declined', {
            actorId: user.id,
            archiveId: invitation.archive_id,
          });
          return {
            decision: 'decline' as const,
            archiveId: invitation.archive_id,
            role: invitation.role,
            nextStep: 'none' as const,
          };
        }

        await tx.query(
          `UPDATE invitation SET status = 'accepted', accepted_at = now() WHERE id = $1`,
          [invitation.id],
        );
        await createMembership(tx, {
          archiveId: invitation.archive_id,
          userId: user.id,
          email: user.email,
          displayName: invitation.display_name,
          role: invitation.role,
          status: 'active',
          invitedByUserId: invitation.created_by_user_id,
        });

        if (invitation.role === 'storyteller') {
          // The archive stays in awaiting_storyteller until consent is set:
          // accepting an invitation is not the same as consenting.
          await tx.query(
            `UPDATE archive SET storyteller_user_id = $2, updated_at = now() WHERE id = $1`,
            [invitation.archive_id, user.id],
          );
        }

        await recordAuditEvent(tx, {
          archiveId: invitation.archive_id,
          actorUserId: user.id,
          actorDisplay: user.displayName,
          action: 'invitation.respond',
          resourceType: 'invitation',
          resourceId: invitation.id,
          outcome: 'success',
          requestId: request.id,
          metadata: { decision: 'accept', role: invitation.role },
        });
        if (inviter) {
          await ctx.email.send({
            to: inviter.email,
            template: 'invitation_accepted',
            templateVersion: 'email-2026-01',
            variables: {
              productName: ctx.branding.productName,
              recipientName: invitation.display_name,
            },
          });
        }
        await ctx.analytics.track('invitation_accepted', {
          actorId: user.id,
          archiveId: invitation.archive_id,
        });

        return {
          decision: 'accept' as const,
          archiveId: invitation.archive_id,
          role: invitation.role,
          nextStep:
            invitation.role === 'storyteller' ? ('teach_back' as const) : ('archive' as const),
        };
      });
    },
  });
}

function toInvitation(
  row: {
    id: string;
    email: string;
    display_name: string;
    role: 'storyteller' | 'buyer' | 'family' | 'contributor' | 'steward';
    status: 'sent' | 'accepted' | 'declined' | 'revoked' | 'expired';
    created_at: Date;
    expires_at: Date;
    accepted_at: Date | null;
    declined_at: Date | null;
  },
  archiveId: string,
) {
  return {
    id: row.id,
    archiveId,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    declinedAt: row.declined_at?.toISOString() ?? null,
  };
}
