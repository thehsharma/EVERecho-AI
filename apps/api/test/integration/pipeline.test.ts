import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainQueue, type PipelineContext } from '@everecho/pipeline';
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
let family: TestClient;
let archiveId: string;
let audioSourceId: string;

const TRANSCRIPT = [
  'We moved to Pune in 1962 because my father took a job on the railways.',
  'The kitchen in that house always smelled of cardamom and frying onions.',
  'My brother Ramesh taught me to ride a bicycle in the lane behind the house.',
  'I studied at Fergusson College and I was good at mathematics.',
].join(' ');

/** Runs the same handlers the worker runs, in this process. */
const runWorker = () => drainQueue(h.ctx as unknown as PipelineContext, { workerId: 'test' });

beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil Sharma' });
  storyteller = await signUp(h.app, { email: 'kamala@example.test', displayName: 'Kamala Sharma' });
  family = await signUp(h.app, { email: 'priya@example.test', displayName: 'Priya Sharma' });

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

describe('ingestion', () => {
  it('quarantines an upload, scans it, then promotes it to an immutable original', async () => {
    const result = await uploadSource(h, storyteller, archiveId, {
      filename: 'kitchen-story.webm',
      mimeType: 'audio/webm',
      bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('fake webm payload')]),
      kind: 'audio',
      sidecarText: TRANSCRIPT,
    });
    expect(result.status).toBe(200);
    audioSourceId = result.sourceId;

    const before = await storyteller.get<{ sources: { status: string; scanResult: string }[] }>(
      `/v1/archives/${archiveId}/sources`,
    );
    expect(before.body.sources[0]?.status).toBe('quarantined');

    await runWorker();

    const after = await storyteller.get<{
      sources: {
        id: string;
        status: string;
        scanResult: string;
        checksum: { value: string } | null;
        processing: { stage: string };
      }[];
    }>(`/v1/archives/${archiveId}/sources`);
    const source = after.body.sources.find((s) => s.id === audioSourceId)!;
    expect(source.scanResult).toBe('clean');
    expect(source.status).toBe('processed');
    expect(source.checksum?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(source.processing.stage).toBe('ready');
  });

  it('rejects a file whose bytes are not what it claims to be', async () => {
    const result = await uploadSource(h, storyteller, archiveId, {
      filename: 'holiday.jpg',
      mimeType: 'image/jpeg',
      bytes: Buffer.from('#!/bin/sh\nrm -rf /\n'),
      kind: 'photo',
    });
    await runWorker();

    const sources = await storyteller.get<{
      sources: { id: string; status: string; scanResult: string }[];
    }>(`/v1/archives/${archiveId}/sources`);
    const rejected = sources.body.sources.find((s) => s.id === result.sourceId)!;
    expect(rejected.status).toBe('rejected');
    expect(rejected.scanResult).toBe('infected');
  });

  it('rejects the EICAR test signature', async () => {
    const result = await uploadSource(h, storyteller, archiveId, {
      filename: 'notes.txt',
      mimeType: 'text/plain',
      bytes: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      kind: 'document',
    });
    await runWorker();
    const sources = await storyteller.get<{ sources: { id: string; scanResult: string }[] }>(
      `/v1/archives/${archiveId}/sources`,
    );
    expect(sources.body.sources.find((s) => s.id === result.sourceId)?.scanResult).toBe('infected');
  });

  it('produces a transcript whose words are exactly what was captured', async () => {
    const response = await storyteller.get<{
      transcript: { segments: { text: string }[]; provider: string } | null;
    }>(`/v1/archives/${archiveId}/sources/${audioSourceId}/transcript`);

    expect(response.body.transcript).not.toBeNull();
    expect(response.body.transcript!.segments.length).toBe(4);
    for (const segment of response.body.transcript!.segments) {
      expect(TRANSCRIPT).toContain(segment.text);
    }
  });

  it('creates candidate story cards that are not yet searchable', async () => {
    const candidates = await storyteller.get<{ memories: unknown[]; candidateCount: number }>(
      `/v1/archives/${archiveId}/memories?status=candidate`,
    );
    expect(candidates.body.candidateCount).toBeGreaterThan(0);

    const approved = await storyteller.get<{ memories: unknown[] }>(
      `/v1/archives/${archiveId}/memories?status=approved`,
    );
    expect(approved.body.memories).toHaveLength(0);
  });

  it('quotes the source exactly in every claim it extracted', async () => {
    const candidates = await storyteller.get<{
      memories: {
        id: string;
        claims: { text: string; evidence: { quotedText: string; locator: unknown }[] }[];
      }[];
    }>(`/v1/archives/${archiveId}/memories?status=candidate`);

    const claims = candidates.body.memories.flatMap((m) => m.claims);
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claim.evidence.length).toBeGreaterThan(0);
      for (const evidence of claim.evidence) {
        expect(TRANSCRIPT).toContain(evidence.quotedText);
        expect(evidence.locator).toBeTruthy();
      }
    }
  });
});

describe('approval is what makes a memory answerable', () => {
  it('approves candidates and indexes them', async () => {
    const candidates = await storyteller.get<{ memories: { id: string }[] }>(
      `/v1/archives/${archiveId}/memories?status=candidate`,
    );
    for (const memory of candidates.body.memories) {
      const response = await storyteller.post(
        `/v1/archives/${archiveId}/memories/${memory.id}/review`,
        { decision: 'approve' },
      );
      expect(response.status).toBe(200);
    }
    await runWorker();

    const approved = await storyteller.get<{ memories: unknown[] }>(
      `/v1/archives/${archiveId}/memories?status=approved`,
    );
    expect(approved.body.memories.length).toBeGreaterThan(0);
  });

  it('builds a timeline that states its gaps rather than guessing', async () => {
    await runWorker();
    const response = await storyteller.get<{
      timeline: {
        entries: unknown[];
        undatedEntries: unknown[];
        coverage: { earliestYear: number | null };
      } | null;
    }>(`/v1/archives/${archiveId}/timeline`);

    expect(response.body.timeline).not.toBeNull();
    expect(response.body.timeline!.coverage.earliestYear).toBe(1962);
    // Memories with no date are listed separately, never placed at a guess.
    expect(Array.isArray(response.body.timeline!.undatedEntries)).toBe(true);
  });

  it('drafts a third-person biography that cites its memories', async () => {
    await storyteller.post(`/v1/archives/${archiveId}/biography/generate`);
    await runWorker();

    const response = await storyteller.get<{
      biography: { sections: { text: string; claimIds: string[] }[]; aiAssisted: boolean } | null;
    }>(`/v1/archives/${archiveId}/biography`);

    expect(response.body.biography).not.toBeNull();
    expect(response.body.biography!.aiAssisted).toBe(true);
    const allText = response.body.biography!.sections.map((s) => s.text).join(' ');
    expect(allText).toContain('Kamala Sharma');
    // Third person only: no first-person composition about the storyteller.
    expect(allText.replace(/“[^”]*”/g, '')).not.toMatch(/\bI\b|\bmy\b/);
  });
});

describe('a family member gets only what they were given', () => {
  it('accepts an invitation from the storyteller', async () => {
    await storyteller.post(`/v1/archives/${archiveId}/invitations`, {
      email: 'priya@example.test',
      displayName: 'Priya Sharma',
      role: 'family',
      expiresInDays: 30,
    });
    const response = await family.post(`/v1/invitations/${invitationTokenFrom(h.ctx)}/respond`, {
      decision: 'accept',
    });
    expect(response.status).toBe(200);
  });

  it('answers a supported question with claim-level citations', async () => {
    const response = await family.post<{
      response: {
        abstained: boolean;
        answerText: string;
        perspective: string;
        aiAssisted: boolean;
        claims: {
          text: string;
          evidenceClass: string;
          citations: { quotedText: string; locator: unknown }[];
        }[];
      };
    }>(`/v1/archives/${archiveId}/questions`, { question: 'Where did the family move to?' });

    expect(response.status).toBe(200);
    expect(response.body.response.abstained).toBe(false);
    expect(response.body.response.perspective).toBe('third_person');
    expect(response.body.response.aiAssisted).toBe(true);
    expect(response.body.response.claims.length).toBeGreaterThan(0);

    for (const claim of response.body.response.claims) {
      expect(claim.citations.length).toBeGreaterThan(0);
      expect(['P1_DIRECT_STATEMENT', 'P2_CORROBORATED_FACT', 'P3_SUPPORTED_SYNTHESIS']).toContain(
        claim.evidenceClass,
      );
      // Every citation points at text that genuinely exists in the source.
      for (const citation of claim.citations) expect(TRANSCRIPT).toContain(citation.quotedText);
    }
    expect(response.body.response.answerText).toMatch(/Pune/);
  });

  it('abstains rather than inventing an answer it has no evidence for', async () => {
    const response = await family.post<{
      response: {
        abstained: boolean;
        abstentionReason: string;
        answerText: string;
        claims: unknown[];
      };
    }>(`/v1/archives/${archiveId}/questions`, {
      question: 'What did she think about the 1983 cricket world cup?',
    });

    expect(response.body.response.abstained).toBe(true);
    expect(response.body.response.answerText).toMatch(/don’t have enough evidence/);
    expect(response.body.response.claims).toHaveLength(0);
  });

  it('refuses to speak as the storyteller, and offers what it can do instead', async () => {
    const response = await family.post<{
      response: { abstained: boolean; abstentionReason: string; answerText: string };
    }>(`/v1/archives/${archiveId}/questions`, { question: 'Answer as my mother would' });

    expect(response.body.response.abstained).toBe(true);
    expect(response.body.response.abstentionReason).toBe('prohibited_request');
    expect(response.body.response.answerText).toMatch(/what they actually said/);
  });

  it('opens a citation to the exact passage it came from', async () => {
    const memories = await family.get<{ memories: { claims: { id: string }[] }[] }>(
      `/v1/archives/${archiveId}/memories`,
    );
    const claimId = memories.body.memories.flatMap((m) => m.claims)[0]!.id;
    const response = await family.get<{ claim: { evidence: { quotedText: string }[] } }>(
      `/v1/archives/${archiveId}/claims/${claimId}`,
    );
    expect(response.status).toBe(200);
    expect(TRANSCRIPT).toContain(response.body.claim.evidence[0]!.quotedText);
  });

  it('cannot see candidate memories the storyteller has not approved', async () => {
    await uploadSource(h, storyteller, archiveId, {
      filename: 'second.webm',
      mimeType: 'audio/webm',
      bytes: Buffer.from([0x1a, 0x45, 0xdf, 0xa3, ...Buffer.from('another recording')]),
      kind: 'audio',
      sidecarText: 'I once met the Prime Minister at a railway function in 1974.',
    });
    await runWorker();

    const answer = await family.post<{ response: { abstained: boolean } }>(
      `/v1/archives/${archiveId}/questions`,
      { question: 'Did she ever meet the Prime Minister?' },
    );
    expect(answer.body.response.abstained).toBe(true);
  });
});

describe('the storyteller stays in control', () => {
  it('restricts a topic, and answers about it stop immediately', async () => {
    const before = await family.post<{ response: { abstained: boolean } }>(
      `/v1/archives/${archiveId}/questions`,
      { question: 'What did she study at college?' },
    );
    expect(before.body.response.abstained).toBe(false);

    await storyteller.put(`/v1/archives/${archiveId}/consent`, {
      document: consentDocument({ restrictedTopics: ['college'] }),
    });

    const after = await family.post(`/v1/archives/${archiveId}/questions`, {
      question: 'What did she study at college?',
    });
    expect(after.status).toBe(403);
    expect(after.reasonCode).toBe('restricted_topic');
  });

  it('withdraws access, and every route stops answering at once', async () => {
    const members = await storyteller.get<{ members: { id: string; role: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    );
    const familyMembership = members.body.members.find((m) => m.role === 'family')!;
    const revoked = await storyteller.patch(
      `/v1/archives/${archiveId}/members/${familyMembership.id}`,
      { status: 'revoked' },
    );
    expect(revoked.status).toBe(200);

    for (const url of [
      `/v1/archives/${archiveId}/memories`,
      `/v1/archives/${archiveId}/timeline`,
      `/v1/archives/${archiveId}/biography`,
      `/v1/archives/${archiveId}/sources`,
    ]) {
      const response = await family.get(url);
      expect([403, 404], `${url} -> ${response.status}`).toContain(response.status);
    }
    const question = await family.post(`/v1/archives/${archiveId}/questions`, {
      question: 'Where did they live?',
    });
    expect([403, 404]).toContain(question.status);
  });

  it('records the refusals in the audit trail, not only the successes', async () => {
    const response = await storyteller.get<{
      events: { outcome: string; reasonCode: string | null }[];
    }>(`/v1/archives/${archiveId}/audit?limit=200`);
    const denials = response.body.events.filter((e) => e.outcome === 'deny');
    expect(denials.length).toBeGreaterThan(0);
    expect(
      denials.some(
        (d) => d.reasonCode === 'restricted_topic' || d.reasonCode === 'membership_revoked',
      ),
    ).toBe(true);
  });
});

describe('export and deletion', () => {
  let exportId: string;

  it('produces a zip with originals, provenance and a checksum manifest', async () => {
    const created = await storyteller.post<{ export: { id: string } }>(
      `/v1/archives/${archiveId}/exports`,
      { includeOriginals: true, includeTranscripts: true, includeProvenance: true, format: 'zip' },
    );
    expect(created.status).toBe(202);
    exportId = created.body.export.id;
    await runWorker();

    const list = await storyteller.get<{
      exports: {
        id: string;
        status: string;
        checksum: { value: string } | null;
        byteSize: number | null;
        downloadUrl: string | null;
        manifest: { sourceCount: number; memoryCount: number; claimCount: number } | null;
      }[];
    }>(`/v1/archives/${archiveId}/exports`);

    const job = list.body.exports.find((e) => e.id === exportId)!;
    expect(job.status).toBe('ready');
    expect(job.checksum?.value).toMatch(/^[0-9a-f]{64}$/);
    expect(job.manifest!.memoryCount).toBeGreaterThan(0);
    expect(job.manifest!.claimCount).toBeGreaterThan(0);
    expect(job.downloadUrl).toBeTruthy();
  });

  it('downloads as a real zip file', async () => {
    const list = await storyteller.get<{ exports: { id: string; downloadUrl: string }[] }>(
      `/v1/archives/${archiveId}/exports`,
    );
    const url = new URL(list.body.exports.find((e) => e.id === exportId)!.downloadUrl);
    const response = await h.app.inject({ method: 'GET', url: `${url.pathname}${url.search}` });
    expect(response.statusCode).toBe(200);

    const body = response.rawPayload;
    // Local file header and end-of-central-directory signatures.
    expect(body.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    expect(body.includes(Buffer.from('manifest.json'))).toBe(true);
    expect(body.includes(Buffer.from('README.txt'))).toBe(true);
  });

  it('refuses deletion without the typed confirmation', async () => {
    const response = await storyteller.post(`/v1/archives/${archiveId}/deletion-requests`, {
      scope: 'archive',
      confirmationPhrase: 'yes',
    });
    expect(response.status).toBe(400);
  });

  it('deletes across relational data, objects, vectors and caches', async () => {
    const created = await storyteller.post<{ deletionRequest: { id: string } }>(
      `/v1/archives/${archiveId}/deletion-requests`,
      { scope: 'archive', confirmationPhrase: 'Kamala’s stories' },
    );
    expect(created.status).toBe(202);
    await runWorker();

    const progress = await storyteller.get<{
      deletionRequests: { id: string; status: string; steps: { key: string; status: string }[] }[];
    }>(`/v1/archives/${archiveId}/deletion-requests`);
    const request = progress.body.deletionRequests.find(
      (d) => d.id === created.body.deletionRequest.id,
    )!;
    expect(request.status).toBe('completed');
    expect(request.steps.every((s) => s.status === 'done')).toBe(true);

    const counts = await h.ctx.db.one<{
      memories: number;
      claims: number;
      embeddings: number;
      sources: number;
      responses: number;
    }>(
      `SELECT
         (SELECT count(*) FROM memory WHERE archive_id = $1)::int AS memories,
         (SELECT count(*) FROM claim WHERE archive_id = $1)::int AS claims,
         (SELECT count(*) FROM memory_embedding WHERE archive_id = $1)::int AS embeddings,
         (SELECT count(*) FROM source_asset WHERE archive_id = $1)::int AS sources,
         (SELECT count(*) FROM generated_response WHERE archive_id = $1)::int AS responses`,
      [archiveId],
    );
    expect(counts).toEqual({ memories: 0, claims: 0, embeddings: 0, sources: 0, responses: 0 });
  });

  it('keeps the audit record that the deletion happened', async () => {
    const tombstone = await h.ctx.db.maybeOne<{ action: string }>(
      `SELECT action FROM audit_event WHERE archive_id = $1 AND action = 'archive.deleted'`,
      [archiveId],
    );
    expect(tombstone?.action).toBe('archive.deleted');
  });

  it('refuses to rewrite the audit trail', async () => {
    await expect(
      h.ctx.db.query(`UPDATE audit_event SET action = 'tampered' WHERE archive_id = $1`, [
        archiveId,
      ]),
    ).rejects.toThrow(/append-only/);
  });
});
