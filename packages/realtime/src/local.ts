import type {
  AudioFrame,
  BudgetDecision,
  CostMeter,
  ProviderCapabilities,
  ProviderHealth,
  TurnDetector,
  UsageReport,
  VadEvent,
  VoiceActivityDetector,
} from './providers';

const LOCAL_CAPS = (name: string): ProviderCapabilities => ({
  name,
  version: 'local-deterministic-v1',
  // Nothing leaves the host, which is why the local path never trips the
  // provider consent gates.
  sendsDataOffHost: false,
  retentionDays: 0,
  permitsModelTraining: false,
  languages: ['en', 'hi', 'hi-Latn'],
  supportsStreaming: true,
  supportsCancellation: true,
});

/**
 * Energy-based voice activity detection over PCM16.
 *
 * Deterministic and honest about what it is: it detects *sound*, not speech.
 * Good enough to drive the state machine and the tests; not a substitute for a
 * real detector on a noisy line, which is why the interface exists.
 */
export class LocalVoiceActivityDetector implements VoiceActivityDetector {
  readonly capabilities = LOCAL_CAPS('local-vad');

  private speaking = false;
  private silenceMs = 0;

  constructor(
    private readonly opts: {
      /** Mean absolute amplitude, 0–32767, above which a frame counts as sound. */
      threshold?: number;
      /** Silence needed before speech is considered ended. */
      hangoverMs?: number;
    } = {},
  ) {}

  async health(): Promise<ProviderHealth> {
    return { status: 'ok' };
  }

  push(frame: AudioFrame): VadEvent[] {
    const threshold = this.opts.threshold ?? 500;
    const hangoverMs = this.opts.hangoverMs ?? 600;
    const events: VadEvent[] = [];

    const energy = meanAbsAmplitude(frame.data);
    const frameMs = frameDurationMs(frame);

    if (energy >= threshold) {
      this.silenceMs = 0;
      if (!this.speaking) {
        this.speaking = true;
        events.push({ type: 'speech_start', offsetMs: frame.offsetMs });
      }
    } else {
      this.silenceMs += frameMs;
      if (this.speaking && this.silenceMs >= hangoverMs) {
        this.speaking = false;
        events.push({ type: 'speech_end', offsetMs: frame.offsetMs });
      } else if (!this.speaking) {
        events.push({ type: 'silence', durationMs: this.silenceMs });
      }
    }
    return events;
  }

  reset(): void {
    this.speaking = false;
    this.silenceMs = 0;
  }
}

/**
 * Words that mean a sentence is not finished.
 *
 * Kept small and boring on purpose. The cost of waiting too long is a slightly
 * slow assistant; the cost of cutting in too early is a person losing their
 * train of thought about their own life.
 */
const TRAILING_CONTINUATIONS = [
  'and',
  'but',
  'so',
  'because',
  'which',
  'that',
  'when',
  'while',
  'then',
  'or',
  'if',
  'aur',
  'lekin',
  'ki',
  'toh',
  'phir',
  'kyunki',
];

export class LocalTurnDetector implements TurnDetector {
  readonly capabilities = LOCAL_CAPS('local-turn-detector');

  async health(): Promise<ProviderHealth> {
    return { status: 'ok' };
  }

  shouldEndTurn(input: {
    silenceMs: number;
    transcriptSoFar: string;
    mode: 'interview' | 'assistant';
  }): { endTurn: boolean; reason: 'silence' | 'explicit' | 'still_speaking' } {
    // An interview waits noticeably longer, because remembering takes time and
    // the person is not composing a query — they are recalling a life.
    const base = input.mode === 'interview' ? 1800 : 900;

    const trimmed = input.transcriptSoFar.trim().toLowerCase();
    const lastWord = trimmed.split(/\s+/).filter(Boolean).at(-1) ?? '';
    const unfinished = TRAILING_CONTINUATIONS.includes(lastWord) || trimmed.endsWith(',');

    // A trailing conjunction earns another beat before we assume they are done.
    const threshold = unfinished ? base + 1200 : base;

    if (input.silenceMs >= threshold) {
      return { endTurn: true, reason: 'silence' };
    }
    return { endTurn: false, reason: 'still_speaking' };
  }

  reset(): void {
    // Stateless.
  }
}

/**
 * Cost meter for the local path.
 *
 * Every rate is zero, and that is the honest number: nothing here costs money.
 * It exists so the accounting path is exercised by the same code that will
 * carry real rates, rather than being written for the first time in production.
 */
export class LocalCostMeter implements CostMeter {
  readonly currency = 'INR';

  estimate(_input: UsageReport): number {
    return 0;
  }
}

/** Rates supplied by configuration; still an estimate, never an invoice. */
export class RateCardCostMeter implements CostMeter {
  constructor(
    readonly currency: string,
    private readonly rates: {
      sttPerMinuteMinor: number;
      ttsPerThousandCharsMinor: number;
      llmInputPerMillionMinor: number;
      llmOutputPerMillionMinor: number;
      transportPerMinuteMinor: number;
    },
  ) {}

  estimate(input: UsageReport): number {
    const stt = ((input.sttSeconds ?? 0) / 60) * this.rates.sttPerMinuteMinor;
    const tts = ((input.ttsCharacters ?? 0) / 1000) * this.rates.ttsPerThousandCharsMinor;
    const llmIn = ((input.llmInputTokens ?? 0) / 1_000_000) * this.rates.llmInputPerMillionMinor;
    const llmOut = ((input.llmOutputTokens ?? 0) / 1_000_000) * this.rates.llmOutputPerMillionMinor;
    const transport =
      ((input.transportSeconds ?? 0) / 60) * this.rates.transportPerMinuteMinor;
    return Math.ceil(stt + tts + llmIn + llmOut + transport);
  }
}

/**
 * Budget check. Fails closed by degrading to text rather than cutting a person
 * off mid-conversation: losing the voice is an inconvenience, losing the
 * session is losing what they were in the middle of saying.
 */
export function checkBudget(input: {
  spentThisSessionMinor: number;
  sessionBudgetMinor: number;
  spentTodayMinor: number;
  dailyLimitMinor: number;
  spentThisMonthMinor: number;
  archiveCapMinor: number;
}): BudgetDecision {
  if (input.spentThisMonthMinor >= input.archiveCapMinor) {
    return { allowed: false, degradeToText: true, reason: 'archive_cap', remainingMinor: 0 };
  }
  if (input.spentTodayMinor >= input.dailyLimitMinor) {
    return { allowed: false, degradeToText: true, reason: 'daily_limit', remainingMinor: 0 };
  }
  if (input.spentThisSessionMinor >= input.sessionBudgetMinor) {
    return {
      allowed: false,
      degradeToText: true,
      reason: 'session_budget_exhausted',
      remainingMinor: 0,
    };
  }
  return {
    allowed: true,
    degradeToText: false,
    reason: 'within_budget',
    remainingMinor: input.sessionBudgetMinor - input.spentThisSessionMinor,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function meanAbsAmplitude(pcm16: Uint8Array): number {
  if (pcm16.length < 2) return 0;
  const view = new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength);
  const samples = Math.floor(pcm16.byteLength / 2);
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    total += Math.abs(view.getInt16(i * 2, true));
  }
  return total / samples;
}

export function frameDurationMs(frame: AudioFrame): number {
  const samples = Math.floor(frame.data.byteLength / 2);
  return Math.round((samples / frame.sampleRate) * 1000);
}

/**
 * Synthesises PCM16 for tests and for the local speech adapter.
 *
 * A tone, not a voice. It is deliberately not speech-like: nothing in this
 * system should ever produce audio that could be mistaken for a person.
 */
export function synthesiseTone(input: {
  durationMs: number;
  sampleRate?: number;
  frequencyHz?: number;
  amplitude?: number;
}): Uint8Array {
  const sampleRate = input.sampleRate ?? 16000;
  const frequency = input.frequencyHz ?? 220;
  const amplitude = input.amplitude ?? 6000;
  const samples = Math.max(0, Math.round((input.durationMs / 1000) * sampleRate));
  const out = new Uint8Array(samples * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples; i += 1) {
    const value = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
    view.setInt16(i * 2, value, true);
  }
  return out;
}

/** Silence of a given length, for testing turn detection and endpointing. */
export function synthesiseSilence(durationMs: number, sampleRate = 16000): Uint8Array {
  const samples = Math.max(0, Math.round((durationMs / 1000) * sampleRate));
  return new Uint8Array(samples * 2);
}
