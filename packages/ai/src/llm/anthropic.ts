import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '@everecho/config';
import {
  ANSWER_SYSTEM_PROMPT,
  BIOGRAPHY_SYSTEM_PROMPT,
  EXTRACTION_SYSTEM_PROMPT,
  INTERVIEW_SYSTEM_PROMPT,
} from '../prompts';
import { isolateEvidence } from '../injection';
import type {
  AnswerInput,
  AnswerOutput,
  BiographyInput,
  BiographySection,
  ExtractionInput,
  ExtractionOutput,
  LlmAdapter,
  QuestionInput,
  QuestionOutput,
} from './types';

/**
 * Hosted composition through the Claude Messages API.
 *
 * UNVERIFIED in this build: no API key was available, so this adapter has been
 * type-checked against the official SDK but never executed. Set
 * LLM_DRIVER=anthropic with LLM_API_KEY to enable it.
 *
 * Structured output is obtained by forcing a single tool call with a strict
 * schema, rather than by parsing prose. The model must fill the schema or the
 * request fails loudly, which is the behaviour we want: a malformed extraction
 * should never be silently coerced into a memory.
 */
export class AnthropicLlmAdapter implements LlmAdapter {
  readonly name = 'anthropic';
  readonly modelVersion: string;
  /** Generative, not extractive — so verification is mandatory downstream. */
  readonly extractive = false;

  private readonly client: Anthropic;
  private readonly maxTokens: number;

  constructor(private readonly cfg: AppConfig) {
    this.modelVersion = cfg.env.ANTHROPIC_MODEL;
    this.maxTokens = cfg.env.ANTHROPIC_MAX_TOKENS;
    this.client = new Anthropic({ apiKey: cfg.env.LLM_API_KEY });
  }

  /**
   * One request, one forced tool call, one validated object.
   * `strict: true` requires `additionalProperties: false` and `required`.
   */
  private async structured<T>(args: {
    system: string;
    userContent: string;
    toolName: string;
    description: string;
    schema: Record<string, unknown>;
  }): Promise<T> {
    try {
      const response = await this.client.messages.create({
        model: this.modelVersion,
        max_tokens: this.maxTokens,
        system: args.system,
        tools: [
          {
            name: args.toolName,
            description: args.description,
            input_schema: args.schema as Anthropic.Tool['input_schema'],
            strict: true,
          },
        ],
        tool_choice: { type: 'tool', name: args.toolName },
        messages: [{ role: 'user', content: args.userContent }],
      });

      if (response.stop_reason === 'refusal') {
        throw new Error(
          `Provider declined this request (${response.stop_details?.category ?? 'unspecified'})`,
        );
      }
      const toolUse = response.content.find((block) => block.type === 'tool_use');
      if (!toolUse || toolUse.type !== 'tool_use') {
        throw new Error('Provider returned no structured output');
      }
      // Tool inputs are already parsed objects; never string-match them.
      return toolUse.input as T;
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        throw new Error('Composition provider is rate limited; try again shortly');
      }
      if (error instanceof Anthropic.AuthenticationError) {
        throw new Error('Composition provider rejected the configured credentials');
      }
      if (error instanceof Anthropic.APIError) {
        throw new Error(`Composition provider error ${error.status}`);
      }
      throw error;
    }
  }

  async extractCandidates(input: ExtractionInput): Promise<ExtractionOutput> {
    const passages = input.segments.map((s) => ({ id: s.id, text: s.text }));
    return this.structured<ExtractionOutput>({
      system: EXTRACTION_SYSTEM_PROMPT,
      // Isolated so a transcript that reads like an instruction stays data.
      userContent: isolateEvidence(passages),
      toolName: 'record_candidates',
      description: 'Record only what the passages state, with the segment id for each claim.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['memories', 'unresolvedReferences'],
        properties: {
          memories: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['title', 'body', 'claims', 'topics', 'entityNames'],
              properties: {
                title: { type: 'string' },
                body: { type: 'string' },
                topics: { type: 'array', items: { type: 'string' } },
                entityNames: { type: 'array', items: { type: 'string' } },
                claims: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['text', 'transcriptSegmentId', 'quotedText'],
                    properties: {
                      text: { type: 'string' },
                      transcriptSegmentId: { type: 'string' },
                      quotedText: {
                        type: 'string',
                        description: 'Verbatim span from the passage that supports this claim.',
                      },
                    },
                  },
                },
              },
            },
          },
          unresolvedReferences: { type: 'array', items: { type: 'string' } },
        },
      },
    }).then((raw) => ({
      memories: (raw.memories ?? []).map((m) => ({
        ...m,
        occurredOn: null,
        placeName: null,
        claims: (m.claims ?? []).map((c) => ({
          ...c,
          locator: { kind: 'transcript_segment', segmentId: c.transcriptSegmentId },
          confidence: 0.8,
        })),
      })),
      unresolvedReferences: raw.unresolvedReferences ?? [],
    }));
  }

  async composeAnswer(input: AnswerInput): Promise<AnswerOutput> {
    const evidence = isolateEvidence(input.passages.map((p) => ({ id: p.id, text: p.text })));
    return this.structured<AnswerOutput>({
      system: ANSWER_SYSTEM_PROMPT,
      userContent: `Subject: ${input.subjectName}\n\nQuestion: ${input.question}\n\nEvidence:\n${evidence}`,
      toolName: 'record_answer',
      description:
        'Record atomic third-person claims, each citing the evidence ids that support it.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['claims', 'abstain'],
        properties: {
          abstain: { type: 'boolean' },
          claims: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['text', 'evidenceIds'],
              properties: {
                text: { type: 'string' },
                evidenceIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    });
  }

  async composeBiography(input: BiographyInput): Promise<BiographySection[]> {
    const result = await this.structured<{ sections: BiographySection[] }>({
      system: BIOGRAPHY_SYSTEM_PROMPT,
      userContent: `Subject: ${input.subjectName}\n\n${isolateEvidence(
        input.memories.map((m) => ({ id: m.id, text: `${m.title}\n${m.body}` })),
      )}`,
      toolName: 'record_biography',
      description: 'Record third-person biography sections citing the memory ids used.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sections'],
        properties: {
          sections: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'heading', 'text', 'claimIds'],
              properties: {
                id: { type: 'string' },
                heading: { type: 'string' },
                text: { type: 'string' },
                claimIds: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    });
    const byMemory = new Map(input.memories.map((m) => [m.id, m]));
    return (result.sections ?? []).map((section) => ({
      ...section,
      sourceIds: [...new Set(section.claimIds.flatMap((id) => byMemory.get(id)?.sourceIds ?? []))],
    }));
  }

  async nextQuestion(input: QuestionInput): Promise<QuestionOutput> {
    return this.structured<QuestionOutput>({
      system: INTERVIEW_SYSTEM_PROMPT,
      userContent: [
        `Topics already covered: ${input.coveredTopics.join(', ') || 'none'}`,
        `Topics the storyteller has restricted (never ask about these): ${input.restrictedTopics.join(', ') || 'none'}`,
        `Questions already asked: ${input.askedQuestions.join(' | ') || 'none'}`,
        input.lastResponseText
          ? `Their last answer:\n${input.lastResponseText}`
          : 'This is the first question.',
      ].join('\n\n'),
      toolName: 'record_question',
      description: 'Record the single next question to ask.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'questionText', 'sensitivityNotice'],
        properties: {
          topic: { type: 'string' },
          questionText: { type: 'string' },
          sensitivityNotice: { type: ['string', 'null'] },
        },
      },
    });
  }

  async summariseSession(input: {
    responses: readonly string[];
    subjectName: string;
  }): Promise<string> {
    const result = await this.structured<{ summary: string }>({
      system: `${INTERVIEW_SYSTEM_PROMPT}\n\nSummarise in the third person. Use only what was said. This is a draft for the storyteller to correct.`,
      userContent: isolateEvidence(input.responses.map((text, i) => ({ id: `r${i}`, text }))),
      toolName: 'record_summary',
      description: 'Record a short third-person summary of what was discussed.',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
    });
    return result.summary;
  }
}
