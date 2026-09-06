import { contentTokens, coverage } from './text';

/**
 * Choosing which moment of a real recording answers a question.
 *
 * This selects. It never edits, and it cannot: the output is one segment
 * index and a time range, and the server hands the browser the original file
 * plus that range. No code in this repository reads audio bytes, so there is
 * nothing that could splice two moments into a sentence she never said.
 *
 * That is the whole design. Splicing is how a true recording becomes a false
 * statement without a single fabricated word — "I never wanted to leave" and
 * "the house in Pune" are both things she said, and joined they are something
 * she did not. The edit is the lie, and citation does not make it honest.
 */

export interface Segment {
  id: string;
  idx: number;
  startMs: number | null;
  endMs: number | null;
  text: string;
}

export interface Clip {
  segmentId: string;
  /** Where playback begins, including lead-in. Never later than the segment. */
  startMs: number;
  /** Where it ends: the segment's own end, never trimmed to fit an answer. */
  endMs: number;
  /** The words, exactly as transcribed or as the storyteller corrected them. */
  text: string;
}

/**
 * One contiguous range of one real recording, carrying its own provenance.
 *
 * A class with a private field, not an interface with a symbol brand. The
 * difference is the whole point and it was found by a test rather than by
 * reasoning: a symbol brand survives object spread at the type level, so
 * `{ ...clip, endMs: other.endMs }` — precisely the splice this is meant to
 * prevent — still typechecked. A native private field makes the type nominal,
 * and a spread of one produces a plain object that is not assignable back.
 *
 * The constructor is private, so `fromSegment` below is the only way to obtain
 * one, and it builds from a single segment of a single recording. There is
 * deliberately no method anywhere that takes two and returns one: no concat,
 * no merge, no array overload. Adding one would be a visible edit to this
 * file, which is the point — splicing is how a true recording becomes a false
 * statement without a single fabricated word.
 */
export class OriginalAudio implements Clip {
  /** Native private field. This is what makes the type nominal. */
  readonly #unaltered = 'P0_ORIGINAL_SOURCE';

  private constructor(
    readonly segmentId: string,
    readonly startMs: number,
    readonly endMs: number,
    readonly text: string,
  ) {}

  /** The one place provenance is conferred, from one segment and nothing else. */
  static fromSegment(segment: Segment): OriginalAudio | null {
    if (segment.startMs === null || segment.endMs === null || segment.endMs <= segment.startMs) {
      return null;
    }
    return new OriginalAudio(
      segment.id,
      // Clamped at the start of the file. Never extended past the segment's
      // own beginning in the other direction, because that would be trimming.
      Math.max(0, segment.startMs - LEAD_IN_MS),
      segment.endMs,
      segment.text,
    );
  }

  /** Referenced so the field is not merely decorative to a linter. */
  get provenance(): string {
    return this.#unaltered;
  }
}

/**
 * How much runs before the answer starts.
 *
 * Ten seconds, because a clip that begins on the answer is a soundbite and a
 * clip that begins a moment earlier is somebody talking. The difference is
 * most of what makes hearing it worth anything.
 */
export const LEAD_IN_MS = 10_000;

/**
 * How much of the question a segment must actually cover.
 *
 * The same bar the spoken path has always used. It is deliberately higher than
 * "shares a word with it": a clip that plays her voice saying something
 * adjacent to what was asked is worse than saying nothing, because her voice
 * makes it sound like an answer.
 */
const MIN_QUESTION_COVERAGE = 0.5;

/**
 * The one moment in this recording that answers the question, if any.
 *
 * Returns at most one clip. Not an array — the return type is where "never
 * assembled from more than one span" is enforced, because a function that
 * cannot return two things cannot be made to join them later.
 */
/**
 * Turns a chosen segment into a clip.
 *
 * The only place a Clip is constructed, so lead-in, the untrimmed end and the
 * single contiguous range are decided once. Choosing *which* segment is a
 * different question and there is more than one way to ask it; how a clip is
 * built is not up for discussion.
 */
export function clipFromSegment(segment: Segment): OriginalAudio | null {
  return OriginalAudio.fromSegment(segment);
}

export function selectClip(question: string, segments: readonly Segment[]): OriginalAudio | null {
  if (contentTokens(question).length === 0) return null;

  const scored = segments
    // A segment with no timing cannot be played. Typed answers and OCR live in
    // the same table and are legitimately unplayable; they are simply not clips.
    .filter((s) => s.startMs !== null && s.endMs !== null && s.endMs > s.startMs)
    .map((segment) => ({ segment, score: coverage(question, segment.text) }))
    .filter((entry) => entry.score >= MIN_QUESTION_COVERAGE)
    // Deterministic tie-break: the same question must not return a different
    // moment on different runs.
    .sort((a, b) => b.score - a.score || a.segment.idx - b.segment.idx);

  const best = scored[0];
  if (!best) return null;
  return clipFromSegment(best.segment);
}

/**
 * The words either side, so the clip has somewhere to stand.
 *
 * Read, not played. Showing what she was talking about is how somebody tells a
 * clip from a quotation taken out of a conversation, and it costs nothing.
 */
export function surroundingText(
  segments: readonly Segment[],
  segmentId: string,
  radius = 2,
): { before: string[]; after: string[] } {
  const at = segments.findIndex((s) => s.id === segmentId);
  if (at === -1) return { before: [], after: [] };
  return {
    before: segments.slice(Math.max(0, at - radius), at).map((s) => s.text),
    after: segments.slice(at + 1, at + 1 + radius).map((s) => s.text),
  };
}
