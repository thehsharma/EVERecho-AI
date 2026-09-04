import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import {
  AnthropicStreamingLanguageModel,
  ClauseAccumulator,
  DEEPGRAM_VOICES,
  DeepgramStreamingSpeechToText,
  DeepgramStreamingTextToSpeech,
  buildMessages,
  buildSystem,
  deepgramHeaders,
  deepgramQuery,
  isPermittedVoice,
  parseDeepgramResult,
  parseToolRequest,
  splitCitations,
  type EvidencePassage,
  type LlmStreamEvent,
  type SocketLike,
  type StreamingConversationInput,
} from '../src/index';

/**
 * The hosted adapters, without a hosted provider.
 *
 * Nothing here has run against Deepgram or the Claude API — no credentials
 * were available, and a test that pretends otherwise would be worse than no
 * test. What is exercised is everything the adapters decide for themselves:
 * the URL and headers they build, the frames they send, how they read the
 * message shapes both services publish, what they do when told to stop, and
 * the promises that must hold whatever a provider does.
 */

const passage = (id: string, text: string): EvidencePassage => ({
  id,
  text,
  sourceId: `source-${id}`,
  memoryId: `memory-${id}`,
  transcriptSegmentId: null,
  locator: { kind: 'whole_asset' },
});

const CONVERSATION: StreamingConversationInput = {
  sessionId: 'session-1',
  mode: 'assistant',
  subjectName: 'Kamala Deshpande',
  passages: [
    passage('pune', 'We moved to Pune in 1962 because my father took a job on the railways.'),
    passage('school', 'The school had one room and a tin roof.'),
  ],
  history: [],
  userTurn: 'Where did the family move to?',
  language: 'en',
  restrictedTopics: [],
  coveredTopics: [],
  askedQuestions: [],
};

// ---------------------------------------------------------------------------
// Deepgram: speech to text
// ---------------------------------------------------------------------------

describe('the Deepgram transcription adapter', () => {
  const stt = new DeepgramStreamingSpeechToText({ apiKey: 'k', model: 'nova-3' });

  it('opts out of model training on every connection', () => {
    // The single most important line in this adapter. "No provider may train
    // on this conversation" is a promise made on a permissions screen; this is
    // where it either happens or does not.
    expect(stt.url({ language: 'en', sampleRate: 16000 })).toContain('mip_opt_out=true');
    expect(deepgramQuery({ anything: 1 })).toContain('mip_opt_out=true');
  });

  it('cannot be configured to allow training', () => {
    expect(stt.capabilities.permitsModelTraining).toBe(false);
    expect(stt.capabilities.sendsDataOffHost).toBe(true);
  });

  it('asks for the audio the browser actually sends', () => {
    const url = stt.url({ language: 'en', sampleRate: 16000 });
    expect(url).toContain('encoding=linear16');
    expect(url).toContain('sample_rate=16000');
    expect(url).toContain('channels=1');
    expect(url).toContain('interim_results=true');
  });

  it('lets the provider detect a language only when nothing was pinned', () => {
    expect(stt.url({ language: 'auto', sampleRate: 16000 })).toContain('language=multi');
    expect(stt.url({ language: 'hi', sampleRate: 16000 })).toContain('language=hi');
  });

  it('authenticates with the documented header rather than a query parameter', () => {
    // A key in the URL ends up in logs, proxies and browser history.
    expect(deepgramHeaders('secret-key')).toEqual({ Authorization: 'Token secret-key' });
    expect(stt.url({ language: 'en', sampleRate: 16000 })).not.toContain('secret');
  });

  it('reads a final result', () => {
    const event = parseDeepgramResult(
      JSON.stringify({
        type: 'Results',
        is_final: true,
        speech_final: true,
        start: 1.5,
        channel: { alternatives: [{ transcript: 'We moved to Pune', confidence: 0.94 }] },
      }),
    );
    expect(event).toMatchObject({
      type: 'final',
      text: 'We moved to Pune',
      offsetMs: 1500,
      confidence: 0.94,
      synthetic: false,
    });
  });

  it('reads an interim result as a partial', () => {
    const event = parseDeepgramResult(
      JSON.stringify({
        type: 'Results',
        is_final: false,
        channel: { alternatives: [{ transcript: 'We moved' }] },
      }),
    );
    expect(event).toMatchObject({ type: 'partial', text: 'We moved' });
  });

  it('says nothing rather than claiming somebody said nothing', () => {
    // An empty transcript is a claim, and a wrong one. Silence in the audio is
    // not the same as a person who said nothing worth keeping.
    for (const frame of [
      JSON.stringify({ type: 'Results', channel: { alternatives: [{ transcript: '   ' }] } }),
      JSON.stringify({ type: 'Metadata', request_id: 'r' }),
      JSON.stringify({ type: 'UtteranceEnd', last_word_end: 2.1 }),
      'not json at all',
    ]) {
      expect(parseDeepgramResult(frame)).toBeNull();
    }
  });

  it('sends audio as binary and control as JSON', async () => {
    const socket = fakeSocket();
    const adapter = new DeepgramStreamingSpeechToText({
      apiKey: 'k',
      model: 'nova-3',
      openSocket: async () => socket.socket,
    });
    const stream = await adapter.open({ sessionId: 's', language: 'en', sampleRate: 16000 });
    await stream.push({ audio: new Uint8Array([1, 2, 3, 4]), sampleRate: 16000, offsetMs: 0 });
    await stream.flush();
    await stream.close();

    expect(socket.sent[0]).toBeInstanceOf(Uint8Array);
    expect(socket.sent.slice(1)).toEqual(['{"type":"Finalize"}', '{"type":"CloseStream"}']);
  });

  it('stops the provider working when a turn is abandoned', async () => {
    const socket = fakeSocket();
    const adapter = new DeepgramStreamingSpeechToText({
      apiKey: 'k',
      model: 'nova-3',
      openSocket: async () => socket.socket,
    });
    const stream = await adapter.open({ sessionId: 's', language: 'en', sampleRate: 16000 });
    await stream.cancel('user_interrupted');
    expect(socket.closed).toBe(true);
    // Nothing further reaches a socket that was abandoned.
    await stream.push({ audio: new Uint8Array([1]), sampleRate: 16000, offsetMs: 0 });
    expect(socket.sent).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Deepgram: speech synthesis
// ---------------------------------------------------------------------------

describe('the Deepgram speech adapter', () => {
  it('refuses any voice that is not on EverEcho’s permitted list', () => {
    for (const voiceId of ['kamala-cloned-v1', 'aura-2-thalia-en', 'storyteller']) {
      expect(() => new DeepgramStreamingTextToSpeech({ apiKey: 'k', voiceId })).toThrow(
        /permitted generic voices/,
      );
    }
  });

  it('offers only generic stock voices, and records the EverEcho name', () => {
    for (const voiceId of Object.keys(DEEPGRAM_VOICES)) {
      expect(isPermittedVoice(voiceId)).toBe(true);
      const tts = new DeepgramStreamingTextToSpeech({ apiKey: 'k', voiceId });
      // What is recorded on the turn is the product's own identifier, so the
      // audit trail does not depend on a provider's naming.
      expect(tts.voiceId).toBe(voiceId);
      expect(tts.url({ sampleRate: 16000 })).toContain(`model=${DEEPGRAM_VOICES[voiceId]}`);
    }
  });

  it('opts out of model training on every connection', () => {
    const tts = new DeepgramStreamingTextToSpeech({
      apiKey: 'k',
      voiceId: 'assistant-neutral-en-v1',
    });
    expect(tts.url({ sampleRate: 16000 })).toContain('mip_opt_out=true');
    expect(tts.capabilities.permitsModelTraining).toBe(false);
  });

  it('speaks one clause and stops when it is flushed', async () => {
    const socket = fakeSocket();
    const tts = new DeepgramStreamingTextToSpeech({
      apiKey: 'k',
      voiceId: 'assistant-neutral-en-v1',
      openSocket: async () => socket.socket,
    });
    const stream = await tts.open({ sessionId: 's', language: 'en', sampleRate: 16000 });

    const chunks: number[] = [];
    const reading = (async () => {
      for await (const chunk of stream.speak('She moved to Pune in 1962.')) {
        chunks.push(chunk.audio.byteLength);
      }
    })();

    socket.emit(new Uint8Array(640));
    socket.emit(new Uint8Array(640));
    socket.emit(JSON.stringify({ type: 'Flushed', sequence_id: 1 }));
    await reading;

    expect(chunks).toEqual([640, 640]);
    expect(socket.sent).toEqual([
      '{"type":"Speak","text":"She moved to Pune in 1962."}',
      '{"type":"Flush"}',
    ]);
  });

  it('clears audio the provider has already produced when interrupted', async () => {
    // Barge-in has to reach the provider, not only the browser. Stopping
    // playback alone leaves the provider generating — and charging for — a
    // sentence nobody will ever hear.
    const socket = fakeSocket();
    const tts = new DeepgramStreamingTextToSpeech({
      apiKey: 'k',
      voiceId: 'assistant-neutral-en-v1',
      openSocket: async () => socket.socket,
    });
    const stream = await tts.open({ sessionId: 's', language: 'en', sampleRate: 16000 });
    await stream.cancel('user_interrupted');
    expect(socket.sent).toContain('{"type":"Clear"}');
  });
});

// ---------------------------------------------------------------------------
// Claude: streaming composition
// ---------------------------------------------------------------------------

describe('the Claude streaming composer', () => {
  const model = new AnthropicStreamingLanguageModel({
    apiKey: 'k',
    model: 'claude-opus-5',
    maxTokens: 1024,
  });

  it('declares itself generative, so verification stays mandatory', () => {
    expect(model.extractive).toBe(false);
    expect(model.capabilities.sendsDataOffHost).toBe(true);
    expect(model.capabilities.permitsModelTraining).toBe(false);
  });

  it('tells the model what it is never allowed to do', () => {
    const system = buildSystem(CONVERSATION);
    expect(system).toContain('You are not the person whose');
    expect(system).toMatch(/never/i);
    expect(system).toContain('third person');
    expect(system).toContain('Kamala Deshpande');
  });

  it('asks for a question and no assertions in an interview', () => {
    const system = buildSystem({ ...CONVERSATION, mode: 'interview' });
    expect(system).toContain('Ask exactly one question');
    expect(system).toContain('Do not assert any fact');
  });

  it('closes restricted subjects explicitly', () => {
    const system = buildSystem({ ...CONVERSATION, restrictedTopics: ['her illness'] });
    expect(system).toContain('her illness');
    expect(system).toContain('These subjects are closed');
  });

  it('sends passages as isolated, numbered evidence', () => {
    const messages = buildMessages(CONVERSATION);
    const last = messages[messages.length - 1];
    const content = String(last?.content);
    expect(content).toContain('Pune');
    // Isolated so a passage that reads like an instruction stays evidence.
    expect(content).toMatch(/BEGIN|<evidence|---/i);
    expect(content).toContain('Where did the family move to?');
  });

  it('sends no passages at all when there are none', () => {
    const messages = buildMessages({ ...CONVERSATION, passages: [] });
    expect(String(messages[messages.length - 1]?.content)).toBe('Where did the family move to?');
  });
});

describe('reading what the model streams', () => {
  it('emits a whole clause with the evidence it cited', () => {
    const accumulator = new ClauseAccumulator(['pune', 'school']);
    const events = [
      ...accumulator.push('She moved to Pune'),
      ...accumulator.push(' in 1962. [1]'),
      ...accumulator.flush(),
    ];
    expect(events).toEqual([
      { type: 'clause', index: 0, text: 'She moved to Pune in 1962.', evidenceIds: ['pune'] },
    ]);
  });

  it('holds a clause back until its citation has arrived', () => {
    // Emitting at the full stop would send an uncited clause, which the
    // verifier would then discard — losing a sentence the model did cite.
    const accumulator = new ClauseAccumulator(['pune']);
    expect(accumulator.push('She moved to Pune in 1962.')).toHaveLength(0);
    expect(accumulator.push(' [1] And')).toHaveLength(1);
  });

  it('carries no evidence for a clause that cited none', () => {
    const accumulator = new ClauseAccumulator(['pune']);
    const [event] = accumulator.push('I think she liked it there. Then');
    expect((event as { evidenceIds: string[] }).evidenceIds).toEqual([]);
  });

  it('ignores a citation pointing at a passage that was never supplied', () => {
    const accumulator = new ClauseAccumulator(['pune']);
    accumulator.push('She moved to Nagpur. [7]');
    const [event] = accumulator.flush();
    expect((event as { evidenceIds: string[] }).evidenceIds).toEqual([]);
  });

  it('separates words from citation markers', () => {
    expect(splitCitations('She moved to Pune in 1962. [1][2]')).toEqual({
      text: 'She moved to Pune in 1962.',
      numbers: [1, 2],
    });
    expect(splitCitations('Her father worked there. [2, 2]')).toEqual({
      text: 'Her father worked there.',
      numbers: [2],
    });
  });

  it('reads a tool call once its partial JSON is complete', () => {
    const request = parseToolRequest({
      id: 'toolu_1',
      name: 'propose_memory_candidate',
      json: '{"title":"Moving to Pune","body":"The family moved in 1962.","quotedText":"We moved to Pune in 1962.","sensitive":false}',
    });
    expect(request).toMatchObject({ id: 'toolu_1', name: 'propose_memory_candidate' });
    expect(request?.input.title).toBe('Moving to Pune');
  });

  it('drops a tool call it cannot read rather than guessing', () => {
    expect(
      parseToolRequest({ id: 't', name: 'propose_memory_candidate', json: '{"title":"Mov' }),
    ).toBeNull();
  });

  it('refuses a tool the product does not offer', () => {
    // The model is given no database, shell, HTTP or code-execution tool. If
    // one ever appeared in a response, it would not be honoured here.
    expect(parseToolRequest({ id: 't', name: 'run_sql', json: '{}' })).toBeNull();
  });
});

describe('the Claude stream, against the documented event sequence', () => {
  /**
   * The exact shapes the streaming documentation publishes, replayed.
   *
   * This is not a recording of a real call and does not pretend to be — it is
   * the protocol the adapter is written against, so that a change in how the
   * adapter reads it is caught here rather than in production.
   */
  function replay(events: unknown[]): Pick<Anthropic, 'messages'> {
    return {
      messages: {
        create: async () => ({
          async *[Symbol.asyncIterator]() {
            for (const event of events) yield event;
          },
        }),
      },
    } as unknown as Pick<Anthropic, 'messages'>;
  }

  const TEXT_STREAM = [
    {
      type: 'message_start',
      message: { id: 'msg_1', role: 'assistant', content: [], usage: { input_tokens: 472 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'ping' },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'She moved to Pune in 1962.' },
    },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' [1] ' } },
    {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Her father worked on the railways. [1] ' },
    },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 15 },
    },
    { type: 'message_stop' },
  ];

  async function drain(model: AnthropicStreamingLanguageModel): Promise<LlmStreamEvent[]> {
    const stream = await model.converse(CONVERSATION);
    const out: LlmStreamEvent[] = [];
    for await (const event of stream.events()) out.push(event);
    return out;
  }

  function withClient(events: unknown[]): AnthropicStreamingLanguageModel {
    return new AnthropicStreamingLanguageModel({
      apiKey: 'k',
      model: 'claude-opus-5',
      maxTokens: 1024,
      client: replay(events),
    });
  }

  it('turns text deltas into cited clauses and reports what it cost', async () => {
    const events = await drain(withClient(TEXT_STREAM));
    expect(events.filter((e) => e.type === 'clause')).toEqual([
      {
        type: 'clause',
        index: 0,
        text: 'She moved to Pune in 1962.',
        evidenceIds: ['pune'],
      },
      {
        type: 'clause',
        index: 1,
        text: 'Her father worked on the railways.',
        evidenceIds: ['pune'],
      },
    ]);
    expect(events.at(-1)).toEqual({ type: 'done', inputTokens: 472, outputTokens: 15 });
  });

  it('reads a tool call assembled from partial JSON', async () => {
    const events = await drain(
      withClient([
        TEXT_STREAM[0],
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'toolu_1', name: 'propose_clarifying_question' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"reference": "he", ' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"question": "Who was that?"}' },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 8 } },
        { type: 'message_stop' },
      ]),
    );
    const tool = events.find((e) => e.type === 'tool_request');
    expect(tool).toMatchObject({
      request: {
        name: 'propose_clarifying_question',
        input: { reference: 'he', question: 'Who was that?' },
      },
    });
  });

  it('abstains when the model asks to, rather than emitting the tool call', async () => {
    const events = await drain(
      withClient([
        TEXT_STREAM[0],
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'tool_use', id: 'toolu_2', name: 'abstain' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'input_json_delta', partial_json: '{"reason":"no_evidence"}' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
        { type: 'message_stop' },
      ]),
    );
    expect(events).toContainEqual({ type: 'abstain', reason: 'no_evidence' });
    expect(events.filter((e) => e.type === 'clause')).toHaveLength(0);
  });

  it('ignores event types it does not recognise', async () => {
    // New event types are added over time; the versioning policy asks that an
    // unknown one is skipped rather than treated as a failure.
    const events = await drain(
      withClient([
        TEXT_STREAM[0],
        { type: 'something_added_later', index: 0, payload: {} },
        ...TEXT_STREAM.slice(1),
      ]),
    );
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.filter((e) => e.type === 'clause')).toHaveLength(2);
  });

  it('says nothing more once the turn is abandoned', async () => {
    const model = withClient(TEXT_STREAM);
    const stream = await model.converse(CONVERSATION);
    await stream.cancel('user_interrupted');
    const out: LlmStreamEvent[] = [];
    for await (const event of stream.events()) out.push(event);
    expect(out).toHaveLength(0);
  });

  it('reports a provider failure without repeating what was sent to it', async () => {
    // An error message is a place a prompt can leak. This one never carries it.
    const model = new AnthropicStreamingLanguageModel({
      apiKey: 'k',
      model: 'claude-opus-5',
      maxTokens: 1024,
      client: {
        messages: {
          create: async () => {
            throw new Error('bad request: We moved to Pune in 1962');
          },
        },
      } as unknown as Pick<Anthropic, 'messages'>,
    });
    const events = await drain(model);
    const failure = events.find((e) => e.type === 'error') as { message: string } | undefined;
    expect(failure?.message).not.toContain('Pune');
    expect(failure).toMatchObject({ type: 'error', code: 'provider_error' });
  });
});

// ---------------------------------------------------------------------------
// A socket that records what was sent to it
// ---------------------------------------------------------------------------

function fakeSocket(): {
  socket: SocketLike;
  sent: (string | Uint8Array)[];
  closed: boolean;
  emit(data: unknown): void;
} {
  const listeners: { message: ((event: { data: unknown }) => void)[] } = { message: [] };
  const state = {
    sent: [] as (string | Uint8Array)[],
    closed: false,
    emit(data: unknown) {
      for (const listener of listeners.message) listener({ data });
    },
    socket: {
      send(data: string | Uint8Array) {
        state.sent.push(data);
      },
      close() {
        state.closed = true;
      },
      addEventListener(type: string, listener: unknown) {
        if (type === 'message') {
          listeners.message.push(listener as (event: { data: unknown }) => void);
        }
      },
    } as SocketLike,
  };
  return state;
}

/** Keeps the unused-import checker honest about the event union. */
export type _Events = LlmStreamEvent;
