import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

export const interviewTopicSchema = z.enum([
  'childhood',
  'family',
  'friendships',
  'education',
  'love',
  'career',
  'challenges',
  'failures',
  'achievements',
  'beliefs',
  'turning_points',
  'humour',
  'traditions',
  'culture',
  'values',
  'regrets',
  'lessons',
  'advice',
  'important_people',
]);
export type InterviewTopic = z.infer<typeof interviewTopicSchema>;

export const startInterviewRequestSchema = z.object({
  mode: z.enum(['text', 'audio']),
  topic: interviewTopicSchema.optional(),
});

export const interviewPromptSchema = z.object({
  id: idSchema,
  index: z.number().int(),
  topic: interviewTopicSchema,
  questionText: z.string(),
  promptVersion: z.string(),
  /** Always true. Every question in EverEcho may be skipped. */
  skippable: z.literal(true),
  /** Shown when the question touches something the storyteller marked sensitive. */
  sensitivityNotice: z.string().nullable(),
});
export type InterviewPrompt = z.infer<typeof interviewPromptSchema>;

export const answerInterviewPromptRequestSchema = z.object({
  promptId: idSchema,
  responseText: z.string().max(20_000).optional(),
  /** Set when the answer was spoken and uploaded as audio. */
  sourceAssetId: idSchema.optional(),
  action: z.enum(['answer', 'skip', 'prefer_not_to_answer', 'pause']),
});
export type AnswerInterviewPromptRequest = z.infer<typeof answerInterviewPromptRequestSchema>;

export const interviewSessionSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  mode: z.enum(['text', 'audio']),
  status: z.enum(['active', 'paused', 'completed', 'abandoned']),
  startedAt: timestampSchema,
  endedAt: timestampSchema.nullable(),
  promptsAnswered: z.number().int(),
  promptsSkipped: z.number().int(),
  topicsCovered: z.array(interviewTopicSchema),
  currentPrompt: interviewPromptSchema.nullable(),
  /** Draft until the storyteller corrects and approves it. */
  summaryText: z.string().nullable(),
  summaryApproved: z.boolean(),
  /** Set when distress language triggered the safety path. */
  safetyNotice: z
    .object({
      shown: z.boolean(),
      region: z.string(),
      message: z.string(),
      resources: z.array(z.object({ label: z.string(), contact: z.string() })),
    })
    .nullable(),
});
export type InterviewSession = z.infer<typeof interviewSessionSchema>;
