import { z } from 'zod';

/**
 * Error codes are a closed set so the frontend can react to them without
 * string-matching prose, and so no internal detail reaches a client.
 */
export const errorCodeSchema = z.enum([
  'validation_failed',
  'unauthenticated',
  'session_expired',
  'forbidden',
  'not_found',
  'conflict',
  'rate_limited',
  'payload_too_large',
  'unsupported_media_type',
  'consent_required',
  'consent_revoked',
  'prohibited_capability',
  'processing_failed',
  'provider_unavailable',
  'internal_error',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    /** Safe for display. Never contains memory content, SQL, or stack traces. */
    message: z.string(),
    /** Machine-readable reason from the policy engine, when a decision denied this. */
    reasonCode: z.string().optional(),
    policyVersion: z.string().optional(),
    requestId: z.string(),
    fieldErrors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const HTTP_STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation_failed: 400,
  unauthenticated: 401,
  session_expired: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  payload_too_large: 413,
  unsupported_media_type: 415,
  consent_required: 403,
  consent_revoked: 403,
  prohibited_capability: 403,
  processing_failed: 500,
  provider_unavailable: 503,
  internal_error: 500,
};
