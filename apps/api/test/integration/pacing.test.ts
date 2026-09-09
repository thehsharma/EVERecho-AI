import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLearningDocument } from '@everecho/consent';
import {
  CORRECT_TEACH_BACK,
  TestClient,
  consentDocument,
  invitationTokenFrom,
  signUp,
  startHarness,
} from '../helpers/harness';
import type { Harness } from '../helpers/harness';

/**
 * Grief-literate pacing, against the real database and the real constraints.
 *
 * Two guarantees, and the second is the one that matters most: the offer to
 * pause is made once, and the answer is final. A product that asks a grieving
 * person the same question twice has not accepted their answer, whatever it
 * tells itself about being helpful.
 */
let h: Harness;
let storyteller: TestClient;
let archiveId: string;
let sessionId: string;

beforeAll(async () => {
  h = await startHarness();
  const buyer = await signUp(h.app, { email: 'pacing-buyer@example.test', displayName: 'Anil' });
  storyteller = await signUp(h.app, {
    email: 'pacing-teller@example.test',
    displayName: 'Kamala Sharma',
  });

  const archive = await buyer.post<{ id: string }>('/v1/archives', {
    name: 'Kamala’s stories',
    subject: { displayName: 'Kamala Sharma', birthYear: 1948 },
    subjectIsAdult: true,
  });
  archiveId = archive.body.id;

  await buyer.post(`/v1/archives/${archiveId}/invitations`, {
    email: 'pacing-teller@example.test',
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
  await storyteller.put(`/v1/archives/${archiveId}/consent`, {
    document: consentDocument(),
  });

  await storyteller.put(`/v1/archives/${archiveId}/learning-policy`, {
    document: { ...defaultLearningDocument(), transcriptRetention: 'until_deleted' },
  });

  const session = await storyteller.post<{ session: { id: string } }>(
    `/v1/archives/${archiveId}/realtime-sessions`,
    { mode: 'interview', language: 'en' },
  );
  sessionId = session.body.session.id;
});

afterAll(async () => h?.close());

/** Moves the session's clock back, which is the only input the offer reacts to. */
const ageSessionBy = (minutes: number) =>
  h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query(
      `UPDATE realtime_session SET started_at = now() - ($2 || ' minutes')::interval WHERE id = $1`,
      [sessionId, String(minutes)],
    ),
  );

const readSession = () =>
  storyteller.get<{ session: { pauseOffer: { message: string; stopLabel: string } | null } }>(
    `/v1/archives/${archiveId}/realtime-sessions/${sessionId}`,
  );

describe('the offer to pause', () => {
  it('says nothing during an ordinary conversation', async () => {
    const response = await readSession();
    expect(response.status).toBe(200);
    expect(response.body.session.pauseOffer).toBeNull();
  });

  it('arrives once the conversation has run long, and offers both answers', async () => {
    await ageSessionBy(40);
    const response = await readSession();

    const offer = response.body.session.pauseOffer!;
    expect(offer.message).toContain('saved');
    expect(offer.stopLabel).toBe('Stop for now');
    // It never says how the person seems, because it does not know and must not guess.
    expect(offer.message).not.toMatch(/you (seem|sound|look)|upset|tired|struggling/i);
    // And it never counts anything at them.
    expect(offer.message).not.toMatch(/\d/);
  });

  it('is gone the moment it is answered', async () => {
    const answered = await storyteller.post(
      `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/pause-offer`,
      { answer: 'continue' },
    );
    expect(answered.status).toBe(200);
    expect((await readSession()).body.session.pauseOffer).toBeNull();
  });

  it('never comes back, however long the conversation then runs', async () => {
    // The whole guarantee. Two more hours and two hundred more turns would not
    // change this: "keep going" was an answer, not a deferral.
    await ageSessionBy(240);
    expect((await readSession()).body.session.pauseOffer).toBeNull();
  });

  it('refuses an answer that is neither of the two offered', async () => {
    const response = await storyteller.post(
      `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/pause-offer`,
      { answer: 'later' },
    );
    expect(response.status).toBe(400);
  });
});

describe('why a conversation ended', () => {
  it('accepts an operational reason', async () => {
    const response = await storyteller.post(
      `/v1/archives/${archiveId}/realtime-sessions/${sessionId}/end`,
      { reason: 'user_ended' },
    );
    expect(response.status).toBe(200);
  });

  it('refuses a reason about the person, at the edge of the API', async () => {
    const session = await storyteller.post<{ session: { id: string } }>(
      `/v1/archives/${archiveId}/realtime-sessions`,
      { mode: 'interview', language: 'en' },
    );
    const response = await storyteller.post(
      `/v1/archives/${archiveId}/realtime-sessions/${session.body.session.id}/end`,
      { reason: 'seemed_upset' },
    );
    expect(response.status).toBe(400);
  });

  it('refuses it at the database too, so the API is not the only thing stopping it', async () => {
    // Three mechanisms is the house style, and this is the one that survives
    // somebody adding a second write path in a year.
    await expect(
      h.ctx.db.withArchiveScope(archiveId, (tx) =>
        tx.query(
          `UPDATE realtime_session SET ended_reason = 'seemed_upset' WHERE archive_id = $1`,
          [archiveId],
        ),
      ),
    ).rejects.toThrow(/realtime_session_ended_reason_is_operational/);
  });

  it('refuses a pause basis that is a claim about somebody', async () => {
    await expect(
      h.ctx.db.withArchiveScope(archiveId, (tx) =>
        tx.query(
          `UPDATE realtime_session SET pause_offer_basis = 'seemed_sad' WHERE archive_id = $1`,
          [archiveId],
        ),
      ),
    ).rejects.toThrow(/realtime_session_pause_basis_is_observable/);
  });
});
