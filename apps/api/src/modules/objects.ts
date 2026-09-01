import type { FastifyInstance } from 'fastify';
import { LocalStorageAdapter } from '@everecho/adapters';
import { ApiError } from '../errors';
import type { AppContext } from '../context';

/**
 * Signed object transfer for the local storage driver.
 *
 * These endpoints are addressed by an HMAC signature rather than by a session:
 * the signature *is* the authorisation, it expires, and it is only ever issued
 * after authorize() has permitted the access. With STORAGE_DRIVER=s3 the
 * equivalent URLs are presigned by S3 and never reach this process at all.
 */
export function registerObjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  const local = ctx.storage instanceof LocalStorageAdapter ? ctx.storage : null;

  // Fastify matches content types by exact string or RegExp; "image/*" is
  // neither, and silently matches nothing.
  const asBuffer = (_request: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) =>
    done(null, body);
  app.addContentTypeParser(/^(audio|video|image)\//, { parseAs: 'buffer' }, asBuffer);
  app.addContentTypeParser(
    ['application/octet-stream', 'application/pdf', 'text/plain'],
    { parseAs: 'buffer' },
    asBuffer,
  );

  app.route({
    method: 'PUT',
    url: '/v1/objects/put',
    bodyLimit: ctx.cfg.env.UPLOAD_MAX_BYTES,
    handler: async (request, reply) => {
      if (!local) throw new ApiError('not_found', 'That was not found.');
      const query = request.query as { key?: string; expires?: string; signature?: string };
      if (
        !query.key ||
        !local.verifySignature({
          key: query.key,
          expires: Number(query.expires),
          op: 'put',
          signature: query.signature ?? '',
        })
      ) {
        // Expired and forged links are indistinguishable to the caller on purpose.
        throw new ApiError('forbidden', 'This upload link is no longer valid.');
      }
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) {
        throw new ApiError('validation_failed', 'No file content was received.');
      }
      const stored = await local.put(query.key, body, request.headers['content-type'] ?? 'application/octet-stream');
      reply.status(200);
      return { stored: true, byteSize: stored.byteSize, checksum: stored.checksumSha256 };
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/objects/get',
    handler: async (request, reply) => {
      if (!local) throw new ApiError('not_found', 'That was not found.');
      const query = request.query as { key?: string; expires?: string; signature?: string };
      if (
        !query.key ||
        !local.verifySignature({
          key: query.key,
          expires: Number(query.expires),
          op: 'get',
          signature: query.signature ?? '',
        })
      ) {
        throw new ApiError('forbidden', 'This link is no longer valid.');
      }
      const bytes = await local.get(query.key).catch(() => null);
      if (!bytes) throw new ApiError('not_found', 'That was not found.');

      reply
        .header('content-type', 'application/octet-stream')
        .header('cache-control', 'private, no-store')
        // Never let a browser sniff a stored file into something executable.
        .header('x-content-type-options', 'nosniff')
        .header('content-disposition', 'attachment');
      return reply.send(bytes);
    },
  });
}
