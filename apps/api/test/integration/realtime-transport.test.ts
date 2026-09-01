import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerEvent } from '@everecho/contracts';
import { defaultLearningDocument } from '@everecho/consent';
import {
  CORRECT_TEACH_BACK,
  TestClient,
  consentDocument,
  invitationTokenFrom,
  signUp,
  startHarness,
  type Harness,
} from '../helpers/harness';

/**
 * The WebSocket media plane, against a real listening server.
 *
 * Nothing is mocked: a real socket, a real handshake, real cookies. What is
 * being tested here is admission and framing — everything the conversation
 * itself does is covered by `realtime-slice.test.ts` against the driver.
 */

let h: Harness;
let baseUrl: string;
let origin: string;
let buyer: TestClient;
let storyteller: TestClient;
let archiveId: string;
let sessionCookie: string;

/** Opens a socket and collects what the server sends. */
function connect(input: { path: string; cookie?: string; origin?: string }): Promise<{
  events: ServerEvent[];
  closeCode: number;
  closeReason: string;
  send(v: unknown): void;
  socket: WebSocket;
}> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (input.cookie) headers.cookie = input.cookie;
    if (input.origin) headers.origin = input.origin;

    const socket = new WebSocket(`${baseUrl}${input.path}`, { headers });
    const events: ServerEvent[] = [];
    let settled = false;

    socket.on('message', (raw) => {
      try {
        events.push(JSON.parse(raw.toString()) as ServerEvent);
      } catch {
        // A frame we cannot parse is itself a failure the assertions will see.
      }
    });

    socket.on('close', (code, reason) => {
      if (settled) return;
      settled = true;
      resolve({
        events,
        closeCode: code,
        closeReason: reason.toString(),
        send: () => undefined,
        socket,
      });
    });

    socket.on('open', () => {
      // Resolve on open too, so a socket that stays open can be driven.
      setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          events,
          closeCode: 0,
          closeReason: '',
          send: (v) => socket.send(JSON.stringify(v)),
          socket,
        });
      }, 250);
    });

    socket.on('error', (error) => {
      if (settled) return;
      settled = true;
      // A rejected upgrade surfaces as an error rather than a close frame.
      resolve({
        events,
        closeCode: -1,
        closeReason: (error as Error).message,
        send: () => undefined,
        socket,
      });
    });

    setTimeout(() => {
      if (!settled) reject(new Error('socket did not settle'));
    }, 8000);
  });
}

async function waitFor(
  events: ServerEvent[],
  predicate: (e: ServerEvent) => boolean,
  timeoutMs = 5000,
): Promise<ServerEvent | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 40));
  }
  return undefined;
}

beforeAll(async () => {
  h = await startHarness();
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const address = h.app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `ws://127.0.0.1:${port}`;
  origin = h.cfg.env.WEB_PUBLIC_URL;

  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil Deshpande' });
  storyteller = await signUp(h.app, {
    email: 'kamala@example.test',
    displayName: 'Kamala Deshpande',
  });

  const created = await buyer.post<{ id: string }>('/v1/archives', {
    name: 'Kamala’s stories',
    subject: { displayName: 'Kamala Deshpande', birthYear: 1948 },
    subjectIsAdult: true,
  });
  archiveId = created.body.id;

  await buyer.post(`/v1/archives/${archiveId}/invitations`, {
    email: 'kamala@example.test',
    displayName: 'Kamala Deshpande',
    role: 'storyteller',
    expiresInDays: 14,
  });
  const token = invitationTokenFrom(h.ctx);
  await storyteller.post(`/v1/invitations/${token}/respond`, { decision: 'accept' });
  await storyteller.post(`/v1/archives/${archiveId}/consent/teach-back`, {
    answers: CORRECT_TEACH_BACK,
  });
  await storyteller.put(`/v1/archives/${archiveId}/consent`, { document: consentDocument() });
  await storyteller.put(`/v1/archives/${archiveId}/learning-policy`, {
    document: defaultLearningDocument(),
  });

  sessionCookie = storyteller.cookieHeaderForTransport();
}, 180_000);

afterAll(async () => {
  await h?.close();
});

async function newSession(): Promise<string> {
  const created = await storyteller.post<{ session: { id: string } }>(
    `/v1/archives/${archiveId}/realtime-sessions`,
    { mode: 'interview', language: 'en' },
  );
  expect(created.status).toBe(201);
  return created.body.session.id;
}

describe('socket admission', () => {
  it('refuses a connection with no session cookie', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      origin,
    });
    expect(result.closeCode).not.toBe(0);
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('not_authenticated');
  });

  it('refuses a connection from another site', async () => {
    // A WebSocket upgrade is a GET and browsers send cookies cross-origin on
    // it, so without this check any page could open an authenticated socket
    // into somebody's archive and listen.
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin: 'https://not-everecho.example',
    });
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('origin_not_allowed');
  });

  it('refuses a connection with no origin header at all', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
    });
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('origin_not_allowed');
  });

  it('refuses a session that does not exist', async () => {
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/00000000-0000-4000-8000-000000000000/socket`,
      cookie: sessionCookie,
      origin,
    });
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('not_found');
  });

  it('refuses a session that has already ended', async () => {
    const sessionId = await newSession();
    await storyteller.post(`/v1/archives/${archiveId}/realtime-sessions/${sessionId}/end`, {});
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('realtime_session_not_live');
  });

  it('refuses a session belonging to somebody else', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: buyer.cookieHeaderForTransport(),
      origin,
    });
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(['not_permitted', 'not_found']).toContain(error?.code);
  });

  it('accepts a legitimate connection and reports its state', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    expect(result.closeCode).toBe(0);

    result.send({ type: 'session.hello', clientEventId: 'hello-1', protocolVersion: 1 });
    const ready = await waitFor(
      result.events,
      (e) => e.type === 'session.state' && (e as { state: string }).state === 'READY',
    );
    expect(ready).toBeTruthy();
    result.socket.close();
  });
});

describe('socket framing', () => {
  it('rejects a protocol version it does not speak', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    result.send({ type: 'session.hello', clientEventId: 'v-1', protocolVersion: 99 });
    const error = await waitFor(result.events, (e) => e.type === 'error');
    expect((error as { code: string } | undefined)?.code).toBe('protocol_version_mismatch');
    result.socket.close();
  });

  it('warns rather than crashing on a frame it cannot parse', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    result.socket.send('this is not json');
    const warning = await waitFor(result.events, (e) => e.type === 'warning');
    expect((warning as { code: string } | undefined)?.code).toBe('malformed');
    // Still alive: one bad frame does not end somebody's conversation.
    expect(result.socket.readyState).toBe(WebSocket.OPEN);
    result.socket.close();
  });

  it('warns on a well-formed frame that is not a known event', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    result.send({ type: 'not.a.real.event', clientEventId: 'x-1' });
    const warning = await waitFor(result.events, (e) => e.type === 'warning');
    expect((warning as { code: string } | undefined)?.code).toBe('invalid_event');
    result.socket.close();
  });

  it('never echoes a rejected payload back, because it may contain speech', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    result.send({
      type: 'audio.chunk',
      clientEventId: 'bad-1',
      seq: 0,
      audio: 'x'.repeat(70_000),
      sampleRate: 16000,
    });
    const warning = await waitFor(result.events, (e) => e.type === 'warning');
    expect(warning).toBeTruthy();
    expect(JSON.stringify(warning)).not.toContain('xxxxxxxxxx');
    result.socket.close();
  });

  it('applies a duplicated client event exactly once', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    result.send({ type: 'session.hello', clientEventId: 'dup-1', protocolVersion: 1 });
    await waitFor(result.events, (e) => e.type === 'session.state');
    const afterFirst = result.events.length;

    // The same event again — a retry after a flaky connection.
    result.send({ type: 'session.hello', clientEventId: 'dup-1', protocolVersion: 1 });
    await new Promise((r) => setTimeout(r, 400));
    expect(result.events.length).toBe(afterFirst);
    result.socket.close();
  });

  it('carries monotonic sequence numbers so a client can detect a gap', async () => {
    const sessionId = await newSession();
    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    result.send({ type: 'session.hello', clientEventId: 'seq-1', protocolVersion: 1 });
    await waitFor(
      result.events,
      (e) => e.type === 'session.state' && (e as { state: string }).state === 'READY',
    );

    const sequences = result.events.map((e) => (e as { seq: number }).seq);
    const sorted = [...sequences].sort((a, b) => a - b);
    expect(sequences).toEqual(sorted);
    expect(new Set(sequences).size).toBe(sequences.length);
    result.socket.close();
  });
});

describe('reconnection', () => {
  it('resumes with a valid token, and refuses the same token twice', async () => {
    const sessionId = await newSession();
    const first = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket`,
      cookie: sessionCookie,
      origin,
    });
    first.send({ type: 'session.hello', clientEventId: 'rc-1', protocolVersion: 1 });
    await waitFor(first.events, (e) => e.type === 'session.state');
    first.socket.close();
    await new Promise((r) => setTimeout(r, 200));

    const minted = await storyteller.post<{ reconnect: { token: string } }>(
      `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/reconnect-token`,
      {},
    );
    expect(minted.status).toBe(200);
    const token = minted.body.reconnect.token;

    const resumed = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket?reconnectToken=${token}`,
      cookie: sessionCookie,
      origin,
    });
    expect(resumed.closeCode).toBe(0);
    resumed.socket.close();
    await new Promise((r) => setTimeout(r, 200));

    // Single-use: a captured token is worthless once the real client has used it.
    const replay = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket?reconnectToken=${token}`,
      cookie: sessionCookie,
      origin,
    });
    const error = replay.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('reconnect_token_invalid');
  });

  it('refuses a token minted before the learning policy narrowed', async () => {
    const sessionId = await newSession();
    const minted = await storyteller.post<{ reconnect: { token: string } }>(
      `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/reconnect-token`,
      {},
    );
    const token = minted.body.reconnect.token;

    // Changing what a conversation may become revokes outstanding tokens, so a
    // dropped client cannot resume under permissions that no longer hold.
    await storyteller.put(`/v1/archives/${archiveId}/learning-policy`, {
      document: { ...defaultLearningDocument(), candidateExtraction: false },
    });

    const result = await connect({
      path: `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/socket?reconnectToken=${token}`,
      cookie: sessionCookie,
      origin,
    });
    const error = result.events.find((e) => e.type === 'error') as { code: string } | undefined;
    expect(error?.code).toBe('reconnect_token_invalid');
  });
});
