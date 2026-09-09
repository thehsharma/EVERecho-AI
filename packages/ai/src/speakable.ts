/**
 * What may reach a listener's speakers.
 *
 * There is exactly one synthesis call in this codebase. Everything that
 * arrives at it is one of two things, and the type system is what says so:
 *
 *   Attributed    — the storyteller's own words, presented as a quotation
 *                   with their name on it, having passed third-person
 *                   assertion.
 *   AssistantVoice — one of the archive's own fixed sentences, which are
 *                   about the archive and never about the person.
 *
 * A bare string is neither, and will not typecheck. That is the guarantee:
 * text cannot reach speech by accident, only by somebody deliberately writing
 * one of the two minting calls below — which is a visible, greppable act
 * rather than a quiet one.
 */

declare const Speakable: unique symbol;

/** The storyteller's words, quoted and attributed. Minted only by `attribute()`. */
export type Attributed = string & { readonly [Speakable]: 'attributed' };

/** The archive speaking as itself. Never about the person's inner life. */
export type AssistantVoice = string & { readonly [Speakable]: 'assistant' };

export type SpeakableText = Attributed | AssistantVoice;

/**
 * Marks one of the archive's own fixed sentences as speakable.
 *
 * Deliberately trivial at runtime and deliberately not trivial to write: it
 * takes a call, at a call site somebody can find, to turn a string into
 * something the synthesiser will accept. Applied to constants — the
 * abstention sentence, the persona refusal — never to model output.
 */
export function assistantVoice(text: string): AssistantVoice {
  return text as AssistantVoice;
}

/** Internal. Only `attribute()` may use this, and it does so after verifying. */
export function markAttributed(text: string): Attributed {
  return text as Attributed;
}
