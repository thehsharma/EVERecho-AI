import { describe, expect, it } from 'vitest';
import {
  LocalStreamingLanguageModel,
  LocalStreamingSpeechToText,
  LocalStreamingTextToSpeech,
  detectLanguage,
  findUnresolvedReferences,
  isPermittedVoice,
  nextInterviewQuestion,
  splitClauses,
  type EvidencePassage,
  type LlmStreamEvent,
} from '../src/index';

const passage = (id: string, text: string): EvidencePassage => ({
  id,
  text,
  sourceId: `source-${id}`,
  memoryId: `memory-${id}`,
  transcriptSegmentId: null,
  locator: { kind: 'whole_asset' },
});

const PUNE = passage(
  'pune',
  'We moved to Pune in 1962 because my father took a job on the railways.',
);
const SCHOOL = passage('school', 'The school had one room and a tin roof.');
const OFTEN = passage('often', 'I have thought about him often since.');

async function collect(
  input: Partial<Parameters<LocalStreamingLanguageModel['converse']>[0]> & { userTurn: string },
): Promise<LlmStreamEvent[]> {
  const model = new LocalStreamingLanguageModel();
  const stream = await model.converse({
    sessionId: 'session-1',
    mode: 'assistant',
    subjectName: 'Kamala Deshpande',
    passages: [],
    history: [],
    language: 'en',
    restrictedTopics: [],
    coveredTopics: [],
    askedQuestions: [],
    ...input,
  });
  const events: LlmStreamEvent[] = [];
  for await (const event of stream.events()) events.push(event);
  return events;
}

describe('the local streaming composer', () => {
  it('answers a question the evidence actually covers', async () => {
    const events = await collect({
      userTurn: 'Where did the family move to?',
      passages: [PUNE, SCHOOL, OFTEN],
    });
    const clauses = events.filter((e) => e.type === 'clause');
    expect(clauses.length).toBeGreaterThan(0);
    expect((clauses[0] as { text: string }).text).toContain('Pune');
  });

  it('abstains rather than returning a cited but irrelevant quotation', async () => {
    // The failure this guards against: "I have thought about him often since"
    // shares one stem with "what did she think about the moon landing", so it
    // is supported, cited and correctly attributed — and it is not an answer.
    // A citation makes an irrelevant answer look reliable, which is worse than
    // saying nothing.
    const events = await collect({
      userTurn: 'What did she think about the moon landing?',
      passages: [OFTEN, PUNE, SCHOOL],
    });
    expect(events.filter((e) => e.type === 'clause')).toHaveLength(0);
    expect(events.some((e) => e.type === 'abstain')).toBe(true);
  });

  it('abstains when there is no evidence at all', async () => {
    const events = await collect({ userTurn: 'What did she say about Delhi?', passages: [] });
    expect(events.some((e) => e.type === 'abstain')).toBe(true);
  });

  it('orders tied passages deterministically', async () => {
    const first = await collect({ userTurn: 'What about the school?', passages: [SCHOOL, PUNE] });
    const second = await collect({ userTurn: 'What about the school?', passages: [PUNE, SCHOOL] });
    expect(first.filter((e) => e.type === 'clause')).toEqual(
      second.filter((e) => e.type === 'clause'),
    );
  });

  it('only ever cites evidence it was given', async () => {
    const events = await collect({
      userTurn: 'Where did the family move to?',
      passages: [PUNE, SCHOOL],
    });
    for (const event of events) {
      if (event.type !== 'clause') continue;
      for (const id of event.evidenceIds) expect(['pune', 'school']).toContain(id);
    }
  });
});

describe('the local interviewer', () => {
  it('asks a question and never asserts a fact', async () => {
    const events = await collect({ userTurn: 'I was born in Nagpur.', mode: 'interview' });
    const clauses = events.filter((e) => e.type === 'clause');
    expect(clauses).toHaveLength(1);
    expect((clauses[0] as { text: string }).text).toContain('?');
    // An interview question cites nothing, because it claims nothing.
    expect((clauses[0] as { evidenceIds: string[] }).evidenceIds).toHaveLength(0);
  });

  it('proposes candidates as a tool request, never as an assertion', async () => {
    const events = await collect({ userTurn: 'I was born in Nagpur.', mode: 'interview' });
    const tools = events.filter((e) => e.type === 'tool_request');
    expect(
      tools.some(
        (t) => (t as { request: { name: string } }).request.name === 'propose_memory_candidate',
      ),
    ).toBe(true);
  });

  it('asks who somebody was rather than moving on', async () => {
    const events = await collect({
      userTurn: 'He said we should go, so we went.',
      mode: 'interview',
    });
    const clauses = events.filter((e) => e.type === 'clause');
    expect((clauses[0] as { text: string }).text).toMatch(/who was that/i);
  });

  it('follows the storyteller into Hindi', async () => {
    const question = nextInterviewQuestion({
      unresolved: null,
      covered: [],
      asked: [],
      language: 'hi',
    });
    expect(question).toMatch(/[ऀ-ॿ]/);
  });

  it('does not repeat a question it has already asked', () => {
    const first = nextInterviewQuestion({
      unresolved: null,
      covered: [],
      asked: [],
      language: 'en',
    });
    const second = nextInterviewQuestion({
      unresolved: null,
      covered: [],
      asked: [first],
      language: 'en',
    });
    expect(second).not.toBe(first);
  });
});

describe('unresolved references', () => {
  it('spots a pronoun that names nobody', () => {
    expect(findUnresolvedReferences('He said we should go')).toContain('he');
    expect(findUnresolvedReferences('My brother came with us')).toContain('my brother');
  });

  it('spots a vague date', () => {
    expect(findUnresolvedReferences('We left a few years later')).toContain('an approximate date');
  });

  it('does not invent one where the person was named', () => {
    expect(findUnresolvedReferences('Anil said we should go')).toHaveLength(0);
  });
});

describe('language detection', () => {
  it('recognises Devanagari without ambiguity', () => {
    expect(detectLanguage('हम पुणे चले गए')).toBe('hi');
  });

  it('recognises romanised Hindi from its function words', () => {
    expect(detectLanguage('hum Pune chale gaye the aur phir wahin rahe')).toBe('hi-Latn');
  });

  it('does not call one stray word code-switching', () => {
    expect(detectLanguage('We moved to Pune because of a job on the railways')).toBe('en');
  });
});

describe('speech-to-text', () => {
  it('streams partials as audio arrives, then a final', async () => {
    const stt = new LocalStreamingSpeechToText();
    const stream = await stt.open({
      sessionId: 's',
      language: 'en',
      sampleRate: 16000,
      sidecarText: 'We moved to Pune in nineteen sixty two',
    });

    const collected: unknown[] = [];
    const reading = (async () => {
      for await (const event of stream.events()) collected.push(event);
    })();

    for (let i = 0; i < 8; i += 1) {
      await stream.push({ audio: new Uint8Array(10240), sampleRate: 16000, offsetMs: i * 320 });
    }
    await stream.flush();
    await reading;

    const partials = collected.filter((e) => (e as { type: string }).type === 'partial');
    const finals = collected.filter((e) => (e as { type: string }).type === 'final');
    expect(partials.length).toBeGreaterThan(1);
    expect(finals).toHaveLength(1);
  });

  it('says it cannot transcribe rather than inventing words', async () => {
    // The most important behaviour in this adapter. A fabricated transcript
    // here would become a fabricated memory.
    const stt = new LocalStreamingSpeechToText();
    const stream = await stt.open({ sessionId: 's', language: 'en', sampleRate: 16000 });

    const collected: unknown[] = [];
    const reading = (async () => {
      for await (const event of stream.events()) collected.push(event);
    })();
    await stream.push({ audio: new Uint8Array(10240), sampleRate: 16000, offsetMs: 0 });
    await stream.flush();
    await reading;

    expect(collected).toHaveLength(1);
    expect(collected[0]).toMatchObject({ type: 'error', code: 'no_recognisable_speech' });
  });
});

describe('speech synthesis', () => {
  it('emits audio for a clause, in chunks', async () => {
    const tts = new LocalStreamingTextToSpeech();
    const stream = await tts.open({ sessionId: 's', language: 'en', sampleRate: 16000 });
    const chunks = [];
    for await (const chunk of stream.speak('She moved to Pune in 1962.')) chunks.push(chunk);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.audio.byteLength).toBeGreaterThan(0);
  });

  it('stops producing audio once cancelled', async () => {
    const tts = new LocalStreamingTextToSpeech();
    const stream = await tts.open({ sessionId: 's', language: 'en', sampleRate: 16000 });
    const chunks = [];
    for await (const chunk of stream.speak('A reasonably long clause that takes several chunks.')) {
      chunks.push(chunk);
      await stream.cancel('user_interrupted');
    }
    // One chunk was already in flight; nothing after the cancellation.
    expect(chunks).toHaveLength(1);
  });

  it('uses a voice from the permitted generic list', () => {
    const tts = new LocalStreamingTextToSpeech();
    expect(isPermittedVoice(tts.voiceId)).toBe(true);
  });

  it('refuses any voice identifier that is not a permitted generic one', () => {
    for (const voice of ['kamala-cloned-v1', 'storyteller-voice', 'custom-1948']) {
      expect(isPermittedVoice(voice)).toBe(false);
    }
  });
});

describe('clause splitting', () => {
  it('splits on sentence and clause boundaries', () => {
    expect(splitClauses('She moved to Pune, then to Nagpur. Her father worked there.')).toEqual([
      'She moved to Pune,',
      'then to Nagpur.',
      'Her father worked there.',
    ]);
  });

  it('returns nothing for empty text', () => {
    expect(splitClauses('   ')).toEqual([]);
  });
});
