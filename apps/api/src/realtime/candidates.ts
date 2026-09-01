import {
  contentTokens,
  coverage,
  detectContradiction,
  extractProperNouns,
  extractYears,
  findUnresolvedReferences,
  splitSentences,
  truncate,
} from '@everecho/ai';
import { candidateRequiresReview, type LearningObligations } from '@everecho/consent';
import type { Transaction } from '@everecho/db';
import { recordLearningDecision } from '@everecho/db';

export const EXTRACTOR_NAME = 'local-conversation-extractor';
export const EXTRACTOR_VERSION = 'v1';
export const EXTRACTION_PROMPT_VERSION = 'realtime-extract-2026-01';

/**
 * Words that make a sentence a question or an aside rather than a statement
 * about the storyteller's life.
 */
const NOT_A_MEMORY =
  /^(?:and|but|so|well|um|uh|hmm|yes|no|okay|right|maybe|perhaps|i think|i guess)\b/i;

/**
 * Categories that put a candidate beyond automatic anything.
 *
 * Detected conservatively and on purpose: a false positive costs one extra
 * review, and a false negative puts somebody's health or beliefs into an
 * archive without them being asked.
 */
const SENSITIVE_MARKERS: Record<string, RegExp> = {
  health:
    /\b(?:cancer|diagnos\w*|hospital|surgery|illness|depress\w*|medication|tumour|tumor|stroke|dementia|alzheimer\w*)\b/i,
  financial: /\b(?:salary|debt|loan|mortgage|inheritance|bankrupt\w*|money|rupees|dowry)\b/i,
  religious: /\b(?:temple|church|mosque|gurudwara|prayer|god|faith|puja|namaz|baptis\w*)\b/i,
  political: /\b(?:congress|bjp|election|vote[ds]?|party|partition|riot|protest|communal)\b/i,
  sexual_orientation: /\b(?:gay|lesbian|queer|homosexual|bisexual)\b/i,
};

export interface ExtractedCandidate {
  kind: 'memory' | 'unresolved_reference';
  title: string;
  body: string;
  topics: string[];
  entityNames: string[];
  placeName: string | null;
  occurredOn: { value: string; precision: 'year' | 'decade' | 'unknown' } | null;
  dataCategories: string[];
  sensitivity: 'normal' | 'sensitive' | 'restricted';
  confidence: number;
  quotedText: string;
  firstHand: boolean;
}

/**
 * Phrases that mark reported speech.
 *
 * "My mother told me we left in 1962" is not the storyteller remembering
 * leaving in 1962 — it is them remembering being told. Conflating the two is
 * how family history acquires false first-hand testimony, and it is
 * unrecoverable once the person who could correct it is gone.
 */
const HEARSAY = /\b(?:told me|used to say|said that|according to|i heard|they say|apparently)\b/i;

/**
 * Extracts candidates from one final user turn.
 *
 * Deliberately conservative. Everything it produces is a *proposal* carrying
 * its own provenance, and nothing here can approve anything.
 */
export function extractCandidates(input: {
  text: string;
  allowedCategories: readonly string[];
}): ExtractedCandidate[] {
  const out: ExtractedCandidate[] = [];
  const sentences = splitSentences(input.text).filter((s) => s.trim().length >= 20);

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (NOT_A_MEMORY.test(trimmed)) continue;
    if (contentTokens(trimmed).length < 4) continue;

    const categories = detectCategories(trimmed);
    // A category the storyteller has not permitted the archive to hold is
    // dropped entirely rather than stored and filtered later.
    const permitted = categories.filter((c) => input.allowedCategories.includes(c));
    if (categories.length > 0 && permitted.length === 0) continue;

    const years = extractYears(trimmed);
    const nouns = extractProperNouns(trimmed);
    const sensitive = categories.some((c) => c !== 'text');

    out.push({
      kind: 'memory',
      title: truncate(trimmed, 90),
      body: trimmed,
      topics: contentTokens(trimmed).slice(0, 8),
      entityNames: nouns.slice(0, 8),
      placeName: null,
      occurredOn: years.length > 0 ? { value: String(years[0]), precision: 'year' } : null,
      dataCategories: permitted.length > 0 ? permitted : ['text'],
      sensitivity: sensitive ? 'sensitive' : 'normal',
      // Confidence reflects how much of the sentence is substantive, not how
      // true it is. Nothing here judges truth.
      confidence: Math.min(0.9, 0.4 + contentTokens(trimmed).length / 40),
      quotedText: trimmed,
      firstHand: !HEARSAY.test(trimmed),
    });
  }

  for (const reference of findUnresolvedReferences(input.text)) {
    out.push({
      kind: 'unresolved_reference',
      title: `Unresolved: ${reference}`,
      body: `The conversation referred to "${reference}" without naming who or when.`,
      topics: [],
      entityNames: [],
      placeName: null,
      occurredOn: null,
      dataCategories: ['text'],
      sensitivity: 'normal',
      confidence: 0.5,
      quotedText: truncate(input.text, 240),
      firstHand: true,
    });
  }

  return out;
}

function detectCategories(text: string): string[] {
  const found: string[] = [];
  for (const [category, pattern] of Object.entries(SENSITIVE_MARKERS)) {
    if (pattern.test(text)) found.push(category);
  }
  return found;
}

export interface StoredCandidate {
  id: string;
  title: string;
  kind: string;
  requiresReview: boolean;
  duplicateOfMemoryId: string | null;
  contradictsMemoryIds: string[];
}

/**
 * Stores candidates, after deduplication and contradiction checking.
 *
 * Contradictions are surfaced, never resolved: two recordings disagreeing
 * about a date is a fact about the archive, and silently picking one would be
 * the system deciding what is true about somebody's life.
 */
export async function storeCandidates(
  tx: Transaction,
  input: {
    archiveId: string;
    sessionId: string;
    turnId: string;
    candidates: readonly ExtractedCandidate[];
    obligations: LearningObligations;
    learningPolicyId: string | null;
    consentPolicyVersion: string;
  },
): Promise<StoredCandidate[]> {
  if (input.candidates.length === 0) return [];

  // Approved memories to check against. Titles and bodies only — this is the
  // storyteller's own archive and the comparison happens inside their scope.
  const existing = await tx.query<{ id: string; title: string; body: string }>(
    `SELECT id, title, body FROM memory
      WHERE archive_id = $1 AND deleted_at IS NULL AND status IN ('approved','pending_review')`,
    [input.archiveId],
  );

  const pending = await tx.query<{ id: string; title: string; body: string }>(
    `SELECT id, title, body FROM memory_candidate
      WHERE archive_id = $1 AND status = 'pending' AND deleted_at IS NULL`,
    [input.archiveId],
  );

  const stored: StoredCandidate[] = [];

  for (const candidate of input.candidates) {
    const duplicateMemory = findDuplicate(candidate.body, existing);
    const duplicateCandidate = findDuplicate(candidate.body, pending);

    const candidateYears = extractYears(candidate.body);
    const contradictions = existing
      .filter(
        (m) =>
          detectContradiction(
            { text: candidate.body, years: candidateYears },
            { text: m.body, years: extractYears(m.body) },
          ) !== null,
      )
      .map((m) => m.id);

    const requiresReview = candidateRequiresReview({
      kind: candidate.kind,
      sensitivity: candidate.sensitivity,
      dataCategories: candidate.dataCategories,
      obligations: input.obligations,
    });

    const row = await tx.one<{ id: string }>(
      `INSERT INTO memory_candidate
         (archive_id, session_id, kind, title, body, occurred_on_value, occurred_on_precision,
          topics, entity_names, place_name, data_categories, sensitivity, evidence_class,
          confidence, duplicate_of_memory_id, duplicate_of_candidate_id, contradicts_memory_ids,
          extractor_name, extractor_version, prompt_version, requires_storyteller_review)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        input.archiveId,
        input.sessionId,
        candidate.kind,
        candidate.title,
        candidate.body,
        candidate.occurredOn?.value ?? null,
        candidate.occurredOn?.precision ?? null,
        candidate.topics,
        candidate.entityNames,
        candidate.placeName,
        candidate.dataCategories,
        candidate.sensitivity,
        // Reported speech is corroboration at best, never a direct statement.
        candidate.firstHand ? 'P1_DIRECT_STATEMENT' : 'P3_SUPPORTED_SYNTHESIS',
        candidate.confidence,
        duplicateMemory,
        duplicateCandidate,
        contradictions,
        EXTRACTOR_NAME,
        EXTRACTOR_VERSION,
        EXTRACTION_PROMPT_VERSION,
        requiresReview,
      ],
    );

    // The evidence link. The database trigger refuses this if the turn is not
    // final and uncancelled, so a partial transcript cannot become a source.
    await tx.query(
      `INSERT INTO memory_candidate_evidence
         (archive_id, candidate_id, turn_id, locator, quoted_text, first_hand, speaker_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        input.archiveId,
        row.id,
        input.turnId,
        JSON.stringify({ kind: 'text_range', startChar: 0, endChar: candidate.quotedText.length }),
        candidate.quotedText,
        candidate.firstHand,
        candidate.firstHand ? 'storyteller' : 'reported',
      ],
    );

    if (duplicateMemory || duplicateCandidate) {
      await recordLearningDecision(tx, {
        archiveId: input.archiveId,
        candidateId: row.id,
        sessionId: input.sessionId,
        decision: 'deduplicated',
        decidedBy: 'system',
        learningPolicyId: input.learningPolicyId,
        consentPolicyVersion: input.consentPolicyVersion,
        note: 'Restates existing material; shown to the storyteller as a duplicate.',
      });
    }

    stored.push({
      id: row.id,
      title: candidate.title,
      kind: candidate.kind,
      requiresReview,
      duplicateOfMemoryId: duplicateMemory,
      contradictsMemoryIds: contradictions,
    });
  }

  return stored;
}

/**
 * Near-duplicate detection by content-word coverage in both directions.
 *
 * Symmetric on purpose: a candidate that merely repeats part of a long memory
 * is not a duplicate of it, and a long candidate containing a short memory is
 * not one either.
 */
function findDuplicate(
  body: string,
  existing: readonly { id: string; body: string; title: string }[],
): string | null {
  for (const item of existing) {
    const forward = coverage(body, item.body);
    const backward = coverage(item.body, body);
    if (forward >= 0.85 && backward >= 0.85) return item.id;
  }
  return null;
}
