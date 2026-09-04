import { clipFromSegment, type Clip, type Segment } from './clips';
import { contentTokens } from './text';

/**
 * Telling them something that has happened since.
 *
 * Somebody types "I got the job" into an archive belonging to a person who
 * died. The obvious thing to build is a reaction — congratulations in their
 * voice, warmth they never expressed about news they never heard. That is a
 * sentence they did not say, and no amount of good intent makes it theirs.
 *
 * This does the other thing. It works out what the news is *about*, and goes
 * looking for what they actually said about the same thing in their own life.
 * You tell her you got the job; she tells you about her first class, fifty-three
 * children and one blackboard, in 1971, in her own voice. Nobody wrote that for
 * the occasion. She just said it, and it happens to be the truest possible
 * answer.
 *
 * Two things this must never become.
 *
 * It must not become a script for how to feel. The table below maps news to
 * *subjects* — work, marriage, a child, a move — never to sentiments. There is
 * no column here for "proud" or "sad" because the archive has no standing to
 * decide which one applies.
 *
 * And it must not become a template of what a life contains. When somebody's
 * news is about something the archive never covers, the honest answer is that
 * there is nothing, and the code below reaches that answer often.
 */

export interface Occasion {
  /** What the news is about. A subject, never a feeling. */
  kind:
    'work' | 'marriage' | 'a child' | 'moving' | 'study' | 'loss' | 'illness' | 'money' | 'travel';
  /**
   * Words from the archive's own vocabulary that touch the same subject.
   *
   * These widen the search; they never supply an answer. If the storyteller
   * never spoke about any of them, nothing is returned.
   */
  relatedTerms: readonly string[];
}

interface OccasionRule extends Occasion {
  cues: RegExp;
}

/**
 * Deliberately small, and deliberately about subjects the storyteller might
 * plausibly have spoken about in their own life. Adding a row means claiming
 * that a kind of news has a counterpart in an ordinary life; that is a real
 * claim and it should be made one row at a time, on purpose.
 */
const RULES: readonly OccasionRule[] = [
  {
    kind: 'work',
    cues: /\b(?:got|started|new|lost|left|quit|first)\b[^.!?]{0,30}\b(?:job|work|post|position|role|career)\b|\b(?:promoted|promotion|hired|redundant|retiring|retired)\b/i,
    relatedTerms: ['work', 'job', 'teaching', 'taught', 'school', 'started', 'first', 'class'],
  },
  {
    kind: 'marriage',
    cues: /\b(?:getting married|got married|engaged|engagement|wedding|my wife|my husband|proposed)\b/i,
    relatedTerms: ['married', 'wedding', 'met', 'husband', 'wife'],
  },
  {
    kind: 'a child',
    cues: /\b(?:had a baby|having a baby|pregnant|expecting|our (?:son|daughter|baby)|was born|becoming a (?:mother|father|parent)|grandchild)\b/i,
    relatedTerms: ['born', 'daughter', 'son', 'children', 'baby', 'mother'],
  },
  {
    kind: 'moving',
    cues: /\b(?:moving|moved|new (?:house|flat|home|place)|leaving town|shifting)\b/i,
    relatedTerms: ['moved', 'house', 'home', 'left', 'town'],
  },
  {
    kind: 'study',
    cues: /\b(?:exam|graduated|graduation|degree|college|university|passed|failed|studying)\b/i,
    relatedTerms: ['college', 'studied', 'school', 'mathematics', 'taught', 'learned'],
  },
  {
    kind: 'loss',
    cues: /\b(?:died|passed away|funeral|lost (?:my|our)|gone now)\b/i,
    relatedTerms: ['died', 'lost', 'funeral', 'after'],
  },
  {
    kind: 'illness',
    cues: /\b(?:ill|unwell|in hospital|diagnosis|diagnosed|operation|surgery|treatment)\b/i,
    relatedTerms: ['ill', 'hospital', 'unwell', 'looked after'],
  },
  {
    kind: 'money',
    cues: /\b(?:short of money|can'?t afford|broke|debt|rent went up|struggling financially)\b/i,
    relatedTerms: ['money', 'tight', 'afford', 'rupee', 'managed'],
  },
  {
    kind: 'travel',
    cues: /\b(?:travelling|traveling|trip to|going back to|visiting|abroad|emigrat)\b/i,
    relatedTerms: ['went', 'travelled', 'visited', 'back'],
  },
];

/** What the news is about, if this is about anything the archive could match. */
export function findOccasion(news: string): Occasion | null {
  for (const rule of RULES) {
    if (rule.cues.test(news)) return { kind: rule.kind, relatedTerms: rule.relatedTerms };
  }
  return null;
}

/**
 * How many of the subject's words a moment has to touch.
 *
 * Two, not one. "I got the job" reaching any sentence containing the word
 * "first" would return something arbitrary in her voice, and something
 * arbitrary in her voice is worse than nothing at all — the voice makes it
 * sound like a reply.
 *
 * A deliberately different rule from the one a direct question uses, because
 * it is a different question. Asking "why did they move to Pune" is asking for
 * a specific answer and gets a strict coverage bar. Telling her you got the
 * job is asking whether she ever spoke about work, and the bar is: at least
 * twice, about that.
 */
const MIN_SUBJECT_MATCHES = 2;

/**
 * What she said about the same subject in her own life.
 *
 * Ranked by how much of the subject a moment touches, then by the news's own
 * words — which often carry the specifics, a place or a name, that make one
 * moment better than another. Deterministic on ties, so telling her the same
 * thing twice does not surface two different memories.
 */
export function selectOccasionClip(
  news: string,
  occasion: Occasion,
  segments: readonly Segment[],
): Clip | null {
  const newsTokens = new Set(contentTokens(news));
  const subject = new Set(occasion.relatedTerms.flatMap((t) => contentTokens(t)));

  const scored = segments
    .map((segment) => {
      const tokens = new Set(contentTokens(segment.text));
      const subjectHits = [...subject].filter((t) => tokens.has(t)).length;
      const newsHits = [...newsTokens].filter((t) => tokens.has(t)).length;
      return { segment, subjectHits, newsHits };
    })
    .filter((entry) => entry.subjectHits >= MIN_SUBJECT_MATCHES)
    .sort(
      (a, b) =>
        b.subjectHits - a.subjectHits || b.newsHits - a.newsHits || a.segment.idx - b.segment.idx,
    );

  const best = scored[0];
  return best ? clipFromSegment(best.segment) : null;
}
