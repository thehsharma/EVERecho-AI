import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

/**
 * How the storyteller felt about their own memory.
 *
 * Free text, deliberately. There is no enum of permitted emotions here and
 * there will not be: a fixed vocabulary would be the product deciding what a
 * person is allowed to have felt about their own life.
 *
 * And nothing in this contract can be produced by inference. There is no
 * confidence, no evidence class and no model version, because there is no path
 * that writes one except the storyteller writing it themselves.
 */

export const memoryFeelingSchema = z.object({
  id: idSchema,
  memoryId: idSchema,
  /** Their words. */
  body: z.string(),
  /** Present when they said it aloud, so it can be played rather than read. */
  sourceAssetId: idSchema.nullable(),
  transcriptSegmentId: idSchema.nullable(),
  /** Whether anybody else may see it. Decided per note, when it is written. */
  shared: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type MemoryFeeling = z.infer<typeof memoryFeelingSchema>;

export const upsertFeelingRequestSchema = z.object({
  body: z.string().min(1).max(4000),
  shared: z.boolean().default(true),
  /** A recording of them saying it, already uploaded and processed. */
  sourceAssetId: idSchema.optional(),
});
