import type { Adapter, Answer, AudioAnswer, Capabilities } from './types';

/**
 * Talks to a system over HTTP.
 *
 * The wire format is four POSTs and a GET, documented in
 * `docs/CONFORMANCE_SPEC.md`. A system implements those five endpoints — in
 * any language, on any architecture — and becomes measurable. Nothing here
 * knows anything about EverEcho.
 */
export function httpAdapter(options: {
  endpoint: string;
  /** Sent as `authorization` when the system needs it. */
  token?: string;
  fetchImpl?: typeof fetch;
}): Adapter {
  const base = options.endpoint.replace(/\/+$/, '');
  const doFetch = options.fetchImpl ?? fetch;

  const call = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await doFetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(options.token ? { authorization: options.token } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      throw new Error(`${path} responded ${response.status}`);
    }
    return (await response.json()) as T;
  };

  return {
    describe: () => call<Capabilities>('/conformance/describe'),
    ask: (question, language) => call<Answer>('/conformance/ask', { question, language }),
    listen: (question, language) =>
      call<AudioAnswer>('/conformance/listen', { question, language }),
    tell: (news, language) => call<AudioAnswer>('/conformance/tell', { news, language }),
  };
}
