import { z } from 'zod';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  changePasswordRequestSchema,
  meResponseSchema,
  sessionSummarySchema,
  signInRequestSchema,
  signUpRequestSchema,
} from '@everecho/contracts';
import { listArchivesForUser, recordAuditEvent } from '@everecho/db';
import { defineRoute } from '../http/route';
import { ApiError, conflict, unauthenticated } from '../errors';
import { hashPassword, verifyPassword } from '../lib/password';
import {
  createSession,
  csrfTokenFor,
  hashIp,
  revokeAllSessions,
  revokeSession,
  userAgentFamily,
} from '../lib/session';
import type { AppContext } from '../context';

/** Slow enough to be inconvenient to a script, fast enough for a person. */
const AUTH_RATE_LIMIT = { max: 20, windowMs: 60_000 };

function setSessionCookie(
  ctx: AppContext,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie(ctx.cfg.env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: ctx.cfg.env.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
    ...(ctx.cfg.env.COOKIE_DOMAIN ? { domain: ctx.cfg.env.COOKIE_DOMAIN } : {}),
  });
  // Readable by the frontend on purpose: it is the double-submit half.
  reply.setCookie('everecho_csrf', csrfTokenFor(token, ctx.cfg.env.SESSION_SECRET), {
    httpOnly: false,
    sameSite: 'lax',
    secure: ctx.cfg.env.COOKIE_SECURE,
    path: '/',
    expires: expiresAt,
  });
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/auth/sign-up',
    tag: 'auth',
    summary: 'Create an account',
    auth: 'none',
    rateLimit: AUTH_RATE_LIMIT,
    body: signUpRequestSchema,
    response: z.object({ userId: z.uuid(), email: z.string() }),
    status: 201,
    handler: async ({ body, request, reply }) => {
      const passwordHash = await hashPassword(body.password);
      const existing = await ctx.db.maybeOne<{ id: string }>(
        `SELECT id FROM app_user WHERE email = $1`,
        [body.email],
      );
      if (existing) {
        // An account already exists. Saying so is a disclosure, but the
        // alternative — silently doing nothing — leaves someone stuck at a
        // screen that will never work. Sign-in is rate limited either way.
        throw conflict('An account with this email already exists. Try signing in instead.');
      }

      const user = await ctx.db.one<{ id: string; email: string }>(
        `INSERT INTO app_user (email, display_name, password_hash, accepted_legal_copy_version)
         VALUES ($1, $2, $3, $4) RETURNING id, email`,
        [body.email, body.displayName, passwordHash, body.acceptedLegalCopyVersion],
      );

      const session = await createSession(ctx.db, ctx.cfg, {
        userId: user.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      setSessionCookie(ctx, reply, session.token, session.expiresAt);

      await recordAuditEvent(ctx.db, {
        archiveId: null,
        actorUserId: user.id,
        actorDisplay: body.displayName,
        action: 'auth.sign_up',
        resourceType: 'archive',
        outcome: 'success',
        requestId: request.id,
      });
      return { userId: user.id, email: user.email };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/auth/sign-in',
    tag: 'auth',
    summary: 'Sign in',
    auth: 'none',
    rateLimit: AUTH_RATE_LIMIT,
    body: signInRequestSchema,
    response: z.object({ userId: z.uuid() }),
    handler: async ({ body, request, reply }) => {
      const row = await ctx.db.maybeOne<{
        id: string;
        password_hash: string | null;
        status: string;
        display_name: string;
      }>(`SELECT id, password_hash, status, display_name FROM app_user WHERE email = $1`, [
        body.email,
      ]);

      // The password is verified even when no account matched, so the response
      // time does not reveal which addresses are registered.
      const valid = await verifyPassword(body.password, row?.password_hash ?? null);

      if (!row || !valid || row.status !== 'active') {
        await ctx.db.query(
          `INSERT INTO security_event (user_id, kind, severity, ip_hash, request_id)
           VALUES ($1, 'sign_in_failed', 'low', $2, $3)`,
          [row?.id ?? null, hashIp(request.ip, ctx.cfg.env.SESSION_SECRET), request.id],
        );
        throw unauthenticated('That email and password did not match.');
      }

      const session = await createSession(ctx.db, ctx.cfg, {
        userId: row.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      setSessionCookie(ctx, reply, session.token, session.expiresAt);
      await ctx.db.query(`UPDATE app_user SET last_login_at = now() WHERE id = $1`, [row.id]);
      return { userId: row.id };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/auth/sign-out',
    tag: 'auth',
    summary: 'Sign out of this session',
    auth: 'required',
    response: z.object({ signedOut: z.literal(true) }),
    handler: async ({ user, reply }) => {
      await revokeSession(ctx.db, user!.sessionId);
      reply.clearCookie(ctx.cfg.env.SESSION_COOKIE_NAME, { path: '/' });
      reply.clearCookie('everecho_csrf', { path: '/' });
      return { signedOut: true as const };
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/me',
    tag: 'auth',
    summary: 'The signed-in account and the archives it can reach',
    auth: 'required',
    response: meResponseSchema,
    handler: async ({ user }) => {
      const account = await ctx.db.one<{
        id: string;
        email: string;
        display_name: string;
        is_platform_admin: boolean;
        mfa_enabled: boolean;
        created_at: Date;
      }>(
        `SELECT id, email, display_name, is_platform_admin, mfa_enabled, created_at
         FROM app_user WHERE id = $1`,
        [user!.id],
      );
      const archives = await listArchivesForUser(ctx.db, user!.id);
      return {
        user: {
          id: account.id,
          email: account.email,
          displayName: account.display_name,
          isPlatformAdmin: account.is_platform_admin,
          mfaEnabled: account.mfa_enabled,
          createdAt: account.created_at.toISOString(),
        },
        archives: archives.map((a) => ({
          archiveId: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
        })),
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'GET',
    url: '/v1/me/sessions',
    tag: 'auth',
    summary: 'Active sessions for this account',
    auth: 'required',
    response: z.object({ sessions: z.array(sessionSummarySchema) }),
    handler: async ({ user }) => {
      const rows = await ctx.db.query<{
        id: string;
        created_at: Date;
        expires_at: Date;
        user_agent_family: string | null;
      }>(
        `SELECT id, created_at, expires_at, user_agent_family FROM user_session
         WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
         ORDER BY created_at DESC`,
        [user!.id],
      );
      return {
        sessions: rows.map((r) => ({
          id: r.id,
          createdAt: r.created_at.toISOString(),
          expiresAt: r.expires_at.toISOString(),
          current: r.id === user!.sessionId,
          userAgentFamily: r.user_agent_family ?? 'unknown',
        })),
      };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/me/sessions/revoke-all',
    tag: 'auth',
    summary: 'Sign out everywhere',
    description: 'Revokes every session for this account, including the current one.',
    auth: 'required',
    response: z.object({ revoked: z.number().int() }),
    handler: async ({ user, reply, request }) => {
      const revoked = await revokeAllSessions(ctx.db, user!.id);
      reply.clearCookie(ctx.cfg.env.SESSION_COOKIE_NAME, { path: '/' });
      reply.clearCookie('everecho_csrf', { path: '/' });
      await recordAuditEvent(ctx.db, {
        archiveId: null,
        actorUserId: user!.id,
        actorDisplay: user!.displayName,
        action: 'auth.revoke_all_sessions',
        resourceType: 'archive',
        outcome: 'success',
        requestId: request.id,
        metadata: { revoked },
      });
      return { revoked };
    },
  });

  defineRoute(app, ctx, {
    method: 'POST',
    url: '/v1/me/password',
    tag: 'auth',
    summary: 'Change password',
    description:
      'Every other session is revoked, because a password change is often a response to a compromise.',
    auth: 'required',
    rateLimit: AUTH_RATE_LIMIT,
    body: changePasswordRequestSchema,
    response: z.object({ changed: z.literal(true), otherSessionsRevoked: z.number().int() }),
    handler: async ({ body, user, request, reply }) => {
      const row = await ctx.db.one<{ password_hash: string | null; email: string }>(
        `SELECT password_hash, email FROM app_user WHERE id = $1`,
        [user!.id],
      );
      if (!(await verifyPassword(body.currentPassword, row.password_hash))) {
        throw new ApiError('unauthenticated', 'That password did not match.');
      }
      const revoked = await revokeAllSessions(ctx.db, user!.id);
      await ctx.db.query(
        `UPDATE app_user SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [user!.id, await hashPassword(body.newPassword)],
      );

      const session = await createSession(ctx.db, ctx.cfg, {
        userId: user!.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      });
      setSessionCookie(ctx, reply, session.token, session.expiresAt);

      await ctx.email.send({
        to: row.email,
        template: 'password_changed',
        templateVersion: 'email-2026-01',
        variables: {
          productName: ctx.branding.productName,
          supportEmail: ctx.branding.supportEmail,
        },
      });
      return { changed: true as const, otherSessionsRevoked: Math.max(0, revoked - 1) };
    },
  });
}

export { userAgentFamily };
