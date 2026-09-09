import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';
import { sensitivitySchema } from './enums';

/**
 * The family growth loop.
 *
 * A question is a request, not evidence. It never enters retrieval, never
 * becomes a fact, and is visible only to the person who asked it and the
 * storyteller it was asked of. Only an answer the storyteller chooses to give
 * becomes a source — and even then it is a candidate until they approve it.
 */

export const familyQuestionStatusSchema = z.enum([
  'pending',
  'answered',
  'declined',
  'deferred',
  'withdrawn',
]);
export type FamilyQuestionStatus = z.infer<typeof familyQuestionStatusSchema>;

/**
 * Who an answer reaches.
 *
 * Always narrower than the archive's consent, never wider: the recipient grant
 * is the ceiling and is re-checked on every read.
 */
export const answerVisibilitySchema = z.enum([
  /** Only the person who asked. The default, because they asked. */
  'asker_only',
  /** Everyone the storyteller has already authorised to read the archive. */
  'all_authorised',
  /** A named subset the storyteller chose. */
  'restricted',
  /** Kept for the storyteller alone. The asker sees only that it was closed. */
  'private',
]);
export type AnswerVisibility = z.infer<typeof answerVisibilitySchema>;

export const createFamilyQuestionRequestSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  /** Optional, and checked against the archive's restricted topics. */
  topic: z.string().trim().min(1).max(120).optional(),
});

export const respondToFamilyQuestionRequestSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answer'),
    body: z.string().trim().min(1).max(20_000),
    visibility: answerVisibilitySchema.default('asker_only'),
    /** Required when visibility is 'restricted'; ignored otherwise. */
    restrictedToUserIds: z.array(idSchema).max(50).optional(),
    sensitivity: sensitivitySchema.default('normal'),
  }),
  z.object({
    kind: z.literal('decline'),
    /**
     * The storyteller's own note. Never returned to the asker, in any shape.
     * A private decline that leaks its reason is not private.
     */
    reason: z.string().trim().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('defer'),
    reason: z.string().trim().max(2000).optional(),
  }),
]);

/** What the storyteller sees in their inbox. */
export const familyQuestionSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  askedByUserId: idSchema,
  askedByDisplayName: z.string(),
  body: z.string(),
  topic: z.string().nullable(),
  status: familyQuestionStatusSchema,
  createdAt: timestampSchema,
  decidedAt: timestampSchema.nullable(),
  /** Storyteller-only. Absent from every asker-facing response. */
  declineReason: z.string().nullable().optional(),
  response: z
    .object({
      id: idSchema,
      kind: z.enum(['answer', 'decline', 'defer']),
      body: z.string().nullable(),
      visibility: answerVisibilitySchema,
      sensitivity: sensitivitySchema,
      createdAt: timestampSchema,
      /** The answer as a citable source, once it exists. */
      sourceId: idSchema.nullable(),
      /** How many suggestions came out of it, and how many are still waiting. */
      candidateCount: z.number().int().min(0),
      pendingCandidateCount: z.number().int().min(0),
    })
    .nullable(),
});
export type FamilyQuestion = z.infer<typeof familyQuestionSchema>;

/**
 * What the asker sees.
 *
 * Deliberately not the same shape as the storyteller's view. A declined
 * question carries no body and no reason, and a private answer is
 * indistinguishable from a decline — because to the asker it is one.
 */
export const askedQuestionSchema = z.object({
  id: idSchema,
  body: z.string(),
  topic: z.string().nullable(),
  status: familyQuestionStatusSchema,
  createdAt: timestampSchema,
  answeredAt: timestampSchema.nullable(),
  answer: z
    .object({
      body: z.string(),
      /** Where the answer came from, so it can be opened like any citation. */
      sourceId: idSchema,
      sourceLabel: z.string(),
      answeredAt: timestampSchema,
    })
    .nullable(),
});
export type AskedQuestion = z.infer<typeof askedQuestionSchema>;
