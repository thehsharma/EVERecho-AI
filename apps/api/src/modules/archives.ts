import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import {
  archiveSchema,
  createArchiveRequestSchema,
  membershipSchema,
  updateMembershipRequestSchema,
} from '@everecho/contracts';
import { ACTION_REQUIREMENTS, ROLE_ACTIONS } from '@everecho/consent';
import {
  createMembership,
  findCurrentPolicy,
  listArchivesForUser,
  listMemberships,
  recordAuditEvent,
  revokeMembership,
  type MembershipRow,
} from '@everecho/db';
import { cacheKeys } from '@everecho/adapters';
import { defineRoute } from '../http/route';
import { withArchiveAccess } from '../lib/access';
import { notFound, validationFailed } from '../errors';
import type { AppContext } from '../context';

const archiveParams = z.object({ archiveId: z.uuid() });

export function registerArchiveRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/archives',
    tag: 'archives',
    summary: 'Start a private archive',
    description:
      'Creates the archive shell. It holds nothing and grants nobody access until the ' +
      'storyteller accepts an invitation and sets their own consent. Paying for an archive ' +
      'does not make the buyer its owner.',
    auth: 'required',
    body: createArchiveRequestSchema,
    response: archiveSchema,
    status: 201,
    handler: async ({ body, user, request }) => {
      if (body.subject.birthYear && new Date().getFullYear() - body.subject.birthYear < 18) {
        throw validationFailed('EverEcho does not create archives for people under 18 in this version.');
      }

      return ctx.db.transaction(async (tx) => {
        const person = await tx.one<{ id: string; display_name: string }>(
          `INSERT INTO person (display_name, given_name, family_name, birth_year)
           VALUES ($1, $2, $3, $4) RETURNING id, display_name`,
          [
            body.subject.displayName,
            body.subject.givenName ?? null,
            body.subject.familyName ?? null,
            body.subject.birthYear ?? null,
          ],
        );
        const household = await tx.one<{ id: string }>(
          `INSERT INTO household (name, created_by_user_id) VALUES ($1, $2) RETURNING id`,
          [body.householdName ?? `${body.subject.displayName}'s family`, user!.id],
        );
        const archive = await tx.one<{ id: string; created_at: Date; updated_at: Date }>(
          `INSERT INTO archive (household_id, subject_person_id, name, status, buyer_user_id,
                                created_by_user_id, data_region)
           VALUES ($1, $2, $3, 'draft', $4, $4, $5)
           RETURNING id, created_at, updated_at`,
          [household.id, person.id, body.name, user!.id, ctx.branding.dataRegion],
        );

        await createMembership(tx, {
          archiveId: archive.id,
          userId: user!.id,
          email: user!.email,
          displayName: user!.displayName,
          role: 'buyer',
          status: 'active',
          invitedByUserId: null,
        });

        await recordAuditEvent(tx, {
          archiveId: archive.id,
          actorUserId: user!.id,
          actorDisplay: user!.displayName,
          action: 'archive.create',
          resourceType: 'archive',
          resourceId: archive.id,
          outcome: 'success',
          requestId: request.id,
        });

        return {
          id: archive.id,
          name: body.name,
          status: 'draft' as const,
          subjectPersonId: person.id,
          subjectDisplayName: person.display_name,
          householdId: household.id,
          storytellerUserId: null,
          currentConsentPolicyId: null,
          consentMode: null,
          dataRegion: ctx.branding.dataRegion,
          createdAt: archive.created_at.toISOString(),
          updatedAt: archive.updated_at.toISOString(),
          viewerCapabilities: capabilitiesFor('buyer'),
          viewerRole: 'buyer' as const,
        };
      });
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives',
    tag: 'archives',
    summary: 'Archives you can reach',
    auth: 'required',
    response: z.object({ archives: z.array(archiveSchema.partial({ viewerCapabilities: true })) }),
    handler: async ({ user }) => {
      const rows = await listArchivesForUser(ctx.db, user!.id);
      return {
        archives: rows.map((row) => ({
          id: row.id,
          name: row.name,
          status: row.status,
          subjectPersonId: row.subject_person_id,
          subjectDisplayName: row.subject_display_name,
          householdId: row.household_id,
          storytellerUserId: row.storyteller_user_id,
          currentConsentPolicyId: row.current_consent_policy_id,
          consentMode: row.consent_mode,
          dataRegion: row.data_region,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
          viewerCapabilities: capabilitiesFor(row.role),
          viewerRole: row.role,
        })),
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId',
    tag: 'archives',
    summary: 'One archive, with what the caller may do in it',
    description:
      'viewerCapabilities lists the actions this caller is permitted, so the interface never ' +
      'has to guess. It is a convenience for rendering, not the authorisation itself: every ' +
      'route re-checks server-side.',
    auth: 'required',
    params: archiveParams,
    response: archiveSchema,
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'archive.read', resource: { type: 'archive' } },
        async ({ tx, archive, membership }) => {
          const policy = await findCurrentPolicy(tx, archive.id);
          return {
            id: archive.id,
            name: archive.name,
            status: archive.status,
            subjectPersonId: archive.subject_person_id,
            subjectDisplayName: archive.subject_display_name,
            householdId: archive.household_id,
            storytellerUserId: archive.storyteller_user_id,
            currentConsentPolicyId: archive.current_consent_policy_id,
            consentMode: policy?.mode ?? null,
            dataRegion: archive.data_region,
            createdAt: archive.created_at.toISOString(),
            updatedAt: archive.updated_at.toISOString(),
            viewerCapabilities: capabilitiesFor(membership!.role),
            viewerRole: membership!.role,
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/archives/:archiveId/members',
    tag: 'archives',
    summary: 'Who has access to this archive',
    auth: 'required',
    params: archiveParams,
    response: z.object({ members: z.array(membershipSchema) }),
    handler: async ({ params, request }) =>
      withArchiveAccess(
        ctx,
        request,
        { archiveId: params.archiveId, action: 'membership.read', resource: { type: 'membership' } },
        async ({ tx }) => {
          const rows = await listMemberships(tx, params.archiveId);
          return {
            members: rows.map((m) => ({
              id: m.id,
              archiveId: m.archive_id,
              userId: m.user_id,
              email: m.email,
              displayName: m.display_name,
              role: m.role,
              status: m.status,
              invitedByUserId: m.invited_by_user_id,
              grantedAt: m.granted_at?.toISOString() ?? null,
              revokedAt: m.revoked_at?.toISOString() ?? null,
              expiresAt: m.expires_at?.toISOString() ?? null,
            })),
          };
        },
      ),
  });

  defineRoute(app, ctx, {
    method: 'PATCH',
    url: '/v1/archives/:archiveId/members/:membershipId',
    tag: 'archives',
    summary: 'Withdraw or adjust someone’s access',
    description:
      'Revocation takes effect immediately: caches for this archive are cleared, so no later ' +
      'request can be served from something computed while the access still existed.',
    auth: 'required',
    params: archiveParams.extend({ membershipId: z.uuid() }),
    body: updateMembershipRequestSchema,
    response: z.object({ membership: membershipSchema }),
    handler: async ({ params, body, request }) =>
      withArchiveAccess(
        ctx,
        request,
        {
          archiveId: params.archiveId,
          action: body.status === 'revoked' ? 'membership.revoke' : 'membership.update',
          resource: { type: 'membership', id: params.membershipId },
          auditOnAllow: true,
          auditMetadata: { status: body.status ?? null },
        },
        async ({ tx, user }) => {
          const existing = await tx.maybeOne<{ id: string; role: string; email: string }>(
            `SELECT id, role, email FROM membership WHERE id = $1 AND archive_id = $2`,
            [params.membershipId, params.archiveId],
          );
          if (!existing) throw notFound('That member was not found.');
          if (existing.role === 'storyteller') {
            throw validationFailed('The storyteller’s own access cannot be withdrawn.');
          }

          const updated =
            body.status === 'revoked'
              ? await revokeMembership(tx, params.membershipId)
              : await tx.maybeOne<MembershipRow>(
                  `UPDATE membership SET expires_at = $2, updated_at = now()
                   WHERE id = $1 RETURNING *`,
                  [params.membershipId, body.expiresAt ?? null],
                );
          if (!updated) throw notFound('That member was not found.');

          // Anything derived while the access existed must stop being served.
          await ctx.cache.deletePrefix(cacheKeys.archivePrefix(params.archiveId));

          if (body.status === 'revoked') {
            await ctx.email.send({
              to: existing.email,
              template: 'access_revoked',
              templateVersion: 'email-2026-01',
              variables: { productName: ctx.branding.productName },
            });
            await ctx.analytics.track('access_revoked', {
              actorId: user.id,
              archiveId: params.archiveId,
            });
          }

          return {
            membership: {
              id: updated.id,
              archiveId: updated.archive_id,
              userId: updated.user_id,
              email: updated.email,
              displayName: updated.display_name,
              role: updated.role,
              status: updated.status,
              invitedByUserId: updated.invited_by_user_id,
              grantedAt: updated.granted_at?.toISOString() ?? null,
              revokedAt: updated.revoked_at?.toISOString() ?? null,
              expiresAt: updated.expires_at?.toISOString() ?? null,
            },
          };
        },
      ),
  });
}

/** Actions this role may attempt, minus anything prohibited outright. */
function capabilitiesFor(role: keyof typeof ROLE_ACTIONS): string[] {
  return ROLE_ACTIONS[role].filter((action) => action in ACTION_REQUIREMENTS);
}
