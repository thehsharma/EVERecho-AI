import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

/**
 * Coverage, stated as questions rather than as a score.
 *
 * There is no percentage, no streak and no "complete" state in this contract,
 * because an archive is not a form and a person cannot be behind on their own
 * life. Every response is a list of things somebody might like to say more
 * about, and every one of them can be put away for good.
 */

export const gapKindSchema = z.enum([
  'unresolved_person',
  'missing_date',
  'missing_place',
  'conflicting_timeline',
  'unfinished_story',
  'thin_relationship',
]);

export const memoryGapSchema = z.object({
  id: idSchema,
  kind: gapKindSchema,
  /** The exact words that produced it. Never a guess at the answer. */
  reference: z.string(),
  memoryId: idSchema.nullable(),
  /** The invitation, phrased as a question. */
  prompt: z.string(),
  status: z.enum(['open', 'dismissed', 'snoozed', 'resolved']),
  snoozedUntil: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type MemoryGap = z.infer<typeof memoryGapSchema>;

/**
 * Answering one, in the storyteller's own words.
 *
 * The answer is not a memory. It becomes a source, and what it suggests goes
 * to the same review queue as everything else — so the radar can ask a
 * question without acquiring the power to write the answer into the archive.
 */
export const answerGapRequestSchema = z.object({
  body: z.string().min(1).max(20_000),
});

export const dismissGapRequestSchema = z.object({
  /**
   * `snooze` puts it away for a while; `never` puts it away for good. The
   * second exists because a "no" that quietly returns next month is not a no.
   */
  decision: z.enum(['snooze', 'never', 'resolved']),
  snoozeDays: z.number().int().min(1).max(365).optional(),
});
