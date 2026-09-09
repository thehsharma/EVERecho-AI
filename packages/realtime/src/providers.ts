/**
 * Provider boundaries for the real-time media plane.
 *
 * Every interface here has a deterministic local implementation, so the whole
 * conversation runs with no paid credentials and no network. A transport
 * provider is an adapter and never an authority: nothing in this file decides
 * consent, retrieval or persistence.
 */

export interface ProviderCapabilities {
  readonly name: string;
  readonly version: string;
  /** Whether material leaves the deployment. Feeds the consent provider gate. */
  readonly sendsDataOffHost: boolean;
  /** Provider-side retention in days, as configured. Only 0 is permitted. */
  readonly retentionDays: number;
  /** Whether the provider's terms permit training on submitted material. */
  readonly permitsModelTraining: boolean;
  readonly languages: readonly string[];
  readonly supportsStreaming: boolean;
  readonly supportsCancellation: boolean;
}

export type ProviderHealth =
  | { status: 'ok' }
  | { status: 'degraded'; detail: string }
  | { status: 'unavailable'; detail: string };

/** Cost is reported per operation and never carries content. */
export interface UsageReport {
  sttSeconds?: number;
  ttsCharacters?: number;
  llmInputTokens?: number;
  llmOutputTokens?: number;
  transportSeconds?: number;
  estimatedCostMinor?: number;
}

export interface ProviderBase {
  readonly capabilities: ProviderCapabilities;
  health(): Promise<ProviderHealth>;
}

/**
 * Mapped provider failures. `retryable` is deliberately conservative: retrying
 * a half-delivered audio stream produces duplicated speech, which is worse
 * than an honest failure.
 */
export class ProviderError extends Error {
  constructor(
    readonly code:
      | 'unauthenticated'
      | 'rate_limited'
      | 'timeout'
      | 'cancelled'
      | 'unsupported_language'
      | 'payload_too_large'
      | 'provider_unavailable'
      | 'invalid_response',
    message: string,
    readonly retryable: boolean = false,
    readonly provider?: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

// ---------------------------------------------------------------------------
// Audio framing
// ---------------------------------------------------------------------------

export interface AudioFrame {
  /** PCM16 mono. */
  readonly data: Uint8Array;
  readonly sampleRate: number;
  readonly seq: number;
  /** Milliseconds since the session's audio stream began. */
  readonly offsetMs: number;
}

export interface AudioChunkOut {
  readonly data: Uint8Array;
  readonly sampleRate: number;
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// Voice activity and turn detection
// ---------------------------------------------------------------------------

export type VadEvent =
  | { type: 'speech_start'; offsetMs: number }
  | { type: 'speech_end'; offsetMs: number }
  | { type: 'silence'; durationMs: number };

export interface VoiceActivityDetector extends ProviderBase {
  /** Stateful across frames within one session. `reset()` clears it. */
  push(frame: AudioFrame): VadEvent[];
  reset(): void;
}

/**
 * Decides when the user has finished a turn.
 *
 * Separate from voice activity because a pause is not an ending: an
 * eighty-year-old recalling a date may stop for four seconds and continue.
 * Cutting them off there is the single most damaging thing an interviewer can
 * do, human or otherwise.
 */
export interface TurnDetector extends ProviderBase {
  /**
   * @param silenceMs how long the user has been silent
   * @param transcriptSoFar the partial transcript, used to spot a trailing
   *        conjunction or an obviously unfinished clause
   */
  shouldEndTurn(input: {
    silenceMs: number;
    transcriptSoFar: string;
    /** Interviews wait longer than an assistant question does. */
    mode: 'interview' | 'assistant';
  }): { endTurn: boolean; reason: 'silence' | 'explicit' | 'still_speaking' };
  reset(): void;
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface TransportSession {
  readonly sessionId: string;
  send(event: unknown): Promise<void>;
  close(reason: string): Promise<void>;
  readonly closed: boolean;
}

export interface RealtimeTransport extends ProviderBase {
  /**
   * Admission is decided before this is called. A transport implementation
   * never authenticates or authorises: it is handed an already-authorised
   * session or it is not called at all.
   */
  accept(input: {
    sessionId: string;
    onEvent: (event: unknown) => Promise<void>;
    onClose: (reason: string) => Promise<void>;
  }): Promise<TransportSession>;
}

// ---------------------------------------------------------------------------
// Cost metering
// ---------------------------------------------------------------------------

export interface CostMeter {
  /** Estimated minor units (paise, cents) for a unit of provider work. */
  estimate(input: UsageReport): number;
  readonly currency: string;
}

/**
 * A budget that fails closed.
 *
 * When the ceiling is reached the session degrades to text rather than
 * silently continuing to spend, because an unbounded voice session is an
 * unbounded invoice.
 */
export interface BudgetDecision {
  allowed: boolean;
  degradeToText: boolean;
  reason: 'within_budget' | 'session_budget_exhausted' | 'daily_limit' | 'archive_cap';
  remainingMinor: number;
}
