import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';
import { sensitivitySchema } from './enums';

/**
 * What a relative may add to somebody else's archive: proposals, and only
 * proposals.
 *
 * The kinds are separated because approving them means different things. A
 * correction changes a detail and keeps the original. An alternate account
 * changes nothing at all — it stands beside what the storyteller said, linked
 * by a contradiction, because a family that remembers something differently is
 * not a family where somebody is wrong.
 */
export const proposalKindSchema = z.enum([
  'media',
  'date',
  'place',
  'person',
  'relationship',
  'correction',
  'note',
  'alternate_account',
]);
export type ProposalKind = z.infer<typeof proposalKindSchema>;

export const proposalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'withdrawn']);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const proposalTargetTypeSchema = z.enum([
  'memory',
  'entity',
  'place',
  'event',
  'source_asset',
]);

/** Why the contributor believes it. */
export const proposalEvidenceInputSchema = z.object({
  sourceId: idSchema.optional(),
  quotedText: z.string().trim().max(2000).optional(),
  /** False when they are reporting what somebody else told them. */
  firstHand: z.boolean().default(false),
  note: z.string().trim().max(2000).optional(),
});

export const createProposalRequestSchema = z
  .object({
    kind: proposalKindSchema,
    targetType: proposalTargetTypeSchema.optional(),
    targetId: idSchema.optional(),
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(10_000),
    /** Structured detail: a date, a place name, a relationship. */
    payload: z.record(z.string(), z.unknown()).default({}),
    sourceId: idSchema.optional(),
    sensitivity: sensitivitySchema.default('normal'),
    evidence: z.array(proposalEvidenceInputSchema).max(10).default([]),
  })
  .refine(
    (value) =>
      !['correction', 'alternate_account'].includes(value.kind) ||
      (value.targetType !== undefined && value.targetId !== undefined),
    { message: 'A correction or an alternate account has to say what it is about.' },
  );

export const reviewProposalRequestSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});

export const proposalSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  proposedByUserId: idSchema,
  proposedByDisplayName: z.string(),
  kind: proposalKindSchema,
  targetType: proposalTargetTypeSchema.nullable(),
  targetId: idSchema.nullable(),
  /** What the target says today, so the storyteller can see both at once. */
  targetSummary: z.string().nullable(),
  title: z.string(),
  body: z.string(),
  payload: z.record(z.string(), z.unknown()),
  sourceId: idSchema.nullable(),
  status: proposalStatusSchema,
  sensitivity: sensitivitySchema,
  /** Approved memories this disagrees with. Surfaced, never resolved. */
  contradictsMemoryIds: z.array(idSchema),
  resultingMemoryId: idSchema.nullable(),
  resultingCorrectionId: idSchema.nullable(),
  reviewedAt: timestampSchema.nullable(),
  reviewNote: z.string().nullable(),
  createdAt: timestampSchema,
  evidence: z.array(
    z.object({
      id: idSchema,
      sourceId: idSchema.nullable(),
      quotedText: z.string().nullable(),
      firstHand: z.boolean(),
      note: z.string().nullable(),
    }),
  ),
});
export type ContributorProposal = z.infer<typeof proposalSchema>;
