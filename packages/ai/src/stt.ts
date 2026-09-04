import type { AppConfig } from '@everecho/config';

export interface TranscriptionSegment {
  idx: number;
  startMs: number | null;
  endMs: number | null;
  text: string;
  confidence: number;
}

export type TranscriptionResult =
  | {
      status: 'ready';
      provider: string;
      modelVersion: string;
      language: string;
      segments: TranscriptionSegment[];
      /** True when produced by a deterministic local provider, not real ASR. */
      synthetic: boolean;
    }
  | {
      status: 'unavailable';
      provider: string;
      /** Shown to the storyteller verbatim. Never a fake success. */
      reason: string;
    };

export interface SpeechToTextAdapter {
  readonly name: string;
  readonly modelVersion: string;
  transcribe(input: {
    audio: Buffer;
    mimeType: string;
    /**
     * Text captured alongside the recording — the browser's own live
     * transcription during an interview, or a transcript the storyteller
     * uploaded with the file. This is real content, not a fabrication.
     */
    sidecarText?: string | null;
    durationMs?: number | null;
  }): Promise<TranscriptionResult>;
}

/**
 * Local speech-to-text.
 *
 * There is no speech recogniser in this process, and it will not pretend
 * otherwise. When a recording arrives with text captured alongside it, that
 * text is segmented and returned — which is what browser-recorded interviews
 * produce, and what makes demo mode exercise the real pipeline. When there is
 * no such text, it reports `unavailable` with a plain explanation rather than
 * inventing a transcript.
 */
export class LocalSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly name = 'local-deterministic';
  readonly modelVersion: string;

  constructor(cfg: AppConfig) {
    this.modelVersion = cfg.env.STT_MODEL;
  }

  async transcribe(input: {
    audio: Buffer;
    mimeType: string;
    sidecarText?: string | null;
    durationMs?: number | null;
  }): Promise<TranscriptionResult> {
    const sidecar = input.sidecarText?.trim();
    if (!sidecar) {
      return {
        status: 'unavailable',
        provider: this.name,
        reason:
          'This recording has not been transcribed. The local provider cannot recognise speech; configure STT_DRIVER with a speech provider, or add a transcript yourself.',
      };
    }

    // Sentence-ish chunks, timed evenly across the recording. Timings are
    // approximate and the UI says so; the words are exactly what was captured.
    const chunks = sidecar
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const total = input.durationMs ?? null;
    const per = total !== null && chunks.length > 0 ? Math.floor(total / chunks.length) : null;

    return {
      status: 'ready',
      provider: this.name,
      modelVersion: this.modelVersion,
      language: 'en',
      synthetic: true,
      segments: chunks.map((text, idx) => ({
        idx,
        startMs: per === null ? null : idx * per,
        endMs: per === null ? null : (idx + 1) * per,
        text,
        confidence: 1,
      })),
    };
  }
}

/**
 * Hosted speech-to-text over an OpenAI-compatible transcription endpoint.
 * UNVERIFIED in this build: no provider credentials were available.
 */
export class HostedSpeechToTextAdapter implements SpeechToTextAdapter {
  readonly name: string;
  readonly modelVersion: string;

  constructor(private readonly cfg: AppConfig) {
    this.name = cfg.env.STT_DRIVER;
    this.modelVersion = cfg.env.STT_MODEL;
  }

  async transcribe(input: { audio: Buffer; mimeType: string }): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), 'audio');
    form.append('model', this.modelVersion);
    form.append('response_format', 'verbose_json');

    const base = this.cfg.env.LLM_BASE_URL ?? 'https://api.openai.com/v1';
    const response = await fetch(`${base}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.cfg.env.STT_API_KEY ?? ''}` },
      body: form,
    });
    if (!response.ok) {
      return {
        status: 'unavailable',
        provider: this.name,
        reason: `The transcription provider returned ${response.status}. The recording is stored and can be transcribed again later.`,
      };
    }
    const payload = (await response.json()) as {
      language?: string;
      segments?: { start: number; end: number; text: string }[];
      text?: string;
    };
    const segments = (payload.segments ?? []).map((s, idx) => ({
      idx,
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
      confidence: 0.9,
    }));
    return {
      status: 'ready',
      provider: this.name,
      modelVersion: this.modelVersion,
      language: payload.language ?? 'en',
      synthetic: false,
      segments:
        segments.length > 0
          ? segments
          : [{ idx: 0, startMs: null, endMs: null, text: payload.text ?? '', confidence: 0.9 }],
    };
  }
}

export function createSpeechToText(cfg: AppConfig): SpeechToTextAdapter {
  return cfg.env.STT_DRIVER === 'local'
    ? new LocalSpeechToTextAdapter(cfg)
    : new HostedSpeechToTextAdapter(cfg);
}
