import { describe, expect, it } from 'vitest';
import { NEVER_AUTO_SAVED_CATEGORIES } from '@everecho/contracts';
import {
  LearningPolicyError,
  candidateRequiresReview,
  compileLearningPolicy,
  defaultLearningDocument,
  deniedLearningObligations,
  diffLearningPolicies,
  isLowRiskPreference,
  isNarrowing,
  prohibitedLearningShapeIssues,
  resolveLearningObligations,
} from '../src/learning';

const doc = (overrides: Record<string, unknown> = {}) => ({
  ...defaultLearningDocument(),
  ...overrides,
});

describe('learning policy compiler', () => {
  it('compiles the default document and hashes it stably', () => {
    const a = compileLearningPolicy(defaultLearningDocument());
    const b = compileLearningPolicy(defaultLearningDocument());
    expect(a.policyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.policyHash).toBe(b.policyHash);
  });

  it('hashes independently of key order, so a reordered document is the same document', () => {
    const base = defaultLearningDocument();
    const reordered = Object.fromEntries(
      Object.entries(base).sort(([x], [y]) => y.localeCompare(x)),
    );
    expect(compileLearningPolicy(reordered).policyHash).toBe(
      compileLearningPolicy(base).policyHash,
    );
  });

  it('refuses model training by name, not by schema error', () => {
    expect(() => compileLearningPolicy(doc({ modelTraining: true }))).toThrow(LearningPolicyError);
    try {
      compileLearningPolicy(doc({ modelTraining: true }));
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('train a model');
    }
  });

  it('refuses cross-archive learning by name', () => {
    try {
      compileLearningPolicy(doc({ crossArchiveLearning: true }));
      throw new Error('should have refused');
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('never crosses between archives');
    }
  });

  it('refuses to let sensitive material skip review', () => {
    try {
      compileLearningPolicy(doc({ sensitiveMemory: 'auto_save' }));
      throw new Error('should have refused');
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('always requires the storyteller');
    }
  });

  it('refuses to make unapproved material searchable by family', () => {
    try {
      compileLearningPolicy(doc({ familySearchEligibility: 'all' }));
      throw new Error('should have refused');
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('Only approved memories');
    }
  });

  it('refuses provider-side retention', () => {
    const bad = doc({
      providerProcessing: {
        mode: 'named_providers',
        speechToText: true,
        speechSynthesis: false,
        composition: false,
        namedProviders: ['someone'],
        retentionDays: 30,
      },
    });
    try {
      compileLearningPolicy(bad);
      throw new Error('should have refused');
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('retentionDays must be 0');
    }
  });

  it('refuses a document that says local-only and then names provider work', () => {
    const contradictory = doc({
      providerProcessing: {
        mode: 'local_only',
        speechToText: true,
        speechSynthesis: false,
        composition: false,
        namedProviders: [],
        retentionDays: 0,
      },
    });
    try {
      compileLearningPolicy(contradictory);
      throw new Error('should have refused');
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('local_only');
    }
  });

  it('refuses provider mode with no provider named', () => {
    const unnamed = doc({
      providerProcessing: {
        mode: 'named_providers',
        speechToText: true,
        speechSynthesis: false,
        composition: false,
        namedProviders: [],
        retentionDays: 0,
      },
    });
    try {
      compileLearningPolicy(unnamed);
      throw new Error('should have refused');
    } catch (error) {
      expect((error as LearningPolicyError).message).toContain('no provider is named');
    }
  });

  it('refuses auto-save alongside a category that can never be auto-saved', () => {
    for (const category of NEVER_AUTO_SAVED_CATEGORIES) {
      const bad = doc({
        lowRiskPreferenceMemory: 'auto_save',
        candidateCategories: ['text', category],
      });
      try {
        compileLearningPolicy(bad);
        throw new Error(`should have refused ${category}`);
      } catch (error) {
        expect((error as LearningPolicyError).message).toContain(category);
      }
    }
  });

  it('reports several problems at once rather than one at a time', () => {
    const issues = prohibitedLearningShapeIssues(
      doc({ modelTraining: true, crossArchiveLearning: true }),
    );
    expect(issues).toHaveLength(2);
  });

  it('defaults to keeping nothing beyond the session and reviewing everything', () => {
    const d = defaultLearningDocument();
    expect(d.audioRetention).toBe('never');
    expect(d.transcriptRetention).toBe('session');
    expect(d.lowRiskPreferenceMemory).toBe('ask_every_time');
    expect(d.providerProcessing.mode).toBe('local_only');
    expect(d.modelTraining).toBe(false);
    expect(d.crossArchiveLearning).toBe(false);
  });
});

describe('resolving obligations', () => {
  const consented = {
    consentAllowsProviderTranscription: true,
    consentAllowsProviderGeneration: true,
    consentAllowsEmbedding: true,
    consentDataCategories: ['text', 'audio', 'photo', 'health'] as const,
  };

  it('permits nothing when there is no policy', () => {
    const o = resolveLearningObligations({ document: null, expired: false, ...consented });
    expect(o).toEqual(deniedLearningObligations());
  });

  it('permits nothing once the policy has expired', () => {
    const o = resolveLearningObligations({
      document: defaultLearningDocument(),
      expired: true,
      ...consented,
    });
    expect(o.mayExtractCandidates).toBe(false);
    expect(o.mayStoreTranscript).toBe(false);
  });

  it('treats consent as a ceiling: learning cannot widen what consent forbids', () => {
    const permissive = {
      ...defaultLearningDocument(),
      providerProcessing: {
        mode: 'named_providers' as const,
        speechToText: true,
        speechSynthesis: true,
        composition: true,
        namedProviders: ['a-provider'],
        retentionDays: 0,
      },
    };
    const o = resolveLearningObligations({
      document: permissive,
      expired: false,
      ...consented,
      consentAllowsProviderTranscription: false,
      consentAllowsProviderGeneration: false,
    });
    expect(o.mayUseProviderSpeechToText).toBe(false);
    expect(o.mayUseProviderSpeechSynthesis).toBe(false);
    expect(o.mayUseProviderComposition).toBe(false);
  });

  it('intersects candidate categories with what consent permits the archive to hold', () => {
    const o = resolveLearningObligations({
      document: { ...defaultLearningDocument(), candidateCategories: ['text', 'video', 'health'] },
      expired: false,
      ...consented,
      consentDataCategories: ['text', 'health'],
    });
    expect([...o.allowedCandidateCategories].sort()).toEqual(['health', 'text']);
  });

  it('does not permit transcript storage when retention is ephemeral', () => {
    const o = resolveLearningObligations({
      document: { ...defaultLearningDocument(), transcriptRetention: 'ephemeral' },
      expired: false,
      ...consented,
    });
    expect(o.mayStoreTranscript).toBe(false);
  });
});

describe('what may be remembered without asking', () => {
  it('accepts only the six interface preferences', () => {
    for (const key of [
      'interface_language',
      'captions_enabled',
      'speaking_rate',
      'interview_pace',
      'preferred_session_minutes',
      'clarifying_question_frequency',
    ]) {
      expect(isLowRiskPreference(key)).toBe(true);
    }
  });

  it('rejects anything about the storyteller’s life', () => {
    for (const key of [
      'diagnosis',
      'religion',
      'political_view',
      'net_worth',
      'personality',
      'voiceprint',
      'relationship_with_son',
      'regret',
    ]) {
      expect(isLowRiskPreference(key)).toBe(false);
    }
  });

  it('requires review for anything that is not a preference', () => {
    const obligations = { ...deniedLearningObligations(), mayAutoSavePreferences: true };
    for (const kind of ['memory', 'person', 'place', 'date', 'relationship']) {
      expect(
        candidateRequiresReview({
          kind,
          sensitivity: 'normal',
          dataCategories: ['text'],
          obligations,
        }),
      ).toBe(true);
    }
  });

  it('requires review for a preference when auto-save is off', () => {
    expect(
      candidateRequiresReview({
        kind: 'preference',
        sensitivity: 'normal',
        dataCategories: ['text'],
        obligations: deniedLearningObligations(),
      }),
    ).toBe(true);
  });

  it('requires review for anything above normal sensitivity, even a preference', () => {
    const obligations = { ...deniedLearningObligations(), mayAutoSavePreferences: true };
    for (const sensitivity of ['sensitive', 'restricted', 'embargoed']) {
      expect(
        candidateRequiresReview({
          kind: 'preference',
          sensitivity,
          dataCategories: ['text'],
          obligations,
        }),
      ).toBe(true);
    }
  });

  it('auto-saves only a normal-sensitivity preference under an explicit policy', () => {
    const obligations = { ...deniedLearningObligations(), mayAutoSavePreferences: true };
    expect(
      candidateRequiresReview({
        kind: 'preference',
        sensitivity: 'normal',
        dataCategories: ['text'],
        obligations,
      }),
    ).toBe(false);
  });
});

describe('policy change reporting', () => {
  it('describes a new policy', () => {
    expect(diffLearningPolicies(null, defaultLearningDocument())).toEqual([
      'Learning policy created.',
    ]);
  });

  it('names what changed', () => {
    const changes = diffLearningPolicies(defaultLearningDocument(), {
      ...defaultLearningDocument(),
      audioRetention: 'session',
      candidateExtraction: false,
    });
    expect(changes.join(' ')).toContain('Audio retention');
    expect(changes.join(' ')).toContain('Candidate extraction');
  });

  it('detects narrowing, which a live session must act on immediately', () => {
    const wide = { ...deniedLearningObligations(), mayExtractCandidates: true };
    const narrow = deniedLearningObligations();
    expect(isNarrowing(wide, narrow)).toBe(true);
    expect(isNarrowing(narrow, wide)).toBe(false);
    expect(isNarrowing(wide, wide)).toBe(false);
  });
});
