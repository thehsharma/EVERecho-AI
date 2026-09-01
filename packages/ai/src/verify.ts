import type { EvidenceClass } from '@everecho/contracts';
import {
  coverage,
  extractProperNouns,
  sharedTokenCount,
  splitSentences,
  tokenOverlap,
} from './text';

export interface EvidencePassage {
  id: string;
  text: string;
  sourceId: string;
  memoryId?: string | null;
  transcriptSegmentId?: string | null;
  locator: Record<string, unknown>;
}

export interface DraftClaim {
  text: string;
  evidenceIds: string[];
}

export interface VerifiedClaim extends DraftClaim {
  verified: boolean;
  evidenceClass: EvidenceClass;
  confidence: number;
  /** Why this claim was rejected, when it was. */
  rejection: string | null;
}

/**
 * A claim is only allowed through if the words it uses are actually present in
 * the evidence it cites. This is what stops a fluent restatement from drifting
 * into a fabrication: "he studied medicine in Delhi" fails when the evidence
 * only ever says "he studied in Delhi".
 */
export const VERIFICATION_THRESHOLDS = {
  /** Content-word coverage required for a claim to count as supported. */
  minCoverage: 0.7,
  /** Coverage above which a single source counts as a direct statement. */
  directStatement: 0.92,
  /** Overlap between two sources for a claim to count as corroborated. */
  corroboration: 0.5,
} as const;

export function verifyClaim(
  claim: DraftClaim,
  passages: readonly EvidencePassage[],
): VerifiedClaim {
  const cited = passages.filter((p) => claim.evidenceIds.includes(p.id));

  if (cited.length === 0) {
    return {
      ...claim,
      verified: false,
      evidenceClass: 'P3_SUPPORTED_SYNTHESIS',
      confidence: 0,
      rejection: 'no_citation',
    };
  }

  // Best single passage, and best coverage achievable from all cited passages
  // together (a claim may legitimately draw on two sentences of one recording).
  const perPassage = cited.map((p) => coverage(claim.text, p.text));
  const best = Math.max(...perPassage);
  const combined = coverage(claim.text, cited.map((p) => p.text).join(' '));
  const effective = Math.max(best, combined);

  if (effective < VERIFICATION_THRESHOLDS.minCoverage) {
    return {
      ...claim,
      verified: false,
      evidenceClass: 'P3_SUPPORTED_SYNTHESIS',
      confidence: Number(effective.toFixed(3)),
      rejection: 'unsupported_by_cited_evidence',
    };
  }

  const distinctSources = new Set(cited.map((p) => p.sourceId));
  const corroborated =
    distinctSources.size > 1 &&
    cited.some((a, i) =>
      cited
        .slice(i + 1)
        .some(
          (b) =>
            a.sourceId !== b.sourceId &&
            tokenOverlap(a.text, b.text) >= VERIFICATION_THRESHOLDS.corroboration,
        ),
    );

  const evidenceClass: EvidenceClass = corroborated
    ? 'P2_CORROBORATED_FACT'
    : best >= VERIFICATION_THRESHOLDS.directStatement
      ? 'P1_DIRECT_STATEMENT'
      : 'P3_SUPPORTED_SYNTHESIS';

  return {
    ...claim,
    verified: true,
    evidenceClass,
    confidence: Number(Math.min(1, effective).toFixed(3)),
    rejection: null,
  };
}

/** First-person composition about the storyteller is prohibited, so it is detected. */
const FIRST_PERSON = /\b(?:I|I'm|I've|I'll|I'd|me|my|mine|myself|we|our|us)\b/;

export function isFirstPerson(text: string): boolean {
  // Quoted speech is the storyteller's own words and is allowed to say "I".
  const outsideQuotes = text.replace(/[“"'’]([^“”"']*)[”"'’]/g, ' ');
  return FIRST_PERSON.test(outsideQuotes);
}

export class FirstPersonCompositionError extends Error {
  constructor(readonly offending: string) {
    super('Refusing to compose in the first person about the storyteller');
    this.name = 'FirstPersonCompositionError';
  }
}

/**
 * Guards every composed sentence. This is the technical expression of "EverEcho
 * is not a griefbot": the system will not produce text that reads as the person
 * speaking, even if a model tries to.
 */
export function assertThirdPerson(text: string): void {
  for (const sentence of splitSentences(text)) {
    if (isFirstPerson(sentence)) throw new FirstPersonCompositionError(sentence);
  }
}

export interface ContradictionFinding {
  kind: 'date_conflict' | 'place_conflict' | 'fact_conflict' | 'relationship_conflict';
  detail: string;
}

/**
 * Detects claims that cannot both be true. Conservative on purpose: a false
 * contradiction sends the storyteller to review something that was fine, which
 * costs their patience — the scarcest resource in this product.
 */
export function detectContradiction(
  a: { text: string; years: number[] },
  b: { text: string; years: number[] },
): ContradictionFinding | null {
  /**
   * Two accounts of one event rarely share half their words — "we moved to
   * Pune in 1962 because my father took a job on the railways" and "we moved
   * to Pune in 1968, when his work brought him there" overlap by less than a
   * third. What they do share is an anchor: the same place name.
   *
   * So the test is: at least two content words in common — one shared place
   * name is not two accounts of one event, it is two events in one town — plus
   * either a shared proper noun or substantial overlap.
   *
   * A contradiction is surfaced for the storyteller to judge and is never acted
   * on, so a false positive costs a moment of their attention while a miss
   * costs the archive its accuracy.
   */
  const overlap = tokenOverlap(a.text, b.text);
  const shared = sharedTokenCount(a.text, b.text);
  const nounsA = new Set(extractProperNouns(a.text).map((n) => n.toLowerCase()));
  const sharedAnchor = extractProperNouns(b.text).some((n) => nounsA.has(n.toLowerCase()));
  const sameSubject = shared >= 2 && (overlap >= 0.5 || sharedAnchor);
  if (!sameSubject) return null;

  const yearsDiffer =
    a.years.length > 0 &&
    b.years.length > 0 &&
    !a.years.some((y) => b.years.includes(y)) &&
    Math.min(...a.years.map((y) => Math.min(...b.years.map((z) => Math.abs(y - z))))) > 1;

  if (yearsDiffer) {
    return {
      kind: 'date_conflict',
      detail: `One account gives ${a.years.join(', ')}; another gives ${b.years.join(', ')}.`,
    };
  }
  return null;
}
