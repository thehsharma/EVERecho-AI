import type { FastifyInstance } from 'fastify';
import { loadConfig, type AppConfig } from '@everecho/config';
import { Database, migrate, resetSchema } from '@everecho/db';
import { createContext, type AppContext } from '../../src/context';
import { buildServer } from '../../src/server';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://everecho:everecho@127.0.0.1:5432/everecho_test';

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  cfg: AppConfig;
  close(): Promise<void>;
}

/**
 * Builds the real server against a real PostgreSQL database with a freshly
 * migrated schema. Nothing here is mocked: these tests exercise the same
 * routes, the same policy engine and the same row-level security that
 * production would.
 */
export async function startHarness(env: Record<string, string> = {}): Promise<Harness> {
  const cfg = loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_DATABASE_URL,
    STORAGE_LOCAL_DIR: './var/test-storage',
    EMAIL_OUTBOX_DIR: './var/test-outbox',
    ...env,
  });
  const db = new Database(cfg);
  await resetSchema(db);
  await migrate(db);

  const ctx = createContext(cfg, db);
  const app = await buildServer(ctx);
  await app.ready();

  return {
    app,
    ctx,
    cfg,
    close: async () => {
      await app.close();
      await db.close();
      await ctx.cache.close();
    },
  };
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  errorCode?: string;
  reasonCode?: string;
}

/**
 * A client that behaves like a browser: it keeps cookies and echoes the CSRF
 * token, so the CSRF protection is exercised rather than bypassed in tests.
 */
export class TestClient {
  private cookies = new Map<string, string>();

  constructor(private readonly app: FastifyInstance) {}

  get csrfToken(): string | undefined {
    return this.cookies.get('everecho_csrf');
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private captureCookies(raw: string | string[] | undefined): void {
    if (!raw) return;
    for (const line of Array.isArray(raw) ? raw : [raw]) {
      const [pair] = line.split(';');
      const index = pair?.indexOf('=') ?? -1;
      if (!pair || index < 0) continue;
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...options.headers,
    };
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const csrf = this.csrfToken;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;

    const response = await this.app.inject({
      method,
      url,
      headers,
      ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
    });
    this.captureCookies(response.headers['set-cookie'] as string | string[] | undefined);

    let body: unknown;
    try {
      body = response.json();
    } catch {
      body = response.body;
    }
    const error = (body as { error?: { code?: string; reasonCode?: string } })?.error;
    return {
      status: response.statusCode,
      body: body as T,
      errorCode: error?.code,
      reasonCode: error?.reasonCode,
    };
  }

  get<T = unknown>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = unknown>(url: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', url, { body, headers });
  }
  put<T = unknown>(url: string, body?: unknown) {
    return this.request<T>('PUT', url, { body });
  }
  patch<T = unknown>(url: string, body?: unknown) {
    return this.request<T>('PATCH', url, { body });
  }
}

export async function signUp(
  app: FastifyInstance,
  input: { email: string; displayName: string; password?: string },
): Promise<TestClient> {
  const client = new TestClient(app);
  const response = await client.post('/v1/auth/sign-up', {
    email: input.email,
    displayName: input.displayName,
    password: input.password ?? 'a-good-long-passphrase',
    acceptedLegalCopyVersion: 'legal-copy-2026-01-draft',
  });
  if (response.status !== 201) {
    throw new Error(`sign-up failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return client;
}

/** Reads the invitation token out of the local outbox, as a recipient would. */
export function invitationTokenFrom(ctx: AppContext): string {
  const outbox = (ctx.email as { sent?: { variables: Record<string, string> }[] }).sent ?? [];
  for (let i = outbox.length - 1; i >= 0; i -= 1) {
    const link = outbox[i]?.variables.link;
    if (link) return link.split('/').pop()!;
  }
  throw new Error('no invitation email was sent');
}

/** The full set of teach-back answers, all correct. */
export const CORRECT_TEACH_BACK = [
  { questionId: 'who_decides', optionId: 'me' },
  { questionId: 'can_i_skip', optionId: 'skip' },
  { questionId: 'ai_role', optionId: 'organise' },
  { questionId: 'change_mind', optionId: 'change' },
  { questionId: 'who_sees_now', optionId: 'nobody' },
  { questionId: 'sensitive', optionId: 'restrict' },
];

/** A consent document granting family read access, used by many tests. */
export function consentDocument(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'compose',
    dataCategories: ['audio', 'photo', 'document', 'text'],
    activities: [
      'storage',
      'export',
      'transcription',
      'ocr',
      'embedding',
      'generation',
      'provider_processing',
    ],
    recipients: [
      {
        role: 'family',
        maxSensitivity: 'normal',
        lifeStates: ['living'],
        mayExport: false,
        mayContribute: false,
      },
    ],
    restrictedTopics: [],
    excludedSourceIds: [],
    providerProcessing: {
      transcription: true,
      ocr: true,
      embedding: true,
      generation: true,
      retentionDays: 0,
      noModelTraining: true,
    },
    voiceAndLikeness: { syntheticVoice: false, syntheticLikeness: false, personaSimulation: false },
    allowFutureChangesWithoutTeachBack: true,
    ...overrides,
  };
}

/** Uploads bytes through the real signed-URL flow, as a browser would. */
export async function uploadSource(
  h: Harness,
  client: TestClient,
  archiveId: string,
  input: {
    filename: string;
    mimeType: string;
    bytes: Buffer;
    kind: 'audio' | 'video' | 'photo' | 'document' | 'text';
    sidecarText?: string;
    privacy?: Partial<Record<string, unknown>>;
  },
): Promise<{ sourceId: string; status: number }> {
  const created = await client.post<{ ticket: { sourceId: string; uploadUrl: string } }>(
    `/v1/archives/${archiveId}/sources`,
    {
      filename: input.filename,
      mimeType: input.mimeType,
      byteSize: input.bytes.length,
      kind: input.kind,
      idempotencyKey: `upload-${input.filename}-${Math.random().toString(36).slice(2)}`,
      privacy: {
        allowTranscription: true,
        allowOcr: true,
        allowEmbedding: true,
        allowGeneration: true,
        allowExport: true,
        sensitivity: 'normal',
        dataCategories: [
          input.kind === 'document' ? 'document' : input.kind === 'photo' ? 'photo' : 'audio',
        ],
        ...input.privacy,
      },
    },
  );
  if (created.status !== 201) return { sourceId: '', status: created.status };

  const url = new URL(created.body.ticket.uploadUrl);
  const put = await h.app.inject({
    method: 'PUT',
    url: `${url.pathname}${url.search}`,
    headers: { 'content-type': input.mimeType },
    payload: input.bytes,
  });
  if (put.statusCode !== 200) throw new Error(`upload PUT failed: ${put.statusCode} ${put.body}`);

  const completed = await client.post(
    `/v1/archives/${archiveId}/sources/${created.body.ticket.sourceId}/complete`,
    input.sidecarText ? { sidecarText: input.sidecarText, durationMs: 30_000 } : {},
  );
  return { sourceId: created.body.ticket.sourceId, status: completed.status };
}
