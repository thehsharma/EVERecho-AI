import { HTTP_STATUS_BY_CODE, type ErrorCode } from '@everecho/contracts';

/**
 * Every error that reaches a client goes through this class. Internal detail —
 * SQL, stack traces, whether an archive exists — never crosses the boundary.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: {
      reasonCode?: string;
      policyVersion?: string;
      fieldErrors?: { path: string; message: string }[];
    } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = HTTP_STATUS_BY_CODE[code];
  }
}

export const unauthenticated = (message = 'Please sign in.') =>
  new ApiError('unauthenticated', message);

export const forbidden = (message: string, reasonCode?: string, policyVersion?: string) =>
  new ApiError('forbidden', message, { reasonCode, policyVersion });

/**
 * Used wherever a resource might exist but the caller has no business knowing.
 * A distinct 403 for "this archive exists but is not yours" would confirm the
 * archive's existence to anyone who guessed an id.
 */
export const notFound = (what = 'That was not found.') => new ApiError('not_found', what);

export const conflict = (message: string) => new ApiError('conflict', message);

export const validationFailed = (
  message: string,
  fieldErrors?: { path: string; message: string }[],
) => new ApiError('validation_failed', message, { fieldErrors });

export const consentRequired = (message: string, reasonCode?: string) =>
  new ApiError('consent_required', message, { reasonCode });

export const prohibited = (message: string) => new ApiError('prohibited_capability', message);
