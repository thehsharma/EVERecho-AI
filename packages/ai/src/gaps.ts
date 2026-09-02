import { findUnresolvedReferences } from './streaming/local';

/**
 * What an archive mentions but never explains.
 *
 * Pure, and deliberately narrow. It detects *absences of detail in text the
 * storyteller already approved* — an unnamed person, a vague date, a place
 * that is never named. It does not infer anything about the person: no
 * personality, no health, no relationships beyond the words in front of it,
 * and no judgement about whether a life is well documented.
 *
 * The distinction matters more than it looks. "You have not talked about your
 * father" is an inference about a life. "You said 'he told us to leave' and
 * never said who" is a fact about a sentence. Only the second is here.
 */

export type GapKind =
  | 'unresolved_person'
  | 'missing_date'
  | 'missing_place'
  | 'conflicting_timeline'
  | 'unfinished_story'
  | 'thin_relationship';

export interface DetectedGap {
  kind: GapKind;
  /** The exact words that produced it. Never a guess at the answer. */
  reference: string;
  memoryId: string | null;
}

/**
 * A pronoun that is doing something *to somebody else*.
 *
 * This is the correction that makes the radar usable on approved memories.
 * `findUnresolvedReferences` was built for the live interview, where the
 * storyteller speaks in the first person and a "he" is therefore always
 * somebody else. Approved memories are written in the *third* person about the
 * subject, so a bare "she taught for thirty-one years" is the subject herself
 * — and asking "who was that?" about the person whose archive it is reads as
 * the software not listening.
 *
 * So a pronoun only becomes a question when it is interacting with the
 * narrator or the family: "he told us", "she gave me", "they came with us".
 * That is the case where the person genuinely is unidentified, and it is the
 * case where knowing who they were actually matters.
 */
const INTERACTION =
  /\b(?:he|she|they)\b[^.!?]{0,40}\b(?:told|said to|gave|sent|took|brought|showed|taught|wrote to|came with|went with|left)\b[^.!?]{0,20}\b(?:us|me|my|our|the family)\b/i;

/**
 * Whether a named relation is answered in the sentence that raises it.
 *
 * "My brother Ramesh taught me to ride a bicycle" mentions a brother and then
 * says who he is, in the next word. Asking "you mentioned 'my brother' — who
 * was that?" about that sentence is the software not reading it, and one of
 * those is worse for trust than ten questions never asked.
 *
 * The check is deliberately literal: the relation, then optionally a comma,
 * then a capitalised word on the same side of any sentence break. It will miss
 * "my brother, who we called Ramesh" — missing a gap costs nothing, and
 * inventing one costs the reader's confidence that anybody is listening.
 */
function isNamedInPlace(text: string, reference: string): boolean {
  // The reference is matched without regard to case — a sentence may open with
  // it — while the name that follows must actually be capitalised. One regex
  // cannot do both, so the reference is located on the lowercased text and the
  // name is read back out of the original.
  const lower = text.toLowerCase();
  for (let from = 0; ;) {
    const at = lower.indexOf(reference, from);
    if (at === -1) return false;
    const rest = text.slice(at + reference.length);
    if (/^,?\s+\p{Lu}\p{L}+/u.test(rest)) return true;
    from = at + reference.length;
  }
}

/** A story referred to and never told: "that is another story", "long story". */
const UNFINISHED =
  /\b(?:that(?:'s| is) another story|another story|long story|too long to tell|some other time|i(?:'ll| will) tell you (?:that )?(?:another|some other) time)\b/i;

/** A place mentioned without a name. */
const VAGUE_PLACE =
  /\b(?:that (?:place|house|town|village|city)|the old (?:place|house)|back (?:there|home)|where we (?:used to )?lived?)\b/i;

export function detectGaps(memories: readonly { id: string; body: string }[]): DetectedGap[] {
  const out: DetectedGap[] = [];
  const seen = new Set<string>();

  const add = (kind: GapKind, reference: string, memoryId: string | null) => {
    const key = `${kind}:${reference.toLowerCase()}`;
    // The same unnamed "he" across four memories is one question, not four.
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ kind, reference, memoryId });
  };

  for (const memory of memories) {
    // Unresolved people and approximate dates, from the same detector the live
    // interviewer uses — so the interview and the radar agree about what is
    // unclear rather than each having their own opinion.
    const interacts = INTERACTION.test(memory.body);
    for (const reference of findUnresolvedReferences(memory.body)) {
      if (reference === 'an approximate date') {
        add('missing_date', reference, memory.id);
        continue;
      }
      // A bare pronoun is only a question when it acted on somebody.
      const isBarePronoun = /^(?:he|she|they|him|her|them)$/i.test(reference);
      if (isBarePronoun && !interacts) continue;
      // A named relation is a question only while it is unnamed.
      if (!isBarePronoun && isNamedInPlace(memory.body, reference)) continue;
      add('unresolved_person', reference, memory.id);
    }

    const unfinished = UNFINISHED.exec(memory.body);
    if (unfinished) add('unfinished_story', unfinished[0], memory.id);

    const place = VAGUE_PLACE.exec(memory.body);
    if (place) add('missing_place', place[0], memory.id);
  }

  return out;
}

/**
 * The question to ask about a gap.
 *
 * Written as an invitation, never as a deficiency. "Who was that?" and not
 * "This memory is incomplete" — the second tells somebody their life is a form
 * with a missing field.
 */
export function promptForGap(gap: DetectedGap): string {
  switch (gap.kind) {
    case 'unresolved_person':
      return `You mentioned “${gap.reference}”. Who was that?`;
    case 'missing_date':
      return 'Roughly when was that? Even the year, or what season it was.';
    case 'missing_place':
      return `You mentioned “${gap.reference}”. Where was it?`;
    case 'unfinished_story':
      return 'You said that was another story. Would you like to tell it?';
    case 'conflicting_timeline':
      return 'Two of these dates do not quite line up. Which one feels right?';
    case 'thin_relationship':
      return `You have mentioned ${gap.reference} a few times. What were they like?`;
  }
}
