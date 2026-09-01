import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { apiErrorSchema } from '@everecho/contracts';
import { ApiError, validationFailed } from '../errors';
import type { AppContext } from '../context';
import type { SessionUser } from '../lib/session';

export interface RouteHandlerArgs<P, Q, B> {
  params: P;
  query: Q;
  body: B;
  user: SessionUser | null;
  request: FastifyRequest;
  reply: FastifyReply;
  ctx: AppContext;
}

export interface RouteDefinition<
  P extends z.ZodTypeAny = z.ZodTypeAny,
  Q extends z.ZodTypeAny = z.ZodTypeAny,
  B extends z.ZodTypeAny = z.ZodTypeAny,
  R extends z.ZodTypeAny = z.ZodTypeAny,
> {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  tag: string;
  summary: string;
  description?: string;
  /** Anonymous access is opt-in per route, never the default. */
  auth: 'required' | 'optional' | 'none';
  params?: P;
  query?: Q;
  body?: B;
  response: R;
  status?: number;
  rateLimit?: { max: number; windowMs: number };
  handler: (
    args: RouteHandlerArgs<z.infer<P>, z.infer<Q>, z.infer<B>>,
  ) => Promise<z.infer<R>> | z.infer<R>;
}

/** Collected as routes register, then emitted as OpenAPI. One source, no drift. */
export const routeRegistry: RouteDefinition[] = [];

function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T | undefined,
  value: unknown,
  where: string,
): z.infer<T> {
  if (!schema) return undefined as z.infer<T>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw validationFailed(
      `Some details were not accepted.`,
      result.error.issues.map((i) => ({
        path: [where, ...i.path.map(String)].join('.'),
        message: i.message,
      })),
    );
  }
  return result.data;
}

/**
 * Registers a route and records it for the OpenAPI document.
 *
 * Requests are validated against the same schemas the specification is
 * generated from, and responses are validated too: a handler that returns a
 * shape the contract does not describe fails loudly in development rather than
 * quietly shipping an undocumented field to a client.
 */
export function defineRoute<
  P extends z.ZodTypeAny,
  Q extends z.ZodTypeAny,
  B extends z.ZodTypeAny,
  R extends z.ZodTypeAny,
>(app: FastifyInstance, ctx: AppContext, route: RouteDefinition<P, Q, B, R>): void {
  routeRegistry.push(route as unknown as RouteDefinition);

  app.route({
    method: route.method,
    url: route.url,
    config: {
      rateLimit: route.rateLimit
        ? { max: route.rateLimit.max, timeWindow: route.rateLimit.windowMs }
        : undefined,
    },
    handler: async (request, reply) => {
      const user = request.user ?? null;
      if (route.auth === 'required' && !user) {
        throw new ApiError('unauthenticated', 'Please sign in.');
      }

      const args: RouteHandlerArgs<z.infer<P>, z.infer<Q>, z.infer<B>> = {
        params: parseOrThrow(route.params, request.params, 'params'),
        query: parseOrThrow(route.query, request.query, 'query'),
        body: parseOrThrow(route.body, request.body, 'body'),
        user,
        request,
        reply,
        ctx,
      };

      const result = await route.handler(args);
      const validated = route.response.safeParse(result);
      if (!validated.success) {
        request.log.error(
          { issues: validated.error.issues.map((i) => i.path.join('.')), url: route.url },
          'response did not match its contract',
        );
        if (!ctx.cfg.isProduction) {
          throw new ApiError('internal_error', 'Response did not match its declared contract.');
        }
      }
      reply.status(route.status ?? 200);
      return validated.success ? validated.data : result;
    },
  });
}

const jsonSchema = (schema: z.ZodTypeAny) =>
  z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>;

/** Builds the OpenAPI document from the registered routes. */
export function buildOpenApiDocument(info: { title: string; version: string; serverUrl: string }) {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of routeRegistry) {
    // /v1/archives/:id -> /v1/archives/{id}
    const url = route.url.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
    paths[url] ??= {};

    const parameters: unknown[] = [];
    if (route.params) {
      const schema = jsonSchema(route.params) as { properties?: Record<string, unknown> };
      for (const [name, propSchema] of Object.entries(schema.properties ?? {})) {
        parameters.push({ name, in: 'path', required: true, schema: propSchema });
      }
    }
    if (route.query) {
      const schema = jsonSchema(route.query) as {
        properties?: Record<string, unknown>;
        required?: string[];
      };
      for (const [name, propSchema] of Object.entries(schema.properties ?? {})) {
        parameters.push({
          name,
          in: 'query',
          required: (schema.required ?? []).includes(name),
          schema: propSchema,
        });
      }
    }

    paths[url]![route.method.toLowerCase()] = {
      tags: [route.tag],
      summary: route.summary,
      description: route.description,
      security: route.auth === 'none' ? [] : [{ sessionCookie: [] }],
      parameters,
      ...(route.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: jsonSchema(route.body) } },
            },
          }
        : {}),
      responses: {
        [String(route.status ?? 200)]: {
          description: 'Success',
          content: { 'application/json': { schema: jsonSchema(route.response) } },
        },
        '400': errorResponse('The request was not accepted.'),
        '401': errorResponse('Authentication is required.'),
        '403': errorResponse('Refused by the storyteller’s consent policy or by role.'),
        '404': errorResponse('Not found, or not visible to you.'),
        '429': errorResponse('Too many requests.'),
      },
    };
  }

  return {
    openapi: '3.1.0',
    info: {
      title: info.title,
      version: info.version,
      description:
        'EverEcho v0.1 — a consent-first archive for a living person’s stories. ' +
        'Every archive-scoped route is authorised by the storyteller’s current consent policy ' +
        'before any data is read, and every AI-assisted answer carries claim-level citations.',
    },
    servers: [{ url: info.serverUrl }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'everecho_session' },
      },
      schemas: { ApiError: jsonSchema(apiErrorSchema) },
    },
    tags: [...new Set(routeRegistry.map((r) => r.tag))].map((name) => ({ name })),
    paths,
  };
}

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
  };
}
