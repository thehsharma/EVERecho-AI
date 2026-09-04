import type { EvidencePassage } from '../verify';

export interface CandidateClaim {
  text: string;
  transcriptSegmentId: string | null;
  locator: Record<string, unknown>;
  quotedText: string;
  confidence: number;
}

export interface CandidateMemory {
  title: string;
  body: string;
  claims: CandidateClaim[];
  topics: string[];
  occurredOn: { value: string; precision: 'day' | 'month' | 'year' | 'decade' | 'unknown' } | null;
  entityNames: string[];
  placeName: string | null;
}

export interface ExtractionInput {
  segments: readonly {
    id: string;
    idx: number;
    text: string;
    startMs: number | null;
    endMs: number | null;
    page: number | null;
  }[];
  sourceId: string;
  sourceKind: string;
}

export interface ExtractionOutput {
  memories: CandidateMemory[];
  /** Names referred to but never resolved ("he", "my sister") — good follow-ups. */
  unresolvedReferences: string[];
}

export interface AnswerInput {
  question: string;
  passages: readonly EvidencePassage[];
  subjectName: string;
}

export interface AnswerOutput {
  claims: { text: string; evidenceIds: string[] }[];
  /** Set when the adapter itself declines to answer. */
  abstain: boolean;
}

export interface BiographyInput {
  subjectName: string;
  memories: readonly {
    id: string;
    title: string;
    body: string;
    occurredOn: string | null;
    topics: string[];
    sourceIds: string[];
    claimIds: string[];
  }[];
}

export interface BiographySection {
  id: string;
  heading: string;
  text: string;
  sourceIds: string[];
  claimIds: string[];
}

export interface QuestionInput {
  coveredTopics: readonly string[];
  lastResponseText: string | null;
  restrictedTopics: readonly string[];
  askedQuestions: readonly string[];
}

export interface QuestionOutput {
  topic: string;
  questionText: string;
  sensitivityNotice: string | null;
}

/**
 * Task-shaped rather than a raw text-completion interface.
 *
 * This is deliberate: an adapter that only exposes `complete(prompt)` forces
 * every caller to invent its own parsing and its own guardrails. Naming the
 * tasks lets the local adapter implement them honestly without a language
 * model, and lets a hosted adapter own its own prompt and its own output
 * validation in one place.
 */
export interface LlmAdapter {
  readonly name: string;
  readonly modelVersion: string;
  /** True when output is derived from the source text rather than generated. */
  readonly extractive: boolean;
  extractCandidates(input: ExtractionInput): Promise<ExtractionOutput>;
  composeAnswer(input: AnswerInput): Promise<AnswerOutput>;
  composeBiography(input: BiographyInput): Promise<BiographySection[]>;
  nextQuestion(input: QuestionInput): Promise<QuestionOutput>;
  summariseSession(input: { responses: readonly string[]; subjectName: string }): Promise<string>;
}
