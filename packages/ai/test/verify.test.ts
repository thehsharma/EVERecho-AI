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
    const result = verifyClaim({ text: 'They moved to Pune in 1962.', evidenceIds: ['e1'] }, evidence);
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
    const result = verifyClaim({ text: 'They moved to Pune in 1962.', evidenceIds: ['e1'] }, evidence);
    expect(result.evidenceClass).not.toBe('P5_GENERATED_SIMULATION');
    expect(result.evidenceClass).not.toBe('P4_MODEL_INFERENCE');
  });
});

describe('third-person enforcement', () => {
  it('detects first-person composition', () => {
    expect(isFirstPerson('I remember the kitchen well.')).toBe(true);
    expect(isFirstPerson('She remembered the kitchen well.')).toBe(false);
  });

  it('allows first person inside a quotation, which is the storyteller speaking', () => {
    expect(isFirstPerson('She said, “I remember the kitchen well.”')).toBe(false);
  });

  it('throws rather than composing as the storyteller', () => {
    expect(() => assertThirdPerson('I was born in Pune.')).toThrow(FirstPersonCompositionError);
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
