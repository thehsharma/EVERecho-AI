import type { ApiError } from '@everecho/contracts';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly reasonCode?: string,
    readonly fieldErrors?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

/** Reads the CSRF cookie the API sets alongside the session. Browser only. */
export function csrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  return document.cookie
    .split('; ')
    .find((c) => c.startsWith('everecho_csrf='))
    ?.split('=')[1];
}

async function handle<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? (JSON.parse(text) as unknown) : {};
  if (!response.ok) {
    const error = (body as ApiError).error;
    throw new ApiRequestError(
      response.status,
      error?.code ?? 'internal_error',
      error?.message ?? 'Something went wrong.',
      error?.reasonCode,
      error?.fieldErrors,
    );
  }
  return body as T;
}

/**
 * Browser-side API client.
 *
 * Sends the session cookie and echoes the double-submit CSRF token. It never
 * makes an access decision: a control the interface shows is still refused by
 * the server if the storyteller's consent does not permit it.
 */
export const api = {
  async get<T>(path: string): Promise<T> {
    return handle<T>(await fetch(`${API_URL}${path}`, { credentials: 'include' }));
  },
  async send<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = csrfToken();
    return handle<T>(
      await fetch(`${API_URL}${path}`, {
        method,
        credentials: 'include',
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { 'x-csrf-token': token } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  },
  post<T>(path: string, body?: unknown) {
    return this.send<T>('POST', path, body);
  },
  put<T>(path: string, body?: unknown) {
    return this.send<T>('PUT', path, body);
  },
  patch<T>(path: string, body?: unknown) {
    return this.send<T>('PATCH', path, body);
  },
  del<T>(path: string) {
    return this.send<T>('DELETE', path);
  },
};
