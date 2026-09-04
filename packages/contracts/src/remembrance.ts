import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

/**
 * What may be heard after the storyteller has died.
 *
 * The shape follows one rule: withholding is a statement, not the absence of
 * one. `effect` is a required field with two equal values, and the default —
 * what silence means — is required on the directive itself, because there is
 * no defensible answer the schema could pick on somebody's behalf.
 */

export const clauseEffectSchema = z.enum(['permit', 'withhold']);
export const clauseScopeSchema = z.enum(['archive', 'topic', 'memory', 'source']);

export const remembranceClauseSchema = z.object({
  id: idSchema,
  effect: clauseEffectSchema,
  scope: clauseScopeSchema,
  topic: z.string().nullable(),
  memoryId: idSchema.nullable(),
  sourceAssetId: idSchema.nullable(),
  /** Null means everyone the archive already permits. It never widens beyond that. */
  audienceUserId: idSchema.nullable(),
  audienceDisplayName: z.string().nullable(),
  notBefore: timestampSchema.nullable(),
  /** Being quoted and being heard are two decisions. */
  allowAudio: z.boolean(),
  createdAt: timestampSchema,
});
export type RemembranceClause = z.infer<typeof remembranceClauseSchema>;

export const remembranceDirectiveSchema = z.object({
  id: idSchema,
  version: z.number().int().min(1),
  status: z.enum(['draft', 'affirmed', 'superseded', 'activated']),
  defaultEffect: clauseEffectSchema,
  note: z.string().nullable(),
  noteSourceAssetId: idSchema.nullable(),
  affirmedAt: timestampSchema.nullable(),
  activatedAt: timestampSchema.nullable(),
  clauses: z.array(remembranceClauseSchema),
  createdAt: timestampSchema,
  /** Whether this viewer may change it. The server refuses regardless. */
  editable: z.boolean(),
});
export type RemembranceDirective = z.infer<typeof remembranceDirectiveSchema>;

export const upsertDirectiveRequestSchema = z.object({
  defaultEffect: clauseEffectSchema,
  note: z.string().max(4000).optional(),
  noteSourceAssetId: idSchema.optional(),
});

export const addClauseRequestSchema = z
  .object({
    effect: clauseEffectSchema,
    scope: clauseScopeSchema,
    topic: z.string().min(1).max(120).optional(),
    memoryId: idSchema.optional(),
    sourceAssetId: idSchema.optional(),
    audienceUserId: idSchema.optional(),
    notBefore: timestampSchema.optional(),
    allowAudio: z.boolean().default(true),
  })
  .refine((v) => v.effect === 'permit' || v.notBefore === undefined, {
    // Mirrors the CHECK constraint. A refusal that opens later is a permission
    // wearing a refusal's clothes, and somebody would read it the wrong way.
    message: 'A withholding clause cannot be scheduled to expire',
    path: ['notBefore'],
  });

/**
 * Establishing that somebody has died.
 *
 * Not a product action. The evidence reference points at a document held
 * outside this system — a death certificate in an application database is a
 * liability, not a record.
 */
export const activateDirectiveRequestSchema = z.object({
  executedByName: z.string().min(1).max(200),
  evidenceKind: z.enum(['death_certificate', 'court_order', 'other']),
  evidenceReference: z.string().min(1).max(200),
  note: z.string().max(2000).optional(),
});
