import { z } from 'zod';
import {
  consentModeSchema,
  dataCategorySchema,
  lifeStateSchema,
  processingActivitySchema,
  roleSchema,
  sensitivitySchema,
} from './enums';
import { idSchema, timestampSchema } from './primitives';

/**
 * A consent policy document. This is the whole of what the storyteller agreed
 * to: it is canonically serialised, hashed and versioned, and it is what
 * `authorize()` reads. Nothing else grants permission.
 */
export const consentPolicyDocumentSchema = z.object({
  /** Highest mode the storyteller has granted. */
  mode: consentModeSchema,

  /** Which categories of material may be held at all. */
  dataCategories: z.array(dataCategorySchema),

  /** Each processing activity is granted independently, not bundled with mode. */
  activities: z.array(processingActivitySchema),

  /** Who may see anything, and in what capacity. */
  recipients: z.array(
    z.object({
      role: roleSchema,
      /** Absent = every member holding this role. */
      userId: idSchema.optional(),
      /** Highest sensitivity this recipient may reach. */
      maxSensitivity: sensitivitySchema,
      accessStartsAt: timestampSchema.optional(),
      accessEndsAt: timestampSchema.optional(),
      /** Access valid while the storyteller is living, after death, or both. */
      lifeStates: z.array(lifeStateSchema).min(1),
      mayExport: z.boolean(),
      mayContribute: z.boolean(),
    }),
  ),

  /** Topics that must never be retrieved, composed or answered. */
  restrictedTopics: z.array(z.string().min(1).max(120)),

  /** Sources the storyteller excluded individually, overriding every other grant. */
  excludedSourceIds: z.array(idSchema),

  /** Providers may process only what is listed here. */
  providerProcessing: z.object({
    transcription: z.boolean(),
    ocr: z.boolean(),
    embedding: z.boolean(),
    generation: z.boolean(),
    /** Provider-side retention in days. 0 = no retention permitted. */
    retentionDays: z.number().int().min(0).max(3650),
    /**
     * Never negotiable. Typed as a boolean rather than `true` so that a request
     * setting it to false is refused by the consent compiler *by name*, instead
     * of by a generic schema error that explains nothing.
     */
    noModelTraining: z.boolean(),
  }),

  /**
   * Voice and likeness rights default to denied and cannot be granted in v0.1.
   * Present in the document so the refusal is part of the audited record.
   */
  voiceAndLikeness: z.object({
    syntheticVoice: z.boolean(),
    syntheticLikeness: z.boolean(),
    personaSimulation: z.boolean(),
  }),

  /** Whether consent may be changed later without a fresh teach-back. */
  allowFutureChangesWithoutTeachBack: z.boolean(),

  /** Storyteller-authored plain-language note shown to recipients. */
  note: z.string().max(2000).optional(),
});
export type ConsentPolicyDocument = z.infer<typeof consentPolicyDocumentSchema>;

export const consentPolicySchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  version: z.number().int().min(1),
  document: consentPolicyDocumentSchema,
  policyHash: z.string().regex(/^[0-9a-f]{64}$/),
  consentCopyVersion: z.string(),
  legalCopyVersion: z.string(),
  policyEngineVersion: z.string(),
  createdByUserId: idSchema,
  effectiveFrom: timestampSchema,
  supersededAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type ConsentPolicy = z.infer<typeof consentPolicySchema>;

/**
 * Teach-back: the storyteller explains the arrangement back to us. Clicking
 * "I agree" is not evidence of understanding; answering these is closer to it.
 */
export const teachBackQuestionSchema = z.object({
  id: z.string().min(1),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string() })).min(2),
  correctOptionId: z.string(),
  /** Shown after an incorrect answer — teaching, not scoring. */
  explanation: z.string(),
});
export type TeachBackQuestion = z.infer<typeof teachBackQuestionSchema>;

export const teachBackSubmissionSchema = z.object({
  answers: z.array(z.object({ questionId: z.string(), optionId: z.string() })).min(1),
});

export const teachBackResultSchema = z.object({
  id: idSchema,
  passed: z.boolean(),
  attempt: z.number().int().min(1),
  incorrectQuestionIds: z.array(z.string()),
  consentCopyVersion: z.string(),
  createdAt: timestampSchema,
});
export type TeachBackResult = z.infer<typeof teachBackResultSchema>;

export const updateConsentRequestSchema = z.object({
  document: consentPolicyDocumentSchema,
  /** Free-text reason recorded in the audit trail. */
  reason: z.string().max(500).optional(),
});

export const consentDecisionSchema = z.object({
  effect: z.enum(['ALLOW', 'DENY']),
  reasonCode: z.string(),
  policyVersion: z.string(),
  /** Human-readable, safe to show a user. */
  explanation: z.string(),
});
export type ConsentDecision = z.infer<typeof consentDecisionSchema>;
