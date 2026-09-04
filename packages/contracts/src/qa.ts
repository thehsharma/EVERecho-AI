import { z } from 'zod';
import { abstentionReasonSchema, answerModeSchema, evidenceClassSchema } from './enums';
import { idSchema, locatorSchema, timestampSchema } from './primitives';

export const askQuestionRequestSchema = z.object({
  question: z.string().min(3).max(1000),
  /** Restrict the answer to specific sources. Never widens what is authorised. */
  sourceIds: z.array(idSchema).max(50).optional(),
});
export type AskQuestionRequest = z.infer<typeof askQuestionRequestSchema>;

export const responseCitationSchema = z.object({
  sourceId: idSchema,
  sourceFilename: z.string(),
  sourceKind: z.string(),
  locator: locatorSchema,
  quotedText: z.string(),
  memoryId: idSchema.nullable(),
});
export type ResponseCitation = z.infer<typeof responseCitationSchema>;

/** One atomic assertion. Every material claim carries its own citations. */
export const responseClaimSchema = z.object({
  index: z.number().int().min(0),
  text: z.string(),
  evidenceClass: evidenceClassSchema,
  sourceIds: z.array(idSchema),
  citations: z.array(responseCitationSchema),
  confidence: z.number().min(0).max(1),
  contradictionIds: z.array(idSchema),
  /** False means the claim failed verification and was dropped before display. */
  verified: z.boolean(),
});
export type ResponseClaim = z.infer<typeof responseClaimSchema>;

export const generatedResponseSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  answerMode: answerModeSchema,
  answerText: z.string(),
  claims: z.array(responseClaimSchema),
  abstained: z.boolean(),
  abstentionReason: abstentionReasonSchema.nullable(),
  policyVersion: z.string(),
  retrievalSnapshotId: idSchema,
  modelAndPromptVersion: z.string(),
  createdAt: timestampSchema,
  /** Never omitted, never quiet. The reader always knows a machine composed this. */
  aiAssisted: z.literal(true),
  /** Present so no client can render this as the storyteller speaking. */
  perspective: z.literal('third_person'),
});
export type GeneratedResponse = z.infer<typeof generatedResponseSchema>;

export const searchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const searchResultSchema = z.object({
  memoryId: idSchema,
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
  evidenceClass: evidenceClassSchema,
  sourceIds: z.array(idSchema),
  occurredAt: z.string().nullable(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;
