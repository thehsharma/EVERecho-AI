import { z } from 'zod';
import { checksumSchema, idSchema, timestampSchema } from './primitives';

export const createExportRequestSchema = z.object({
  includeOriginals: z.boolean().default(true),
  includeTranscripts: z.boolean().default(true),
  includeProvenance: z.boolean().default(true),
  format: z.enum(['zip']).default('zip'),
});

export const exportJobSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  status: z.enum(['queued', 'running', 'ready', 'failed', 'expired']),
  requestedByUserId: idSchema,
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  downloadUrl: z.string().nullable(),
  expiresAt: timestampSchema.nullable(),
  checksum: checksumSchema.nullable(),
  byteSize: z.number().int().nullable(),
  manifest: z
    .object({
      sourceCount: z.number().int(),
      memoryCount: z.number().int(),
      claimCount: z.number().int(),
      transcriptCount: z.number().int(),
      permissionCount: z.number().int(),
      conversationCount: z.number().int(),
      suggestionCount: z.number().int(),
    })
    .nullable(),
  error: z.string().nullable(),
});
export type ExportJob = z.infer<typeof exportJobSchema>;

export const createDeletionRequestSchema = z.object({
  scope: z.enum(['archive', 'source', 'memory']),
  targetId: idSchema.optional(),
  /** Typed confirmation. Deletion is irreversible and must feel like it. */
  confirmationPhrase: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const deletionStepSchema = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'done', 'failed', 'skipped']),
  affectedCount: z.number().int().nullable(),
  completedAt: timestampSchema.nullable(),
  error: z.string().nullable(),
});
export type DeletionStep = z.infer<typeof deletionStepSchema>;

export const deletionRequestSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  scope: z.enum(['archive', 'source', 'memory']),
  targetId: idSchema.nullable(),
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
  requestedByUserId: idSchema,
  createdAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  steps: z.array(deletionStepSchema),
});
export type DeletionRequest = z.infer<typeof deletionRequestSchema>;

export const auditEventSchema = z.object({
  id: idSchema,
  archiveId: idSchema.nullable(),
  actorUserId: idSchema.nullable(),
  actorDisplayName: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: idSchema.nullable(),
  outcome: z.enum(['allow', 'deny', 'success', 'failure']),
  reasonCode: z.string().nullable(),
  policyVersion: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: timestampSchema,
  /** Metadata is redacted of memory content before it is written, not on read. */
  metadata: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const successionDirectiveSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  /** Recorded intent only. v0.1 never transitions an archive automatically. */
  status: z.enum(['recorded', 'under_review', 'not_executable']),
  stewardEmail: z.string().nullable(),
  instructions: z.string().nullable(),
  recipientOptInRequired: z.literal(true),
  coolingPeriodDays: z.number().int(),
  executionEnabled: z.literal(false),
  legalReviewStatus: z.literal('pending_qualified_legal_review'),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});
export type SuccessionDirective = z.infer<typeof successionDirectiveSchema>;

export const updateSuccessionDirectiveRequestSchema = z.object({
  stewardEmail: z.email().nullable().optional(),
  instructions: z.string().max(5000).nullable().optional(),
  coolingPeriodDays: z.number().int().min(7).max(365).optional(),
});
