import { describe, expect, it } from 'vitest';
import { findOccasion, selectOccasionClip, type Segment } from '../src/index';

/**
 * Telling them something that has happened since.
 *
 * The tests are mostly about what this refuses to be: a script for how to
 * feel, and a template of what a life is supposed to contain.
 */

const seg = (idx: number, text: string, startMs: number, endMs: number): Segment => ({
  id: `s${idx}`,
  idx,
  startMs,
  endMs,
  text,
});

const HER_LIFE: Segment[] = [
  seg(0, 'I started teaching in 1971, at a school near the cantonment.', 0, 7_000),
  seg(
    1,
    'The first class I ever taught had fifty-three children in it and one blackboard.',
    7_000,
    15_000,
  ),
  seg(2, 'I met Vijay at a wedding in 1969 and we were married two years later.', 15_000, 23_000),
  seg(3, 'We moved to Pune in 1962 because my father took a job on the railways.', 23_000, 31_000),
];

describe('what the news is about', () => {
  it('recognises a subject the archive might have its own version of', () => {
    expect(findOccasion('I got the job, Aai')?.kind).toBe('work');
    expect(findOccasion('We are getting married in December')?.kind).toBe('marriage');
    expect(findOccasion('Our daughter was born on Tuesday')?.kind).toBe('a child');
    expect(findOccasion('We are moving house next month')?.kind).toBe('moving');
  });

  it('says nothing when the news is not about anything it can match', () => {
    // The honest answer is often nothing, and this must reach it easily.
    expect(findOccasion('I painted the balcony')).toBeNull();
    expect(findOccasion('The monsoon was late this year')).toBeNull();
    expect(findOccasion('hello')).toBeNull();
  });
});

describe('what it must never become', () => {
  it('maps news to subjects, never to feelings', () => {
    // There is no column here for "proud" or "sad", because the archive has no
    // standing to decide which one applies to somebody else's news.
    const occasions = [
      findOccasion('I got the job'),
      findOccasion('We are getting married'),
      findOccasion('My father died last week'),
      findOccasion('I am in hospital'),
    ];
    for (const occasion of occasions) {
      expect(occasion).not.toBeNull();
      expect(JSON.stringify(occasion)).not.toMatch(
        /proud|happy|sad|sorry|congratul|condolence|joy|grief|comfort/i,
      );
    }
  });

  it('never supplies an answer of its own, only a place to look', () => {
    // The related terms widen a search. If she never spoke about any of them,
    // nothing comes back — the terms cannot become the reply.
    const silent: Segment[] = [seg(0, 'The kitchen smelled of cardamom.', 0, 5_000)];
    const occasion = findOccasion('I got the job')!;
    expect(selectOccasionClip('I got the job', occasion, silent)).toBeNull();
  });
});

describe('finding what she said about the same thing', () => {
  it('reaches her own first job from somebody else’s new one', () => {
    // "I got the job" and "I started teaching in 1971" share no words at all.
    // This is the whole point of the bridge.
    const news = 'I got the job, Aai';
    const clip = selectOccasionClip(news, findOccasion(news)!, HER_LIFE);
    expect(clip).not.toBeNull();
    expect(clip!.text).toMatch(/teaching|taught|class/);
  });

  it('reaches her own wedding from somebody else’s engagement', () => {
    const news = 'We are getting married in December';
    const clip = selectOccasionClip(news, findOccasion(news)!, HER_LIFE);
    expect(clip?.text).toContain('married');
  });

  it('still finds nothing when she never spoke about the subject', () => {
    const news = 'I have been unwell and I am in hospital';
    const clip = selectOccasionClip(news, findOccasion(news)!, HER_LIFE);
    expect(clip).toBeNull();
  });

  it('needs more than one word in common before it says anything', () => {
    // A moment that merely contains "first" is not her talking about work.
    // Something arbitrary in her voice is worse than nothing, because the
    // voice makes it sound like a reply.
    const nearly: Segment[] = [
      seg(0, 'The first time I saw the sea I was already forty.', 0, 6_000),
    ];
    expect(selectOccasionClip('I got the job', findOccasion('I got the job')!, nearly)).toBeNull();
  });

  it('returns the same moment when told the same news twice', () => {
    const news = 'I got the job, Aai';
    const first = selectOccasionClip(news, findOccasion(news)!, HER_LIFE);
    const second = selectOccasionClip(news, findOccasion(news)!, [...HER_LIFE].reverse());
    expect(second?.segmentId).toBe(first?.segmentId);
  });
});
