import { describe, expect, it } from 'vitest';
import { LEAD_IN_MS, selectClip, surroundingText, type Segment } from '../src/index';

/**
 * Choosing a moment of a real recording.
 *
 * The tests that matter are about what it refuses: to join two moments, to
 * trim one to fit, and to play her voice saying something that is merely
 * adjacent to what was asked.
 */

const seg = (idx: number, text: string, startMs: number | null, endMs: number | null): Segment => ({
  id: `s${idx}`,
  idx,
  startMs,
  endMs,
  text,
});

const RECORDING: Segment[] = [
  seg(0, 'I was born in Nagpur in 1948, in a house with a courtyard.', 0, 6_000),
  seg(1, 'We moved to Pune in 1962 because my father took a job on the railways.', 6_000, 14_000),
  seg(2, 'The kitchen always smelled of cardamom and frying onions.', 14_000, 20_000),
  seg(3, 'I started teaching in 1971, at a school near the cantonment.', 20_000, 27_000),
];

describe('what it selects', () => {
  it('finds the moment that answers the question', () => {
    const clip = selectClip('Why did the family move to Pune?', RECORDING);
    expect(clip?.segmentId).toBe('s1');
    expect(clip?.text).toContain('railways');
  });

  it('starts before the answer, so it is a moment and not a soundbite', () => {
    const clip = selectClip('Why did the family move to Pune?', RECORDING);
    expect(clip?.startMs).toBe(6_000 - LEAD_IN_MS < 0 ? 0 : 6_000 - LEAD_IN_MS);
    expect(clip!.startMs).toBeLessThan(6_000);
  });

  it('never begins before the start of the recording', () => {
    const clip = selectClip('Where was she born?', RECORDING);
    expect(clip?.segmentId).toBe('s0');
    expect(clip?.startMs).toBe(0);
  });

  it('ends where she stopped talking, not where the answer stopped', () => {
    // No trimming to fit. If the honest clip is longer than an answer needs,
    // it is longer.
    const clip = selectClip('Why did the family move to Pune?', RECORDING);
    expect(clip?.endMs).toBe(14_000);
  });
});

describe('what it refuses', () => {
  it('cannot return two moments', () => {
    // Enforced by the return type, and asserted here so that a future change
    // to an array has to break this test on the way past.
    const clip = selectClip('Pune 1962 railways cardamom teaching', RECORDING);
    expect(Array.isArray(clip)).toBe(false);
    expect(clip === null || typeof clip.segmentId === 'string').toBe(true);
  });

  it('says nothing rather than playing something merely adjacent', () => {
    // Her voice makes anything sound like an answer. A clip about the kitchen,
    // played in response to a question about her favourite food, is worse than
    // silence.
    expect(selectClip('What was her favourite food?', RECORDING)).toBeNull();
    expect(selectClip('How many grandchildren does she have?', RECORDING)).toBeNull();
  });

  it('says nothing when the question carries no content at all', () => {
    expect(selectClip('   ', RECORDING)).toBeNull();
    expect(selectClip('the and of', RECORDING)).toBeNull();
  });

  it('will not offer a segment that cannot be played', () => {
    // A typed answer and an OCR page live in the same table and have no
    // timings. They are legitimate transcript, and they are not clips.
    const typed = [seg(0, 'We moved to Pune in 1962 because of the railways.', null, null)];
    expect(selectClip('Why did the family move to Pune?', typed)).toBeNull();
  });

  it('will not offer a segment whose timings are impossible', () => {
    const broken = [seg(0, 'We moved to Pune in 1962 because of the railways.', 9_000, 9_000)];
    expect(selectClip('Why did the family move to Pune?', broken)).toBeNull();
  });

  it('returns the same moment every time', () => {
    // Two runs of the same question must not surface different memories.
    const first = selectClip('Why did the family move to Pune?', RECORDING);
    const second = selectClip('Why did the family move to Pune?', [...RECORDING].reverse());
    expect(second?.segmentId).toBe(first?.segmentId);
  });
});

describe('the words either side', () => {
  it('gives the clip somewhere to stand', () => {
    const around = surroundingText(RECORDING, 's2');
    expect(around.before).toHaveLength(2);
    expect(around.after).toHaveLength(1);
    expect(around.before[1]).toContain('railways');
  });

  it('copes at the edges of a recording', () => {
    expect(surroundingText(RECORDING, 's0').before).toEqual([]);
    expect(surroundingText(RECORDING, 's3').after).toEqual([]);
  });

  it('returns nothing for a segment that is not there', () => {
    expect(surroundingText(RECORDING, 'nope')).toEqual({ before: [], after: [] });
  });
});
