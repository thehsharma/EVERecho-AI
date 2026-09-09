/**
 * Prompt-injection isolation.
 *
 * A photograph caption, a scanned letter or a transcript can contain text that
 * reads like an instruction — sometimes maliciously, sometimes because the
 * storyteller genuinely wrote "ignore everything I said before". Both must be
 * treated as *content*: something the person said, never something to obey.
 */

const INJECTION_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  {
    pattern:
      /ignore (?:all |any )?(?:the )?(?:previous|prior|above|earlier) (?:instructions?|prompts?|rules?)/i,
    label: 'override_instructions',
  },
  {
    pattern:
      /disregard (?:all |the )?(?:previous|prior|above|earlier|your) (?:instructions?|rules?|system)/i,
    label: 'override_instructions',
  },
  { pattern: /you are (?:now|actually) (?:a|an|the)\b/i, label: 'role_reassignment' },
  { pattern: /\bsystem prompt\b/i, label: 'system_prompt_probe' },
  {
    pattern:
      /(?:reveal|print|repeat|show) (?:your|the) (?:system )?(?:prompt|instructions?|rules?)/i,
    label: 'system_prompt_probe',
  },
  { pattern: /\bpretend (?:to be|you are)\b/i, label: 'persona_request' },
  {
    pattern:
      /\b(?:speak|answer|respond|reply|talk) as (?:if you (?:are|were) )?(?:me|him|her|them|dad|mum|mom|grandma|grandpa)\b/i,
    label: 'persona_request',
  },
  { pattern: /\bin (?:my|his|her|their) (?:own )?voice\b/i, label: 'persona_request' },
  { pattern: /\bfirst person\b/i, label: 'persona_request' },
  { pattern: /\bwithout (?:citations?|sources?|evidence)\b/i, label: 'evidence_bypass' },
  {
    pattern: /\b(?:make (?:it |something )?up|guess|invent|imagine what)\b/i,
    label: 'fabrication_request',
  },
  { pattern: /\bdeveloper mode\b|\bjailbreak\b|\bDAN\b/i, label: 'jailbreak' },
  { pattern: /<\/?(?:system|assistant|user|instructions?)>/i, label: 'delimiter_injection' },
];

export interface InjectionFinding {
  label: string;
  excerptHash: string;
}

export function detectInjection(text: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { pattern, label } of INJECTION_PATTERNS) {
    if (pattern.test(text) && !findings.some((f) => f.label === label)) {
      // The matched text is memory content and is never logged; only a label.
      findings.push({ label, excerptHash: String(text.length) });
    }
  }
  return findings;
}

/**
 * Wraps evidence for a hosted model so it can never be mistaken for
 * instructions: delimiters that appear in the content are neutralised, and each
 * passage is labelled with the id the model must cite.
 */
export function isolateEvidence(passages: readonly { id: string; text: string }[]): string {
  return passages
    .map(({ id, text }) => {
      const neutralised = text
        .replace(/[<>]/g, (c) => (c === '<' ? '‹' : '›'))
        .replace(/```/g, "'''");
      return `<<<EVIDENCE id="${id}">>>\n${neutralised}\n<<<END id="${id}">>>`;
    })
    .join('\n\n');
}

/**
 * Requests the product refuses outright, regardless of who is asking. These are
 * detected before retrieval, so a prohibited request never causes evidence to
 * be loaded at all.
 */
const PROHIBITED_REQUEST_PATTERNS: readonly RegExp[] = [
  /\b(?:speak|talk|answer|respond|write|reply) (?:to me )?as (?:if you (?:are|were) )?(?:my |his |her |their )?(?:mum|mom|dad|father|mother|grandma|grandpa|granddad|grandmother|grandfather|him|her|them)\b/i,
  /\bpretend (?:to be|you are|you're)\b/i,
  /\bin (?:his|her|their|my) (?:own )?voice\b/i,
  /\b(?:clone|copy|synthesise|synthesize|recreate|generate) (?:his|her|their|my|the) (?:voice|face|likeness)\b/i,
  // The conditional is what makes it a fabrication request, so it is enough on
  // its own: "what would she say to me now" and "what would she think about
  // this" both ask for a sentence she never said. Deliberately not matching
  // "what *did* she say about the move", which is the legitimate question this
  // product exists to answer.
  /\bwhat would (?:he|she|they) (?:say|think|do|feel|want|make of)\b/i,
  /\bbe (?:my|his|her|their) (?:mum|mom|dad|grandma|grandpa)\b/i,
  /\btalk to (?:him|her|them) again\b/i,
  /\bbring (?:him|her|them) back\b/i,
];

export function isProhibitedRequest(question: string): boolean {
  return PROHIBITED_REQUEST_PATTERNS.some((p) => p.test(question));
}

/**
 * The refusal a family member sees when they ask for the thing this product
 * will not do.
 *
 * Re-exported from `refusal.ts` rather than written twice. There were two
 * copies of this text — one here for the written and spoken paths, one in the
 * memorial-mode route — and two copies of the most important sentence in the
 * product is exactly how the two paths end up saying different things to the
 * same grieving person.
 */
export { PERSONA_REFUSAL as PROHIBITED_REQUEST_MESSAGE } from './refusal';
