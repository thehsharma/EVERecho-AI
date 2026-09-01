import type { EvidencePassage } from '../verify';

/**
 * Streaming provider boundaries.
 *
 * Every one of these has a deterministic local implementation, so the whole
 * real-time conversation runs with no paid credentials and no network. The
 * local implementations exercise the same domain, authorisation, audit and
 * provenance paths as the hosted ones — they are not a happy path around them.
 */

export interface StreamCapabilities {
  readonly name: string;
  readonly version: string;
  /** Whether material leaves the deployment. Feeds the consent provider gate. */
  readonly sendsDataOffHost: boolean;
  readonly retentionDays: number;
  readonly permitsModelTraining: boolean;
  readonly languages: readonly string[];
  readonly supportsCancellation: boolean;
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export type SttEvent =
  | { type: 'partial'; text: string; language: string | null; offsetMs: number }
  | {
      type: 'final';
      text: string;
      language: string | null;
      offsetMs: number;
      confidence: number;
      /** True when the text was not produced by actual speech recognition. */
      synthetic: boolean;
    }
  | { type: 'error'; code: string; message: string };

/**
 * A live transcription stream.
 *
 * `push` accepts audio; `events` yields partials and finals as they arrive.
 * `close` ends the stream cleanly; `cancel` abandons it, which must stop the
 * provider from charging for work nobody will read.
 */
export interface SttStream {
  push(input: { audio: Uint8Array; sampleRate: number; offsetMs: number }): Promise<void>;
  /** Signals that the speaker has stopped, so a final may be emitted. */
  flush(): Promise<void>;
  events(): AsyncIterableIterator<SttEvent>;
  close(): Promise<void>;
  cancel(reason: string): Promise<void>;
}

export interface StreamingSpeechToText {
  readonly capabilities: StreamCapabilities;
  open(input: {
    sessionId: string;
    /** 'auto' asks the provider to detect; anything else pins it. */
    language: string;
    sampleRate: number;
    /**
     * Text captured by the browser's own recogniser alongside the audio. Real
     * content, not a fabrication — and the only way the local adapter can
     * produce a transcript at all.
     */
    sidecarText?: string | null;
  }): Promise<SttStream>;
}

// ---------------------------------------------------------------------------
// Language model
// ---------------------------------------------------------------------------

/**
 * The tool surface offered to the model.
 *
 * Deliberately tiny. The model may request these; it never executes an archive
 * operation itself, and it never receives a generic database, shell, HTTP or
 * code-execution tool. Identifiers in tool input are treated as untrusted:
 * actor, archive and session always come from the server.
 */
export type AssistantToolName =
  | 'search_authorised_archive'
  | 'inspect_authorised_source'
  | 'list_approved_people_places_events'
  | 'propose_memory_candidate'
  | 'propose_clarifying_question'
  | 'report_contradiction'
  | 'record_low_risk_preference_candidate'
  | 'abstain'
  | 'end_session_summary';

export interface ToolRequest {
  id: string;
  name: AssistantToolName;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  name: AssistantToolName;
  output: unknown;
  isError?: boolean;
}

export type LlmStreamEvent =
  /** A whole clause, never a raw token: unverified text is never emitted. */
  | { type: 'clause'; index: number; text: string; evidenceIds: string[] }
  | { type: 'tool_request'; request: ToolRequest }
  | { type: 'abstain'; reason: string }
  | { type: 'done'; inputTokens: number; outputTokens: number }
  | { type: 'error'; code: string; message: string };

export interface LlmStream {
  events(): AsyncIterableIterator<LlmStreamEvent>;
  /** Supplies a tool result and lets generation continue. */
  provideToolResult(result: ToolResult): Promise<void>;
  /** Stops generation. Must prevent any further clause being emitted. */
  cancel(reason: string): Promise<void>;
}

export interface StreamingConversationInput {
  sessionId: string;
  mode: 'interview' | 'assistant';
  subjectName: string;
  /** Only evidence the reader is permitted to see ever reaches this. */
  passages: readonly EvidencePassage[];
  /** Prior turns in this session, for follow-ups and pronouns. */
  history: readonly { speaker: 'user' | 'assistant'; text: string }[];
  userTurn: string;
  language: string;
  restrictedTopics: readonly string[];
  /** Topics already covered, so an interview does not repeat itself. */
  coveredTopics: readonly string[];
  askedQuestions: readonly string[];
}

export interface StreamingLanguageModel {
  readonly capabilities: StreamCapabilities;
  readonly modelVersion: string;
  readonly promptVersion: string;
  /** True when output is derived from source text rather than generated. */
  readonly extractive: boolean;
  converse(input: StreamingConversationInput): Promise<LlmStream>;
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

export interface TtsChunk {
  audio: Uint8Array;
  sampleRate: number;
  durationMs: number;
}

export interface TtsStream {
  /**
   * Synthesises one verified clause.
   *
   * Clause by clause on purpose: speech cannot be retracted, so nothing is
   * spoken until its citation has been checked. A sentence that appears in
   * text for 200 ms and is then removed is a glitch; the same sentence spoken
   * aloud is something a family member heard.
   */
  speak(text: string): AsyncIterableIterator<TtsChunk>;
  cancel(reason: string): Promise<void>;
  close(): Promise<void>;
}

export interface StreamingTextToSpeech {
  readonly capabilities: StreamCapabilities;
  /**
   * The voice identifier, recorded on every generated turn so that "we never
   * use the storyteller's voice" is auditable against a known allow-list
   * rather than merely asserted.
   */
  readonly voiceId: string;
  open(input: { sessionId: string; language: string; sampleRate: number }): Promise<TtsStream>;
}

/**
 * Voices this product will ever use.
 *
 * A generic, licensed, obviously-synthetic assistant voice. Any identifier
 * outside this list is refused at session creation, which is what stops a
 * cloned voice being introduced by configuration rather than by code.
 */
export const PERMITTED_VOICE_PREFIXES = ['local-neutral-', 'generic-', 'assistant-'] as const;

export function isPermittedVoice(voiceId: string): boolean {
  return PERMITTED_VOICE_PREFIXES.some((prefix) => voiceId.startsWith(prefix));
}
