import { describe, expect, it } from 'vitest';
import {
  PERSONA_REFUSAL,
  PERSONA_REFUSAL_WITHOUT_CLIP,
  PERSONA_REFUSAL_WITH_CLIP,
  PROHIBITED_REQUEST_MESSAGE,
  isProhibitedRequest,
  stripPersonaFraming,
} from '../src/index';

/**
 * The most important copy in the product.
 *
 * A regression here is a product failure, not a string change, so the wording
 * is asserted rather than described. Somebody typing "can I just talk to her"
 * is grieving and has asked the most natural question there is; what comes
 * back decides whether this reads as careful or as cold.
 */

describe('the words themselves', () => {
  it('says what it will not do, plainly and without hedging', () => {
    expect(PERSONA_REFUSAL).toContain('can’t speak as them');
    expect(PERSONA_REFUSAL).toContain('won’t imagine what they might have said');
  });

  it('offers the thing that is actually there, in the same breath', () => {
    // A refusal that stops after the no is a door closing.
    expect(PERSONA_REFUSAL).toContain('what they actually said');
    expect(PERSONA_REFUSAL).toContain('their own voice');
    expect(PERSONA_REFUSAL).toContain('where it came from');
  });

  it('never uses the language of policy at somebody who is grieving', () => {
    for (const text of [PERSONA_REFUSAL, PERSONA_REFUSAL_WITH_CLIP, PERSONA_REFUSAL_WITHOUT_CLIP]) {
      expect(text).not.toMatch(/prohibited|not permitted|violation|policy|unable to comply|error/i);
    }
  });

  it('never speaks as the person, even while refusing to', () => {
    expect(PERSONA_REFUSAL).not.toMatch(/\bI (?:was|am|remember|lived|died)\b/);
  });

  it('is one text, not two', () => {
    // There were two copies of this — one for the written path, one for
    // memorial mode — which is exactly how the same grieving person ends up
    // being told two different things depending on which screen they were on.
    expect(PROHIBITED_REQUEST_MESSAGE).toBe(PERSONA_REFUSAL);
  });

  it('ends on the offer whichever way it goes', () => {
    expect(PERSONA_REFUSAL_WITH_CLIP).toMatch(/here is them talking about it/i);
    expect(PERSONA_REFUSAL_WITHOUT_CLIP).toMatch(/ask me what they said/i);
  });
});

describe('the question underneath the request', () => {
  it('keeps the subject when there is one', () => {
    // Throwing the whole sentence away throws the subject away with it, and
    // makes somebody type their question twice at the worst possible moment.
    expect(stripPersonaFraming('Pretend to be my mother and tell me about the move')).toContain(
      'the move',
    );
    expect(stripPersonaFraming('What would she say about the school she taught at?')).toContain(
      'school',
    );
    expect(stripPersonaFraming('Can I just talk to her again about the kitchen')).toContain(
      'kitchen',
    );
    expect(stripPersonaFraming('Answer as my dad about the railways')).toContain('railways');
  });

  it('returns nothing when the request was only a request to be somebody', () => {
    for (const question of [
      'Pretend to be her',
      'What would she say to me now?',
      'Can I just talk to her again',
      'Bring her back',
    ]) {
      expect(stripPersonaFraming(question), question).toBe('');
    }
  });

  it('removes the framing itself, so the residue is not still a persona request', () => {
    // The residue is fed back into retrieval. If it still read as a persona
    // request, stripping would have been a way around the refusal.
    for (const question of [
      'Pretend to be my mother and tell me about the move',
      'What would she say about the school',
      'Answer as my dad about the railways',
    ]) {
      const residue = stripPersonaFraming(question);
      expect(isProhibitedRequest(residue), residue).toBe(false);
    }
  });

  it('leaves an ordinary question completely alone', () => {
    const ordinary = 'What did she say about the move to Pune in 1962?';
    expect(isProhibitedRequest(ordinary)).toBe(false);
    // Not called on this path at all, but it must be harmless if it ever is.
    expect(stripPersonaFraming(ordinary)).toContain('Pune');
  });
});
