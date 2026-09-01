import { describe, expect, it } from 'vitest';
import {
  ConsentPolicyError,
  canonicalise,
  compileConsentPolicy,
  defaultConsentDocument,
  diffPolicies,
  hashPolicy,
} from '../src/policy';
import { evaluateTeachBack, TEACH_BACK_QUESTIONS } from '../src/teachback';

const base = defaultConsentDocument();

describe('the default policy grants nothing to anyone', () => {
  it('starts in preserve mode with no recipients', () => {
    expect(base.mode).toBe('preserve');
    expect(base.recipients).toEqual([]);
    expect(base.providerProcessing.generation).toBe(false);
  });

  it('denies voice and likeness by default', () => {
    expect(base.voiceAndLikeness).toEqual({
      syntheticVoice: false,
      syntheticLikeness: false,
      personaSimulation: false,
    });
  });
});

describe('prohibited consent is refused at compile time', () => {
  it('refuses perform mode', () => {
    expect(() => compileConsentPolicy({ ...base, mode: 'perform' })).toThrow(ConsentPolicyError);
  });

  it('refuses a granted synthetic voice even if the caller insists', () => {
    expect(() =>
      compileConsentPolicy({
        ...base,
        voiceAndLikeness: {
          syntheticVoice: true,
          syntheticLikeness: false,
          personaSimulation: false,
        },
      }),
    ).toThrow(/voice and likeness/i);
  });

  it('refuses to record consent to model training', () => {
    expect(() =>
      compileConsentPolicy({
        ...base,
        providerProcessing: { ...base.providerProcessing, noModelTraining: false },
      }),
    ).toThrow(ConsentPolicyError);
  });
});

describe('normalisation', () => {
  it('never lets a storyteller lose storage or export of their own archive', () => {
    const { document } = compileConsentPolicy({ ...base, activities: [] });
    expect(document.activities).toContain('storage');
    expect(document.activities).toContain('export');
  });

  it('clamps provider flags to the activities that were actually granted', () => {
    const { document } = compileConsentPolicy({
      ...base,
      activities: ['storage', 'export'],
      providerProcessing: { ...base.providerProcessing, transcription: true, generation: true },
    });
    expect(document.providerProcessing.transcription).toBe(false);
    expect(document.providerProcessing.generation).toBe(false);
  });

  it('keeps modes and activities independent so granularity survives', () => {
    const { document } = compileConsentPolicy({
      ...base,
      mode: 'compose',
      activities: ['storage', 'export', 'transcription', 'embedding', 'generation'],
      providerProcessing: {
        ...base.providerProcessing,
        transcription: true,
        embedding: true,
        generation: true,
      },
    });
    // Composition enabled, OCR still refused: documents simply go unprocessed.
    expect(document.mode).toBe('compose');
    expect(document.activities).not.toContain('ocr');
    expect(document.providerProcessing.ocr).toBe(false);
  });

  it('drops blank restricted topics and de-duplicates', () => {
    const { document } = compileConsentPolicy({
      ...base,
      restrictedTopics: ['  money ', 'money', '   ', 'illness'],
    });
    expect(document.restrictedTopics).toEqual(['illness', 'money']);
  });
});

describe('hashing', () => {
  it('is stable across key and array order', () => {
    const a = compileConsentPolicy({
      ...base,
      restrictedTopics: ['b', 'a'],
      dataCategories: ['photo', 'audio'],
    });
    const b = compileConsentPolicy({
      ...base,
      dataCategories: ['audio', 'photo'],
      restrictedTopics: ['a', 'b'],
    });
    expect(a.policyHash).toBe(b.policyHash);
  });

  it('changes when a single meaningful field changes', () => {
    const a = compileConsentPolicy(base);
    const b = compileConsentPolicy({ ...base, mode: 'organise' });
    expect(a.policyHash).not.toBe(b.policyHash);
  });

  it('produces a sha256 hex digest', () => {
    expect(hashPolicy(base)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sorts object keys at every depth', () => {
    expect(canonicalise({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});

describe('policy diffs read as plain English', () => {
  it('describes a first grant', () => {
    expect(diffPolicies(null, base)[0]).toMatch(/set up with mode/);
  });

  it('names what was withdrawn', () => {
    const before = compileConsentPolicy({
      ...base,
      activities: ['storage', 'export', 'transcription'],
    }).document;
    const after = compileConsentPolicy({ ...base, activities: ['storage', 'export'] }).document;
    expect(diffPolicies(before, after).join(' ')).toMatch(/Withdrawn: transcription/);
  });

  it('names access that was removed', () => {
    const grant = {
      role: 'family' as const,
      maxSensitivity: 'normal' as const,
      lifeStates: ['living' as const],
      mayExport: false,
      mayContribute: false,
    };
    const before = compileConsentPolicy({ ...base, recipients: [grant] }).document;
    const after = compileConsentPolicy({ ...base, recipients: [] }).document;
    expect(diffPolicies(before, after).join(' ')).toMatch(/Access removed from family/);
  });
});

describe('teach-back', () => {
  const allCorrect = TEACH_BACK_QUESTIONS.map((q) => ({
    questionId: q.id,
    optionId: q.correctOptionId,
  }));

  it('passes only when every answer is right', () => {
    expect(evaluateTeachBack(allCorrect).passed).toBe(true);
  });

  it('fails and teaches when the storyteller thinks the AI will speak as them', () => {
    const answers = allCorrect.map((a) =>
      a.questionId === 'ai_role' ? { ...a, optionId: 'speak_as_me' } : a,
    );
    const result = evaluateTeachBack(answers);
    expect(result.passed).toBe(false);
    expect(result.incorrectQuestionIds).toEqual(['ai_role']);
    expect(result.teaching[0]?.explanation).toMatch(/never speak as you/i);
  });

  it('fails when nothing is answered', () => {
    expect(evaluateTeachBack([]).passed).toBe(false);
  });

  it('covers the points that matter: control, skipping, AI limits, reversal, privacy', () => {
    const ids = TEACH_BACK_QUESTIONS.map((q) => q.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'who_decides',
        'can_i_skip',
        'ai_role',
        'change_mind',
        'who_sees_now',
        'sensitive',
      ]),
    );
  });
});
