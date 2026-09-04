'use client';

import type {
  ClientEvent,
  LearningSummary,
  RealtimeClaim,
  RealtimeState,
  ServerEvent,
} from '@everecho/contracts';
import { API_URL } from './api';

/**
 * The browser side of a live conversation.
 *
 * It renders state and sends events; it never decides one. Every permission
 * question is answered by the server, and this file's job is to make the
 * conversation feel immediate without ever asserting anything about what is
 * allowed.
 */

export interface LiveClause {
  clauseIndex: number;
  text: string;
  claim: RealtimeClaim | null;
}

export interface LiveTurn {
  index: number;
  speaker: 'user' | 'assistant';
  text: string;
  final: boolean;
  cancelled: boolean;
  clauses: LiveClause[];
  abstained: boolean;
}

export interface LiveSnapshot {
  state: RealtimeState;
  connection: 'connecting' | 'open' | 'reconnecting' | 'closed';
  partial: string;
  turns: LiveTurn[];
  warnings: { code: string; message: string }[];
  fatal: { code: string; message: string } | null;
  summary: LearningSummary | null;
  candidates: { id: string; title: string; requiresStorytellerReview: boolean }[];
  /** Missed sequence numbers, so the interface can say the transcript has a gap. */
  gapDetected: boolean;
}

const EMPTY: LiveSnapshot = {
  state: 'CREATED',
  connection: 'closed',
  partial: '',
  turns: [],
  warnings: [],
  fatal: null,
  summary: null,
  candidates: [],
  gapDetected: false,
};

/** Frames of this length keep captions responsive without flooding the socket. */
const FRAME_MS = 320;
const SAMPLE_RATE = 16000;

export interface LiveSessionOptions {
  archiveId: string;
  sessionId: string;
  onChange: (snapshot: LiveSnapshot) => void;
  /**
   * Text the browser's own recogniser produced. Passed alongside audio because
   * this deployment may have no speech recogniser of its own, and inventing
   * words would be inventing the storyteller's words.
   */
  onNeedsSidecar?: () => string | null;
}

export class LiveSession {
  private socket: WebSocket | null = null;
  private snapshot: LiveSnapshot = { ...EMPTY };
  private lastSeq = -1;
  private eventCounter = 0;
  private audioContext: AudioContext | null = null;
  private playbackTime = 0;
  private queuedSources: AudioBufferSourceNode[] = [];
  private stream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private frameBuffer: Int16Array[] = [];
  private frameSamples = 0;
  private closedByUser = false;
  private reconnectAttempts = 0;
  /**
   * Random per instance.
   *
   * Client event ids are the idempotency key the server dedupes on, so two
   * instances must never generate the same one. A timestamp and a counter are
   * not enough: two sessions constructed in the same millisecond — a reconnect,
   * a second tab, a development double-mount — would collide, and the server
   * would correctly drop the second one's first event as a duplicate. That
   * looks exactly like a connection that never happened.
   */
  private readonly instanceId = Math.random().toString(36).slice(2, 10);

  constructor(private readonly options: LiveSessionOptions) {}

  get current(): LiveSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<LiveSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.options.onChange(this.snapshot);
  }

  private nextEventId(): string {
    this.eventCounter += 1;
    return `c-${this.instanceId}-${this.eventCounter}`;
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------

  async connect(reconnectToken?: string): Promise<void> {
    this.closedByUser = false;
    this.update({ connection: this.reconnectAttempts > 0 ? 'reconnecting' : 'connecting' });

    const base = API_URL.replace(/^http/, 'ws');
    const query = reconnectToken ? `?reconnectToken=${encodeURIComponent(reconnectToken)}` : '';
    const url =
      `${base}/v1/archives/${this.options.archiveId}` +
      `/realtime-sessions/${this.options.sessionId}/socket${query}`;

    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectAttempts = 0;
      this.update({ connection: 'open' });
      this.send({ type: 'session.hello', clientEventId: this.nextEventId(), protocolVersion: 1 });
    });

    socket.addEventListener('message', (event) => {
      try {
        this.receive(JSON.parse(String(event.data)) as ServerEvent);
      } catch {
        // A frame we cannot read is reported as a gap rather than crashing the
        // page mid-conversation.
        this.update({ gapDetected: true });
      }
    });

    socket.addEventListener('close', () => {
      if (this.closedByUser) {
        this.update({ connection: 'closed' });
        return;
      }
      void this.tryReconnect();
    });

    socket.addEventListener('error', () => {
      this.update({
        warnings: [
          ...this.snapshot.warnings,
          { code: 'connection', message: 'The connection had a problem.' },
        ],
      });
    });
  }

  /**
   * Reconnects with backoff, up to a point.
   *
   * A dropped socket is not an ended conversation: the session lives in the
   * database and the server holds it open, so coming back resumes where the
   * person was rather than starting again.
   */
  private async tryReconnect(): Promise<void> {
    if (this.closedByUser || this.reconnectAttempts >= 4) {
      this.update({ connection: 'closed' });
      return;
    }
    this.reconnectAttempts += 1;
    this.update({ connection: 'reconnecting' });
    await new Promise((r) => setTimeout(r, Math.min(4000, 400 * 2 ** this.reconnectAttempts)));

    try {
      const response = await fetch(
        `${API_URL}/v1/archives/${this.options.archiveId}` +
          `/realtime-sessions/${this.options.sessionId}/reconnect-token`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
            'x-csrf-token': readCsrf() ?? '',
          },
          body: '{}',
        },
      );
      if (!response.ok) {
        this.update({ connection: 'closed' });
        return;
      }
      const body = (await response.json()) as { reconnect: { token: string } };
      await this.connect(body.reconnect.token);
    } catch {
      this.update({ connection: 'closed' });
    }
  }

  private send(event: ClientEvent): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(event));
  }

  // -------------------------------------------------------------------------
  // Server events
  // -------------------------------------------------------------------------

  private receive(event: ServerEvent): void {
    // Sequence numbers are monotonic, so a jump means something was missed.
    // Said out loud rather than hidden: a transcript with a silent hole in it
    // is worse than one that admits to having one.
    if (event.seq > 0) {
      if (this.lastSeq >= 0 && event.seq > this.lastSeq + 1) this.update({ gapDetected: true });
      this.lastSeq = Math.max(this.lastSeq, event.seq);
    }

    switch (event.type) {
      case 'session.state':
        this.update({ state: event.state });
        if (event.state === 'ENDED' || event.state === 'FAILED') this.closedByUser = true;
        return;

      case 'transcript.partial':
        this.update({ partial: event.text });
        return;

      case 'transcript.final':
        this.update({
          partial: '',
          turns: [
            ...this.snapshot.turns,
            {
              index: event.turnIndex,
              speaker: 'user',
              text: event.text,
              final: true,
              cancelled: false,
              clauses: [],
              abstained: false,
            },
          ],
        });
        return;

      case 'assistant.thinking':
        return;

      case 'assistant.text.delta':
        this.upsertAssistantTurn(event.turnIndex, (turn) => ({
          ...turn,
          clauses: [
            ...turn.clauses.filter((c) => c.clauseIndex !== event.clauseIndex),
            { clauseIndex: event.clauseIndex, text: event.text, claim: null },
          ].sort((a, b) => a.clauseIndex - b.clauseIndex),
        }));
        return;

      case 'assistant.citation':
        this.upsertAssistantTurn(event.turnIndex, (turn) => ({
          ...turn,
          clauses: turn.clauses.map((c) =>
            c.clauseIndex === event.clauseIndex ? { ...c, claim: event.claim } : c,
          ),
        }));
        return;

      case 'assistant.audio.chunk':
        void this.play(event.audio, event.sampleRate);
        return;

      case 'assistant.turn.complete':
        this.upsertAssistantTurn(event.turn.index, (turn) => ({
          ...turn,
          text: event.turn.text,
          final: true,
          abstained: event.turn.abstained,
        }));
        return;

      case 'assistant.turn.cancelled':
        this.stopPlayback();
        this.upsertAssistantTurn(event.turnIndex, (turn) => ({
          ...turn,
          cancelled: true,
          final: false,
        }));
        return;

      case 'learning.candidate':
        this.update({
          candidates: [
            ...this.snapshot.candidates,
            {
              id: event.candidateId,
              title: event.title,
              requiresStorytellerReview: event.requiresStorytellerReview,
            },
          ],
        });
        return;

      case 'learning.summary':
        this.update({ summary: event.summary });
        return;

      case 'policy.changed':
        this.update({
          warnings: [
            ...this.snapshot.warnings,
            {
              code: 'policy_changed',
              message: event.narrowed
                ? 'The storyteller has narrowed what this conversation may do.'
                : 'Permissions for this conversation changed.',
            },
          ],
        });
        return;

      case 'warning':
        this.update({
          warnings: [...this.snapshot.warnings, { code: event.code, message: event.message }],
        });
        return;

      case 'error':
        this.stopPlayback();
        if (event.fatal) {
          this.closedByUser = true;
          this.update({ fatal: { code: event.code, message: event.message } });
        } else {
          this.update({
            warnings: [...this.snapshot.warnings, { code: event.code, message: event.message }],
          });
        }
        return;
    }
  }

  private upsertAssistantTurn(index: number, patch: (turn: LiveTurn) => LiveTurn): void {
    const existing = this.snapshot.turns.find(
      (t) => t.speaker === 'assistant' && t.index === index,
    );
    const base: LiveTurn = existing ?? {
      index,
      speaker: 'assistant',
      text: '',
      final: false,
      cancelled: false,
      clauses: [],
      abstained: false,
    };
    const updated = patch(base);
    this.update({
      turns: existing
        ? this.snapshot.turns.map((t) => (t === existing ? updated : t))
        : [...this.snapshot.turns, updated],
    });
  }

  // -------------------------------------------------------------------------
  // Microphone
  // -------------------------------------------------------------------------

  /**
   * Starts capturing.
   *
   * Resamples to 16 kHz mono PCM16 in the browser, because sending raw
   * 48 kHz float audio would be four times the bandwidth for no benefit and
   * would push the resampling cost onto the server.
   */
  async startListening(): Promise<void> {
    if (this.stream) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.stream = stream;

    const context = this.ensureAudioContext();
    const source = context.createMediaStreamSource(stream);
    const processor = context.createScriptProcessor(4096, 1, 1);
    this.processor = processor;

    let seq = 0;
    const samplesPerFrame = Math.round((FRAME_MS / 1000) * SAMPLE_RATE);

    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0);
      const resampled = downsample(input, context.sampleRate, SAMPLE_RATE);
      this.frameBuffer.push(resampled);
      this.frameSamples += resampled.length;

      while (this.frameSamples >= samplesPerFrame) {
        const frame = takeSamples(this.frameBuffer, samplesPerFrame);
        this.frameSamples -= samplesPerFrame;
        this.send({
          type: 'audio.chunk',
          clientEventId: this.nextEventId(),
          seq: seq++,
          audio: toBase64(frame),
          sampleRate: SAMPLE_RATE,
        });
      }
    };

    source.connect(processor);
    processor.connect(context.destination);
    this.send({ type: 'user.speech.started', clientEventId: this.nextEventId() });
  }

  stopListening(): void {
    this.send({ type: 'user.speech.ended', clientEventId: this.nextEventId() });
    this.processor?.disconnect();
    this.processor = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.frameBuffer = [];
    this.frameSamples = 0;
  }

  /** Text and voice are the same conversation; this is the typed half. */
  sendText(text: string): void {
    const sidecar = this.options.onNeedsSidecar?.() ?? null;
    void sidecar;
    this.send({ type: 'user.turn.commit', clientEventId: this.nextEventId(), text });
  }

  /**
   * Barge-in. Stops queued audio immediately in the browser as well as telling
   * the server, because waiting for a round trip means the assistant keeps
   * talking over somebody for the length of it.
   */
  interrupt(): void {
    this.stopPlayback();
    this.send({ type: 'user.interrupt', clientEventId: this.nextEventId() });
  }

  pause(): void {
    this.stopPlayback();
    this.send({ type: 'session.pause', clientEventId: this.nextEventId() });
  }

  resume(): void {
    this.send({ type: 'session.resume', clientEventId: this.nextEventId() });
  }

  end(reason = 'user_ended'): void {
    this.closedByUser = true;
    this.stopListening();
    this.stopPlayback();
    this.send({ type: 'session.end', clientEventId: this.nextEventId(), reason });
  }

  close(): void {
    this.closedByUser = true;
    this.stopListening();
    this.stopPlayback();
    this.socket?.close();
    void this.audioContext?.close();
    this.audioContext = null;
  }

  // -------------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------------

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new Ctor();
    }
    return this.audioContext;
  }

  private async play(base64: string, sampleRate: number): Promise<void> {
    const context = this.ensureAudioContext();
    if (context.state === 'suspended') await context.resume();

    const pcm = fromBase64(base64);
    const frames = pcm.length / 2;
    if (frames === 0) return;

    const buffer = context.createBuffer(1, frames, sampleRate);
    const channel = buffer.getChannelData(0);
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    for (let i = 0; i < frames; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;

    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);

    // Scheduled end to end so consecutive chunks play without a gap between
    // them, which is what makes a stream sound continuous rather than stuttered.
    const startAt = Math.max(context.currentTime, this.playbackTime);
    source.start(startAt);
    this.playbackTime = startAt + buffer.duration;

    this.queuedSources.push(source);
    source.onended = () => {
      this.queuedSources = this.queuedSources.filter((s) => s !== source);
    };
  }

  /** Stops everything queued. This is what makes barge-in feel immediate. */
  private stopPlayback(): void {
    for (const source of this.queuedSources) {
      try {
        source.stop();
      } catch {
        // Already finished.
      }
    }
    this.queuedSources = [];
    this.playbackTime = this.audioContext?.currentTime ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Audio helpers
// ---------------------------------------------------------------------------

function downsample(input: Float32Array, from: number, to: number): Int16Array {
  if (to >= from) return floatToPcm16(input);
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    // Average the source window rather than picking one sample, which would
    // alias badly on speech.
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let total = 0;
    for (let j = start; j < end; j += 1) total += input[j] ?? 0;
    const value = total / Math.max(1, end - start);
    out[i] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
  }
  return out;
}

function floatToPcm16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    out[i] = Math.max(-32768, Math.min(32767, Math.round((input[i] ?? 0) * 32767)));
  }
  return out;
}

function takeSamples(buffers: Int16Array[], count: number): Int16Array {
  const out = new Int16Array(count);
  let written = 0;
  while (written < count && buffers.length > 0) {
    const head = buffers[0] as Int16Array;
    const take = Math.min(head.length, count - written);
    out.set(head.subarray(0, take), written);
    written += take;
    if (take === head.length) buffers.shift();
    else buffers[0] = head.subarray(take);
  }
  return out;
}

function toBase64(samples: Int16Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readCsrf(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('everecho_csrf='))
    ?.split('=')[1];
}
