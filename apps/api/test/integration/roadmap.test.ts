import { drainQueue, type PipelineContext } from '@everecho/pipeline';
import { beforeAll, afterAll, it, expect } from 'vitest';
import type { InterviewSession } from '@everecho/contracts';
import {
  CORRECT_TEACH_BACK,
  TestClient,
  consentDocument,
  invitationTokenFrom,
  signUp,
  startHarness,
  uploadSource,
  type Harness,
} from '../helpers/harness';
let h: Harness;
let buyer: TestClient;
let storyteller: TestClient;
let archiveId: string;
let family: TestClient;
beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil Sharma' });
  storyteller = await signUp(h.app, { email: 'kamala@example.test', displayName: 'Kamala Sharma' });

  const archive = await buyer.post<{ id: string }>('/v1/archives', {
    name: 'Kamala’s stories',
    subject: { displayName: 'Kamala Sharma', birthYear: 1948 },
    subjectIsAdult: true,
  });
  archiveId = archive.body.id;

  await buyer.post(`/v1/archives/${archiveId}/invitations`, {
    email: 'kamala@example.test',
    displayName: 'Kamala Sharma',
    role: 'storyteller',
    expiresInDays: 14,
  });
  await storyteller.post(`/v1/invitations/${invitationTokenFrom(h.ctx)}/respond`, {
    decision: 'accept',
  });
  await storyteller.post(`/v1/archives/${archiveId}/consent/teach-back`, {
    answers: CORRECT_TEACH_BACK,
  });
  await storyteller.put(`/v1/archives/${archiveId}/consent`, { document: consentDocument() });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

it('preserves the question across pause, rejects foreign prompts, and makes retries idempotent', async () => {
  const base = '/v1/archives/' + archiveId + '/interviews';
  const started = await storyteller.post<{ session: InterviewSession }>(base, { mode: 'text' });
  expect(started.status).toBe(201);
  const session = started.body.session;
  const url = base + '/' + session.id;
  const promptId = session.currentPrompt!.id;
  expect((await storyteller.post(url + '/approve-summary', {})).status).toBe(400);
  expect((await storyteller.post(url + '/answer', { promptId, action: 'pause' })).status).toBe(200);
  const resumed = await storyteller.post<{ session: InterviewSession }>(url + '/resume');
  expect(resumed.body.session.currentPrompt!.id).toBe(promptId);
  const other = await storyteller.post<{ session: InterviewSession }>(base, { mode: 'text' });
  expect(
    (
      await storyteller.post(url + '/answer', {
        promptId: other.body.session.currentPrompt!.id,
        action: 'skip',
      })
    ).status,
  ).toBe(404);
  const answer = {
    promptId,
    action: 'answer',
    responseText: 'I remember planting roses with my mother in the garden.',
  };
  const saved = await storyteller.post<{ session: InterviewSession }>(url + '/answer', answer);
  const retry = await storyteller.post<{ session: InterviewSession }>(url + '/answer', answer);
  expect(saved.body.session.promptsAnswered).toBe(1);
  expect(retry.body.session.currentPrompt!.id).toBe(saved.body.session.currentPrompt!.id);
  expect((await storyteller.post(url + '/finish')).status).toBe(200);
  const approved = await storyteller.post<{ memoriesCreated: number }>(
    url + '/approve-summary',
    {},
  );
  expect(approved.body.memoriesCreated).toBe(1);
  expect(
    (await storyteller.post<{ memoriesCreated: number }>(url + '/approve-summary', {})).body
      .memoriesCreated,
  ).toBe(0);
});
it('exports only approved stories and enforces restricted topics and payer permissions', async () => {
  const memory = await h.ctx.db.withArchiveScope(archiveId, async (tx) =>
    tx.one<{ id: string }>(
      "INSERT INTO memory(archive_id,title,body,status,origin,topics) VALUES($1,'A garden','A private story','approved','storyteller_written',ARRAY['garden']) RETURNING id",
      [archiveId],
    ),
  );
  family = await signUp(h.app, { email: 'relative@example.test', displayName: 'Relative' });
  await storyteller.post('/v1/archives/' + archiveId + '/invitations', {
    email: 'relative@example.test',
    displayName: 'Relative',
    role: 'family',
    expiresInDays: 14,
  });
  await family.post('/v1/invitations/' + invitationTokenFrom(h.ctx) + '/respond', {
    decision: 'accept',
  });
  const recipients = [
    {
      role: 'family',
      maxSensitivity: 'normal',
      lifeStates: ['living'],
      mayExport: true,
      mayContribute: false,
    },
  ];
  expect(
    (
      await storyteller.put('/v1/archives/' + archiveId + '/consent', {
        document: consentDocument({ recipients }),
      })
    ).status,
  ).toBe(200);
  const url = '/v1/archives/' + archiveId + '/keepsake';
  const body = { title: 'Our stories', dedication: 'For family', memoryIds: [memory.id] };
  const exported = await storyteller.post<{ count: number; html: string }>(url, body);
  expect(exported.status).toBe(200);
  expect(exported.body.count).toBe(1);
  expect((await buyer.post(url, body)).status).toBe(403);
  await storyteller.put('/v1/archives/' + archiveId + '/consent', {
    document: consentDocument({ recipients, restrictedTopics: ['garden'] }),
  });
  expect((await family.post(url, body)).status).toBe(404);
  const listed = await family.get<{ memories: { id: string }[] }>(
    '/v1/archives/' + archiveId + '/memories',
  );
  expect(listed.body.memories.some((m) => m.id === memory.id)).toBe(false);
  expect((await family.get('/v1/archives/' + archiveId + '/memories/' + memory.id)).status).toBe(
    404,
  );
  await storyteller.put('/v1/archives/' + archiveId + '/consent', { document: consentDocument() });
  await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query("UPDATE memory SET status='candidate' WHERE id=$1", [memory.id]),
  );
  expect((await storyteller.post(url, body)).status).toBe(404);
});

it('withholds a linked original when export is disabled or the source is excluded', async () => {
  await storyteller.put('/v1/archives/' + archiveId + '/consent', { document: consentDocument() });
  const upload = await uploadSource(h, storyteller, archiveId, {
    filename: 'synthetic-garden.webm',
    mimeType: 'audio/webm',
    kind: 'audio',
    bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('synthetic audio')]),
    sidecarText: 'We moved to Pune in 1962 because my father took a job on the railways.',
  });
  expect(upload.status).toBe(200);
  await drainQueue(h.ctx as unknown as PipelineContext, { workerId: 'roadmap-test' });
  const cards = await storyteller.get<{
    memories: { id: string; claims: { evidence: { sourceAssetId: string }[] }[] }[];
  }>('/v1/archives/' + archiveId + '/memories?status=candidate');
  const card = cards.body.memories.find((m) =>
    m.claims.some((c) => c.evidence.some((e) => e.sourceAssetId === upload.sourceId)),
  )!;
  expect(card).toBeDefined();
  expect(
    (
      await storyteller.post('/v1/archives/' + archiveId + '/memories/' + card.id + '/review', {
        decision: 'approve',
      })
    ).status,
  ).toBe(200);
  const url = '/v1/archives/' + archiveId + '/keepsake';
  const body = { title: 'Synthetic keepsake', dedication: '', memoryIds: [card.id] };
  expect((await storyteller.post(url, body)).status).toBe(200);
  await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query(
      "UPDATE source_asset SET privacy=jsonb_set(privacy,'{allowExport}','false') WHERE id=$1",
      [upload.sourceId],
    ),
  );
  expect((await storyteller.post(url, body)).status).toBe(404);
  await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query(
      "UPDATE source_asset SET privacy=jsonb_set(privacy,'{allowExport}','true') WHERE id=$1",
      [upload.sourceId],
    ),
  );
  await storyteller.put('/v1/archives/' + archiveId + '/consent', {
    document: consentDocument({ excludedSourceIds: [upload.sourceId] }),
  });
  expect((await storyteller.post(url, body)).status).toBe(404);
  expect((await storyteller.get('/v1/archives/' + archiveId + '/memories/' + card.id)).status).toBe(
    404,
  );
});
