import { createHash } from 'node:crypto';
import {
  LOW_RISK_PREFERENCE_KEYS,
  NEVER_AUTO_SAVED_CATEGORIES,
  learningPolicyDocumentSchema,
  type DataCategory,
  type InteractionPreferenceKey,
  type LearningPolicyDocument,
} from '@everecho/contracts';
import { canonicalise } from './policy';
import type { LearningObligations } from './types';

export class LearningPolicyError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(issues.join(' '));
    this.name = 'LearningPolicyError';
  }
}

/**
 * Shapes the product will not compile, checked *before* schema validation so
 * the refusal is named rather than arriving as a generic parse error.
 *
 * Same pattern as the consent compiler: these fields are typed loosely on
 * purpose, so that the compiler — not the schema — owns the explanation.
 */
export function prohibitedLearningShapeIssues(input: unknown): string[] {
  const issues: string[] = [];
  if (typeof input !== 'object' || input === null) return ['A learning policy must be an object.'];
  const doc = input as Record<string, unknown>;

  if (doc.modelTraining === true) {
    issues.push(
      'EverEcho never permits a provider to train a model on private memories. ' +
        'modelTraining cannot be enabled.',
    );
  }
  if (doc.crossArchiveLearning === true) {
    issues.push(
      'Learning never crosses between archives. One family’s conversation cannot ' +
        'inform another’s. crossArchiveLearning cannot be enabled.',
    );
  }
  if (doc.sensitiveMemory !== undefined && doc.sensitiveMemory !== 'always_review') {
    issues.push(
      'Sensitive material always requires the storyteller’s review. ' +
        'sensitiveMemory must be "always_review".',
    );
  }
  if (doc.familySearchEligibility !== undefined && doc.familySearchEligibility !== 'approved_only') {
    issues.push(
      'Only approved memories are ever searchable by family. ' +
        'familySearchEligibility must be "approved_only".',
    );
  }

  const provider = doc.providerProcessing;
  if (typeof provider === 'object' && provider !== null) {
    const p = provider as Record<string, unknown>;
    if (typeof p.retentionDays === 'number' && p.retentionDays > 0) {
      issues.push(
        'Provider-side retention of conversation material is not permitted in v0.2. ' +
          'providerProcessing.retentionDays must be 0.',
      );
    }
    if (
      p.mode === 'local_only' &&
      (p.speechToText === true || p.speechSynthesis === true || p.composition === true)
    ) {
      issues.push(
        'providerProcessing.mode is "local_only", so no provider may be used for ' +
          'speech-to-text, speech synthesis or composition.',
      );
    }
    if (p.mode === 'named_providers' && Array.isArray(p.namedProviders)) {
      const usesProvider =
        p.speechToText === true || p.speechSynthesis === true || p.composition === true;
      if (usesProvider && p.namedProviders.length === 0) {
        issues.push(
          'providerProcessing.mode is "named_providers" but no provider is named. ' +
            'Name the providers that may process this conversation.',
        );
      }
    }
  }

  // A category that can never be auto-saved must not appear as an
  // auto-extractable candidate category when auto-save is on.
  const categories = doc.candidateCategories;
  if (doc.lowRiskPreferenceMemory === 'auto_save' && Array.isArray(categories)) {
    const offending = categories.filter((c) =>
      (NEVER_AUTO_SAVED_CATEGORIES as readonly string[]).includes(String(c)),
    );
    if (offending.length > 0) {
      issues.push(
        `These categories can never be saved without review: ${offending.join(', ')}. ` +
          'Auto-save applies only to interface preferences.',
      );
    }
  }

  return issues;
}

export interface CompiledLearningPolicy {
  document: LearningPolicyDocument;
  canonical: string;
  policyHash: string;
}

/**
 * Compiles a learning policy document into the object the authorisation engine
 * reads, refusing prohibited shapes by name.
 */
export function compileLearningPolicy(input: unknown): CompiledLearningPolicy {
  const prohibited = prohibitedLearningShapeIssues(input);
  if (prohibited.length > 0) throw new LearningPolicyError(prohibited);

  const parsed = learningPolicyDocumentSchema.safeParse(input);
  if (!parsed.success) {
    throw new LearningPolicyError(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'document'}: ${i.message}`),
    );
  }

  const document = parsed.data;
  const canonical = canonicalise(document);
  return {
    document,
    canonical,
    policyHash: createHash('sha256').update(canonical).digest('hex'),
  };
}

/**
 * The default: conversation works, nothing is retained beyond the session, and
 * nothing becomes family history without being reviewed.
 *
 * Defaults matter more here than almost anywhere else in the product, because
 * most people will never open this screen.
 */
export function defaultLearningDocument(): LearningPolicyDocument {
  return {
    sessionContext: true,
    transcriptRetention: 'session',
    audioRetention: 'never',
    candidateExtraction: true,
    candidateCategories: ['text', 'audio', 'photo', 'document'],
    lowRiskPreferenceMemory: 'ask_every_time',
    sensitiveMemory: 'always_review',
    familySearchEligibility: 'approved_only',
    providerProcessing: {
      mode: 'local_only',
      speechToText: false,
      speechSynthesis: false,
      composition: false,
      namedProviders: [],
      retentionDays: 0,
    },
    modelTraining: false,
    crossArchiveLearning: false,
    correctionLearning: true,
    expiresAt: null,
  };
}

/** Nothing is permitted. Used when no learning policy exists at all. */
export function deniedLearningObligations(): LearningObligations {
  return {
    mayStoreTranscript: false,
    mayStoreAudio: false,
    mayExtractCandidates: false,
    mayUseProviderSpeechToText: false,
    mayUseProviderSpeechSynthesis: false,
    mayUseProviderComposition: false,
    mayAutoSavePreferences: false,
    mayLearnFromCorrections: false,
    allowedCandidateCategories: [],
  };
}

/**
 * Resolves a learning policy into obligations, given the consent document's
 * own limits. Consent is the ceiling: a learning policy that permits provider
 * transcription cannot enable it if consent forbids provider processing.
 */
export function resolveLearningObligations(input: {
  document: LearningPolicyDocument | null;
  expired: boolean;
  consentAllowsProviderTranscription: boolean;
  consentAllowsProviderGeneration: boolean;
  consentAllowsEmbedding: boolean;
  consentDataCategories: readonly DataCategory[];
}): LearningObligations {
  const doc = input.document;
  if (!doc || input.expired) return deniedLearningObligations();

  const providerAllowed = doc.providerProcessing.mode === 'named_providers';

  return {
    mayStoreTranscript: doc.transcriptRetention !== 'ephemeral',
    mayStoreAudio: doc.audioRetention !== 'never',
    mayExtractCandidates: doc.candidateExtraction,
    mayUseProviderSpeechToText:
      providerAllowed && doc.providerProcessing.speechToText && input.consentAllowsProviderTranscription,
    mayUseProviderSpeechSynthesis:
      providerAllowed && doc.providerProcessing.speechSynthesis && input.consentAllowsProviderGeneration,
    mayUseProviderComposition:
      providerAllowed && doc.providerProcessing.composition && input.consentAllowsProviderGeneration,
    mayAutoSavePreferences: doc.lowRiskPreferenceMemory === 'auto_save',
    mayLearnFromCorrections: doc.correctionLearning,
    // Intersection, not union: a learning policy cannot widen the categories
    // the storyteller permitted the archive to hold in the first place.
    allowedCandidateCategories: doc.candidateCategories.filter((c) =>
      input.consentDataCategories.includes(c),
    ),
  };
}

/**
 * Whether a preference may be written without review.
 *
 * Checked in application code *and* by a CHECK constraint in the database, so
 * a bug here cannot persist a key the policy does not name.
 */
export function isLowRiskPreference(key: string): key is InteractionPreferenceKey {
  return (LOW_RISK_PREFERENCE_KEYS as readonly string[]).includes(key);
}

/**
 * Whether a candidate may skip storyteller review.
 *
 * The answer is almost always no. Only a low-risk interaction preference under
 * an explicit auto-save policy qualifies; anything biographical, sensitive or
 * about another person requires the storyteller, always.
 */
export function candidateRequiresReview(input: {
  kind: string;
  sensitivity: string;
  dataCategories: readonly string[];
  obligations: LearningObligations;
}): boolean {
  if (input.kind !== 'preference') return true;
  if (!input.obligations.mayAutoSavePreferences) return true;
  if (input.sensitivity !== 'normal') return true;
  return input.dataCategories.some((c) =>
    (NEVER_AUTO_SAVED_CATEGORIES as readonly string[]).includes(c),
  );
}

export function diffLearningPolicies(
  previous: LearningPolicyDocument | null,
  next: LearningPolicyDocument,
): string[] {
  if (!previous) return ['Learning policy created.'];
  const changes: string[] = [];
  const say = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changes.push(`${label}: ${String(a)} → ${String(b)}`);
  };
  say('Session context', previous.sessionContext, next.sessionContext);
  say('Transcript retention', previous.transcriptRetention, next.transcriptRetention);
  say('Audio retention', previous.audioRetention, next.audioRetention);
  say('Candidate extraction', previous.candidateExtraction, next.candidateExtraction);
  say('Preference auto-save', previous.lowRiskPreferenceMemory, next.lowRiskPreferenceMemory);
  say('Correction learning', previous.correctionLearning, next.correctionLearning);
  say('Provider mode', previous.providerProcessing.mode, next.providerProcessing.mode);
  if (
    JSON.stringify(previous.candidateCategories) !== JSON.stringify(next.candidateCategories)
  ) {
    changes.push('Candidate categories changed.');
  }
  return changes.length > 0 ? changes : ['No change.'];
}

/**
 * True when the change narrows what a live session may do, which the session
 * must act on immediately rather than at the next turn.
 */
export function isNarrowing(
  previous: LearningObligations,
  next: LearningObligations,
): boolean {
  const keys = [
    'mayStoreTranscript',
    'mayStoreAudio',
    'mayExtractCandidates',
    'mayUseProviderSpeechToText',
    'mayUseProviderSpeechSynthesis',
    'mayUseProviderComposition',
    'mayAutoSavePreferences',
    'mayLearnFromCorrections',
  ] as const;
  return keys.some((k) => previous[k] && !next[k]);
}
