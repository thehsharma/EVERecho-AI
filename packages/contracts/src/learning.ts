import { z } from 'zod';
import { dataCategorySchema, evidenceClassSchema, sensitivitySchema } from './enums';
import { approximateDateSchema, idSchema, locatorSchema, timestampSchema } from './primitives';

// ---------------------------------------------------------------------------
// The learning policy
// ---------------------------------------------------------------------------

/**
 * How long a conversation transcript may be kept.
 *
 * `ephemeral` means the text exists only for the duration of the turn that
 * produced it: it drives captions and is never written to a durable row.
 */
export const transcriptRetentionSchema = z.enum([
  'ephemeral',
  'session',
  '30_days',
  'until_deleted',
]);
export type TranscriptRetention = z.infer<typeof transcriptRetentionSchema>;

/**
 * Audio is not stored by default. `explicit_archive_source` means the recording
 * becomes a first-class source asset, subject to every rule that governs an
 * uploaded recording.
 */
export const audioRetentionSchema = z.enum(['never', 'session', 'explicit_archive_source']);
export type AudioRetention = z.infer<typeof audioRetentionSchema>;

export const preferenceMemoryModeSchema = z.enum(['ask_every_time', 'auto_save', 'never']);
export type PreferenceMemoryMode = z.infer<typeof preferenceMemoryModeSchema>;

/**
 * The complete, closed set of things that may ever be saved without review.
 *
 * An allow-list rather than a deny-list, because a deny-list fails open the
 * moment somebody adds a preference type and forgets to exclude it. The same
 * set is enforced again by a CHECK constraint in the database, so application
 * code cannot write a key this list does not name.
 */
export const interactionPreferenceKeySchema = z.enum([
  'interface_language',
  'captions_enabled',
  'speaking_rate',
  'interview_pace',
  'preferred_session_minutes',
  'clarifying_question_frequency',
]);
export type InteractionPreferenceKey = z.infer<typeof interactionPreferenceKeySchema>;

export const LOW_RISK_PREFERENCE_KEYS = [
  'interface_language',
  'captions_enabled',
  'speaking_rate',
  'interview_pace',
  'preferred_session_minutes',
  'clarifying_question_frequency',
] as const satisfies readonly InteractionPreferenceKey[];

/**
 * Categories that may never be auto-saved, auto-approved or inferred, whatever
 * any policy says. Present as data so the refusal is testable and so the
 * compiler can name which one was requested.
 */
export const NEVER_AUTO_SAVED_CATEGORIES = [
  'health',
  'financial',
  'religious',
  'political',
  'sexual_orientation',
  'biometric',
] as const;

/**
 * The learning policy: what a *conversation* may become.
 *
 * Deliberately separate from the consent policy, which governs material the
 * storyteller has already given. The consent mode remains a hard ceiling over
 * everything here — a learning policy can only narrow, never widen.
 */
export const learningPolicyDocumentSchema = z.object({
  /** Short-lived within-session context so follow-ups and pronouns work. */
  sessionContext: z.boolean(),

  transcriptRetention: transcriptRetentionSchema,
  audioRetention: audioRetentionSchema,

  /** Whether a conversation may produce candidate memories at all. */
  candidateExtraction: z.boolean(),

  /** Categories a candidate may carry. Anything outside this is dropped. */
  candidateCategories: z.array(dataCategorySchema),

  lowRiskPreferenceMemory: preferenceMemoryModeSchema,

  /**
   * Typed as a string rather than a literal so that a document requesting
   * anything else is refused *by name* by the compiler, instead of producing a
   * schema error that explains nothing. Only 'always_review' compiles.
   */
  sensitiveMemory: z.string(),

  /** Only storyteller-approved material is ever eligible for family search. */
  familySearchEligibility: z.string(),

  providerProcessing: z.object({
    mode: z.enum(['local_only', 'named_providers']),
    speechToText: z.boolean(),
    speechSynthesis: z.boolean(),
    composition: z.boolean(),
    /** Allow-list. Empty when mode is `local_only`. */
    namedProviders: z.array(z.string().min(1).max(64)),
    /** Provider-side retention in days. Only 0 compiles in v0.2. */
    retentionDays: z.number().int().min(0).max(3650),
  }),

  /** Never negotiable. A document setting this true is refused by name. */
  modelTraining: z.boolean(),
  /** Never negotiable. A document setting this true is refused by name. */
  crossArchiveLearning: z.boolean(),

  /** Whether a storyteller correction may create a new authorised version. */
  correctionLearning: z.boolean(),

  /** Optional expiry, after which the policy stops permitting anything. */
  expiresAt: timestampSchema.nullable(),
});
export type LearningPolicyDocument = z.infer<typeof learningPolicyDocumentSchema>;

export const learningPolicySchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  version: z.number().int().min(1),
  document: learningPolicyDocumentSchema,
  policyHash: z.string().regex(/^[0-9a-f]{64}$/),
  policyEngineVersion: z.string(),
  createdByUserId: idSchema,
  effectiveFrom: timestampSchema,
  supersededAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
});
export type LearningPolicy = z.infer<typeof learningPolicySchema>;

export const updateLearningPolicyRequestSchema = z.object({
  document: learningPolicyDocumentSchema,
  reason: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Candidate knowledge
// ---------------------------------------------------------------------------

export const candidateStatusSchema = z.enum([
  'pending',
  'approved',
  'rejected',
  'superseded',
  'expired',
  'withdrawn',
]);
export type CandidateStatus = z.infer<typeof candidateStatusSchema>;

export const candidateKindSchema = z.enum([
  'memory',
  'person',
  'place',
  'date',
  'relationship',
  'preference',
  'unresolved_reference',
]);
export type CandidateKind = z.infer<typeof candidateKindSchema>;

/**
 * A candidate always points at the exact conversational turn it came from.
 * There is no path by which a candidate exists without its source.
 */
export const candidateEvidenceSchema = z.object({
  id: idSchema,
  turnId: idSchema.nullable(),
  sourceAssetId: idSchema.nullable(),
  transcriptSegmentId: idSchema.nullable(),
  locator: locatorSchema,
  quotedText: z.string(),
  /** True when the storyteller said it; false when they reported someone else saying it. */
  firstHand: z.boolean(),
  speakerLabel: z.string().max(80).nullable(),
});
export type CandidateEvidence = z.infer<typeof candidateEvidenceSchema>;

export const memoryCandidateSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  sessionId: idSchema.nullable(),
  kind: candidateKindSchema,
  status: candidateStatusSchema,
  title: z.string().max(200),
  body: z.string(),
  occurredOn: approximateDateSchema.nullable(),
  topics: z.array(z.string()),
  entityNames: z.array(z.string()),
  placeName: z.string().nullable(),
  dataCategories: z.array(dataCategorySchema),
  sensitivity: sensitivitySchema,
  evidenceClass: evidenceClassSchema,
  confidence: z.number().min(0).max(1),
  /** Set when this candidate restates something already approved or pending. */
  duplicateOfMemoryId: idSchema.nullable(),
  duplicateOfCandidateId: idSchema.nullable(),
  /** Open contradictions this candidate participates in. */
  contradictsMemoryIds: z.array(idSchema),
  /** Which extractor produced it, so a bad extractor's output can be found. */
  extractorName: z.string(),
  extractorVersion: z.string(),
  promptVersion: z.string(),
  /** True when the candidate needs the storyteller and cannot be auto-saved. */
  requiresStorytellerReview: z.boolean(),
  evidence: z.array(candidateEvidenceSchema),
  reviewedByUserId: idSchema.nullable(),
  reviewedAt: timestampSchema.nullable(),
  reviewNote: z.string().nullable(),
  approvedMemoryId: idSchema.nullable(),
  createdAt: timestampSchema,
});
export type MemoryCandidate = z.infer<typeof memoryCandidateSchema>;

export const patchCandidateRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(20000).optional(),
  occurredOn: approximateDateSchema.nullable().optional(),
  topics: z.array(z.string().min(1).max(60)).max(24).optional(),
  entityNames: z.array(z.string().min(1).max(120)).max(40).optional(),
  placeName: z.string().min(1).max(160).nullable().optional(),
  sensitivity: sensitivitySchema.optional(),
});

export const approveCandidateRequestSchema = z.object({
  /** Keeps the memory in the archive but out of family search results. */
  keepPrivate: z.boolean().default(false),
  note: z.string().max(500).optional(),
});

export const rejectCandidateRequestSchema = z.object({
  note: z.string().max(500).optional(),
});

// ---------------------------------------------------------------------------
// Interaction preferences
// ---------------------------------------------------------------------------

export const interactionPreferenceSchema = z.object({
  id: idSchema,
  key: interactionPreferenceKeySchema,
  value: z.string().max(120),
  /** How it got here: the user set it, or auto-save captured it. */
  origin: z.enum(['explicit', 'auto_saved']),
  learningPolicyVersion: z.number().int().min(1).nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type InteractionPreference = z.infer<typeof interactionPreferenceSchema>;

export const putInteractionPreferenceRequestSchema = z.object({
  key: interactionPreferenceKeySchema,
  value: z.string().min(1).max(120),
});

// ---------------------------------------------------------------------------
// What the storyteller is shown after a session
// ---------------------------------------------------------------------------

export const learningSummarySchema = z.object({
  sessionId: idSchema,
  candidateCount: z.number().int().min(0),
  requiresReviewCount: z.number().int().min(0),
  duplicateCount: z.number().int().min(0),
  contradictionCount: z.number().int().min(0),
  autoSavedPreferenceKeys: z.array(interactionPreferenceKeySchema),
  /** Names and dates the conversation left unresolved — good next questions. */
  unresolvedReferences: z.array(z.string()),
  /** Plain sentence shown to the storyteller. Contains no memory content. */
  headline: z.string(),
});
export type LearningSummary = z.infer<typeof learningSummarySchema>;
