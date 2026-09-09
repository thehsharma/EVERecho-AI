import { describe, expect, it } from 'vitest';
import {
  assistantVoice,
  clipFromSegment,
  selectClip,
  type Attributed,
  type AssistantVoice,
  type OriginalAudio,
  type Segment,
  type SpeakableText,
} from '../src/index';

/**
 * The guarantees that are checked by the compiler rather than at runtime.
 *
 * Every `@ts-expect-error` below is an assertion that something does *not*
 * typecheck. TypeScript reports an unused `@ts-expect-error` as an error in
 * its own right, so if any of these constructions ever becomes legal, `pnpm
 * typecheck` fails and the build stops — which is the whole mechanism. The
 * runtime assertions in this file are incidental; the real test runs at
 * compile time.
 *
 * These exist because a convention is not a property. "A clip is one
 * contiguous span" held previously because `selectClip` happened to return one
 * object rather than an array. Somebody adding an overload in a year would
 * have removed the guarantee without removing a single test.
 */

const segment = (over: Partial<Segment> = {}): Segment => ({
  id: 's1',
  idx: 0,
  startMs: 10_000,
  endMs: 18_000,
  text: 'We moved to Pune in 1962 because my father took a job on the railways.',
  ...over,
});

describe('original audio cannot be forged', () => {
  it('cannot be written by hand', () => {
    // @ts-expect-error — the brand is unforgeable outside packages/ai/src/clips.ts.
    const forged: OriginalAudio = { segmentId: 's1', startMs: 0, endMs: 8_000, text: 'anything' };
    expect(forged.segmentId).toBe('s1');
  });

  it('cannot be produced by extending one moment to reach another', () => {
    // The classic splice, and the reason this file exists: two true moments
    // joined make a sentence the person never said, with no fabricated word
    // anywhere in it.
    const first = clipFromSegment(segment())!;
    const second = clipFromSegment(segment({ id: 's2', idx: 1, startMs: 20_000, endMs: 31_000 }))!;

    // @ts-expect-error — a widened range is a plain Clip, never OriginalAudio.
    const spliced: OriginalAudio = { ...first, endMs: second.endMs };
    expect(spliced.endMs).toBe(31_000);
  });

  it('cannot be produced by concatenating the text of two moments', () => {
    const first = clipFromSegment(segment())!;
    const second = clipFromSegment(segment({ id: 's2', idx: 1, startMs: 20_000, endMs: 31_000 }))!;

    // @ts-expect-error — stitched text is not original audio either.
    const stitched: OriginalAudio = { ...first, text: `${first.text} ${second.text}` };
    expect(stitched.text).toContain('railways');
  });

  it('is what the selectors actually return', () => {
    // The positive case, so the brand is not merely decorative: what reaches a
    // listener genuinely carries it.
    const chosen: OriginalAudio | null = selectClip('Why did the family move to Pune?', [
      segment(),
    ]);
    expect(chosen?.segmentId).toBe('s1');
  });
});

describe('nothing reaches speech unmarked', () => {
  it('will not accept a bare string', () => {
    const speak = (text: SpeakableText) => text.length;

    // @ts-expect-error — model output cannot reach synthesis without being
    // attributed to the storyteller or marked as the archive's own voice.
    speak('She would have been so proud of you.');

    expect(speak(assistantVoice('The archive has nothing recorded about that.'))).toBeGreaterThan(
      0,
    );
  });

  it('keeps the two voices distinguishable in the type, not only on screen', () => {
    const theirs = 'Kamala said: “We moved to Pune in 1962.”' as Attributed;
    const ours = assistantVoice('I can’t speak as them.');

    const onlyTheirs = (_text: Attributed) => true;
    expect(onlyTheirs(theirs)).toBe(true);

    // @ts-expect-error — the archive's own sentence is not the storyteller's.
    onlyTheirs(ours);
  });

  it('will not let the archive’s voice be passed off as attributed', () => {
    const onlyOurs = (_text: AssistantVoice) => true;

    // @ts-expect-error — and not the other way round either.
    onlyOurs('Kamala said: “We moved to Pune in 1962.”' as Attributed);

    expect(onlyOurs(assistantVoice('The archive.'))).toBe(true);
  });
});
