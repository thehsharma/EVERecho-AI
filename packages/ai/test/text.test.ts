import { describe, expect, it } from 'vitest';
import {
  contentTokens,
  coverage,
  extractDecades,
  extractProperNouns,
  extractYears,
  splitSentences,
  stem,
  tokenOverlap,
  truncate,
} from '../src/text';

describe('sentence splitting survives real writing', () => {
  it('does not split on initials or titles', () => {
    const text = 'Dr. Rao delivered me in 1948. My father, K. R. Sharma, waited outside.';
    expect(splitSentences(text)).toEqual([
      'Dr. Rao delivered me in 1948.',
      'My father, K. R. Sharma, waited outside.',
    ]);
  });

  it('does not split on decimals or ellipses', () => {
    expect(splitSentences('It cost 12.50 rupees... I still remember. Then we left.')).toHaveLength(
      2,
    );
  });
});

describe('token utilities', () => {
  it('drops stop words but keeps meaning', () => {
    // Tokens are stemmed matching keys, not display words.
    expect(contentTokens('I was in the house with my mother')).toEqual(['hous', 'mother']);
  });

  it('makes inflected forms of the same word converge', () => {
    for (const [a, b] of [
      ['move', 'moved'],
      ['move', 'moving'],
      ['house', 'houses'],
      ['carry', 'carried'],
      ['watch', 'watches'],
      ['railway', 'railways'],
    ] as const) {
      expect(stem(a), `${a} vs ${b}`).toBe(stem(b));
    }
  });

  it('does not collapse genuinely different words', () => {
    expect(stem('father')).not.toBe(stem('mother'));
    expect(stem('pune')).not.toBe(stem('delhi'));
  });

  it('scores coverage of a claim by its evidence', () => {
    const evidence = 'We moved to Pune in 1962 when my father changed jobs.';
    expect(coverage('We moved to Pune in 1962', evidence)).toBe(1);
    expect(coverage('We moved to Delhi in 1962', evidence)).toBeLessThan(1);
  });

  it('measures overlap symmetrically enough to spot duplicates', () => {
    expect(tokenOverlap('the kitchen smelled of cardamom', 'kitchen smelled of cardamom')).toBe(1);
    expect(tokenOverlap('school in Pune', 'a wedding in Delhi')).toBeLessThan(0.4);
  });
});

describe('dates and names', () => {
  it('finds four-digit years', () => {
    expect(extractYears('Born in 1948, married in 1971.')).toEqual([1948, 1971]);
  });

  it('finds decades', () => {
    expect(extractDecades('Through the 1960s and into the 1970s')).toEqual([1960, 1970]);
  });

  it('finds proper nouns without treating sentence starts as names', () => {
    const nouns = extractProperNouns('We lived in Pune. Later my brother Ramesh moved to Delhi.');
    expect(nouns).toContain('Pune');
    expect(nouns).toContain('Ramesh');
    expect(nouns).toContain('Delhi');
    expect(nouns).not.toContain('We');
    expect(nouns).not.toContain('Later');
  });
});

describe('truncate', () => {
  it('cuts on a word boundary', () => {
    expect(truncate('the quick brown fox jumps', 12)).toBe('the quick…');
  });

  it('leaves short text alone', () => {
    expect(truncate('short', 100)).toBe('short');
  });
});
