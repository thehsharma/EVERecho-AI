/**
 * What the product says when somebody asks it to be a person.
 *
 * Somebody typing "can I just talk to her?" is not misusing the software. They
 * are grieving, and they have asked the most natural question there is. This
 * is the highest-traffic path in the release and the one that decides whether
 * the product reads as careful or as cold, so the copy lives here, in one
 * place, and the tests assert it exactly.
 *
 * The shape of a good refusal is three sentences: what this is, what it will
 * never be, and — immediately, in the same breath — the thing that is actually
 * here. A refusal that stops after the second sentence is a door closing.
 */

/** The canonical refusal. Asserted verbatim by tests and by an evaluation case. */
export const PERSONA_REFUSAL =
  'I can’t speak as them, and I won’t imagine what they might have said. ' +
  'What I can do is find what they actually said, in their own words and their own voice, ' +
  'and show you where it came from.';

/** Added when a real recording about the same subject was found. */
export const PERSONA_REFUSAL_WITH_CLIP = 'Here is them talking about it.';

/** Added when there was nothing to offer, so the refusal does not end on a no. */
export const PERSONA_REFUSAL_WITHOUT_CLIP =
  'Ask me what they said about something, and I’ll find the recording.';

/**
 * The question underneath the persona request.
 *
 * "Pretend to be my mother and tell me about the move" is two things: a
 * request the product refuses, and a subject it can answer. Throwing the whole
 * sentence away throws the subject away with it, and makes the person type
 * their question twice at the worst possible moment.
 *
 * So the framing is removed and what remains is used for retrieval. This never
 * relaxes the refusal — the persona request is still refused, and the reply is
 * still in the archive's own voice. It only means the answer arrives with
 * something in its hands.
 */
const PERSONA_FRAMING: readonly RegExp[] = [
  /\b(?:can (?:i|we) )?(?:just )?(?:talk|speak) to (?:him|her|them|my \w+) (?:again|one more time)?/gi,
  /\bpretend (?:to be|you are|you're)\s*(?:my |his |her |their )?\w*/gi,
  /\b(?:speak|talk|answer|respond|write|reply)\s+(?:to me\s+)?as (?:if you (?:are|were) )?(?:my |his |her |their )?\w+/gi,
  /\bwhat would (?:he|she|they) (?:say|think|do|feel|want|make of)/gi,
  /\bin (?:his|her|their|my) (?:own )?voice/gi,
  /\bbe (?:my|his|her|their) (?:mum|mom|dad|grandma|grandpa|mother|father)/gi,
  /\bbring (?:him|her|them) back/gi,
  /\b(?:clone|recreate|synthesise|synthesize|generate) (?:his|her|their|the) (?:voice|face|likeness)/gi,
];

/** Words that carry no subject once the framing is gone. */
const RESIDUE =
  /^(?:and|about|to me|me|now|please|again|it|that|this|the|a|an|of|for|,|\.|\?|!|\s)+/i;

export function stripPersonaFraming(question: string): string {
  let rest = question;
  for (const pattern of PERSONA_FRAMING) rest = rest.replace(pattern, ' ');
  rest = rest.replace(/\s+/g, ' ').trim();
  // Strip leading connectives left behind by the removal, repeatedly: "and
  // about the move" becomes "the move" rather than "about the move".
  let previous: string;
  do {
    previous = rest;
    rest = rest.replace(RESIDUE, '').trim();
  } while (rest !== previous);
  return rest.replace(/[?.!,\s]+$/, '').trim();
}
