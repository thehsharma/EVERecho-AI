import { z } from 'zod';
import { archiveStatusSchema, membershipStatusSchema, roleSchema } from './enums';
import { idSchema, timestampSchema } from './primitives';
import { emailSchema } from './auth';

export const createArchiveRequestSchema = z.object({
  name: z.string().min(1).max(160).trim(),
  /** Who this archive is about. The buyer is usually not this person. */
  subject: z.object({
    displayName: z.string().min(1).max(160).trim(),
    givenName: z.string().max(80).trim().optional(),
    familyName: z.string().max(80).trim().optional(),
    birthYear: z.number().int().min(1850).max(2030).optional(),
  }),
  householdName: z.string().min(1).max(160).trim().optional(),
  /** v0.1 does not create profiles for minors. Asserted, then enforced. */
  subjectIsAdult: z.literal(true),
});
export type CreateArchiveRequest = z.infer<typeof createArchiveRequestSchema>;

export const archiveSchema = z.object({
  id: idSchema,
  name: z.string(),
  status: archiveStatusSchema,
  subjectPersonId: idSchema,
  subjectDisplayName: z.string(),
  householdId: idSchema,
  storytellerUserId: idSchema.nullable(),
  currentConsentPolicyId: idSchema.nullable(),
  consentMode: z.string().nullable(),
  dataRegion: z.string(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  /** What the *calling* user may do, so the UI never guesses. */
  viewerCapabilities: z.array(z.string()),
  viewerRole: roleSchema,
});
export type Archive = z.infer<typeof archiveSchema>;

export const membershipSchema = z.object({
  id: idSchema,
  archiveId: idSchema,
  userId: idSchema.nullable(),
  email: emailSchema,
  displayName: z.string(),
  role: roleSchema,
  status: membershipStatusSchema,
  invitedByUserId: idSchema.nullable(),
  grantedAt: timestampSchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  expiresAt: timestampSchema.nullable(),
});
export type Membership = z.infer<typeof membershipSchema>;

export const updateMembershipRequestSchema = z.object({
  status: z.enum(['active', 'revoked']).optional(),
  expiresAt: timestampSchema.nullable().optional(),
  reason: z.string().max(500).optional(),
});
