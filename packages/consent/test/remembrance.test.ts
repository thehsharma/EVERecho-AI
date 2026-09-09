import { describe, expect, it } from 'vitest';
import {
  resolveRemembrance,
  type RemembranceClause,
  type RemembranceDirective,
} from '../src/remembrance';

/**
 * The directive decides whether a bereaved person hears their mother's voice.
 *
 * Most of these test refusals, because a refusal that leaks is unrecoverable:
 * the person who could have corrected the record is the person who died.
 */

const clause = (over: Partial<RemembranceClause> = {}): RemembranceClause => ({
  effect: 'permit',
  scope: 'archive',
  topic: null,
  memoryId: null,
  sourceAssetId: null,
  audienceUserId: null,
  notBefore: null,
  allowAudio: true,
  ...over,
});

const directive = (over: Partial<RemembranceDirective> = {}): RemembranceDirective => ({
  status: 'activated',
  defaultEffect: 'permit',
  clauses: [],
  ...over,
});

const NOW = new Date('2026-09-04T00:00:00Z');
const ask = (d: RemembranceDirective | null, subject = {}, viewer = 'anjali') =>
  resolveRemembrance({ directive: d, subject, viewerUserId: viewer, now: NOW });

describe('while the storyteller is alive', () => {
  it('says nothing at all', () => {
    // A person must not lose access to their own archive by planning ahead.
    for (const status of ['draft', 'affirmed', 'superseded'] as const) {
      const decision = ask(directive({ status, defaultEffect: 'withhold' }));
      expect(decision.mayRead).toBe(true);
      expect(decision.reasonCode).toBe('not_activated');
    }
  });

  it('says nothing when there is no directive', () => {
    expect(ask(null).mayRead).toBe(true);
  });
});

describe('what silence means', () => {
  it('opens when they said it should', () => {
    const decision = ask(directive({ defaultEffect: 'permit' }));
    expect(decision.mayRead).toBe(true);
    expect(decision.reasonCode).toBe('permitted_by_default');
  });

  it('stays closed when they said it should', () => {
    const decision = ask(directive({ defaultEffect: 'withhold' }));
    expect(decision.mayRead).toBe(false);
    expect(decision.mayHearVoice).toBe(false);
    expect(decision.reasonCode).toBe('withheld_by_default');
  });
});

describe('a refusal is absolute', () => {
  it('beats a permission at the same scope', () => {
    const decision = ask(
      directive({ clauses: [clause({ effect: 'permit' }), clause({ effect: 'withhold' })] }),
    );
    expect(decision.mayRead).toBe(false);
    expect(decision.reasonCode).toBe('withheld_by_clause');
  });

  it('beats a narrower permission', () => {
    // The storyteller sealed the archive to one person, and separately
    // permitted one memory to everybody. The specific permission must not
    // reopen what they closed — refusals are absolute, permissions are not.
    const decision = ask(
      directive({
        clauses: [
          clause({ effect: 'withhold', scope: 'archive', audienceUserId: 'anjali' }),
          clause({ effect: 'permit', scope: 'memory', memoryId: 'm1' }),
        ],
      }),
      { memoryId: 'm1' },
    );
    expect(decision.mayRead).toBe(false);
  });

  it('cannot be scheduled to expire', () => {
    // Enforced by a CHECK constraint in the schema too. A refusal that opens
    // later is a permission wearing a refusal's clothes.
    const decision = ask(
      directive({
        clauses: [clause({ effect: 'withhold', notBefore: new Date('2020-01-01T00:00:00Z') })],
      }),
    );
    expect(decision.mayRead).toBe(false);
  });

  it('applies to the person it names, and not to anybody else', () => {
    const clauses = [clause({ effect: 'withhold', audienceUserId: 'ravi' })];
    expect(ask(directive({ clauses }), {}, 'ravi').mayRead).toBe(false);
    expect(ask(directive({ clauses }), {}, 'anjali').mayRead).toBe(true);
  });
});

describe('not yet', () => {
  it('holds a permission that has not arrived', () => {
    const decision = ask(
      directive({
        defaultEffect: 'withhold',
        clauses: [clause({ notBefore: new Date('2030-01-01T00:00:00Z') })],
      }),
    );
    expect(decision.mayRead).toBe(false);
    expect(decision.reasonCode).toBe('not_yet');
  });

  it('opens once the date has passed', () => {
    const decision = ask(
      directive({
        defaultEffect: 'withhold',
        clauses: [clause({ notBefore: new Date('2020-01-01T00:00:00Z') })],
      }),
    );
    expect(decision.mayRead).toBe(true);
  });
});

describe('the words and the voice are two decisions', () => {
  it('lets them be quoted without being played', () => {
    const decision = ask(directive({ clauses: [clause({ allowAudio: false })] }));
    expect(decision.mayRead).toBe(true);
    expect(decision.mayHearVoice).toBe(false);
    expect(decision.reasonCode).toBe('audio_withheld');
  });

  it('takes the cautious reading when two clauses disagree about the voice', () => {
    const decision = ask(
      directive({
        clauses: [
          clause({ scope: 'archive', allowAudio: true }),
          clause({ scope: 'memory', memoryId: 'm1', allowAudio: false }),
        ],
      }),
      { memoryId: 'm1' },
    );
    expect(decision.mayRead).toBe(true);
    expect(decision.mayHearVoice).toBe(false);
  });

  it('never plays the voice when the words are refused', () => {
    const decision = ask(directive({ defaultEffect: 'withhold' }));
    expect(decision.mayHearVoice).toBe(false);
  });
});

describe('what a topic clause matches', () => {
  it('matches the topic exactly, whatever the case', () => {
    const clauses = [clause({ effect: 'withhold', scope: 'topic', topic: 'Money' })];
    expect(ask(directive({ clauses }), { topics: ['money'] }).mayRead).toBe(false);
  });

  it('does not match a topic that merely contains the word', () => {
    // "money" must not seal "harmony". A substring match here would withhold
    // a story about a wedding because of a clause about debt.
    const clauses = [clause({ effect: 'withhold', scope: 'topic', topic: 'money' })];
    expect(ask(directive({ clauses }), { topics: ['harmony'] }).mayRead).toBe(true);
  });

  it('ignores a topic clause with no topic', () => {
    const clauses = [clause({ effect: 'withhold', scope: 'topic', topic: null })];
    expect(ask(directive({ clauses }), { topics: ['money'] }).mayRead).toBe(true);
  });
});

describe('what the reason code may contain', () => {
  it('is a code, never prose and never their words', () => {
    const codes = [
      ask(null),
      ask(directive()),
      ask(directive({ defaultEffect: 'withhold' })),
      ask(directive({ clauses: [clause({ effect: 'withhold' })] })),
      ask(directive({ clauses: [clause({ allowAudio: false })] })),
    ].map((d) => d.reasonCode);

    for (const code of codes) {
      expect(code).toMatch(/^[a-z_]+$/);
      expect(code.length).toBeLessThan(40);
    }
  });
});
