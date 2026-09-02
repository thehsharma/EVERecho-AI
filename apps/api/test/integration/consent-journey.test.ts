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

let h: Harness;
let buyer: TestClient;
let storyteller: TestClient;
let archiveId: string;

beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'buyer@example.test', displayName: 'Anil Sharma' });
  storyteller = await signUp(h.app, { email: 'kamala@example.test', displayName: 'Kamala Sharma' });
}, 120_000);

afterAll(async () => {
  await h?.close();
});

describe('a buyer starts an archive but does not own it', () => {
  it('creates an archive shell that grants nobody anything', async () => {
    const response = await buyer.post<{ id: string; status: string; viewerRole: string }>(
      '/v1/archives',
      {
        name: 'Kamala’s stories',
        subject: { displayName: 'Kamala Sharma', birthYear: 1948 },
        subjectIsAdult: true,
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.status).toBe('draft');
    expect(response.body.viewerRole).toBe('buyer');
    archiveId = response.body.id;
  });

  it('refuses to create an archive for a minor', async () => {
    const response = await buyer.post('/v1/archives', {
      name: 'Too young',
      subject: { displayName: 'A Child', birthYear: new Date().getFullYear() - 9 },
      subjectIsAdult: true,
    });
    expect(response.status).toBe(400);
  });

  it('will not let the buyer consent on the storyteller’s behalf', async () => {
    const response = await buyer.put(`/v1/archives/${archiveId}/consent`, {
      document: consentDocument(),
    });
    expect(response.status).toBe(403);
    expect(response.reasonCode).toBe('buyer_cannot_consent_for_storyteller');
  });

  it('shows no consent policy before the storyteller has said anything', async () => {
    const response = await buyer.get<{ policy: unknown }>(`/v1/archives/${archiveId}/consent`);
    expect(response.status).toBe(200);
    expect(response.body.policy).toBeNull();
  });
});

describe('the storyteller decides for themselves', () => {
  let token: string;

  it('sends an invitation that discloses nothing about the archive', async () => {
    const response = await buyer.post(`/v1/archives/${archiveId}/invitations`, {
      email: 'kamala@example.test',
      displayName: 'Kamala Sharma',
      role: 'storyteller',
      personalNote: 'Only if you would like to, Ma.',
      expiresInDays: 14,
    });
    expect(response.status).toBe(201);
    token = invitationTokenFrom(h.ctx);

    const preview = await new TestClient(h.app).get<Record<string, unknown>>(
      `/v1/invitations/${token}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body.requiresTeachBack).toBe(true);
    expect(preview.body.invitedByDisplayName).toBe('Anil Sharma');
    expect(Object.keys(preview.body)).not.toContain('memories');
    expect(Object.keys(preview.body)).not.toContain('members');
  });

  it('refuses an invitation opened by someone it was not addressed to', async () => {
    const stranger = await signUp(h.app, {
      email: 'stranger@example.test',
      displayName: 'Stranger',
    });
    const response = await stranger.post(`/v1/invitations/${token}/respond`, {
      decision: 'accept',
    });
    expect(response.status).toBe(400);
  });

  it('lets the storyteller accept, without that being consent', async () => {
    const response = await storyteller.post<{ nextStep: string }>(
      `/v1/invitations/${token}/respond`,
      {
        decision: 'accept',
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.nextStep).toBe('teach_back');

    const archive = await storyteller.get<{ status: string; viewerRole: string }>(
      `/v1/archives/${archiveId}`,
    );
    expect(archive.body.status).toBe('awaiting_storyteller');
    expect(archive.body.viewerRole).toBe('storyteller');
  });

  it('will not set permissions until teach-back is passed', async () => {
    const response = await storyteller.put(`/v1/archives/${archiveId}/consent`, {
      document: consentDocument(),
    });
    expect(response.status).toBe(409);
  });

  it('teaches rather than blocks when an answer is wrong', async () => {
    const wrong = CORRECT_TEACH_BACK.map((a) =>
      a.questionId === 'ai_role' ? { ...a, optionId: 'speak_as_me' } : a,
    );
    const response = await storyteller.post<{
      result: { passed: boolean; attempt: number };
      teaching: { explanation: string }[];
    }>(`/v1/archives/${archiveId}/consent/teach-back`, { answers: wrong });

    expect(response.body.result.passed).toBe(false);
    expect(response.body.result.attempt).toBe(1);
    expect(response.body.teaching[0]?.explanation).toMatch(/never speak as you/i);
  });

  it('records the passing attempt', async () => {
    const response = await storyteller.post<{ result: { passed: boolean; attempt: number } }>(
      `/v1/archives/${archiveId}/consent/teach-back`,
      { answers: CORRECT_TEACH_BACK },
    );
    expect(response.body.result.passed).toBe(true);
    expect(response.body.result.attempt).toBe(2);
  });

  it('activates the archive once consent is granted', async () => {
    const response = await storyteller.put<{ policy: { version: number } }>(
      `/v1/archives/${archiveId}/consent`,
      { document: consentDocument() },
    );
    expect(response.status).toBe(200);
    expect(response.body.policy.version).toBe(1);

    const archive = await storyteller.get<{ status: string; consentMode: string }>(
      `/v1/archives/${archiveId}`,
    );
    expect(archive.body.status).toBe('active');
    expect(archive.body.consentMode).toBe('compose');
  });

  it('refuses a consent document that grants a synthetic voice', async () => {
    const response = await storyteller.put(`/v1/archives/${archiveId}/consent`, {
      document: consentDocument({
        voiceAndLikeness: {
          syntheticVoice: true,
          syntheticLikeness: false,
          personaSimulation: false,
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/voice and likeness/i);
  });

  it('refuses perform mode', async () => {
    const response = await storyteller.put(`/v1/archives/${archiveId}/consent`, {
      document: consentDocument({ mode: 'perform' }),
    });
    expect(response.status).toBe(400);
  });

  it('keeps every consent version, so an old policy is still answerable', async () => {
    const history = await storyteller.get<{ versions: { version: number }[]; records: unknown[] }>(
      `/v1/archives/${archiveId}/consent/history`,
    );
    expect(history.body.versions.length).toBeGreaterThanOrEqual(1);
    expect(history.body.records.length).toBeGreaterThanOrEqual(3);
  });
});

describe('what the buyer can see afterwards', () => {
  it('sees the membership list but no content', async () => {
    const members = await buyer.get<{ members: { role: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    );
    expect(members.body.members.map((m) => m.role).sort()).toEqual(['buyer', 'storyteller']);
  });

  it('cannot withdraw anyone’s access', async () => {
    const members = await storyteller.get<{ members: { id: string; role: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    );
    const buyerMembership = members.body.members.find((m) => m.role === 'buyer')!;
    const response = await buyer.patch(`/v1/archives/${archiveId}/members/${buyerMembership.id}`, {
      status: 'revoked',
    });
    expect(response.status).toBe(403);
  });

  it('cannot withdraw the storyteller’s own access even as the storyteller', async () => {
    const members = await storyteller.get<{ members: { id: string; role: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    );
    const storytellerMembership = members.body.members.find((m) => m.role === 'storyteller')!;
    const response = await storyteller.patch(
      `/v1/archives/${archiveId}/members/${storytellerMembership.id}`,
      { status: 'revoked' },
    );
    expect(response.status).toBe(400);
  });
});

describe('archives are invisible to everyone else', () => {
  it('reports someone else’s archive as not found, not as forbidden', async () => {
    const outsider = await signUp(h.app, {
      email: 'outsider@example.test',
      displayName: 'Outsider',
    });
    const response = await outsider.get(`/v1/archives/${archiveId}`);
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toMatch(/Kamala/);
  });

  it('does not list archives the caller has no relationship with', async () => {
    const outsider = await signUp(h.app, {
      email: 'outsider2@example.test',
      displayName: 'Outsider Two',
    });
    const response = await outsider.get<{ archives: unknown[] }>('/v1/archives');
    expect(response.body.archives).toHaveLength(0);
  });
});

describe('session and CSRF handling', () => {
  it('rejects a state-changing request that carries a session cookie but no CSRF token', async () => {
    const response = await h.app.inject({
      method: 'POST',
      url: '/v1/archives',
      headers: { 'content-type': 'application/json', cookie: 'everecho_session=whatever' },
      payload: JSON.stringify({ name: 'x', subject: { displayName: 'y' }, subjectIsAdult: true }),
    });
    expect(response.statusCode).toBe(403);
  });

  it('refuses anonymous access to archive routes', async () => {
    const anonymous = new TestClient(h.app);
    expect((await anonymous.get(`/v1/archives/${archiveId}`)).status).toBe(401);
  });

  it('signs out and stops accepting the session', async () => {
    const temporary = await signUp(h.app, { email: 'temp@example.test', displayName: 'Temp' });
    expect((await temporary.get('/v1/me')).status).toBe(200);
    await temporary.post('/v1/auth/sign-out');
    expect((await temporary.get('/v1/me')).status).toBe(401);
  });
});

describe('operational endpoints leak nothing', () => {
  it('reports readiness without versions, hostnames or connection strings', async () => {
    const response = await new TestClient(h.app).get<{ status: string; checks: unknown[] }>(
      '/readyz',
    );
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toMatch(/postgres:\/\/|password|127\.0\.0\.1/);
  });

  it('describes the product without claiming capabilities it does not have', async () => {
    const response = await new TestClient(h.app).get<{
      features: { performMode: boolean; successionExecution: boolean };
      providers: { compositionIsExtractive: boolean };
    }>('/v1/meta');
    expect(response.body.features.performMode).toBe(false);
    expect(response.body.features.successionExecution).toBe(false);
    expect(response.body.providers.compositionIsExtractive).toBe(true);
  });
});

describe('a gift the storyteller turns down', () => {
  /**
   * A buyer may pay for an archive and still not be its owner, and the person
   * it was bought for may say no. What the money does then is the part that
   * was missing: the deposit stops waiting, and it does so without carrying
   * anything the storyteller said about why.
   */
  it('releases the deposit when the storyteller declines, and tells the buyer nothing', async () => {
    const giver = await signUp(h.app, { email: 'giver@example.test', displayName: 'Giver' });
    const recipient = await signUp(h.app, {
      email: 'recipient@example.test',
      displayName: 'Recipient',
    });

    const created = await giver.post<{ id: string }>('/v1/archives', {
      name: 'A gift',
      subject: { displayName: 'Recipient Person', birthYear: 1950 },
      subjectIsAdult: true,
    });
    const giftArchiveId = created.body.id;

    // A paid reservation against that archive.
    const reserved = await giver.post<{
      reservation: { id: string; providerRef: string | null };
    }>('/v1/billing/reservations', {
      currency: 'INR',
      archiveId: giftArchiveId,
      idempotencyKey: `gift-${Date.now()}`,
    });
    expect(reserved.status).toBe(201);

    // The real payment path, not a shortcut: the local provider signs the same
    // webhook a real one would send, and the signature check runs.
    const signed = await giver.post<{ signature: string; payload: string }>(
      '/v1/billing/local-checkout/complete',
      { providerRef: reserved.body.reservation.providerRef!, outcome: 'paid' },
    );
    expect(signed.status).toBe(200);
    const delivered = await h.app.inject({
      method: 'POST',
      url: '/v1/webhooks/billing',
      headers: { 'content-type': 'application/json', 'x-signature': signed.body.signature },
      payload: signed.body.payload,
    });
    expect(delivered.statusCode).toBeLessThan(300);

    await giver.post(`/v1/archives/${giftArchiveId}/invitations`, {
      email: 'recipient@example.test',
      displayName: 'Recipient Person',
      role: 'storyteller',
      expiresInDays: 14,
    });
    const token = invitationTokenFrom(h.ctx);

    const declined = await recipient.post(`/v1/invitations/${token}/respond`, {
      decision: 'decline',
      declineReason: 'I would rather my life were not written down.',
    });
    expect(declined.status).toBe(200);

    // The money stopped waiting, and it says why in a reason code.
    const reservations = await giver.get<{
      reservations: { id: string; status: string; releaseReasonCode: string | null }[];
    }>('/v1/billing');
    const reservation = reservations.body.reservations.find(
      (r) => r.id === reserved.body.reservation.id,
    );
    expect(reservation?.status).toBe('released');
    expect(reservation?.releaseReasonCode).toBe('storyteller_declined');

    // And the buyer learns nothing about why the person said no.
    expect(JSON.stringify(reservations.body)).not.toContain('rather my life');

    // Paying did not make them the owner, and declining did not make them one.
    const reach = await giver.get(`/v1/archives/${giftArchiveId}/memories`);
    expect([200, 403, 404]).toContain(reach.status);
    if (reach.status === 200) {
      expect((reach.body as { memories: unknown[] }).memories).toEqual([]);
    }
  });
});
