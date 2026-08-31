import { z } from 'zod';

// ---------------------------------------------------------------------------
// Roles and authority
// ---------------------------------------------------------------------------

/**
 * Authority is *not* a ladder. A buyer who paid has less authority over
 * memories than the storyteller whose life they are, and no ordering between
 * these values is implied anywhere in the codebase.
 */
export const roleSchema = z.enum([
  /** The living person whose memories these are. Final authority. */
  'storyteller',
  /** Purchased or reserved the archive. Cannot consent on the storyteller's behalf. */
  'buyer',
  /** Sees and queries only what was explicitly granted. */
  'family',
  /** May propose material and corrections; may never silently overwrite. */
  'contributor',
  /** Narrowly delegated continuity tasks. Not the executor, not the owner. */
  'steward',
  /** Exceptional, purpose-limited, time-bound, audited internal access. */
  'support_admin',
]);
export type Role = z.infer<typeof roleSchema>;

export const membershipStatusSchema = z.enum(['active', 'revoked', 'expired', 'pending']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const invitationStatusSchema = z.enum([
  'sent',
  'accepted',
  'declined',
  'revoked',
  'expired',
]);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

/**
 * Consent modes are cumulative in capability but each is granted explicitly.
 * `perform` exists in the type system so that every switch must acknowledge and
 * refuse it; it is prohibited in v0.1 and rejected by the policy compiler.
 */
export const consentModeSchema = z.enum([
  /** Encrypted archive only. No processing of any kind. */
  'preserve',
  /** Transcription, OCR, indexing, reviewed structure. */
  'organise',
  /** Search, timeline and retrieval. */
  'explore',
  /** Source-grounded biography and third-person answers. */
  'compose',
  /** PROHIBITED in v0.1: synthetic voice, avatar, persona. */
  'perform',
]);
export type ConsentMode = z.infer<typeof consentModeSchema>;

export const ALLOWED_CONSENT_MODES = ['preserve', 'organise', 'explore', 'compose'] as const;
export const PROHIBITED_CONSENT_MODES = ['perform'] as const;

/** Processing activities consent must cover independently, not as one bundle. */
export const processingActivitySchema = z.enum([
  'storage',
  'transcription',
  'ocr',
  'embedding',
  'generation',
  'provider_processing',
  'provider_retention',
  'export',
  'contribution',
]);
export type ProcessingActivity = z.infer<typeof processingActivitySchema>;

export const dataCategorySchema = z.enum([
  'audio',
  'video',
  'photo',
  'document',
  'text',
  'health',
  'financial',
  'religious',
  'political',
  'sexual_orientation',
  'biometric',
]);
export type DataCategory = z.infer<typeof dataCategorySchema>;

export const sensitivitySchema = z.enum(['normal', 'sensitive', 'restricted', 'embargoed']);
export type Sensitivity = z.infer<typeof sensitivitySchema>;

export const lifeStateSchema = z.enum(['living', 'posthumous']);
export type LifeState = z.infer<typeof lifeStateSchema>;

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Evidence classes, strongest first. The number is meaningful: customer answers
 * may use P1–P3 only, P4 is off by default, P5 is prohibited and unimplementable.
 */
export const evidenceClassSchema = z.enum([
  /** The original file or recording itself. */
  'P0_ORIGINAL_SOURCE',
  /** The storyteller said this, in their own words, in a source. */
  'P1_DIRECT_STATEMENT',
  /** Two or more independent sources agree. */
  'P2_CORROBORATED_FACT',
  /** Restatement that stays inside what the sources support. */
  'P3_SUPPORTED_SYNTHESIS',
  /** The model guessed. Off by default; never in customer answers. */
  'P4_MODEL_INFERENCE',
  /** Simulated speech or persona. Prohibited. Never produced. */
  'P5_GENERATED_SIMULATION',
]);
export type EvidenceClass = z.infer<typeof evidenceClassSchema>;

export const CUSTOMER_ANSWER_EVIDENCE_CLASSES = [
  'P1_DIRECT_STATEMENT',
  'P2_CORROBORATED_FACT',
  'P3_SUPPORTED_SYNTHESIS',
] as const;

export const STORABLE_EVIDENCE_CLASSES = [
  'P0_ORIGINAL_SOURCE',
  'P1_DIRECT_STATEMENT',
  'P2_CORROBORATED_FACT',
  'P3_SUPPORTED_SYNTHESIS',
] as const;

export const PROHIBITED_EVIDENCE_CLASSES = ['P5_GENERATED_SIMULATION'] as const;

// ---------------------------------------------------------------------------
// Content lifecycle
// ---------------------------------------------------------------------------

export const archiveStatusSchema = z.enum([
  'draft',
  'awaiting_storyteller',
  'declined',
  'active',
  'frozen',
  'export_only',
  'deleting',
  'deleted',
]);
export type ArchiveStatus = z.infer<typeof archiveStatusSchema>;

export const sourceStatusSchema = z.enum([
  'uploading',
  'quarantined',
  'scanning',
  'rejected',
  'stored',
  'processing',
  'processed',
  'processing_failed',
  'deleted',
]);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const sourceKindSchema = z.enum(['audio', 'video', 'photo', 'document', 'text']);
export type SourceKind = z.infer<typeof sourceKindSchema>;

/**
 * Nothing reaches search or an answer while it is a candidate. Approval is an
 * act by the storyteller, never a side effect of processing.
 */
export const reviewStatusSchema = z.enum(['candidate', 'approved', 'rejected', 'superseded']);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export const jobStatusSchema = z.enum([
  'queued',
  'running',
  'succeeded',
  'failed',
  'dead_lettered',
  'cancelled',
]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const jobTypeSchema = z.enum([
  'scan_source',
  'transcribe_source',
  'ocr_source',
  'segment_transcript',
  'extract_candidates',
  'embed_memory',
  'build_timeline',
  'compose_biography',
  'run_export',
  'run_deletion',
  'send_notification',
]);
export type JobType = z.infer<typeof jobTypeSchema>;

export const answerModeSchema = z.enum(['grounded', 'abstained']);
export type AnswerMode = z.infer<typeof answerModeSchema>;

export const abstentionReasonSchema = z.enum([
  'no_evidence',
  'insufficient_evidence',
  'contradictory_evidence',
  'restricted_topic',
  'consent_not_granted',
  'access_not_granted',
  'unsafe_request',
  'prohibited_request',
]);
export type AbstentionReason = z.infer<typeof abstentionReasonSchema>;
