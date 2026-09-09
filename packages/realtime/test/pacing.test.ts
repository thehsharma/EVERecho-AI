import { describe, expect, it } from 'vitest';
import { PAUSE_OFFER, PAUSE_OFFER_ACTIONS, shouldOfferPause } from '../src/pacing';

const at = (minutes: number) => new Date(Date.UTC(2026, 8, 6, 10, minutes));

const base = {
  startedAt: at(0),
  now: at(5),
  turnCount: 4,
  distinctTopics: 3,
  pauseOfferedAt: null,
  pauseOfferDeclinedAt: null,
};

describe('offering a pause', () => {
  it('says nothing during an ordinary session', () => {
    expect(shouldOfferPause(base)).toEqual({ offer: false, because: 'not_yet' });
  });

  it('offers once the session has run long', () => {
    expect(shouldOfferPause({ ...base, now: at(25) })).toEqual({
      offer: true,
      basis: 'long_session',
    });
  });

  it('offers when many turns have stayed on one topic', () => {
    expect(shouldOfferPause({ ...base, turnCount: 12, distinctTopics: 1 })).toEqual({
      offer: true,
      basis: 'one_topic',
    });
  });

  it('does not mistake a wide-ranging conversation for a stuck one', () => {
    expect(shouldOfferPause({ ...base, turnCount: 40, distinctTopics: 6 })).toEqual({
      offer: false,
      because: 'not_yet',
    });
  });

  it('never offers twice', () => {
    expect(shouldOfferPause({ ...base, now: at(25), pauseOfferedAt: at(25) })).toEqual({
      offer: false,
      because: 'already_offered',
    });
  });

  it('takes no for an answer, however long the session then runs', () => {
    // The guarantee this slice exists for. An hour later, still no.
    expect(
      shouldOfferPause({
        ...base,
        now: at(90),
        turnCount: 200,
        distinctTopics: 1,
        pauseOfferedAt: at(25),
        pauseOfferDeclinedAt: at(26),
      }),
    ).toEqual({ offer: false, because: 'declined' });
  });

  it('treats a declined offer as final even if the record of offering it is lost', () => {
    expect(
      shouldOfferPause({
        ...base,
        now: at(90),
        pauseOfferedAt: null,
        pauseOfferDeclinedAt: at(26),
      }),
    ).toEqual({ offer: false, because: 'declined' });
  });
});

describe('what the offer says', () => {
  it('never says how the person seems', () => {
    for (const text of Object.values(PAUSE_OFFER)) {
      expect(text).not.toMatch(
        /you (seem|sound|look|must be)|upset|tired|distressed|emotional|struggling|sad|overwhelmed/i,
      );
    }
  });

  it('offers stopping and continuing as equals', () => {
    // A "keep going" that reads as the obvious choice makes the offer a
    // formality, which is worse than not offering.
    expect(PAUSE_OFFER_ACTIONS.stop).toBe('Stop for now');
    expect(PAUSE_OFFER_ACTIONS.continue).toBe('Keep going');
    for (const label of Object.values(PAUSE_OFFER_ACTIONS)) {
      expect(label).not.toMatch(/!|\?|really|sure|are you/i);
    }
  });

  it('says the work is safe, because that is the actual worry', () => {
    for (const text of Object.values(PAUSE_OFFER)) {
      expect(text).toContain('saved');
    }
  });

  it('never counts anything at the person', () => {
    // No "45 minutes", no "12 questions", no progress of any kind.
    for (const text of Object.values(PAUSE_OFFER)) {
      expect(text).not.toMatch(/\d/);
    }
  });
});
