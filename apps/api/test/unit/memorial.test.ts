import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@everecho/config';
import type { AppContext } from '../../src/context';
import { ApiError } from '../../src/errors';
import { registerMemorialRoutes, verifyMemorialVoice } from '../../src/modules/memorial';

const profile = {
  name: 'Alex',
  relationship: 'grandparent',
  language: 'en',
  personality: 'gentle',
  memories: 'We planted roses together.',
  phrases: 'One day at a time.',
  tone: 'warm',
};
const turn = {
  profile,
  history: [],
  message: 'Tell me about roses',
  acknowledged: true,
  allowCloud: false,
};
const sample = {
  name: 'Alex',
  mime: 'audio/mpeg',
  audio: Buffer.alloc(150, 1).toString('base64'),
  authorized: true,
  allowCloud: true,
};
const apps: ReturnType<typeof Fastify>[] = [];

function appFor(options: { user?: string | null; cloud?: boolean; production?: boolean } = {}) {
  const app = Fastify();
  apps.push(app);
  const cfg = loadConfig({
    NODE_ENV: 'test',
    ...(options.cloud
      ? { MEMORIAL_LLM_API_KEY: 'test-llm', MEMORIAL_ELEVENLABS_API_KEY: 'test-voice' }
      : {}),
  });
  app.addHook('onRequest', async (request) => {
    request.user =
      options.user === null
        ? null
        : {
            id: options.user ?? 'owner',
            email: 'owner@example.com',
            displayName: 'Owner',
            isPlatformAdmin: false,
            sessionId: 'session',
          };
  });
  app.setErrorHandler((error, _request, reply) => {
    reply
      .code(error instanceof ApiError ? error.status : 500)
      .send({ message: error instanceof Error ? error.message : 'Unknown error' });
  });
  registerMemorialRoutes(app, {
    cfg: { ...cfg, isProduction: options.production ?? false },
  } as AppContext);
  return { app, secret: cfg.env.SESSION_SECRET };
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('memorial simulation boundaries', () => {
  it('requires authentication before accepting a voice upload', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { app } = appFor({ user: null, cloud: true });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/memorial/voice', payload: sample })).statusCode,
    ).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not contact providers without cloud permission even when keys exist', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { app } = appFor({ cloud: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memorial/respond',
      payload: turn,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ mode: 'local-preview', audio: null });
    expect(response.json().text).toContain('We planted roses together.');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('admits when a question has no supplied memory', async () => {
    const { app } = appFor();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memorial/respond',
      payload: { ...turn, message: 'Where were you born?' },
    });
    expect(response.json().text).toContain('no matching memory');
  });
  it('requires disclosure acknowledgment and voice authorization', async () => {
    const { app } = appFor({ cloud: true });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/memorial/respond',
          payload: { ...turn, acknowledged: false },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/memorial/voice',
          payload: { ...sample, authorized: false },
        })
      ).statusCode,
    ).toBe(400);
  });
  it('blocks the experimental feature in production', async () => {
    const { app } = appFor({ production: true });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/memorial/respond', payload: turn })).statusCode,
    ).toBe(403);
  });
  it('does not pretend an unconfigured voice provider is ready', async () => {
    const { app } = appFor();
    expect((await app.inject('/v1/memorial/status')).json()).toMatchObject({
      conversationReady: false,
      voiceReady: false,
    });
    expect(
      (await app.inject({ method: 'POST', url: '/v1/memorial/voice', payload: sample })).statusCode,
    ).toBe(409);
  });
  it('binds a created voice to its owner and rejects tampering', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ voice_id: 'voice123', requires_verification: false })),
        ),
    );
    const { app, secret } = appFor({ cloud: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memorial/voice',
      payload: sample,
    });
    const token = response.json().voiceToken as string;
    expect(verifyMemorialVoice(token, 'owner', secret)).toBe('voice123');
    expect(() => verifyMemorialVoice(token, 'other-user', secret)).toThrow();
    expect(() => verifyMemorialVoice(`${token}x`, 'owner', secret)).toThrow();
  });
  it('does not enable a voice awaiting provider verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ voice_id: 'voice123', requires_verification: true })),
        ),
    );
    const { app } = appFor({ cloud: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memorial/voice',
      payload: sample,
    });
    expect(response.json()).toMatchObject({ requiresVerification: true, voiceToken: null });
  });
  it('labels cloud replies as simulations and supplies the profile as reference', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: 'An imagined conversation about roses.' }],
        }),
      ),
    );
    vi.stubGlobal('fetch', fetch);
    const { app } = appFor({ cloud: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memorial/respond',
      payload: { ...turn, allowCloud: true },
    });
    expect(response.json()).toMatchObject({
      mode: 'ai-simulation',
      text: 'An imagined conversation about roses.',
    });
    const submitted = JSON.parse(fetch.mock.calls[0]![1].body);
    expect(submitted.system).toContain('not the deceased person');
    expect(submitted.system).toContain('untrusted reference data');
  });
  it('does not expose provider response bodies in errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('private provider content', { status: 403 })),
    );
    const { app } = appFor({ cloud: true });
    const response = await app.inject({
      method: 'POST',
      url: '/v1/memorial/respond',
      payload: { ...turn, allowCloud: true },
    });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private provider content');
  });
});
