import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyticsPropsSchema } from '@everecho/contracts';
import { sessionEndReasonSchema, pauseBasisSchema } from '@everecho/contracts';

/**
 * There is no sentiment analysis in this product, and this is what says so.
 *
 * The prohibition is easy to write in a document and easy to lose in a commit
 * that only wanted to be helpful. Every check here is on a mechanism rather
 * than on an intention: a closed vocabulary, a schema that cannot carry a
 * label, a search of the source for the vocabulary of mood detection.
 *
 * The distinction it protects is not "no emotion in the product". The archive
 * holds a great deal of emotion — stated by the person, about themselves, in
 * their own words. What cannot exist is the product deciding how somebody
 * feels and acting on it.
 */

const SOURCE_ROOTS = ['packages', 'apps'];

/** What a sentiment feature would have to be called something like. */
const MOOD_DETECTION =
  /\b(sentiment(Score|Analysis)?|detectEmotion|emotionScore|moodScore|inferMood|valence|arousal|affectScore|distressScore|toneAnalysis)\b/;

/** Blanks comments, keeping line numbers so an offender can be pointed at. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes('no-sentiment.test')) yield full;
  }
}

describe('no sentiment analysis of anybody', () => {
  it('has no scorer anywhere in the source', async () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for await (const file of sourceFiles(root)) {
        // Comments are stripped first. Writing down *why* there is no sentiment
        // analysis is the opposite of adding some, and the first version of
        // this test flagged the paragraph in `feelings.ts` explaining the
        // prohibition — a check that punishes documenting a rule teaches
        // people to stop documenting it.
        for (const [index, line] of withoutComments(readFileSync(file, 'utf8'))
          .split('\n')
          .entries()) {
          if (MOOD_DETECTION.test(line)) offenders.push(`${file}:${index + 1}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has an analytics schema that cannot carry a mood', () => {
    // Numbers, booleans, a three-value severity, null. Not a free string, so
    // "felt_overwhelmed" cannot be passed by accident or on purpose.
    expect(analyticsPropsSchema.safeParse({ mood: 'sad' }).success).toBe(false);
    expect(analyticsPropsSchema.safeParse({ sentiment: -0.8 }).success).toBe(true);
    expect(analyticsPropsSchema.safeParse({ turns: 12, ended: true }).success).toBe(true);
  });

  it('records that a session ended, and only operational reasons why', () => {
    for (const reason of sessionEndReasonSchema.options) {
      // Every value names something that happened to the session.
      expect(reason).not.toMatch(/upset|sad|distress|emotion|cry|overwhelm|tired|struggl/i);
    }
    expect(sessionEndReasonSchema.safeParse('seemed_upset').success).toBe(false);
    expect(sessionEndReasonSchema.safeParse('user_ended').success).toBe(true);
  });

  it('bases the offer to pause on the conversation, never on the person', () => {
    expect(pauseBasisSchema.options).toEqual(['long_session', 'one_topic']);
  });
});
