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
 * The ante-mortem directive, against a real database.
 *
 * The tests that matter are about the moment it stops being editable. Before
 * death it is a draft somebody may rewrite as often as they like; after, it is
 * the last word of a person who cannot be asked again, and nothing may touch
 * it — not the family, not an administrator, not a support ticket.
 */

let h: Harness;
let buyer: TestClient;
let storyteller: TestClient;
let anjali: TestClient;
let ravi: TestClient;
let admin: TestClient;
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

/** Puts the directive back in a state these tests can build on. */
async function resetDirective(defaultEffect: 'permit' | 'withhold' = 'permit') {
  await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query(`DELETE FROM remembrance_directive WHERE archive_id = $1`, [archiveId]),
  );
  await storyteller.put(`/v1/archives/${archiveId}/remembrance`, { defaultEffect });
}

beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil' });
  storyteller = await signUp(h.app, { email: 'kamala@example.test', displayName: 'Kamala' });
  anjali = await signUp(h.app, { email: 'anjali@example.test', displayName: 'Anjali' });
  ravi = await signUp(h.app, { email: 'ravi@example.test', displayName: 'Ravi' });
  admin = await signUp(h.app, { email: 'support@example.test', displayName: 'Support' });

  await h.ctx.db.query(`UPDATE app_user SET is_platform_admin = true WHERE email = $1`, [
    'support@example.test',
  ]);

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
              ($1,'The money years','There were years when it was very tight.','approved',
               'interview','normal','P1_DIRECT_STATEMENT', now())
       RETURNING id`,
      [archiveId],
    ),
  );
  memoryIds = rows.map((r) => r.id);
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('writing it', () => {
  it('requires the storyteller to say what silence means', async () => {
    // There is no default in the schema, so a directive cannot exist without
    // the person having decided how to read their own silence.
    const missing = await storyteller.put(`/v1/archives/${archiveId}/remembrance`, {});
    expect(missing.status).toBe(400);

    const created = await storyteller.put<{ directive: { defaultEffect: string } }>(
      `/v1/archives/${archiveId}/remembrance`,
      { defaultEffect: 'withhold', note: 'Play the school stories. Not the money ones.' },
    );
    expect(created.status).toBe(200);
    expect(created.body.directive.defaultEffect).toBe('withhold');
  });

  it('lets them change their mind as often as they like', async () => {
    await storyteller.put(`/v1/archives/${archiveId}/remembrance`, { defaultEffect: 'withhold' });
    const revised = await storyteller.put<{ directive: { defaultEffect: string } }>(
      `/v1/archives/${archiveId}/remembrance`,
      { defaultEffect: 'permit' },
    );
    expect(revised.status).toBe(200);
    expect(revised.body.directive.defaultEffect).toBe('permit');
  });

  it('takes a refusal as readily as a permission', async () => {
    await resetDirective('permit');
    const withheld = await storyteller.post<{ directive: { clauses: { effect: string }[] } }>(
      `/v1/archives/${archiveId}/remembrance/clauses`,
      { effect: 'withhold', scope: 'memory', memoryId: memoryIds[1] },
    );
    expect(withheld.status).toBe(200);
    expect(withheld.body.directive.clauses.some((c) => c.effect === 'withhold')).toBe(true);
  });

  it('refuses a withholding clause that would expire', async () => {
    // A refusal that opens later is a permission wearing a refusal's clothes.
    // Rejected by the schema and by the contract, so this checks the contract.
    const response = await storyteller.post(`/v1/archives/${archiveId}/remembrance/clauses`, {
      effect: 'withhold',
      scope: 'archive',
      notBefore: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(response.status).toBe(400);
  });

  it('can single out one person the storyteller already invited', async () => {
    await resetDirective('permit');
    const response = await storyteller.post<{
      directive: { clauses: { audienceUserId: string | null; effect: string }[] };
    }>(`/v1/archives/${archiveId}/remembrance/clauses`, {
      effect: 'withhold',
      scope: 'archive',
      audienceUserId: raviId,
    });
    expect(response.status).toBe(200);
    const forRavi = response.body.directive.clauses.find((c) => c.audienceUserId === raviId);
    expect(forRavi?.effect).toBe('withhold');

    // And the same clause says nothing about anybody else.
    expect(response.body.directive.clauses.some((c) => c.audienceUserId === anjaliId)).toBe(false);
  });

  it('cannot name somebody the archive has not already admitted', async () => {
    // A directive narrows what consent permits. It can never reach a person
    // consent has not admitted, so an outsider is reported as not found.
    const outsider = await signUp(h.app, {
      email: 'stranger@example.test',
      displayName: 'Stranger',
    });
    const strangerId = (await outsider.get<{ user: { id: string } }>('/v1/me')).body.user.id;

    const response = await storyteller.post(`/v1/archives/${archiveId}/remembrance/clauses`, {
      effect: 'permit',
      scope: 'archive',
      audienceUserId: strangerId,
    });
    expect(response.status).toBe(404);
  });
});

describe('who may write it', () => {
  it('keeps it to the person it speaks for', async () => {
    for (const client of [anjali, ravi, buyer, admin]) {
      const response = await client.put(`/v1/archives/${archiveId}/remembrance`, {
        defaultEffect: 'permit',
      });
      expect([403, 404]).toContain(response.status);
    }
  });

  it('lets the family read what was decided about them', async () => {
    // Being refused without being told a decision exists is how people
    // conclude the software is hiding something.
    const response = await anjali.get<{ directive: { editable: boolean } | null }>(
      `/v1/archives/${archiveId}/remembrance`,
    );
    expect(response.status).toBe(200);
    expect(response.body.directive).not.toBeNull();
    expect(response.body.directive?.editable).toBe(false);
  });
});

describe('recording that they have died', () => {
  it('is not reachable from the product at all', async () => {
    await resetDirective('permit');
    await storyteller.post(`/v1/archives/${archiveId}/remembrance/affirm`, {});

    for (const client of [storyteller, anjali, ravi, buyer]) {
      const response = await client.post(`/v1/admin/archives/${archiveId}/remembrance/activate`, {
        executedByName: 'Somebody',
        evidenceKind: 'death_certificate',
        evidenceReference: 'REF-1',
      });
      expect(response.status).toBe(404);
    }
  });

  it('refuses a directive the storyteller never confirmed', async () => {
    await resetDirective('permit');
    const response = await admin.post(`/v1/admin/archives/${archiveId}/remembrance/activate`, {
      executedByName: 'Priya Nair',
      evidenceKind: 'death_certificate',
      evidenceReference: 'MH/2026/00481',
    });
    expect(response.status).toBe(409);
  });

  it('records who did it, and on what evidence', async () => {
    await resetDirective('permit');
    await storyteller.post(`/v1/archives/${archiveId}/remembrance/affirm`, {});

    const response = await admin.post<{ directive: { status: string; activatedAt: string } }>(
      `/v1/admin/archives/${archiveId}/remembrance/activate`,
      {
        executedByName: 'Priya Nair',
        evidenceKind: 'death_certificate',
        evidenceReference: 'MH/2026/00481',
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.directive.status).toBe('activated');

    const activation = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ executed_by_name: string; evidence_reference: string; kind: string }>(
        `SELECT executed_by_name, evidence_reference, kind FROM remembrance_activation
          WHERE archive_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [archiveId],
      ),
    );
    expect(activation.kind).toBe('activated');
    expect(activation.executed_by_name).toBe('Priya Nair');
    expect(activation.evidence_reference).toBe('MH/2026/00481');
  });

  it('is visible to the family in the archive’s own activity log', async () => {
    // Not only in an internal log. The family is entitled to see who recorded
    // this, and on what evidence.
    const audit = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query<{ action: string }>(
        `SELECT action FROM audit_event
          WHERE archive_id = $1 AND action = 'admin.remembrance.activate'`,
        [archiveId],
      ),
    );
    expect(audit.length).toBeGreaterThan(0);
  });
});

describe('after it has been activated', () => {
  it('cannot be edited by anyone, including an administrator', async () => {
    // The person it speaks for cannot revise it any more, so nobody else may.
    const clients: [string, TestClient][] = [
      ['storyteller', storyteller],
      ['family', anjali],
      ['admin', admin],
    ];
    for (const [, client] of clients) {
      const changed = await client.put(`/v1/archives/${archiveId}/remembrance`, {
        defaultEffect: 'permit',
      });
      expect(changed.status).not.toBe(200);

      const added = await client.post(`/v1/archives/${archiveId}/remembrance/clauses`, {
        effect: 'permit',
        scope: 'archive',
      });
      expect(added.status).not.toBe(200);
    }
  });

  it('tells the storyteller plainly rather than failing silently', async () => {
    const response = await storyteller.post(`/v1/archives/${archiveId}/remembrance/clauses`, {
      effect: 'permit',
      scope: 'archive',
    });
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('remembrance_activated');
  });

  it('cannot be activated twice', async () => {
    const response = await admin.post(`/v1/admin/archives/${archiveId}/remembrance/activate`, {
      executedByName: 'Somebody Else',
      evidenceKind: 'other',
      evidenceReference: 'REF-2',
    });
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('remembrance_already_activated');
  });

  it('reports itself as no longer editable', async () => {
    const response = await storyteller.get<{ directive: { editable: boolean; status: string } }>(
      `/v1/archives/${archiveId}/remembrance`,
    );
    expect(response.body.directive.status).toBe('activated');
    expect(response.body.directive.editable).toBe(false);
  });
});

describe('archive isolation', () => {
  it('never returns one archive’s directive in another’s scope', async () => {
    const other = await buyer.post<{ id: string }>('/v1/archives', {
      name: 'Another archive',
      subject: { displayName: 'Someone Else', birthYear: 1950 },
      subjectIsAdult: true,
    });
    const leaked = await h.ctx.db.withArchiveScope(other.body.id, (tx) =>
      tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM remembrance_directive`),
    );
    expect(leaked.n).toBe(0);

    const unscoped = await h.ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM remembrance_directive`,
    );
    expect(unscoped[0]?.n).toBe(0);
  });
});
