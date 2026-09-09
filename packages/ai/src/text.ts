/** Text utilities shared by extraction, retrieval, composition and verification. */

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'than',
  'so',
  'because',
  'as',
  'of',
  'at',
  'by',
  'for',
  'with',
  'about',
  'into',
  'through',
  'during',
  'to',
  'from',
  'in',
  'on',
  'off',
  'over',
  'under',
  'again',
  'further',
  'once',
  'is',
  'am',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'doing',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'him',
  'his',
  'she',
  'her',
  'it',
  'its',
  'they',
  'them',
  'their',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
  'when',
  'where',
  'why',
  'how',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'no',
  'nor',
  'not',
  'only',
  'own',
  'same',
  'too',
  'very',
  'can',
  'will',
  'just',
  'would',
  'could',
  'should',
  'there',
  'here',
  'also',
  'did',
  'were',
  'has',
]);

export function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[-']+|[-']+$/g, ''))
    .filter((t) => t.length > 1);
}

/**
 * Conservative suffix stripping so "moved" matches "move".
 *
 * Without this, a family member asking "where did they move to?" gets no
 * answer from a recording that says "we moved to Pune" — which is exactly the
 * kind of silent retrieval failure that reads as the archive being empty.
 * Deliberately mild: over-stemming collapses distinct words and produces
 * confident wrong matches, which is the worse failure here.
 */
/**
 * Irregular forms no suffix rule can reach. Small and deliberately common:
 * without "taught -> teach", asking how long someone taught finds nothing in a
 * recording that says "I taught for thirty-one years".
 */
const IRREGULAR: Record<string, string> = {
  taught: 'teach',
  thought: 'think',
  bought: 'buy',
  brought: 'bring',
  caught: 'catch',
  sought: 'seek',
  fought: 'fight',
  told: 'tell',
  sold: 'sell',
  held: 'hold',
  left: 'leave',
  felt: 'feel',
  kept: 'keep',
  slept: 'sleep',
  met: 'meet',
  built: 'build',
  sent: 'send',
  spent: 'spend',
  lost: 'lose',
  found: 'find',
  gave: 'give',
  given: 'give',
  took: 'take',
  taken: 'take',
  went: 'go',
  gone: 'go',
  came: 'come',
  ran: 'run',
  wrote: 'write',
  written: 'write',
  spoke: 'speak',
  spoken: 'speak',
  knew: 'know',
  known: 'know',
  grew: 'grow',
  grown: 'grow',
  began: 'begin',
  begun: 'begin',
  children: 'child',
  people: 'person',
  women: 'woman',
  men: 'man',
  wives: 'wife',
  lives: 'life',
};

export function stem(token: string): string {
  const irregular = IRREGULAR[token];
  if (irregular) return irregular;
  if (token.length <= 3) return token;

  let base = token;
  if (base.endsWith('ies') && base.length > 4) base = `${base.slice(0, -3)}y`;
  else if (base.endsWith('ied') && base.length > 4) base = `${base.slice(0, -3)}y`;
  else if (base.endsWith('ing') && base.length > 5) base = base.slice(0, -3);
  else if (base.endsWith('ed') && base.length > 4) base = base.slice(0, -2);
  else if (/(?:sses|shes|ches|xes|zes)$/.test(base)) base = base.slice(0, -2);
  else if (base.endsWith('s') && !base.endsWith('ss') && base.length > 3) base = base.slice(0, -1);

  // "moved" strips to "mov" while "move" would stay "move", so the two forms
  // would never match. Dropping a trailing silent "e" makes them converge.
  if (base.endsWith('e') && base.length > 3) base = base.slice(0, -1);
  return base;
}

export function contentTokens(text: string): string[] {
  return tokenise(text)
    .filter((t) => !STOP_WORDS.has(t))
    .map(stem);
}

/**
 * Sentence splitting that survives the way people actually write: initials,
 * common abbreviations, decimals, and ellipses do not end a sentence.
 */
export function splitSentences(text: string): string[] {
  const protectedText = text
    .replace(/\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|approx|no)\./gi, '$1<DOT>')
    .replace(/\b([A-Z])\./g, '$1<DOT>')
    .replace(/(\d)\.(\d)/g, '$1<DOT>$2')
    .replace(/\.\.\./g, '<ELLIPSIS>');

  return protectedText
    .split(/(?<=[.!?])\s+(?=[A-Z"'(‘“])/)
    .map((s) =>
      s
        .replace(/<DOT>/g, '.')
        .replace(/<ELLIPSIS>/g, '...')
        .trim(),
    )
    .filter((s) => s.length > 0);
}

/** Jaccard overlap of content words: cheap, explainable, good enough to verify. */
export function tokenOverlap(a: string, b: string): number {
  const setA = new Set(contentTokens(a));
  const setB = new Set(contentTokens(b));
  if (setA.size === 0 || setB.size === 0) return 0;
  let shared = 0;
  for (const t of setA) if (setB.has(t)) shared += 1;
  return shared / Math.min(setA.size, setB.size);
}

/** How many distinct content words two texts have in common. */
export function sharedTokenCount(a: string, b: string): number {
  const setB = new Set(contentTokens(b));
  let shared = 0;
  for (const token of new Set(contentTokens(a))) if (setB.has(token)) shared += 1;
  return shared;
}

/** Proportion of `claim`'s content words that appear in `evidence`. */
export function coverage(claim: string, evidence: string): number {
  const claimTokens = contentTokens(claim);
  if (claimTokens.length === 0) return 0;
  const evidenceTokens = new Set(contentTokens(evidence));
  const covered = claimTokens.filter((t) => evidenceTokens.has(t)).length;
  return covered / claimTokens.length;
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > maxChars * 0.6 ? lastSpace : maxChars).trimEnd()}…`;
}

/** Years mentioned in text, used for dating events and detecting date conflicts. */
export function extractYears(text: string): number[] {
  const years = [...text.matchAll(/\b(1[89]\d{2}|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  return [...new Set(years)].sort();
}

const DECADE_PATTERN = /\b(?:the\s+)?(1[89]\d0|20[0-4]0)s\b/gi;

export function extractDecades(text: string): number[] {
  return [...new Set([...text.matchAll(DECADE_PATTERN)].map((m) => Number(m[1])))].sort();
}

/**
 * Capitalised multi-word spans that look like names of people or places.
 * Deliberately conservative: a missed name costs a suggestion, an invented one
 * costs trust.
 */
export function extractProperNouns(text: string): string[] {
  const found = new Set<string>();
  for (const sentence of splitSentences(text)) {
    const words = sentence.split(/\s+/);
    let run: string[] = [];
    words.forEach((word, index) => {
      const clean = word.replace(/[^\p{L}\p{N}'-]/gu, '');
      const isCapitalised = /^\p{Lu}/u.test(clean) && clean.length > 1;
      // The first word of a sentence is capitalised by grammar, not by being a name.
      if (isCapitalised && !(index === 0 && run.length === 0)) {
        run.push(clean);
      } else {
        if (run.length > 0) found.add(run.join(' '));
        run = [];
      }
    });
    if (run.length > 0) found.add(run.join(' '));
  }
  return [...found].filter((n) => n.length > 2);
}

/** Stable hash for deduplication and snapshot identity. Not a security hash. */
export function stableHash(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).padStart(16, '0');
}
