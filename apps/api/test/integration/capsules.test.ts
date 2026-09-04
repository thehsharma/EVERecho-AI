import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
 * Private story capsules, against a real database.
 *
 * The tests that matter are the ones about a link that should have stopped
 * working: after revocation, before an embargo lifts, after expiry, for
 * somebody it was never for, and for a story that became more private after
 * the capsule was made.
 */

let h: Harness;
let buyer: TestClient;
let storyteller: TestClient;
let anjali: TestClient;
let ravi: TestClient;
let outsider: TestClient;
let archiveId: string;
let anjaliId: string;
let raviId: string;
let memoryIds: string[] = [];

async function invite(
  from: TestClient,
  as: TestClient,
  input: { email: string; displayName: string; role: string },
): Promise<void> {
  await from.post(`/v1/archives/${archiveId}/invitations`, {
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    expiresInDays: 14,
  });
  const token = invitationTokenFrom(h.ctx);
  await as.post(`/v1/invitations/${token}/respond`, { decision: 'accept' });
}

beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil' });
  storyteller = await signUp(h.app, { email: 'kamala@example.test', displayName: 'Kamala' });
  anjali = await signUp(h.app, { email: 'anjali@example.test', displayName: 'Anjali' });
  ravi = await signUp(h.app, { email: 'ravi@example.test', displayName: 'Ravi' });
  outsider = await signUp(h.app, { email: 'nobody@example.test', displayName: 'Nobody' });

  const created = await buyer.post<{ id: string }>('/v1/archives', {
    name: 'Kamala’s stories',
    subject: { displayName: 'Kamala Deshpande', birthYear: 1948 },
    subjectIsAdult: true,
  });
  archiveId = created.body.id;

  await invite(buyer, storyteller, {
    email: 'kamala@example.test',
    displayName: 'Kamala',
    role: 'storyteller',
  });
  await storyteller.post(`/v1/archives/${archiveId}/consent/teach-back`, {
    answers: CORRECT_TEACH_BACK,
  });
  await storyteller.put(`/v1/archives/${archiveId}/consent`, { document: consentDocument() });
  await invite(storyteller, anjali, {
    email: 'anjali@example.test',
    displayName: 'Anjali',
    role: 'family',
  });
  await invite(storyteller, ravi, {
    email: 'ravi@example.test',
    displayName: 'Ravi',
    role: 'contributor',
  });

  anjaliId = (await anjali.get<{ user: { id: string } }>('/v1/me')).body.user.id;
  raviId = (await ravi.get<{ user: { id: string } }>('/v1/me')).body.user.id;

  const rows = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query<{ id: string }>(
      `INSERT INTO memory (archive_id, title, body, status, origin, sensitivity, evidence_class,
                           approved_at)
       VALUES ($1,'The kitchen','It smelled of cardamom every morning.','approved','interview',
               'normal','P1_DIRECT_STATEMENT', now()),
              ($1,'The move','We moved to Pune in 1962.','approved','interview','normal',
               'P1_DIRECT_STATEMENT', now())
       RETURNING id`,
      [archiveId],
    ),
  );
  memoryIds = rows.map((r) => r.id);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('making one', () => {
  it('packages approved stories for named people', async () => {
    const response = await storyteller.post<{
      capsule: { id: string; itemCount: number; recipients: { userId: string }[] };
    }>(`/v1/archives/${archiveId}/capsules`, {
      title: 'For Anjali, on her birthday',
      memoryIds,
      recipientUserIds: [anjaliId],
    });
    expect(response.status).toBe(201);
    expect(response.body.capsule.itemCount).toBe(2);
    expect(response.body.capsule.recipients[0]?.userId).toBe(anjaliId);
  });

  it('refuses to include a story that has not been approved', async () => {
    const candidate = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ id: string }>(
        `INSERT INTO memory (archive_id, title, body, status, origin, sensitivity, evidence_class)
         VALUES ($1,'Not yet','Something still in review.','candidate','interview','normal',
                 'P1_DIRECT_STATEMENT') RETURNING id`,
        [archiveId],
      ),
    );
    const response = await storyteller.post(`/v1/archives/${archiveId}/capsules`, {
      title: 'Too early',
      memoryIds: [candidate.id],
      recipientUserIds: [anjaliId],
    });
    expect(response.status).toBe(400);
  });

  it('refuses to include somebody who is not a member', async () => {
    const outsiderId = (await outsider.get<{ user: { id: string } }>('/v1/me')).body.user.id;
    const response = await storyteller.post(`/v1/archives/${archiveId}/capsules`, {
      title: 'For a stranger',
      memoryIds,
      recipientUserIds: [outsiderId],
    });
    expect(response.status).toBe(400);
  });

  it('refuses to let a family member make one', async () => {
    const response = await anjali.post(`/v1/archives/${archiveId}/capsules`, {
      title: 'Mine now',
      memoryIds,
      recipientUserIds: [anjaliId],
    });
    expect(response.status).toBe(403);
  });
});

describe('opening one', () => {
  let capsuleId: string;

  beforeAll(async () => {
    const created = await storyteller.post<{ capsule: { id: string } }>(
      `/v1/archives/${archiveId}/capsules`,
      { title: 'For Anjali', memoryIds, recipientUserIds: [anjaliId] },
    );
    capsuleId = created.body.capsule.id;
  });

  it('shows the recipient what is in it', async () => {
    const opened = await anjali.get<{ capsule: { memories: { title: string }[]; from: string } }>(
      `/v1/archives/${archiveId}/capsules/${capsuleId}/open`,
    );
    expect(opened.status).toBe(200);
    expect(opened.body.capsule.memories).toHaveLength(2);
    expect(opened.body.capsule.from).toContain('Kamala');
  });

  it('refuses somebody it was not made for', async () => {
    // Ravi is a member of the archive and still not a recipient of this.
    const response = await ravi.get(`/v1/archives/${archiveId}/capsules/${capsuleId}/open`);
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('capsule_not_yours');
  });

  it('reports it as missing to somebody outside the archive', async () => {
    const response = await outsider.get(`/v1/archives/${archiveId}/capsules/${capsuleId}/open`);
    expect(response.status).toBe(404);
  });

  it('records who opened it and who was turned away', async () => {
    const log = await storyteller.get<{
      events: { action: string; reasonCode: string | null }[];
    }>(`/v1/archives/${archiveId}/capsules/${capsuleId}/access`);
    expect(log.status).toBe(200);
    expect(log.body.events.some((e) => e.action === 'opened')).toBe(true);
    // The refusal matters more than the open.
    expect(
      log.body.events.some((e) => e.action === 'refused' && e.reasonCode === 'capsule_not_yours'),
    ).toBe(true);
  });

  it('keeps the access log away from the people it names', async () => {
    const response = await anjali.get(`/v1/archives/${archiveId}/capsules/${capsuleId}/access`);
    expect([403, 404]).toContain(response.status);
  });
});

describe('a link that should have stopped working', () => {
  it('stops the moment it is withdrawn', async () => {
    const created = await storyteller.post<{ capsule: { id: string } }>(
      `/v1/archives/${archiveId}/capsules`,
      { title: 'Withdrawn later', memoryIds, recipientUserIds: [anjaliId] },
    );
    const capsuleId = created.body.capsule.id;

    expect((await anjali.get(`/v1/archives/${archiveId}/capsules/${capsuleId}/open`)).status).toBe(
      200,
    );

    await storyteller.post(`/v1/archives/${archiveId}/capsules/${capsuleId}/revoke`, {
      reason: 'Changed my mind.',
    });

    const after = await anjali.get(`/v1/archives/${archiveId}/capsules/${capsuleId}/open`);
    expect(after.status).toBe(409);
    expect(after.reasonCode).toBe('capsule_revoked');
    // And the reason the storyteller gave is not sent to the recipient.
    expect(JSON.stringify(after.body)).not.toContain('Changed my mind');
  });

  it('will not open before its time', async () => {
    const created = await storyteller.post<{ capsule: { id: string } }>(
      `/v1/archives/${archiveId}/capsules`,
      {
        title: 'For her birthday',
        memoryIds,
        recipientUserIds: [anjaliId],
        embargoUntil: new Date(Date.now() + 86_400_000).toISOString(),
      },
    );
    const response = await anjali.get(
      `/v1/archives/${archiveId}/capsules/${created.body.capsule.id}/open`,
    );
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('capsule_embargoed');
  });

  it('will not open after it expires', async () => {
    const created = await storyteller.post<{ capsule: { id: string } }>(
      `/v1/archives/${archiveId}/capsules`,
      { title: 'Briefly', memoryIds, recipientUserIds: [anjaliId] },
    );
    // Backdated rather than waited for: the check is on the clock, and the
    // test should not be.
    await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query(`UPDATE story_capsule SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
        created.body.capsule.id,
      ]),
    );
    const response = await anjali.get(
      `/v1/archives/${archiveId}/capsules/${created.body.capsule.id}/open`,
    );
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('capsule_expired');
  });

  it('stops when the recipient’s access to the archive is withdrawn', async () => {
    const created = await storyteller.post<{ capsule: { id: string } }>(
      `/v1/archives/${archiveId}/capsules`,
      { title: 'Before revocation', memoryIds, recipientUserIds: [raviId] },
    );
    expect(
      (await ravi.get(`/v1/archives/${archiveId}/capsules/${created.body.capsule.id}/open`)).status,
    ).toBe(200);

    const members = await storyteller.get<{ members: { id: string; userId: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    );
    const membership = members.body.members.find((m) => m.userId === raviId)!;
    await storyteller.patch(`/v1/archives/${archiveId}/members/${membership.id}`, {
      status: 'revoked',
    });

    // The capsule grant is still active; the archive membership is not, and
    // that is the ceiling.
    const after = await ravi.get(
      `/v1/archives/${archiveId}/capsules/${created.body.capsule.id}/open`,
    );
    expect([403, 404]).toContain(after.status);
  });
});

describe('a capsule never widens consent', () => {
  it('drops a story that was made more private after the capsule was built', async () => {
    const created = await storyteller.post<{ capsule: { id: string } }>(
      `/v1/archives/${archiveId}/capsules`,
      { title: 'Two stories', memoryIds, recipientUserIds: [anjaliId] },
    );
    const capsuleId = created.body.capsule.id;

    const before = await anjali.get<{ capsule: { memories: unknown[] } }>(
      `/v1/archives/${archiveId}/capsules/${capsuleId}/open`,
    );
    expect(before.body.capsule.memories).toHaveLength(2);

    // Anjali's grant is `normal`; raising one story above it removes it from
    // her view without anybody editing the capsule.
    await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query(`UPDATE memory SET sensitivity = 'restricted' WHERE id = $1`, [memoryIds[0]]),
    );

    const after = await anjali.get<{ capsule: { memories: { title: string }[] } }>(
      `/v1/archives/${archiveId}/capsules/${capsuleId}/open`,
    );
    expect(after.body.capsule.memories).toHaveLength(1);
    expect(after.body.capsule.memories[0]?.title).toBe('The move');
  });
});

describe('archive isolation holds for capsules', () => {
  it('never returns one archive’s capsules in another’s scope', async () => {
    const other = await buyer.post<{ id: string }>('/v1/archives', {
      name: 'A different family',
      subject: { displayName: 'Someone Else' },
      subjectIsAdult: true,
    });
    const leaked = await h.ctx.db.withArchiveScope(other.body.id, (tx) =>
      tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM story_capsule`),
    );
    expect(leaked.n).toBe(0);

    const unscoped = await h.ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM story_capsule`,
    );
    expect(unscoped[0]?.n).toBe(0);
  });
});
