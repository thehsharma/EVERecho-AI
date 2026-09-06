/**
 * Whether to offer a pause, and never a second time.
 *
 * A grief-literate product has one job here and one temptation.
 *
 * The job: notice that somebody has been at this for a long time, or has been
 * circling the same thing for a while, and say once that they can stop. Not a
 * countdown, not a modal, not a "you have been here 45 minutes!" — an offer,
 * phrased as an offer, that takes no for an answer.
 *
 * The temptation: work out how they are feeling. Every input to this function
 * is a property of the *conversation* — how long it has run, how many turns,
 * how many distinct topics those turns touched. None of them is a property of
 * the person. There is deliberately nowhere to pass text, audio, a voice
 * quality, a hesitation, or anything else that could be read as a mood, and
 * the type is what enforces that rather than a comment asking politely.
 *
 * This is why the shape is a pure function over four numbers and two
 * timestamps. If somebody ever wants to make the offer smarter, the smallest
 * possible change is to add a field here, and the field will be conspicuous.
 */

/** Long enough that somebody may not have noticed how long. */
const LONG_SESSION_MS = 25 * 60 * 1000;

/** Enough turns that a single topic is a pattern rather than a coincidence. */
const ONE_TOPIC_TURNS = 12;

export type PauseBasis = 'long_session' | 'one_topic';

export interface PacingInput {
  startedAt: Date;
  now: Date;
  /** Turns from either speaker. A count, never their content. */
  turnCount: number;
  /** How many distinct topics those turns touched. A count, never which. */
  distinctTopics: number;
  /** Set once the offer has been made. */
  pauseOfferedAt: Date | null;
  /** Set once it has been declined. The answer is final. */
  pauseOfferDeclinedAt: Date | null;
}

export type PacingDecision =
  | { offer: true; basis: PauseBasis }
  | { offer: false; because: 'already_offered' | 'declined' | 'not_yet' };

export function shouldOfferPause(input: PacingInput): PacingDecision {
  // Declined first, and before anything else could override it. A system that
  // asks a second time has not accepted the answer, whatever its reason.
  if (input.pauseOfferDeclinedAt !== null) return { offer: false, because: 'declined' };
  if (input.pauseOfferedAt !== null) return { offer: false, because: 'already_offered' };

  const elapsedMs = input.now.getTime() - input.startedAt.getTime();
  if (elapsedMs >= LONG_SESSION_MS) return { offer: true, basis: 'long_session' };

  // One topic, held for a long time. Said plainly rather than diagnosed: the
  // offer names what the conversation has been about, not what it means.
  if (input.turnCount >= ONE_TOPIC_TURNS && input.distinctTopics <= 1) {
    return { offer: true, basis: 'one_topic' };
  }

  return { offer: false, because: 'not_yet' };
}

/**
 * What the offer says.
 *
 * Written out here rather than in the frontend so it is asserted by a test and
 * cannot drift into something warmer. Two properties matter and are both
 * pinned: it never says how the person seems, and stopping and continuing are
 * offered as equals — a "keep going" styled as the obvious choice would make
 * the offer a formality.
 */
export const PAUSE_OFFER: Record<PauseBasis, string> = {
  long_session:
    'You have been here a while. There is no need to finish anything today — ' +
    'everything so far is saved, and it will be here whenever you come back.',
  one_topic:
    'This has been about one thing for a while. You are welcome to stay with it, ' +
    'and equally welcome to stop here — everything so far is saved.',
};

export const PAUSE_OFFER_ACTIONS = {
  stop: 'Stop for now',
  continue: 'Keep going',
} as const;
