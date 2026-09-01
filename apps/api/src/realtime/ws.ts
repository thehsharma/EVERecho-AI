import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  REALTIME_PROTOCOL_VERSION,
  clientEventSchema,
  type ServerEvent,
} from '@everecho/contracts';
import {
  consumeReconnectToken,
  findArchive,
  findMembership,
  findSession,
  type RealtimeSessionRow,
} from '@everecho/db';
import type { AppContext } from '../context';
import { createStreamingProviders } from './engine';
import { SessionDriver } from './driver';

/**
 * The WebSocket media plane.
 *
 * A thin adapter. Every decision that matters — admission, authorisation,
 * retrieval, persistence, what may be learned — belongs to the driver and to
 * `authorize()`. This file moves bytes and nothing else, which is why swapping
 * it for LiveKit later is an adapter change rather than a rewrite.
 */

/** One audio frame may not exceed this. A bounded frame cannot exhaust memory. */
const MAX_MESSAGE_BYTES = 96 * 1024;

/**
 * Sessions one person may hold open at once.
 *
 * Low on purpose: a real person holds one conversation. The limit exists to
 * stop an open socket being a cheap way to consume a server.
 */
const MAX_CONCURRENT_SESSIONS_PER_USER = 3;

/** A session with no traffic for this long is abandoned and closed. */
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

interface LiveConnection {
  driver: SessionDriver;
  socket: { send(data: string): void; close(code?: number, reason?: string): void };
  userId: string;
  sessionId: string;
  archiveId: string;
  lastActivity: number;
}

/**
 * Live connections, in memory, keyed by session.
 *
 * Deliberately not the source of truth: session state lives in PostgreSQL, so
 * losing this map loses connections but never data, and two API instances do
 * not have to agree about it.
 */
const connections = new Map<string, LiveConnection>();

export function liveConnectionCount(): number {
  return connections.size;
}

/** Ends every live connection for an archive. Used when consent is withdrawn. */
export async function closeArchiveConnections(archiveId: string, reason: string): Promise<number> {
  let closed = 0;
  for (const [key, connection] of connections) {
    if (connection.archiveId !== archiveId) continue;
    await connection.driver.end(reason).catch(() => undefined);
    connection.socket.close(4003, reason);
    connections.delete(key);
    closed += 1;
  }
  return closed;
}

export async function registerRealtimeSocket(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const { default: websocket } = await import('@fastify/websocket');
  await app.register(websocket, {
    options: { maxPayload: MAX_MESSAGE_BYTES },
  });

  app.get<{
    Params: { archiveId: string; sessionId: string };
    Querystring: { reconnectToken?: string };
  }>(
    '/v1/archives/:archiveId/realtime-sessions/:sessionId/socket',
    { websocket: true },
    async (socket, request) => {
      const send = (event: ServerEvent) => {
        try {
          socket.send(JSON.stringify(event));
        } catch {
          // A closed socket is not an error worth logging per frame.
        }
      };

      const fail = (code: number, reason: string) => {
        send({ type: 'error', seq: 0, code: reason, message: reason, fatal: true });
        socket.close(code, reason);
      };

      // Origin checking, before anything else.
      //
      // A WebSocket upgrade is a GET, so the CSRF hook does not cover it, and
      // browsers send cookies on cross-origin WebSocket handshakes because
      // WebSockets are not subject to CORS. Without this, any page on the
      // internet could open an authenticated socket into somebody's archive
      // and listen. This is the whole defence against that.
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !allowedOrigins(ctx).includes(origin)) {
        fail(4403, 'origin_not_allowed');
        return;
      }

      // Admission. The session cookie was already resolved by the server's
      // onRequest hook, so this reuses the one authentication path rather than
      // inventing a second one for sockets.
      const user = (request as FastifyRequest).user;
      if (!user) {
        fail(4401, 'not_authenticated');
        return;
      }

      const { archiveId, sessionId } = request.params;
      const session = await loadSession(ctx, archiveId, sessionId);
      if (!session) {
        fail(4404, 'not_found');
        return;
      }
      if (session.ended_at) {
        fail(4409, 'realtime_session_not_live');
        return;
      }

      // Only the person who started it, and only if they are still a member.
      // Membership is re-read here rather than trusted from session creation.
      const membership = await ctx.db.withArchiveScope(archiveId, (tx) =>
        findMembership(tx, archiveId, user.id),
      );
      if (!membership || membership.status !== 'active' || session.started_by_user_id !== user.id) {
        fail(4403, 'not_permitted');
        return;
      }

      // Resuming a dropped connection consumes a single-use token, so a
      // captured token is useless once the legitimate client has reconnected.
      const reconnectToken = request.query.reconnectToken;
      if (reconnectToken) {
        const ok = await ctx.db.withArchiveScope(archiveId, (tx) =>
          consumeReconnectToken(tx, {
            archiveId,
            sessionId,
            userId: user.id,
            token: reconnectToken,
          }),
        );
        if (!ok) {
          fail(4401, 'reconnect_token_invalid');
          return;
        }
      }

      const openForUser = [...connections.values()].filter((c) => c.userId === user.id).length;
      if (openForUser >= MAX_CONCURRENT_SESSIONS_PER_USER) {
        fail(4429, 'too_many_sessions');
        return;
      }

      const driver = new SessionDriver({
        ctx,
        providers: createStreamingProviders(ctx),
        session,
        userId: user.id,
        emit: async (event) => send(event),
      });

      const connection: LiveConnection = {
        driver,
        socket,
        userId: user.id,
        sessionId,
        archiveId,
        lastActivity: Date.now(),
      };
      connections.set(sessionId, connection);

      const idle = setInterval(() => {
        if (Date.now() - connection.lastActivity < IDLE_TIMEOUT_MS) return;
        void driver.end('idle_timeout').finally(() => socket.close(4408, 'idle_timeout'));
      }, 30_000);

      socket.on('message', (raw: Buffer | string) => {
        connection.lastActivity = Date.now();
        void (async () => {
          const text = typeof raw === 'string' ? raw : raw.toString('utf8');
          if (text.length > MAX_MESSAGE_BYTES) {
            send({
              type: 'warning',
              seq: 0,
              code: 'payload_too_large',
              message: 'Frame too large.',
            });
            return;
          }

          let parsed: unknown;
          try {
            parsed = JSON.parse(text);
          } catch {
            send({ type: 'warning', seq: 0, code: 'malformed', message: 'Could not read that.' });
            return;
          }

          const result = clientEventSchema.safeParse(parsed);
          if (!result.success) {
            send({
              type: 'warning',
              seq: 0,
              code: 'invalid_event',
              // The validation message, never the payload: a rejected frame may
              // contain speech, and an error path is not a place for it.
              message: result.error.issues[0]?.message ?? 'Unrecognised event.',
            });
            return;
          }

          if (
            result.data.type === 'session.hello' &&
            result.data.protocolVersion !== REALTIME_PROTOCOL_VERSION
          ) {
            fail(4400, 'protocol_version_mismatch');
            return;
          }

          try {
            await driver.handle(result.data);
          } catch (error) {
            send({
              type: 'error',
              seq: 0,
              code: 'internal_error',
              message: 'Something went wrong in this conversation.',
              fatal: false,
            });
            request.log.error({ err: error, sessionId }, 'realtime event failed');
          }
        })();
      });

      socket.on('close', () => {
        clearInterval(idle);
        connections.delete(sessionId);
        // Deliberately not ended here: a dropped socket is a reconnection
        // opportunity, not a decision to end the conversation. The idle
        // timeout closes it if nobody comes back.
      });

      socket.on('error', () => {
        clearInterval(idle);
        connections.delete(sessionId);
      });
    },
  );
}

/**
 * Origins permitted to open a socket.
 *
 * The web application and the API's own public URL, and nothing else. Kept
 * deliberately narrow: a permissive list here is indistinguishable from having
 * no origin check at all.
 */
function allowedOrigins(ctx: AppContext): string[] {
  return [ctx.cfg.env.WEB_PUBLIC_URL, ctx.cfg.env.API_PUBLIC_URL].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}

async function loadSession(
  ctx: AppContext,
  archiveId: string,
  sessionId: string,
): Promise<RealtimeSessionRow | null> {
  const archive = await ctx.db.withArchiveScope(archiveId, (tx) => findArchive(tx, archiveId));
  if (!archive) return null;
  return ctx.db.withArchiveScope(archiveId, (tx) => findSession(tx, archiveId, sessionId));
}
