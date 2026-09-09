import type {
  SttEvent,
  SttStream,
  StreamCapabilities,
  StreamingSpeechToText,
  StreamingTextToSpeech,
  TtsChunk,
  TtsStream,
} from './types';
import { isPermittedVoice } from './types';

/**
 * Live speech recognition and speech synthesis through Deepgram.
 *
 * UNEXECUTED in this build: no API key was available, so neither adapter has
 * run against the real service. Both are written against the published
 * WebSocket protocols and their pure parts — URL and header construction,
 * frame encoding, message parsing, cancellation — are tested against the
 * documented message shapes through an injected socket. Set
 * REALTIME_STT_DRIVER / REALTIME_TTS_DRIVER to `deepgram` with
 * DEEPGRAM_API_KEY to enable them, and read PRODUCTION_READINESS first.
 *
 * Two properties of these adapters are not negotiable by configuration:
 *
 * `mip_opt_out=true` is set on every connection. It is what the promise "no
 * provider is ever permitted to train a model on this conversation" actually
 * means at the wire, and it is hard-coded rather than exposed as a setting,
 * because a setting is something somebody can turn off.
 *
 * The voice is chosen from a fixed table of the provider's own generic stock
 * voices. There is no path from a recording of a person to a voice this
 * product will speak in — not through configuration, not through the database,
 * not through an environment variable.
 */

const DEFAULT_BASE_URL = 'wss://api.deepgram.com';

/** The socket surface these adapters need. Injectable, so they can be tested. */
export interface SocketLike {
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'open' | 'close', listener: () => void): void;
  addEventListener(type: 'error', listener: (event: unknown) => void): void;
}

export type SocketFactory = (url: string, headers: Record<string, string>) => Promise<SocketLike>;

/**
 * The default socket, from `ws`.
 *
 * Loaded on demand rather than imported: Deepgram authenticates the handshake
 * with an `Authorization` header, which the platform's own WebSocket cannot
 * send, and a deployment that never enables these adapters should not have to
 * carry the dependency.
 */
const defaultSocketFactory: SocketFactory = async (url, headers) => {
  const { WebSocket } = (await import('ws')) as unknown as {
    WebSocket: new (url: string, options: { headers: Record<string, string> }) => SocketLike;
  };
  return new WebSocket(url, { headers });
};

function capabilities(name: string, version: string): StreamCapabilities {
  return {
    name,
    version,
    sendsDataOffHost: true,
    // Retention is a contractual setting on the account, not something this
    // code can enforce; `mip_opt_out` is the part it can and does.
    retentionDays: 0,
    permitsModelTraining: false,
    languages: ['en', 'hi', 'hi-Latn', 'multi'],
    supportsCancellation: true,
  };
}

/** Builds a query string with the opt-out that is never optional. */
export function deepgramQuery(params: Record<string, string | number | boolean>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) query.set(key, String(value));
  query.set('mip_opt_out', 'true');
  return query.toString();
}

export function deepgramHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `Token ${apiKey}` };
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

export interface DeepgramSttOptions {
  apiKey: string;
  /** A Deepgram live model, e.g. `nova-3`. */
  model: string;
  baseUrl?: string;
  openSocket?: SocketFactory;
}

export class DeepgramStreamingSpeechToText implements StreamingSpeechToText {
  readonly capabilities: StreamCapabilities;

  constructor(private readonly options: DeepgramSttOptions) {
    this.capabilities = capabilities('deepgram-listen-streaming', options.model);
  }

  url(input: { language: string; sampleRate: number }): string {
    const base = this.options.baseUrl ?? DEFAULT_BASE_URL;
    return `${base}/v1/listen?${deepgramQuery({
      model: this.options.model,
      // 'auto' means "let the provider decide", which Deepgram spells `multi`.
      language: input.language === 'auto' ? 'multi' : input.language,
      // What the browser actually sends: 16 kHz mono PCM16.
      encoding: 'linear16',
      sample_rate: input.sampleRate,
      channels: 1,
      interim_results: true,
      // Captions should keep up with speech; a turn is decided by our own turn
      // detector, so endpointing only has to be quick, not clever.
      endpointing: 300,
      vad_events: true,
      punctuate: true,
      smart_format: true,
    })}`;
  }

  async open(input: {
    sessionId: string;
    language: string;
    sampleRate: number;
    sidecarText?: string | null;
  }): Promise<SttStream> {
    const factory = this.options.openSocket ?? defaultSocketFactory;
    const socket = await factory(
      this.url({ language: input.language, sampleRate: input.sampleRate }),
      deepgramHeaders(this.options.apiKey),
    );
    return new DeepgramSttStream(socket);
  }
}

class DeepgramSttStream implements SttStream {
  private readonly queue = new EventQueue<SttEvent>();
  private closed = false;

  constructor(private readonly socket: SocketLike) {
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', () => this.queue.end());
    socket.addEventListener('error', () => {
      this.queue.push({
        type: 'error',
        code: 'provider_unreachable',
        message: 'The transcription service could not be reached.',
      });
      this.queue.end();
    });
  }

  private receive(data: unknown): void {
    const parsed = parseDeepgramResult(data);
    if (parsed) this.queue.push(parsed);
  }

  async push(input: { audio: Uint8Array; sampleRate: number; offsetMs: number }): Promise<void> {
    if (this.closed) return;
    // Audio goes over the socket as raw binary; only control messages are JSON.
    this.socket.send(input.audio);
  }

  async flush(): Promise<void> {
    if (this.closed) return;
    // Asks for a final on everything sent so far without ending the stream,
    // which is what makes "they stopped speaking" produce a transcript now
    // rather than after the next silence timeout.
    this.socket.send(JSON.stringify({ type: 'Finalize' }));
  }

  events(): AsyncIterableIterator<SttEvent> {
    return this.queue.iterator();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.send(JSON.stringify({ type: 'CloseStream' }));
  }

  async cancel(reason: string): Promise<void> {
    void reason;
    if (this.closed) return;
    this.closed = true;
    this.socket.close(1000, 'cancelled');
    this.queue.end();
  }
}

/**
 * Reads one Deepgram message.
 *
 * Only Results carry words. Everything else — metadata, speech-started,
 * utterance-end, keep-alive acknowledgements — is ignored rather than guessed
 * at, and an unparseable frame produces nothing rather than an empty
 * transcript, because an empty transcript is a claim that somebody said
 * nothing.
 */
export function parseDeepgramResult(data: unknown): SttEvent | null {
  let payload: unknown;
  try {
    payload = typeof data === 'string' ? JSON.parse(data) : JSON.parse(String(data));
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload === null) return null;

  const message = payload as {
    type?: string;
    is_final?: boolean;
    start?: number;
    channel?: { alternatives?: { transcript?: string; confidence?: number }[] };
  };
  if (message.type !== 'Results') return null;

  const alternative = message.channel?.alternatives?.[0];
  const text = typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : '';
  if (text.length === 0) return null;

  const offsetMs = Math.round((message.start ?? 0) * 1000);
  if (message.is_final === true) {
    return {
      type: 'final',
      text,
      language: null,
      offsetMs,
      confidence: typeof alternative?.confidence === 'number' ? alternative.confidence : 0,
      // Real recognition of real audio. The local adapter, which cannot
      // recognise speech, is the one that would have to say otherwise.
      synthetic: false,
    };
  }
  return { type: 'partial', text, language: null, offsetMs };
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

/**
 * The voices this product may speak in.
 *
 * Generic stock voices belonging to the provider, chosen once, in code. The
 * left-hand side is what EverEcho records on every turn it speaks; the
 * right-hand side is what the provider is asked for. Nothing outside this
 * table can be configured, so "we never synthesise the storyteller's voice" is
 * a property of the build rather than of an environment file.
 */
export const DEEPGRAM_VOICES: Record<string, string> = {
  'assistant-neutral-en-v1': 'aura-2-thalia-en',
  'assistant-neutral-en-alt-v1': 'aura-2-orion-en',
};

export interface DeepgramTtsOptions {
  apiKey: string;
  /** An EverEcho voice identifier, not a provider one. */
  voiceId: string;
  baseUrl?: string;
  openSocket?: SocketFactory;
}

export class DeepgramStreamingTextToSpeech implements StreamingTextToSpeech {
  readonly capabilities: StreamCapabilities;
  readonly voiceId: string;
  private readonly providerVoice: string;

  constructor(private readonly options: DeepgramTtsOptions) {
    const providerVoice = DEEPGRAM_VOICES[options.voiceId];
    if (!providerVoice || !isPermittedVoice(options.voiceId)) {
      // Refused at construction, so a deployment configured with a voice that
      // is not on the list fails to start rather than failing on somebody's
      // first question.
      throw new Error(
        `Voice "${options.voiceId}" is not one of EverEcho's permitted generic voices.`,
      );
    }
    this.voiceId = options.voiceId;
    this.providerVoice = providerVoice;
    this.capabilities = capabilities('deepgram-speak-streaming', providerVoice);
  }

  url(input: { sampleRate: number }): string {
    const base = this.options.baseUrl ?? DEFAULT_BASE_URL;
    return `${base}/v1/speak?${deepgramQuery({
      model: this.providerVoice,
      encoding: 'linear16',
      sample_rate: input.sampleRate,
    })}`;
  }

  async open(input: {
    sessionId: string;
    language: string;
    sampleRate: number;
  }): Promise<TtsStream> {
    const factory = this.options.openSocket ?? defaultSocketFactory;
    const socket = await factory(
      this.url({ sampleRate: input.sampleRate }),
      deepgramHeaders(this.options.apiKey),
    );
    return new DeepgramTtsStream(socket, input.sampleRate);
  }
}

class DeepgramTtsStream implements TtsStream {
  private readonly audio = new EventQueue<TtsChunk>();
  private cancelled = false;
  private closed = false;

  constructor(
    private readonly socket: SocketLike,
    private readonly sampleRate: number,
  ) {
    socket.addEventListener('message', (event) => this.receive(event.data));
    socket.addEventListener('close', () => this.audio.end());
    socket.addEventListener('error', () => this.audio.end());
  }

  private receive(data: unknown): void {
    if (this.cancelled) return;
    const bytes = toBytes(data);
    if (bytes) {
      this.audio.push({
        audio: bytes,
        sampleRate: this.sampleRate,
        // 16-bit mono: two bytes per sample.
        durationMs: Math.round((bytes.byteLength / 2 / this.sampleRate) * 1000),
      });
      return;
    }
    // Metadata, Flushed, Cleared and Warning are JSON; the Flushed marker ends
    // this clause's audio so the caller's loop finishes rather than hanging.
    const message = parseDeepgramSpeakMessage(data);
    if (message === 'Flushed') this.audio.end();
  }

  async *speak(text: string): AsyncIterableIterator<TtsChunk> {
    if (this.cancelled || this.closed) return;
    this.audio.reset();
    this.socket.send(JSON.stringify({ type: 'Speak', text }));
    this.socket.send(JSON.stringify({ type: 'Flush' }));
    for await (const chunk of this.audio.iterator()) {
      if (this.cancelled) return;
      yield chunk;
    }
  }

  async cancel(reason: string): Promise<void> {
    void reason;
    this.cancelled = true;
    // Clears audio the provider has buffered but not yet sent. Without this,
    // barge-in would stop the browser playing while the provider carried on
    // producing — and being paid for — a sentence nobody will hear.
    if (!this.closed) this.socket.send(JSON.stringify({ type: 'Clear' }));
    this.audio.end();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.socket.send(JSON.stringify({ type: 'Close' }));
    this.audio.end();
  }
}

export function parseDeepgramSpeakMessage(data: unknown): string | null {
  try {
    const payload = JSON.parse(typeof data === 'string' ? data : String(data)) as { type?: string };
    return typeof payload.type === 'string' ? payload.type : null;
  } catch {
    return null;
  }
}

/** Binary frames are audio; anything else is a control message. */
function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data) && data.every((part) => part instanceof Uint8Array)) {
    const total = data.reduce((sum, part) => sum + (part as Uint8Array).byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of data as Uint8Array[]) {
      out.set(part, offset);
      offset += part.byteLength;
    }
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// A queue that bridges callbacks to async iteration
// ---------------------------------------------------------------------------

/**
 * Events arrive on socket callbacks and are consumed by `for await`.
 *
 * Buffered rather than dropped: audio that arrives before the consumer starts
 * reading is still audio somebody is waiting to hear.
 */
class EventQueue<T> {
  private items: T[] = [];
  private waiting: (() => void) | null = null;
  private ended = false;

  push(item: T): void {
    this.items.push(item);
    this.waiting?.();
    this.waiting = null;
  }

  end(): void {
    this.ended = true;
    this.waiting?.();
    this.waiting = null;
  }

  /** Reopens the queue for the next clause on a socket that stays open. */
  reset(): void {
    this.items = [];
    this.ended = false;
  }

  iterator(): AsyncIterableIterator<T> {
    const next = async (): Promise<IteratorResult<T>> => {
      for (;;) {
        const item = this.items.shift();
        if (item !== undefined) return { value: item, done: false };
        if (this.ended) return { value: undefined as never, done: true };
        await new Promise<void>((resolve) => {
          this.waiting = resolve;
        });
      }
    };
    return {
      next,
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
      },
    };
  }
}
