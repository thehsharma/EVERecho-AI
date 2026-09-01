import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import { randomUUID } from 'node:crypto';
import { ApiError } from './errors';
import { csrfTokenValid, resolveSession, type SessionUser } from './lib/session';
import type { AppContext } from './context';
import { registerRoutes } from './modules';
import { registerRealtimeSocket } from './realtime/ws';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const CLIENT_ERROR_CODES: Record<
  number,
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
> = {
  400: 'validation_failed',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  415: 'unsupported_media_type',
  429: 'rate_limited',
};

const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: 'That request was not accepted.',
  401: 'Please sign in.',
  403: 'You do not have access to that.',
  404: 'That was not found.',
  409: 'That conflicts with something that already exists.',
  413: 'That file is larger than the limit.',
  415: 'That file type is not accepted.',
  429: 'Too many requests. Please wait a moment.',
};

export async function buildServer(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: ctx.cfg.env.TRUST_PROXY,
    genReqId: () => randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
    logger: {
      level: ctx.cfg.env.LOG_LEVEL,
      // Memory content must never reach a log line, so the request body is
      // never serialised and only a coarse user-agent family is kept.
      serializers: {
        req: (request) => ({
          method: request.method,
          url: request.url.split('?')[0],
          requestId: request.id,
        }),
      },
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
        remove: true,
      },
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // The API serves JSON and signed object bytes; it renders no markup.
        scriptSrc: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(cors, {
    origin: [ctx.cfg.env.WEB_PUBLIC_URL],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'idempotency-key'],
  });

  // A POST with a JSON content type and no body is what a browser sends for an
  // action that takes no arguments ("sign out"). Fastify rejects that by
  // default; treating it as an empty object is what callers actually mean.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new ApiError('validation_failed', 'That request body was not valid JSON.'), undefined);
    }
  });

  await app.register(cookie, { secret: ctx.cfg.env.SESSION_SECRET });
  await app.register(multipart, {
    limits: { fileSize: ctx.cfg.env.UPLOAD_MAX_BYTES, files: 1 },
  });

  /**
   * Session resolution runs BEFORE the rate limiter is registered, because
   * Fastify runs onRequest hooks in registration order. With it after, the
   * limiter's key generator never sees `request.user`, every request falls back
   * to the client address, and all server-rendered traffic — which arrives from
   * one address — shares a single bucket and locks every user out together.
   */
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    request.user = null;

    const token = request.cookies[ctx.cfg.env.SESSION_COOKIE_NAME];
    if (token) {
      request.user = await resolveSession(ctx.db, token);
      if (!request.user) {
        reply.clearCookie(ctx.cfg.env.SESSION_COOKIE_NAME, { path: '/' });
      }
    }
  });

  await app.register(rateLimit, {
    global: true,
    max: ctx.cfg.env.RATE_LIMIT_MAX,
    timeWindow: ctx.cfg.env.RATE_LIMIT_WINDOW_MS,
    // Per account where we have one, per address otherwise, so one household
    // behind a shared connection does not lock each other out.
    keyGenerator: (request) => request.user?.id ?? request.ip,
    // Liveness and readiness probes must not consume anyone's budget, and the
    // branding endpoint is fetched on every page render with nothing private
    // in it.
    allowList: (request) =>
      ['/healthz', '/readyz', '/v1/meta'].includes(request.url.split('?')[0] ?? ''),
  });

  app.addHook('onRequest', async (request) => {
    // Double-submit CSRF on every state-changing request that carries a
    // session. Webhooks authenticate by provider signature and are exempt.
    const token = request.cookies[ctx.cfg.env.SESSION_COOKIE_NAME];
    if (!SAFE_METHODS.has(request.method) && token && !request.url.startsWith('/v1/webhooks/')) {
      const presented = request.headers['x-csrf-token'];
      if (
        !csrfTokenValid(
          token,
          typeof presented === 'string' ? presented : undefined,
          ctx.cfg.env.SESSION_SECRET,
        )
      ) {
        throw new ApiError(
          'forbidden',
          'This request could not be verified. Please reload and try again.',
        );
      }
    }
  });

  app.setNotFoundHandler(async (request, reply) => {
    reply.status(404);
    return {
      error: { code: 'not_found', message: 'That was not found.', requestId: request.id },
    };
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.status >= 500)
        request.log.error({ err: error, requestId: request.id }, 'api error');
      reply.status(error.status);
      return {
        error: {
          code: error.code,
          message: error.message,
          reasonCode: error.options.reasonCode,
          policyVersion: error.options.policyVersion,
          fieldErrors: error.options.fieldErrors,
          requestId: request.id,
        },
      };
    }

    // Anything the framework itself rejected is the caller's problem, not a
    // server fault. Reporting these as 500 would both mislead the client and
    // bury real faults in the same bucket.
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      const code = CLIENT_ERROR_CODES[statusCode] ?? 'validation_failed';
      const message = CLIENT_ERROR_MESSAGES[statusCode] ?? 'That request was not accepted.';
      request.log.warn({ statusCode, requestId: request.id }, 'request rejected');
      reply.status(statusCode);
      return { error: { code, message, requestId: request.id } };
    }

    // Anything unrecognised is logged in full and reported as nothing.
    request.log.error({ err: error, requestId: request.id }, 'unhandled error');
    reply.status(500);
    return {
      error: {
        code: 'internal_error',
        message: 'Something went wrong on our side. Nothing was changed.',
        requestId: request.id,
      },
    };
  });

  await registerRoutes(app, ctx);
  // The media plane, registered after the control plane so it inherits the
  // same session-resolving and rate-limiting hooks.
  await registerRealtimeSocket(app, ctx);
  return app;
}
