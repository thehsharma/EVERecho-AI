import type { AppConfig } from '@everecho/config';
import {
  contentTokens,
  coverage,
  extractDecades,
  extractProperNouns,
  extractYears,
  splitSentences,
  stableHash,
  tokenOverlap,
  truncate,
} from '../text';
import { TOPIC_PLANS } from '../prompts/interview';
import type {
  AnswerInput,
  AnswerOutput,
  BiographyInput,
  BiographySection,
  CandidateClaim,
  CandidateMemory,
  ExtractionInput,
  ExtractionOutput,
  LlmAdapter,
  QuestionInput,
  QuestionOutput,
} from './types';

/** Words that make a sentence a question or an aside rather than an assertion. */
const NON_ASSERTIVE = /^(?:and|but|so|well|um|uh|hmm|yes|no|okay|right)\b/i;

/**
 * The local composer.
 *
 * It is **extractive**: every sentence it emits is selected from text that the
 * storyteller actually produced, then attributed to the exact passage it came
 * from. It has no generative capacity, which is the point — it cannot invent a
 * memory, so demo mode exercises the real provenance, verification and
 * abstention paths rather than a happy path around them.
 *
 * It is not a language model, and the interface never describes it as one. The
 * UI labels its output "AI-assisted (local deterministic composer)".
 */
export class LocalLlmAdapter implements LlmAdapter {
  readonly name = 'local-deterministic';
  readonly modelVersion: string;
  readonly extractive = true;

  constructor(cfg: AppConfig) {
    this.modelVersion = cfg.env.LLM_MODEL;
  }

  async extractCandidates(input: ExtractionInput): Promise<ExtractionOutput> {
    const memories: CandidateMemory[] = [];
    const unresolved = new Set<string>();

    for (const segment of input.segments) {
      const sentences = splitSentences(segment.text).filter((s) => contentTokens(s).length >= 3);
      if (sentences.length === 0) continue;

      const claims: CandidateClaim[] = [];
      let offset = 0;
      for (const sentence of sentences) {
        const startChar = segment.text.indexOf(sentence, offset);
        offset = startChar >= 0 ? startChar + sentence.length : offset;
        if (NON_ASSERTIVE.test(sentence) && contentTokens(sentence).length < 5) continue;

        claims.push({
          text: sentence,
          transcriptSegmentId: segment.id,
          locator: {
            kind:
              segment.page !== null
                ? 'page'
                : segment.startMs !== null
                  ? 'timestamp'
                  : 'transcript_segment',
            segmentId: segment.id,
            ...(segment.page !== null ? { page: segment.page } : {}),
            ...(segment.startMs !== null ? { startMs: segment.startMs, endMs: segment.endMs } : {}),
            ...(startChar >= 0 ? { startChar, endChar: startChar + sentence.length } : {}),
          },
          // The claim IS the quoted text: extraction never rewrites.
          quotedText: sentence,
          confidence: 1,
        });
      }
      if (claims.length === 0) continue;

      const body = sentences.join(' ');
      const years = extractYears(body);
      const decades = extractDecades(body);
      const properNouns = extractProperNouns(body);

      memories.push({
        title: this.titleFor(sentences[0]!, body),
        body,
        claims,
        topics: this.topicsFor(body),
        occurredOn:
          years.length > 0
            ? { value: String(years[0]), precision: 'year' }
            : decades.length > 0
              ? { value: String(decades[0]), precision: 'decade' }
              : null,
        entityNames: properNouns,
        placeName: this.placeFor(body, properNouns),
      });

      for (const reference of this.unresolvedReferences(body)) unresolved.add(reference);
    }

    return { memories, unresolvedReferences: [...unresolved] };
  }

  /** A title is a shortened first sentence — never a summary the source did not make. */
  private titleFor(firstSentence: string, body: string): string {
    const candidate = firstSentence.replace(/^(?:and|but|so|well)\s+/i, '');
    return truncate(candidate.length < 12 ? body : candidate, 70).replace(/[.,;:]$/, '');
  }

  private topicsFor(text: string): string[] {
    const tokens = new Set(contentTokens(text));
    const hints: Record<string, string[]> = {
      childhood: ['childhood', 'child', 'young', 'school', 'boy', 'girl', 'born', 'grew'],
      family: [
        'mother',
        'father',
        'mum',
        'mom',
        'dad',
        'parents',
        'sister',
        'brother',
        'family',
        'grandmother',
        'grandfather',
      ],
      education: ['school', 'college', 'university', 'teacher', 'studied', 'exam', 'class'],
      career: [
        'work',
        'worked',
        'job',
        'office',
        'factory',
        'business',
        'company',
        'career',
        'shop',
      ],
      love: ['married', 'marriage', 'wife', 'husband', 'wedding', 'met', 'love'],
      traditions: ['festival', 'diwali', 'christmas', 'eid', 'tradition', 'ritual', 'celebrate'],
      challenges: [
        'illness',
        'hospital',
        'died',
        'death',
        'lost',
        'hard',
        'difficult',
        'struggle',
        'war',
      ],
      friendships: ['friend', 'friends', 'neighbour', 'neighbor'],
      values: ['believe', 'important', 'taught', 'honest', 'respect', 'values'],
      advice: ['advice', 'should', 'tell', 'learn', 'lesson'],
    };
    const topics = Object.entries(hints)
      .filter(([, words]) => words.some((w) => tokens.has(w)))
      .map(([topic]) => topic);
    return topics.length > 0 ? topics : ['general'];
  }

  private placeFor(text: string, properNouns: readonly string[]): string | null {
    const match = text.match(
      /\b(?:in|at|from|to|near)\s+([A-Z][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)*)/u,
    );
    const candidate = match?.[1];
    return candidate && properNouns.includes(candidate) ? candidate : (candidate ?? null);
  }

  /**
   * Pronouns and kinship terms with no antecedent in the same passage. These
   * become the interviewer's clarifying questions instead of a guess.
   */
  private unresolvedReferences(text: string): string[] {
    const found: string[] = [];
    const sentences = splitSentences(text);
    sentences.forEach((sentence, index) => {
      const opensWithPronoun = /^(?:he|she|they|him|her|them)\b/i.exec(sentence.trim());
      const priorHasName = sentences.slice(0, index).some((s) => extractProperNouns(s).length > 0);
      if (opensWithPronoun && !priorHasName) found.push(opensWithPronoun[0].toLowerCase());
    });
    for (const kinship of text.matchAll(
      /\bmy (sister|brother|aunt|uncle|cousin|neighbour|neighbor|friend)\b/gi,
    )) {
      found.push(`my ${kinship[1]!.toLowerCase()}`);
    }
    return [...new Set(found)];
  }

  /**
   * Selects the sentences in the evidence that answer the question, and cites
   * the passage each came from. Selection, not generation.
   */
  async composeAnswer(input: AnswerInput): Promise<AnswerOutput> {
    const questionTokens = new Set(contentTokens(input.question));
    if (questionTokens.size === 0) return { claims: [], abstain: true };

    const scored: { text: string; evidenceId: string; score: number }[] = [];
    for (const passage of input.passages) {
      for (const sentence of splitSentences(passage.text)) {
        const tokens = contentTokens(sentence);
        if (tokens.length < 3) continue;
        const overlap = tokens.filter((t) => questionTokens.has(t)).length;
        if (overlap === 0) continue;
        // Favour sentences that answer the question without padding around it.
        const score = overlap / Math.sqrt(tokens.length);
        scored.push({ text: sentence, evidenceId: passage.id, score });
      }
    }
    if (scored.length === 0) return { claims: [], abstain: true };

    scored.sort((a, b) => b.score - a.score);

    const claims: { text: string; evidenceIds: string[] }[] = [];
    for (const candidate of scored) {
      if (claims.length >= 5) break;
      // Do not repeat the same fact from two recordings as two separate claims;
      // add the second recording as corroboration of the first instead.
      const duplicate = claims.find((c) => tokenOverlap(c.text, candidate.text) >= 0.8);
      if (duplicate) {
        if (!duplicate.evidenceIds.includes(candidate.evidenceId)) {
          duplicate.evidenceIds.push(candidate.evidenceId);
        }
        continue;
      }
      claims.push({ text: candidate.text, evidenceIds: [candidate.evidenceId] });
    }

    // Attach any other passage that independently supports the same claim, so
    // corroboration is found rather than missed.
    for (const claim of claims) {
      for (const passage of input.passages) {
        if (claim.evidenceIds.includes(passage.id)) continue;
        if (coverage(claim.text, passage.text) >= 0.9) claim.evidenceIds.push(passage.id);
      }
    }

    return { claims, abstain: claims.length === 0 };
  }

  async composeBiography(input: BiographyInput): Promise<BiographySection[]> {
    const byTopic = new Map<string, BiographyInput['memories'][number][]>();
    for (const memory of input.memories) {
      const topic = memory.topics[0] ?? 'general';
      byTopic.set(topic, [...(byTopic.get(topic) ?? []), memory]);
    }

    const order = [
      'childhood',
      'family',
      'education',
      'friendships',
      'love',
      'career',
      'traditions',
      'challenges',
      'values',
      'advice',
      'general',
    ];
    const sections: BiographySection[] = [];

    for (const topic of order) {
      const memories = byTopic.get(topic);
      if (!memories || memories.length === 0) continue;

      const dated = [...memories].sort((a, b) =>
        (a.occurredOn ?? '9999').localeCompare(b.occurredOn ?? '9999'),
      );
      // Third person throughout, and only sentences the storyteller produced.
      const text = dated
        .map((m) => {
          const first = splitSentences(m.body)[0] ?? m.body;
          const when = m.occurredOn ? `In ${m.occurredOn}, ` : '';
          return `${when}${input.subjectName} recalled: “${truncate(first, 220)}”`;
        })
        .join(' ');

      sections.push({
        id: topic,
        heading: HEADINGS[topic] ?? 'Other recollections',
        text,
        sourceIds: [...new Set(dated.flatMap((m) => m.sourceIds))],
        claimIds: [...new Set(dated.flatMap((m) => m.claimIds))],
      });
    }
    return sections;
  }

  async nextQuestion(input: QuestionInput): Promise<QuestionOutput> {
    // A named person or place with nothing else said about it is the most
    // valuable next question — it follows what they just told us.
    if (input.lastResponseText) {
      const nouns = extractProperNouns(input.lastResponseText);
      const unasked = nouns.find(
        (n) =>
          !input.askedQuestions.some((q) => q.includes(n)) &&
          !this.isRestricted(n, input.restrictedTopics),
      );
      if (unasked) {
        return {
          topic: 'important_people',
          questionText: `You mentioned ${unasked}. Can you tell me more about that?`,
          sensitivityNotice: null,
        };
      }
    }

    const remaining = TOPIC_PLANS.filter(
      (p) =>
        !input.coveredTopics.includes(p.topic) &&
        !this.isRestricted(p.topic, input.restrictedTopics),
    );
    const plan = remaining[0] ?? TOPIC_PLANS[0]!;

    const followUps = plan.followUps.filter((q) => !input.askedQuestions.includes(q));
    const questionText = input.coveredTopics.includes(plan.topic)
      ? (followUps[0] ?? plan.opening)
      : plan.opening;

    return {
      topic: plan.topic,
      questionText,
      sensitivityNotice: SENSITIVE_TOPICS.includes(plan.topic)
        ? 'This one can be harder to talk about. Skip it if you would rather.'
        : null,
    };
  }

  private isRestricted(value: string, restricted: readonly string[]): boolean {
    const v = value.toLowerCase();
    return restricted.some((r) => {
      const needle = r.toLowerCase().trim();
      return needle.length > 0 && (v.includes(needle) || needle.includes(v));
    });
  }

  async summariseSession(input: {
    responses: readonly string[];
    subjectName: string;
  }): Promise<string> {
    const points = input.responses
      .flatMap((r) => splitSentences(r).slice(0, 1))
      .filter((s) => contentTokens(s).length >= 3)
      .slice(0, 8);

    if (points.length === 0) {
      return `${input.subjectName} did not record anything in this session.`;
    }
    // Explicitly a draft, explicitly quoting, explicitly third person.
    return [
      `In this session, ${input.subjectName} talked about the following. These are their own words, for them to correct:`,
      ...points.map((p) => `• “${truncate(p, 200)}”`),
    ].join('\n');
  }
}

const HEADINGS: Record<string, string> = {
  childhood: 'Early years',
  family: 'Family',
  education: 'School and learning',
  friendships: 'Friendships',
  love: 'Marriage and partnership',
  career: 'Work',
  traditions: 'Traditions',
  challenges: 'Harder times',
  values: 'What mattered to them',
  advice: 'What they would pass on',
  general: 'Other recollections',
};

const SENSITIVE_TOPICS = ['challenges', 'regrets', 'failures'];

export { stableHash };
