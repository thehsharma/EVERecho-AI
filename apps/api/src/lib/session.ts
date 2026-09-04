import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '@everecho/config';
import type { Database } from '@everecho/db';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  isPlatformAdmin: boolean;
  sessionId: string;
}

/** Only a hash is stored, so a database dump does not yield usable sessions. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Hashed with the session secret: audit context without a tracking database. */
export function hashIp(ip: string | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHmac('sha256', secret).update(ip).digest('hex').slice(0, 32);
}

/** A coarse family, never the full user-agent string. */
export function userAgentFamily(userAgent: string | undefined): string {
  if (!userAgent) return 'unknown';
  if (/edg/i.test(userAgent)) return 'Edge';
  if (/chrome|chromium/i.test(userAgent)) return 'Chrome';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  return 'Other';
}

export async function createSession(
  db: Database,
  cfg: AppConfig,
  input: { userId: string; ip?: string; userAgent?: string },
): Promise<{ token: string; expiresAt: Date; sessionId: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + cfg.env.SESSION_TTL_SECONDS * 1000);
  const row = await db.one<{ id: string }>(
    `INSERT INTO user_session (user_id, token_hash, expires_at, ip_hash, user_agent_family)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      input.userId,
      hashToken(token),
      expiresAt,
      hashIp(input.ip, cfg.env.SESSION_SECRET),
      userAgentFamily(input.userAgent),
    ],
  );
  return { token, expiresAt, sessionId: row.id };
}

export async function resolveSession(db: Database, token: string): Promise<SessionUser | null> {
  const row = await db.maybeOne<{
    session_id: string;
    id: string;
    email: string;
    display_name: string;
    is_platform_admin: boolean;
    status: string;
  }>(
    `SELECT s.id AS session_id, u.id, u.email, u.display_name, u.is_platform_admin, u.status
     FROM user_session s
     JOIN app_user u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()`,
    [hashToken(token)],
  );
  if (!row || row.status !== 'active') return null;

  await db.query(`UPDATE user_session SET last_seen_at = now() WHERE id = $1`, [row.session_id]);
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    isPlatformAdmin: row.is_platform_admin,
    sessionId: row.session_id,
  };
}

export async function revokeSession(db: Database, sessionId: string): Promise<void> {
  await db.query(`UPDATE user_session SET revoked_at = now() WHERE id = $1`, [sessionId]);
}

export async function revokeAllSessions(db: Database, userId: string): Promise<number> {
  const rows = await db.query<{ id: string }>(
    `UPDATE user_session SET revoked_at = now()
     WHERE user_id = $1 AND revoked_at IS NULL RETURNING id`,
    [userId],
  );
  return rows.length;
}

/**
 * Double-submit CSRF token, bound to the session cookie by HMAC. State-changing
 * requests must echo it in a header, which a cross-site form post cannot do.
 */
export function csrfTokenFor(sessionToken: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
}

export function csrfTokenValid(
  sessionToken: string,
  presented: string | undefined,
  secret: string,
): boolean {
  if (!presented) return false;
  const expected = Buffer.from(csrfTokenFor(sessionToken, secret));
  const given = Buffer.from(presented);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Invitation and confirmation tokens: random, stored only as a hash. */
export function issueOpaqueToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

export function hashOpaqueToken(token: string): string {
  return hashToken(token);
}
