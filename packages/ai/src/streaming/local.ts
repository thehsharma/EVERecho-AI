import { splitSentences, contentTokens, coverage } from '../text';
import type { EvidencePassage } from '../verify';
import type {
  LlmStream,
  LlmStreamEvent,
  SttEvent,
  SttStream,
  StreamCapabilities,
  StreamingConversationInput,
  StreamingLanguageModel,
  StreamingSpeechToText,
  StreamingTextToSpeech,
  ToolResult,
  TtsChunk,
  TtsStream,
} from './types';

const LOCAL_CAPS = (name: string): StreamCapabilities => ({
  name,
  version: 'local-deterministic-v1',
  sendsDataOffHost: false,
  retentionDays: 0,
  permitsModelTraining: false,
  languages: ['en', 'hi', 'hi-Latn'],
  supportsCancellation: true,
});

/**
 * A small async queue.
 *
 * Producers push, one consumer iterates. Bounded: a producer that outruns the
 * consumer is a backpressure problem, not a memory problem, so the queue drops
 * its oldest audio rather than growing without limit.
 */
class EventQueue<T> {
  private readonly items: T[] = [];
  private resolvers: ((value: IteratorResult<T>) => void)[] = [];
  private done = false;

  constructor(private readonly maxDepth = 512) {}

  push(item: T): void {
    if (this.done) return;
    const resolve = this.resolvers.shift();
    if (resolve) {
      resolve({ value: item, done: false });
      return;
    }
    if (this.items.length >= this.maxDepth) this.items.shift();
    this.items.push(item);
  }

  end(): void {
    if (this.done) return;
    this.done = true;
    for (const resolve of this.resolvers) resolve({ value: undefined, done: true });
    this.resolvers = [];
  }

  iterator(): AsyncIterableIterator<T> {
    const next = async (): Promise<IteratorResult<T>> => {
      const item = this.items.shift();
      if (item !== undefined) return { value: item, done: false };
      if (this.done) return { value: undefined, done: true };
      return new Promise((resolve) => this.resolvers.push(resolve));
    };
    const iterator: AsyncIterableIterator<T> = {
      [Symbol.asyncIterator]: () => iterator,
      next,
      // Called when a consumer breaks out of `for await`, which is what
      // happens on barge-in. Ending the queue releases any pending producer.
      return: async () => {
        this.end();
        return { value: undefined, done: true };
      },
    };
    return iterator;
  }
}

// ---------------------------------------------------------------------------
// Speech to text
// ---------------------------------------------------------------------------

/**
 * Local streaming speech-to-text.
 *
 * **It cannot recognise speech, and it does not pretend to.** What it does is
 * stream out, word by word, text that was captured alongside the audio — the
 * browser's own live recogniser during an interview, or a transcript supplied
 * with a recording. That text is real content produced by a real recogniser,
 * so the pipeline downstream of here is exercised honestly.
 *
 * Given audio and no such text, it reports that it cannot transcribe. It never
 * invents words, because a fabricated transcript in this product would become
 * a fabricated memory.
 */
class LocalSttStream implements SttStream {
  private readonly queue = new EventQueue<SttEvent>();
  private readonly words: string[];
  private emitted = 0;
  private offsetMs = 0;
  private cancelled = false;
  private audioMs = 0;

  constructor(
    private readonly language: string,
    sidecarText: string | null | undefined,
  ) {
    this.words = (sidecarText ?? '').trim().split(/\s+/).filter(Boolean);
  }

  async push(input: { audio: Uint8Array; sampleRate: number; offsetMs: number }): Promise<void> {
    if (this.cancelled) return;
    this.offsetMs = input.offsetMs;
    const samples = Math.floor(input.audio.byteLength / 2);
    this.audioMs += (samples / input.sampleRate) * 1000;

    if (this.words.length === 0) return;

    // Reveal words in step with the audio, so a caption appears while somebody
    // is still speaking rather than all at once at the end.
    const target = Math.min(this.words.length, Math.max(1, Math.floor(this.audioMs / 320)));
    if (target > this.emitted) {
      this.emitted = target;
      this.queue.push({
        type: 'partial',
        text: this.words.slice(0, this.emitted).join(' '),
        language: this.language === 'auto' ? detectLanguage(this.words.join(' ')) : this.language,
        offsetMs: this.offsetMs,
      });
    }
  }

  async flush(): Promise<void> {
    if (this.cancelled) return;
    if (this.words.length === 0) {
      this.queue.push({
        type: 'error',
        code: 'no_recognisable_speech',
        // Said plainly. A local adapter that faked a transcript here would be
        // fabricating the storyteller's words.
        message:
          'This deployment has no speech recogniser. Audio was received but no text was ' +
          'captured alongside it, so nothing can be transcribed.',
      });
      this.queue.end();
      return;
    }
    const text = this.words.join(' ');
    this.queue.push({
      type: 'final',
      text,
      language: this.language === 'auto' ? detectLanguage(text) : this.language,
      offsetMs: this.offsetMs,
      confidence: 0.99,
      synthetic: true,
    });
    this.queue.end();
  }

  events(): AsyncIterableIterator<SttEvent> {
    return this.queue.iterator();
  }

  async close(): Promise<void> {
    this.queue.end();
  }

  async cancel(_reason: string): Promise<void> {
    this.cancelled = true;
    this.queue.end();
  }
}

export class LocalStreamingSpeechToText implements StreamingSpeechToText {
  readonly capabilities = LOCAL_CAPS('local-streaming-stt');

  async open(input: {
    sessionId: string;
    language: string;
    sampleRate: number;
    sidecarText?: string | null;
  }): Promise<SttStream> {
    return new LocalSttStream(input.language, input.sidecarText);
  }
}

/**
 * Language detection good enough to label a transcript, and honest about being
 * a heuristic.
 *
 * Devanagari is unambiguous. Hinglish is guessed from common romanised Hindi
 * function words, which is genuinely approximate — the user can always correct
 * it, and the transcript keeps whatever they say it is.
 */
const HINGLISH_MARKERS = new Set([
  'hai',
  'tha',
  'thi',
  'the',
  'nahi',
  'nahin',
  'kya',
  'kaise',
  'mera',
  'meri',
  'apna',
  'humne',
  'hum',
  'aap',
  'mujhe',
  'unko',
  'bahut',
  'aur',
  'lekin',
  'kyunki',
  'phir',
  'toh',
  'bhi',
  'karke',
  'gaya',
  'gayi',
  'diya',
  'liya',
]);

export function detectLanguage(text: string): string {
  if (/[ऀ-ॿ]/.test(text)) return 'hi';
  const words = text
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (words.length === 0) return 'en';
  const markers = words.filter((w) => HINGLISH_MARKERS.has(w)).length;
  // A single marker in a long English sentence is not code-switching.
  return markers >= 2 || markers / words.length > 0.15 ? 'hi-Latn' : 'en';
}

// ---------------------------------------------------------------------------
// Language model
// ---------------------------------------------------------------------------

/**
 * The local streaming composer.
 *
 * **Extractive**: every clause it emits is selected from a retrieved passage
 * and attributed to it. It has no generative capacity at all, so fabrication
 * is unavailable rather than merely rare, and the deterministic demonstration
 * exercises the real verification and abstention paths instead of a happy path
 * around them.
 */
class LocalLlmStream implements LlmStream {
  private readonly queue = new EventQueue<LlmStreamEvent>();
  private cancelled = false;

  constructor(private readonly input: StreamingConversationInput) {
    // Deferred so the caller can start iterating before events arrive, which is
    // what makes this behave like a stream rather than a batch.
    queueMicrotask(() => void this.run());
  }

  private async run(): Promise<void> {
    const { mode, userTurn, passages } = this.input;

    if (mode === 'interview') {
      await this.runInterview();
      return;
    }

    const scored = rankPassages(userTurn, passages);
    if (scored.length === 0) {
      if (this.cancelled) return;
      this.queue.push({ type: 'abstain', reason: 'no_evidence' });
      this.queue.push({ type: 'done', inputTokens: 0, outputTokens: 0 });
      this.queue.end();
      return;
    }

    let index = 0;
    for (const { passage } of scored.slice(0, 4)) {
      if (this.cancelled) return;
      // One clause per passage, taken verbatim from what was actually said.
      const sentence = firstUsefulSentence(passage.text);
      if (!sentence) continue;
      this.queue.push({
        type: 'clause',
        index,
        text: sentence,
        evidenceIds: [passage.id],
      });
      index += 1;
      // A tick between clauses so a consumer can interrupt mid-answer, which is
      // the behaviour the barge-in path has to be able to test.
      await Promise.resolve();
    }

    if (index === 0) {
      this.queue.push({ type: 'abstain', reason: 'insufficient_evidence' });
    }
    this.queue.push({ type: 'done', inputTokens: 0, outputTokens: 0 });
    this.queue.end();
  }

  /**
   * The interviewer.
   *
   * Asks one question at a time, never asserts a fact, and never completes an
   * unfinished sentence on the storyteller's behalf. When a person or a date
   * is left unresolved it asks about that rather than moving on, because the
   * unresolved reference is usually the thing the family will want.
   */
  private async runInterview(): Promise<void> {
    const unresolved = findUnresolvedReferences(this.input.userTurn);

    if (unresolved.length > 0) {
      this.queue.push({
        type: 'tool_request',
        request: {
          id: `clarify-${this.input.askedQuestions.length}`,
          name: 'propose_clarifying_question',
          input: { about: unresolved[0], userTurn: this.input.userTurn },
        },
      });
    }

    // Candidate extraction is a tool request rather than an assertion: the
    // model proposes, the server decides, and the storyteller approves.
    if (this.input.userTurn.trim().length > 0) {
      this.queue.push({
        type: 'tool_request',
        request: {
          id: `candidate-${this.input.history.length}`,
          name: 'propose_memory_candidate',
          input: { userTurn: this.input.userTurn },
        },
      });
    }

    const question = nextInterviewQuestion({
      unresolved: unresolved[0] ?? null,
      covered: this.input.coveredTopics,
      asked: this.input.askedQuestions,
      language: this.input.language,
    });

    if (this.cancelled) return;
    this.queue.push({ type: 'clause', index: 0, text: question, evidenceIds: [] });
    this.queue.push({ type: 'done', inputTokens: 0, outputTokens: 0 });
    this.queue.end();
  }

  events(): AsyncIterableIterator<LlmStreamEvent> {
    return this.queue.iterator();
  }

  async provideToolResult(_result: ToolResult): Promise<void> {
    // The local composer does not branch on tool output: it proposes, and the
    // server does the work. A hosted model continues generation here.
  }

  async cancel(_reason: string): Promise<void> {
    this.cancelled = true;
    this.queue.end();
  }
}

export class LocalStreamingLanguageModel implements StreamingLanguageModel {
  readonly capabilities = LOCAL_CAPS('local-streaming-llm');
  readonly modelVersion = 'local-deterministic-v1';
  readonly promptVersion = 'realtime-2026-01';
  readonly extractive = true;

  async converse(input: StreamingConversationInput): Promise<LlmStream> {
    return new LocalLlmStream(input);
  }
}

// ---------------------------------------------------------------------------
// Text to speech
// ---------------------------------------------------------------------------

/**
 * Local streaming speech synthesis.
 *
 * Emits a soft tone shaped by the length of each clause — **not** speech, and
 * deliberately nothing that could be mistaken for a person. It exists so the
 * audio transport, the clause-by-clause pacing, the barge-in cancellation and
 * the playback path are all exercised end to end without a paid provider.
 *
 * It is never described as a voice, and it proves nothing about a real
 * provider's quality or latency.
 */
class LocalTtsStream implements TtsStream {
  private cancelled = false;

  constructor(private readonly sampleRate: number) {}

  async *speak(text: string): AsyncIterableIterator<TtsChunk> {
    const durationMs = Math.min(6000, Math.max(240, text.length * 55));
    const chunkMs = 120;
    const chunks = Math.ceil(durationMs / chunkMs);

    for (let i = 0; i < chunks; i += 1) {
      // Checked between chunks: this is what makes barge-in stop audio that has
      // been generated but not yet delivered.
      if (this.cancelled) return;
      const thisMs = Math.min(chunkMs, durationMs - i * chunkMs);
      yield {
        audio: tone({
          durationMs: thisMs,
          sampleRate: this.sampleRate,
          // Gentle downward drift so a listener can tell one clause from the
          // next without it resembling intonation.
          frequencyHz: 210 - Math.min(60, i * 3),
          amplitude: 3200,
        }),
        sampleRate: this.sampleRate,
        durationMs: thisMs,
      };
      await Promise.resolve();
    }
  }

  async cancel(_reason: string): Promise<void> {
    this.cancelled = true;
  }

  async close(): Promise<void> {
    this.cancelled = true;
  }
}

export class LocalStreamingTextToSpeech implements StreamingTextToSpeech {
  readonly capabilities = LOCAL_CAPS('local-streaming-tts');
  /** Matches the permitted-voice allow-list. Never the storyteller's voice. */
  readonly voiceId = 'local-neutral-synthetic-v1';

  async open(input: {
    sessionId: string;
    language: string;
    sampleRate: number;
  }): Promise<TtsStream> {
    return new LocalTtsStream(input.sampleRate);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tone(input: {
  durationMs: number;
  sampleRate: number;
  frequencyHz: number;
  amplitude: number;
}): Uint8Array {
  const samples = Math.max(0, Math.round((input.durationMs / 1000) * input.sampleRate));
  const out = new Uint8Array(samples * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples; i += 1) {
    // Short fades stop each chunk boundary from clicking.
    const fade = Math.min(1, Math.min(i, samples - i) / (input.sampleRate * 0.01));
    const value = Math.round(
      input.amplitude * fade * Math.sin((2 * Math.PI * input.frequencyHz * i) / input.sampleRate),
    );
    view.setInt16(i * 2, value, true);
  }
  return out;
}

/**
 * How much of a question a passage must actually answer.
 *
 * A single shared word is not an answer. Asked "what did she think about the
 * moon landing", a passage saying "I have thought about him often since"
 * shares one stem out of three — it is supported, cited and correctly
 * attributed, and it is not an answer to the question. Returning it is worse
 * than abstaining, because the citation makes it look reliable.
 *
 * Verification cannot catch this: the sentence is perfectly supported by the
 * evidence it cites. What is missing is relevance, not support.
 *
 * Half the question's content words is the bar, and it is measured rather than
 * guessed: genuine answers in the demonstration archive score 0.5, and that
 * near-miss scores 0.33.
 */
const MIN_QUESTION_COVERAGE = 0.5;

function rankPassages(
  question: string,
  passages: readonly EvidencePassage[],
): { passage: EvidencePassage; score: number }[] {
  if (contentTokens(question).length === 0) return [];
  return (
    passages
      // How much of the question the passage covers, not the reverse: a long
      // passage should not be penalised for containing more than was asked.
      .map((passage) => ({ passage, score: coverage(question, passage.text) }))
      .filter((entry) => entry.score >= MIN_QUESTION_COVERAGE)
      // Deterministic tie-break: two passages with the same score must not
      // produce different answers on different runs.
      .sort((a, b) => b.score - a.score || a.passage.id.localeCompare(b.passage.id))
  );
}

function firstUsefulSentence(text: string): string | null {
  for (const sentence of splitSentences(text)) {
    const trimmed = sentence.trim();
    if (trimmed.length >= 12) return trimmed;
  }
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Pronouns and vague references the interview should ask about.
 *
 * "He said we should go" names nobody. Left unresolved, it becomes a memory
 * about an unidentified person, which is the kind of gap that is impossible to
 * close once the storyteller is gone.
 */
const VAGUE_REFERENCES = [
  'he',
  'she',
  'they',
  'him',
  'her',
  'them',
  'someone',
  'somebody',
  'my brother',
  'my sister',
  'my uncle',
  'my aunt',
  'my cousin',
  'my friend',
  'that man',
  'that woman',
  'the neighbour',
  'the neighbor',
];

export function findUnresolvedReferences(text: string): string[] {
  const lower = ` ${text.toLowerCase()} `;
  const found: string[] = [];
  for (const reference of VAGUE_REFERENCES) {
    if (lower.includes(` ${reference} `)) found.push(reference);
  }
  // A vague date is the other thing worth asking about.
  if (/\b(?:some|a few|several|many)\s+years?\s+(?:ago|later|before)\b/i.test(text)) {
    found.push('an approximate date');
  }
  return [...new Set(found)];
}

/**
 * The next question.
 *
 * One at a time. Never leading, never completing a thought for the storyteller,
 * and never asserting a fact they did not say. Follows their language.
 */
export function nextInterviewQuestion(input: {
  unresolved: string | null;
  covered: readonly string[];
  asked: readonly string[];
  language: string;
}): string {
  const hindi = input.language === 'hi';

  if (input.unresolved) {
    if (input.unresolved === 'an approximate date') {
      return hindi
        ? 'क्या आपको याद है कि यह लगभग किस साल की बात है?'
        : 'Do you remember roughly what year that was?';
    }
    return hindi
      ? `आपने "${input.unresolved}" कहा — वह कौन थे?`
      : `You mentioned "${input.unresolved}" — who was that?`;
  }

  const openings = hindi
    ? [
        'उस समय आपके आसपास कौन-कौन था?',
        'वह जगह कैसी दिखती थी?',
        'उस दिन की कोई ऐसी बात जो आपको आज भी याद है?',
        'उसके बाद क्या हुआ?',
      ]
    : [
        'Who else was there at the time?',
        'What did that place look like?',
        'Is there something about that day you still remember clearly?',
        'What happened after that?',
      ];

  // Falls back to the last opening rather than repeating: running out of
  // questions should end the interview gracefully, not loop.
  const unused = openings.filter((q) => !input.asked.includes(q));
  return unused[0] ?? openings.at(-1) ?? 'What would you like to tell me about?';
}

/**
 * Splits generated text into clauses for verification and speech.
 *
 * Clause-sized rather than sentence-sized so that verification is granular and
 * a failing fragment is dropped without discarding the sentences around it.
 */
export function splitClauses(text: string): string[] {
  return splitSentences(text)
    .flatMap((sentence) => sentence.split(/(?<=[,;:])\s+/))
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
}
