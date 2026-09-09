import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

/**
 * Private story capsules.
 *
 * A capsule is a selection of approved memories for named people. It narrows
 * what consent already permits and can never widen it — there is no public
 * capsule and no "anyone with the link" mode, and the schema offers no way to
 * ask for one.
 */

export const capsuleStatusSchema = z.enum(['active', 'revoked']);

export const createCapsuleRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    note: z.string().trim().max(2000).optional(),
    /** Approved memories only. The server re-checks; this is the request. */
    memoryIds: z.array(idSchema).min(1).max(200),
    /** People it is for. Named, always. */
    recipientUserIds: z.array(idSchema).min(1).max(100),
    embargoUntil: timestampSchema.optional(),
    expiresAt: timestampSchema.optional(),
    allowDownload: z.boolean().default(false),
  })
  .refine(
    (value) =>
      !value.embargoUntil ||
      !value.expiresAt ||
      Date.parse(value.embargoUntil) < Date.parse(value.expiresAt),
    { message: 'It cannot expire before it opens.' },
  );

export const capsuleSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  title: z.string(),
  note: z.string().nullable(),
  status: capsuleStatusSchema,
  embargoUntil: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable(),
  allowDownload: z.boolean(),
  createdAt: timestampSchema,
  revokedAt: timestampSchema.nullable(),
  itemCount: z.number().int().min(0),
  recipients: z.array(
    z.object({
      userId: idSchema,
      displayName: z.string(),
      status: capsuleStatusSchema,
    }),
  ),
});
export type StoryCapsule = z.infer<typeof capsuleSchema>;

/** What a recipient sees when they open one. */
export const openCapsuleSchema = z.object({
  id: idSchema,
  title: z.string(),
  note: z.string().nullable(),
  from: z.string(),
  allowDownload: z.boolean(),
  expiresAt: timestampSchema.nullable(),
  memories: z.array(
    z.object({
      id: idSchema,
      title: z.string(),
      body: z.string(),
      occurredOn: z.string().nullable(),
    }),
  ),
});
export type OpenCapsule = z.infer<typeof openCapsuleSchema>;

/** Who opened it, and who was turned away. */
export const capsuleAccessEventSchema = z.object({
  id: idSchema,
  action: z.enum(['opened', 'refused', 'downloaded']),
  displayName: z.string(),
  reasonCode: z.string().nullable(),
  at: timestampSchema,
});
