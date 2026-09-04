import { describe, expect, it } from 'vitest';
import {
  FirstPersonCompositionError,
  assertThirdPerson,
  detectContradiction,
  isFirstPerson,
  verifyClaim,
  type EvidencePassage,
} from '../src/verify';

const passage = (id: string, text: string, sourceId = `src-${id}`): EvidencePassage => ({
  id,
  text,
  sourceId,
  memoryId: null,
  transcriptSegmentId: null,
  locator: { kind: 'transcript_segment' },
});

describe('claim verification', () => {
  const evidence = [
    passage('e1', 'We moved to Pune in 1962 because my father changed jobs.'),
    passage('e2', 'The family moved to Pune in 1962 when father took a new job.', 'src-other'),
  ];

  it('accepts a claim whose words are all in the cited evidence', () => {
    const result = verifyClaim(
      { text: 'They moved to Pune in 1962.', evidenceIds: ['e1'] },
      evidence,
    );
    expect(result.verified).toBe(true);
    expect(result.evidenceClass).toBe('P1_DIRECT_STATEMENT');
  });

  it('rejects a claim that adds a detail the evidence never states', () => {
    const result = verifyClaim(
      { text: 'They moved to Delhi in 1962 to be near her grandmother.', evidenceIds: ['e1'] },
      evidence,
    );
    expect(result.verified).toBe(false);
    expect(result.rejection).toBe('unsupported_by_cited_evidence');
  });

  it('rejects a claim with no citation at all', () => {
    const result = verifyClaim({ text: 'They were happy.', evidenceIds: [] }, evidence);
    expect(result.verified).toBe(false);
    expect(result.rejection).toBe('no_citation');
  });

  it('promotes a claim to corroborated when two sources agree', () => {
    const result = verifyClaim(
      { text: 'They moved to Pune in 1962.', evidenceIds: ['e1', 'e2'] },
      evidence,
    );
    expect(result.evidenceClass).toBe('P2_CORROBORATED_FACT');
  });

  it('never returns a prohibited evidence class', () => {
    const result = verifyClaim(
      { text: 'They moved to Pune in 1962.', evidenceIds: ['e1'] },
      evidence,
    );
    expect(result.evidenceClass).not.toBe('P5_GENERATED_SIMULATION');
    expect(result.evidenceClass).not.toBe('P4_MODEL_INFERENCE');
  });
});

describe('third-person enforcement', () => {
  it('detects first-person composition', () => {
    expect(isFirstPerson('I remember the kitchen well.')).toBe(true);
    expect(isFirstPerson('She remembered the kitchen well.')).toBe(false);
  });

  it('detects it at the start of a sentence, whatever the case', () => {
    // Found by an evaluation, and the most important bug in this file's
    // history: the pattern listed "I" in capitals and everything else in lower
    // case, so a sentence *beginning* with "We" or "Our" — which is how most
    // first-person sentences begin — went straight through. A passage from the
    // archive could reach a spoken turn unattributed, which is precisely what
    // this function exists to prevent.
    expect(isFirstPerson('We had lived at the old house for so long.')).toBe(true);
    expect(isFirstPerson('Our house was on Tilak Road.')).toBe(true);
    expect(isFirstPerson('My brother taught me to ride a bicycle.')).toBe(true);
    expect(isFirstPerson('Us three walked to school together.')).toBe(true);
  });

  it('does not mistake a country for a person', () => {
    // The only false positive case-insensitivity introduces, excluded by hand
    // rather than leaving the whole check case-sensitive.
    expect(isFirstPerson('The family moved to the US in 1971.')).toBe(false);
  });

  it('allows first person inside a quotation, which is the storyteller speaking', () => {
    expect(isFirstPerson('She said, “I remember the kitchen well.”')).toBe(false);
    expect(isFirstPerson('Kamala said: “We moved to Pune in 1962.”')).toBe(false);
  });

  it('throws rather than composing as the storyteller', () => {
    expect(() => assertThirdPerson('I was born in Pune.')).toThrow(FirstPersonCompositionError);
    expect(() => assertThirdPerson('We moved to Pune in 1962.')).toThrow(
      FirstPersonCompositionError,
    );
    expect(() => assertThirdPerson('He was born in Pune.')).not.toThrow();
  });
});

describe('contradiction detection', () => {
  it('flags two accounts that give different years for the same event', () => {
    const finding = detectContradiction(
      { text: 'They moved to Pune in 1962.', years: [1962] },
      { text: 'They moved to Pune in 1968.', years: [1968] },
    );
    expect(finding?.kind).toBe('date_conflict');
  });

  it('does not flag unrelated statements', () => {
    expect(
      detectContradiction(
        { text: 'They moved to Pune in 1962.', years: [1962] },
        { text: 'She learned to swim in 1971.', years: [1971] },
      ),
    ).toBeNull();
  });

  it('tolerates a one-year difference rather than nagging about it', () => {
    expect(
      detectContradiction(
        { text: 'They moved to Pune in 1962.', years: [1962] },
        { text: 'They moved to Pune in 1963.', years: [1963] },
      ),
    ).toBeNull();
  });
});

describe('contradiction detection across real phrasing', () => {
  it('spots two accounts of the same move that share only a place name', () => {
    const finding = detectContradiction(
      {
        text: 'We moved to Pune in 1962 because my father took a job on the railways.',
        years: [1962],
      },
      {
        text: 'We moved to Pune in 1968, before we were married, when his work brought him there.',
        years: [1968],
      },
    );
    expect(finding?.kind).toBe('date_conflict');
  });

  it('does not flag two different events that happen to name the same place', () => {
    expect(
      detectContradiction(
        { text: 'She was born in Nagpur in 1948.', years: [1948] },
        {
          text: 'Her first teaching post was near the Nagpur cantonment, which she took in 1971 after finishing college.',
          years: [1971],
        },
      ),
    ).toBeNull();
  });
});
