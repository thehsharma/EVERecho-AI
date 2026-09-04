import { z } from 'zod';
import { evidenceClassSchema, reviewStatusSchema, sensitivitySchema } from './enums';
import { approximateDateSchema, idSchema, locatorSchema, timestampSchema } from './primitives';

export const claimEvidenceSchema = z.object({
  id: idSchema,
  sourceAssetId: idSchema,
  sourceKind: z.string(),
  sourceFilename: z.string(),
  transcriptSegmentId: idSchema.nullable(),
  locator: locatorSchema,
  /** The exact words the claim rests on. */
  quotedText: z.string(),
  extractionMethod: z.string(),
  modelVersion: z.string(),
  promptVersion: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ClaimEvidence = z.infer<typeof claimEvidenceSchema>;

export const claimSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  memoryId: idSchema.nullable(),
  text: z.string(),
  evidenceClass: evidenceClassSchema,
  status: reviewStatusSchema,
  sensitivity: sensitivitySchema,
  evidence: z.array(claimEvidenceSchema),
  contradictionIds: z.array(idSchema),
  createdAt: timestampSchema,
  supersededByClaimId: idSchema.nullable(),
});
export type Claim = z.infer<typeof claimSchema>;

export const memorySchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  title: z.string(),
  body: z.string(),
  status: reviewStatusSchema,
  sensitivity: sensitivitySchema,
  /** Highest evidence class among this memory's claims. */
  evidenceClass: evidenceClassSchema,
  occurredAt: approximateDateSchema.nullable(),
  placeId: idSchema.nullable(),
  placeName: z.string().nullable(),
  entityIds: z.array(idSchema),
  claims: z.array(claimSchema),
  version: z.number().int(),
  /** Distinguishes machine draft from storyteller-corrected text in the UI. */
  origin: z.enum(['interview', 'upload_extraction', 'storyteller_written', 'contributor_proposed']),
  wasCorrected: z.boolean(),
  createdAt: timestampSchema,
  approvedAt: timestampSchema.nullable(),
  approvedByUserId: idSchema.nullable(),
});
export type Memory = z.infer<typeof memorySchema>;

export const updateMemoryRequestSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  body: z.string().min(1).max(50_000).optional(),
  occurredAt: approximateDateSchema.nullable().optional(),
  sensitivity: sensitivitySchema.optional(),
  placeName: z.string().max(200).nullable().optional(),
  reason: z.string().max(500).optional(),
});

export const reviewMemoryRequestSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().max(500).optional(),
});

export const entitySchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  kind: z.enum(['person', 'organisation', 'object']),
  name: z.string(),
  aliases: z.array(z.string()),
  notes: z.string().nullable(),
  status: reviewStatusSchema,
  mentionCount: z.number().int(),
});
export type Entity = z.infer<typeof entitySchema>;

export const relationshipSchema = z.object({
  id: idSchema,
  fromEntityId: idSchema,
  fromEntityName: z.string(),
  toEntityId: idSchema,
  toEntityName: z.string(),
  kind: z.string(),
  status: reviewStatusSchema,
  notes: z.string().nullable(),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const placeSchema = z.object({
  id: idSchema,
  name: z.string(),
  region: z.string().nullable(),
  country: z.string().nullable(),
});

export const eventSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  memoryId: idSchema.nullable(),
  title: z.string(),
  startDate: approximateDateSchema.nullable(),
  endDate: approximateDateSchema.nullable(),
  placeId: idSchema.nullable(),
  placeName: z.string().nullable(),
  status: reviewStatusSchema,
  evidenceClass: evidenceClassSchema,
});
export type LifeEvent = z.infer<typeof eventSchema>;

export const contradictionSchema = z.object({
  id: idSchema,
  claimAId: idSchema,
  claimAText: z.string(),
  claimBId: idSchema,
  claimBText: z.string(),
  kind: z.enum(['date_conflict', 'place_conflict', 'fact_conflict', 'relationship_conflict']),
  status: z.enum(['open', 'resolved', 'accepted']),
  detectedAt: timestampSchema,
});
export type Contradiction = z.infer<typeof contradictionSchema>;

export const resolveContradictionRequestSchema = z.object({
  resolution: z.enum(['prefer_a', 'prefer_b', 'both_true', 'neither']),
  note: z.string().max(1000).optional(),
});

export const correctionSchema = z.object({
  id: idSchema,
  targetType: z.string(),
  targetId: idSchema,
  actorUserId: idSchema.nullable(),
  actorDisplayName: z.string(),
  reason: z.string().nullable(),
  previous: z.unknown(),
  next: z.unknown(),
  createdAt: timestampSchema,
});
