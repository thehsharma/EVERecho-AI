import { z } from 'zod';
import { dataCategorySchema, sensitivitySchema, sourceKindSchema, sourceStatusSchema } from './enums';
import { checksumSchema, idSchema, timestampSchema } from './primitives';

/** Per-source choices. These override archive-wide consent downward, never upward. */
export const sourcePrivacyChoicesSchema = z.object({
  allowTranscription: z.boolean(),
  allowOcr: z.boolean(),
  allowEmbedding: z.boolean(),
  allowGeneration: z.boolean(),
  allowExport: z.boolean(),
  sensitivity: sensitivitySchema,
  dataCategories: z.array(dataCategorySchema),
  /** Held but never surfaced until the storyteller lifts the embargo. */
  embargoUntil: timestampSchema.nullable().optional(),
});
export type SourcePrivacyChoices = z.infer<typeof sourcePrivacyChoicesSchema>;

export const createUploadRequestSchema = z.object({
  filename: z.string().min(1).max(400),
  mimeType: z.string().min(1).max(160),
  byteSize: z.number().int().min(1),
  kind: sourceKindSchema,
  privacy: sourcePrivacyChoicesSchema,
  /** Client-computed; re-verified server-side after the bytes land. */
  checksum: checksumSchema.optional(),
  idempotencyKey: z.string().min(8).max(200),
  caption: z.string().max(2000).optional(),
});
export type CreateUploadRequest = z.infer<typeof createUploadRequestSchema>;

export const uploadTicketSchema = z.object({
  sourceId: idSchema,
  uploadUrl: z.string(),
  method: z.enum(['PUT', 'POST']),
  headers: z.record(z.string(), z.string()),
  expiresAt: timestampSchema,
  maxBytes: z.number().int(),
});
export type UploadTicket = z.infer<typeof uploadTicketSchema>;

export const sourceAssetSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  kind: sourceKindSchema,
  status: sourceStatusSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  checksum: checksumSchema.nullable(),
  privacy: sourcePrivacyChoicesSchema,
  caption: z.string().nullable(),
  scanResult: z.enum(['pending', 'clean', 'infected', 'unsupported', 'error']),
  uploadedByUserId: idSchema.nullable(),
  createdAt: timestampSchema,
  processedAt: timestampSchema.nullable(),
  /** Progress the customer can actually read, not a spinner. */
  processing: z.object({
    stage: z.enum(['queued', 'scanning', 'transcribing', 'extracting', 'ready', 'failed', 'skipped']),
    detail: z.string().nullable(),
    attempts: z.number().int(),
  }),
  transcriptId: idSchema.nullable(),
});
export type SourceAsset = z.infer<typeof sourceAssetSchema>;

export const transcriptSegmentSchema = z.object({
  id: idSchema,
  index: z.number().int(),
  startMs: z.number().int().nullable(),
  endMs: z.number().int().nullable(),
  page: z.number().int().nullable(),
  text: z.string(),
  confidence: z.number().min(0).max(1).nullable(),
  /** Storyteller-corrected text supersedes the machine transcript. */
  correctedText: z.string().nullable(),
});
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;

export const transcriptSchema = z.object({
  id: idSchema,
  sourceAssetId: idSchema,
  provider: z.string(),
  modelVersion: z.string(),
  language: z.string(),
  status: z.enum(['pending', 'ready', 'failed']),
  segments: z.array(transcriptSegmentSchema),
  createdAt: timestampSchema,
});
export type Transcript = z.infer<typeof transcriptSchema>;

export const correctSegmentRequestSchema = z.object({
  correctedText: z.string().min(1).max(20_000),
  reason: z.string().max(500).optional(),
});
