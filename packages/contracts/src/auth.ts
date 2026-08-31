import { z } from 'zod';
import { idSchema, timestampSchema } from './primitives';

export const emailSchema = z.email().max(254).toLowerCase().trim();

/**
 * Length beats composition rules. A 12-character passphrase is stronger than
 * "P@ssw0rd!" and far likelier to be remembered by an 80-year-old storyteller.
 */
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters — a short phrase works well')
  .max(256);

export const signUpRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(1).max(120).trim(),
  acceptedLegalCopyVersion: z.string().min(1),
});
export type SignUpRequest = z.infer<typeof signUpRequestSchema>;

export const signInRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(256),
  totpCode: z.string().regex(/^\d{6}$/).optional(),
});
export type SignInRequest = z.infer<typeof signInRequestSchema>;

export const sessionSummarySchema = z.object({
  id: idSchema,
  createdAt: timestampSchema,
  expiresAt: timestampSchema,
  current: z.boolean(),
  userAgentFamily: z.string(),
});

export const meResponseSchema = z.object({
  user: z.object({
    id: idSchema,
    email: emailSchema,
    displayName: z.string(),
    isPlatformAdmin: z.boolean(),
    mfaEnabled: z.boolean(),
    createdAt: timestampSchema,
  }),
  archives: z.array(
    z.object({
      archiveId: idSchema,
      name: z.string(),
      role: z.string(),
      status: z.string(),
    }),
  ),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});
