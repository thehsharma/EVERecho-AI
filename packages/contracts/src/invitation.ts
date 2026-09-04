import { z } from 'zod';
import { invitationStatusSchema, roleSchema } from './enums';
import { idSchema, timestampSchema } from './primitives';
import { emailSchema } from './auth';

export const createInvitationRequestSchema = z.object({
  email: emailSchema,
  role: roleSchema.exclude(['support_admin']),
  displayName: z.string().min(1).max(160).trim(),
  /** Shown to the invitee. Coercive or guilt-based copy is the caller's to avoid. */
  personalNote: z.string().max(1000).optional(),
  expiresInDays: z.number().int().min(1).max(60).default(14),
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const invitationSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  email: emailSchema,
  displayName: z.string(),
  role: roleSchema,
  status: invitationStatusSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  declinedAt: timestampSchema.nullable(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/**
 * What an invitee sees *before* signing in. Deliberately thin: an invitation
 * link must not disclose archive contents to whoever holds the token.
 */
export const invitationPreviewSchema = z.object({
  invitationId: idSchema,
  role: roleSchema,
  archiveName: z.string(),
  subjectDisplayName: z.string(),
  invitedByDisplayName: z.string(),
  personalNote: z.string().nullable(),
  expiresAt: timestampSchema,
  productName: z.string(),
  /** Storytellers see the full explanation of control before deciding. */
  requiresTeachBack: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const respondToInvitationRequestSchema = z.object({
  decision: z.enum(['accept', 'decline']),
  /** Only ever shown to the invitee. A private decline stays private. */
  declineReason: z.string().max(500).optional(),
});
