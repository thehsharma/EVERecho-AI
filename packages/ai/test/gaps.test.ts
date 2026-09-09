import { describe, expect, it } from 'vitest';
import { detectGaps, promptForGap } from '../src/index';

/**
 * Gap detection has one job and one prohibition.
 *
 * It finds absences of detail in text the storyteller already approved. It
 * infers nothing about the person — and the tests below are mostly about the
 * things it must refuse to notice.
 */

const memory = (id: string, body: string) => ({ id, body });

describe('what it notices', () => {
  it('spots a person who is never named', () => {
    const gaps = detectGaps([memory('m1', 'He told us to leave, so we went that night.')]);
    expect(gaps).toContainEqual({ kind: 'unresolved_person', reference: 'he', memoryId: 'm1' });
  });

  it('spots a date given only as a feeling', () => {
    const gaps = detectGaps([memory('m1', 'We moved a few years later, once things settled.')]);
    expect(gaps.some((g) => g.kind === 'missing_date')).toBe(true);
  });

  it('spots a story that was promised and never told', () => {
    const gaps = detectGaps([
      memory('m1', 'We nearly did not make it at all, but that is another story.'),
    ]);
    expect(gaps.some((g) => g.kind === 'unfinished_story')).toBe(true);
  });

  it('spots a place that is never named', () => {
    const gaps = detectGaps([memory('m1', 'We went back there every summer for years.')]);
    expect(gaps.some((g) => g.kind === 'missing_place')).toBe(true);
  });

  it('asks about the same unnamed person once, not once per memory', () => {
    // Four memories mentioning an unnamed "he" is one question. Four would
    // feel like being nagged by software that is not paying attention.
    const gaps = detectGaps([
      memory('m1', 'He told us to leave.'),
      memory('m2', 'He was always right about these things.'),
      memory('m3', 'He never spoke about it afterwards.'),
    ]);
    expect(gaps.filter((g) => g.kind === 'unresolved_person')).toHaveLength(1);
  });
});

describe('what it must never notice', () => {
  it('says nothing about a life that is simply short on entries', () => {
    // "You have not talked about your father" is an inference about a life.
    // Nothing here is allowed to produce one.
    expect(detectGaps([memory('m1', 'She taught for thirty-one years.')])).toEqual([]);
    expect(detectGaps([])).toEqual([]);
  });

  it('infers nothing about health, money, belief or relationships', () => {
    const gaps = detectGaps([
      memory('m1', 'She was tired a great deal in those last years.'),
      memory('m2', 'Money was short and the rent went up every spring.'),
      memory('m3', 'She stopped going to temple after her sister died.'),
    ]);
    // A vague date or an unnamed person in these sentences is fair game; a
    // conclusion about illness, poverty or faith is not, and there is no code
    // path that could produce one.
    expect(gaps.every((g) => g.kind === 'missing_date' || g.kind === 'unresolved_person')).toBe(
      true,
    );
    expect(JSON.stringify(gaps)).not.toMatch(/health|money|belief|illness|faith/i);
  });

  it('does not ask who the storyteller is', () => {
    // Approved memories are written in the third person about the subject, so
    // a bare "she" is usually her. Asking "who was that?" about the person
    // whose archive it is reads as the software not listening.
    for (const body of [
      'She taught for thirty-one years.',
      'She kept the letters in a tin under the bed.',
      'He worked on the railways until he retired.',
    ]) {
      expect(
        detectGaps([memory('m1', body)]).filter((g) => g.kind === 'unresolved_person'),
      ).toEqual([]);
    }
  });

  it('still asks when the pronoun acted on the family', () => {
    // "He told us to leave" is somebody else, and who they were matters.
    const gaps = detectGaps([memory('m1', 'He told us to leave before the monsoon.')]);
    expect(gaps.some((g) => g.kind === 'unresolved_person')).toBe(true);
  });

  it('does not invent a gap where the person was named', () => {
    expect(detectGaps([memory('m1', 'Anil told us to leave, so we went.')])).toEqual([]);
  });

  it('does not ask who a relation is when the sentence already says', () => {
    // Found against the real demonstration archive: "My brother Ramesh taught
    // me to ride a bicycle" was producing "you mentioned 'my brother' — who
    // was that?", which reads as the software not having read the sentence.
    expect(
      detectGaps([memory('m1', 'My brother Ramesh taught me to ride a bicycle in the lane.')]),
    ).toEqual([]);
    expect(detectGaps([memory('m2', 'My aunt Shanta gave us the key that morning.')])).toEqual([]);
  });

  it('still asks about a relation who is never named', () => {
    const gaps = detectGaps([memory('m1', 'My brother taught me to ride a bicycle in the lane.')]);
    expect(gaps).toEqual([{ kind: 'unresolved_person', reference: 'my brother', memoryId: 'm1' }]);
  });

  it('does not treat the next sentence’s first word as the name', () => {
    // "I never met my uncle then. Ramesh did." names somebody, but not them.
    const gaps = detectGaps([memory('m1', 'I never met my uncle then. Ramesh did.')]);
    expect(gaps.some((g) => g.reference === 'my uncle')).toBe(true);
  });
});

describe('how it asks', () => {
  it('invites rather than reports a deficiency', () => {
    const prompts = (
      [
        'unresolved_person',
        'missing_date',
        'missing_place',
        'unfinished_story',
        'conflicting_timeline',
        'thin_relationship',
      ] as const
    ).map((kind) => promptForGap({ kind, reference: 'he', memoryId: null }));

    for (const prompt of prompts) {
      // A question, never a verdict on how complete somebody's life is.
      expect(prompt).toMatch(/\?|Would you like/);
      expect(prompt).not.toMatch(/incomplete|missing from|you have not|failed|only \d+%/i);
    }
  });

  it('quotes the words that produced it, so the question explains itself', () => {
    expect(
      promptForGap({ kind: 'unresolved_person', reference: 'my brother', memoryId: null }),
    ).toContain('my brother');
  });
});
