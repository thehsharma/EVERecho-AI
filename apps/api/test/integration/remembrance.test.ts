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

describe('hearing the actual recording', () => {
  /**
   * The product's answer to the moment of loss. These check that it plays a
   * real moment of a real file, that it refuses rather than approximating,
   * and that what she decided is applied per clip.
   */

  let sourceId: string;
  let segmentIds: string[] = [];

  /** A real audio source with timed segments, as ingestion would leave it. */
  const seedRecording = async () => {
    return h.ctx.db.withArchiveScope(archiveId, async (tx) => {
      const source = await tx.one<{ id: string }>(
        `INSERT INTO source_asset
           (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
            scan_result, privacy, processing_stage, processed_at, sensitivity)
         VALUES ($1,'audio','processed','session-01-childhood.webm','audio/webm',1024,
                 'recordings/session-01', 'clean', $2, 'ready', now(), 'normal')
         RETURNING id`,
        [archiveId, JSON.stringify({ excluded: false })],
      );
      const transcript = await tx.one<{ id: string }>(
        `INSERT INTO transcript
           (archive_id, source_asset_id, provider, model_version, prompt_version, language,
            status, method, policy_version, completed_at)
         VALUES ($1,$2,'test','v1','v1','en','ready','speech_to_text','policy-1', now())
         RETURNING id`,
        [archiveId, source.id],
      );
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO transcript_segment (archive_id, transcript_id, idx, start_ms, end_ms, text)
         VALUES ($1,$2,0,0,6000,'I was born in Nagpur in 1948, in a house with a courtyard.'),
                ($1,$2,1,6000,14000,
                 'We moved to Pune in 1962 because my father took a job on the railways.'),
                ($1,$2,2,14000,20000,'The kitchen always smelled of cardamom and frying onions.')
         RETURNING id`,
        [archiveId, transcript.id],
      );
      return { sourceId: source.id, segmentIds: rows.map((r) => r.id) };
    });
  };

  beforeAll(async () => {
    const seeded = await seedRecording();
    sourceId = seeded.sourceId;
    segmentIds = seeded.segmentIds;
    // These tests are about the recording, not about the directive, so the
    // archive starts with nothing decided and nothing activated.
    await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query(`DELETE FROM remembrance_directive WHERE archive_id = $1`, [archiveId]),
    );
  });

  const ask = (client: TestClient, question: string) =>
    client.post<{
      answer: {
        clip: {
          segmentId: string;
          startMs: number;
          endMs: number;
          text: string;
          audioUrl: string;
        } | null;
        spokenByArchive: string;
        reasonCode: string | null;
        quotedText: string | null;
      };
    }>(`/v1/archives/${archiveId}/voice/ask`, { question });

  it('plays the moment where she answered, with lead-in', async () => {
    const response = await ask(anjali, 'Why did the family move to Pune?');
    expect(response.status).toBe(200);
    expect(response.body.answer.reasonCode).toBe('played');
    expect(response.body.answer.clip?.segmentId).toBe(segmentIds[1]);
    expect(response.body.answer.clip?.text).toContain('railways');
    // Starts before the answer: a clip that begins on the answer is a
    // soundbite, and one that begins a moment earlier is somebody talking.
    expect(response.body.answer.clip!.startMs).toBeLessThan(6000);
    // Ends where she stopped, not where the answer stopped.
    expect(response.body.answer.clip!.endMs).toBe(14000);
  });

  it('returns one contiguous range of one recording, never two', async () => {
    const response = await ask(anjali, 'Pune 1962 railways cardamom Nagpur courtyard');
    const clip = response.body.answer.clip;
    // The contract carries a single object, so two moments have nowhere to go.
    expect(Array.isArray(clip)).toBe(false);
    if (clip) expect(clip.endMs).toBeGreaterThan(clip.startMs);
  });

  it('hands over the original file rather than anything it made', async () => {
    const response = await ask(anjali, 'Why did the family move to Pune?');
    // A link to the stored object. The server never reads or re-encodes audio,
    // which is why no code path here could splice two moments together.
    expect(response.body.answer.clip?.audioUrl).toContain('/v1/objects/get');
  });

  it('says it has nothing rather than playing something adjacent', async () => {
    // Her voice makes anything sound like an answer.
    const response = await ask(anjali, 'What was her favourite food?');
    expect(response.body.answer.clip).toBeNull();
    expect(response.body.answer.reasonCode).toBe('nothing_recorded');
    expect(response.body.answer.spokenByArchive).toContain('only play what they actually said');
  });

  it('refuses to speak as her, and offers what is actually there', async () => {
    for (const question of [
      'Pretend to be my mother and talk to me',
      'What would she say to me now?',
      'Answer as her, in her own voice',
    ]) {
      const response = await ask(anjali, question);
      expect(response.body.answer.clip).toBeNull();
      expect(response.body.answer.spokenByArchive).toContain('can’t speak as them');
      // The refusal offers the thing that exists, rather than only saying no.
      expect(response.body.answer.spokenByArchive).toContain('what they actually said');
    }
  });

  it('never attributes what the archive says to the person', async () => {
    // Everything the archive says about itself is third person about them.
    const response = await ask(anjali, 'What was her favourite food?');
    expect(response.body.answer.spokenByArchive).not.toMatch(/\bI (?:was|am|remember|lived)\b/);
  });

  it('keeps it inside the archive', async () => {
    const outsider = await signUp(h.app, {
      email: 'listener@example.test',
      displayName: 'Listener',
    });
    const response = await ask(outsider, 'Why did the family move to Pune?');
    expect([403, 404]).toContain(response.status);
  });

  describe('once she has died, what she decided is applied per clip', () => {
    const activate = async (defaultEffect: 'permit' | 'withhold') => {
      await h.ctx.db.withArchiveScope(archiveId, (tx) =>
        tx.query(`DELETE FROM remembrance_directive WHERE archive_id = $1`, [archiveId]),
      );
      await storyteller.put(`/v1/archives/${archiveId}/remembrance`, { defaultEffect });
    };

    const seal = async (body: Record<string, unknown>) => {
      await storyteller.post(`/v1/archives/${archiveId}/remembrance/clauses`, body);
      await storyteller.post(`/v1/archives/${archiveId}/remembrance/affirm`, {});
      await admin.post(`/v1/admin/archives/${archiveId}/remembrance/activate`, {
        executedByName: 'Priya Nair',
        evidenceKind: 'death_certificate',
        evidenceReference: 'MH/2026/00481',
      });
    };

    it('plays nothing she sealed, and says so rather than pretending it is missing', async () => {
      await activate('permit');
      await seal({ effect: 'withhold', scope: 'source', sourceAssetId: sourceId });

      const response = await ask(anjali, 'Why did the family move to Pune?');
      expect(response.body.answer.clip).toBeNull();
      expect(response.body.answer.reasonCode).toBe('withheld_by_clause');
      // "She asked us not to" is a fact about her. Hiding it behind "nothing
      // found" would misrepresent somebody who cannot correct the record.
      expect(response.body.answer.spokenByArchive).toContain('their choice');
    });

    it('keeps her words when she refused only the recording', async () => {
      await activate('permit');
      await seal({
        effect: 'permit',
        scope: 'source',
        sourceAssetId: sourceId,
        allowAudio: false,
      });

      const response = await ask(anjali, 'Why did the family move to Pune?');
      expect(response.body.answer.clip).toBeNull();
      expect(response.body.answer.reasonCode).toBe('audio_withheld');
      // Being quoted and being heard were two decisions, and she refused one.
      expect(response.body.answer.quotedText).toContain('railways');
    });

    it('plays nothing at all when she chose to close what she did not mention', async () => {
      await activate('withhold');
      await storyteller.post(`/v1/archives/${archiveId}/remembrance/affirm`, {});
      await admin.post(`/v1/admin/archives/${archiveId}/remembrance/activate`, {
        executedByName: 'Priya Nair',
        evidenceKind: 'death_certificate',
        evidenceReference: 'MH/2026/00481',
      });

      const response = await ask(anjali, 'Why did the family move to Pune?');
      expect(response.body.answer.clip).toBeNull();
      expect(response.body.answer.reasonCode).toBe('withheld_by_default');
    });

    it('still plays for the storyteller while nothing has been activated', async () => {
      await activate('withhold');
      const response = await ask(storyteller, 'Why did the family move to Pune?');
      expect(response.body.answer.reasonCode).toBe('played');
    });
  });
});

describe('telling them something that has happened since', () => {
  /**
   * The obvious thing to build here is a reaction — congratulations in her
   * voice, warmth she never expressed about news she never heard. These tests
   * are mostly about the product not doing that.
   */

  beforeAll(async () => {
    await h.ctx.db.withArchiveScope(archiveId, async (tx) => {
      await tx.query(`DELETE FROM remembrance_directive WHERE archive_id = $1`, [archiveId]);
      const source = await tx.one<{ id: string }>(
        `INSERT INTO source_asset
           (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
            scan_result, privacy, processing_stage, processed_at, sensitivity)
         VALUES ($1,'audio','processed','session-03-work.webm','audio/webm',2048,
                 'recordings/session-03', 'clean', $2, 'ready', now(), 'normal')
         RETURNING id`,
        [archiveId, JSON.stringify({ excluded: false })],
      );
      const transcript = await tx.one<{ id: string }>(
        `INSERT INTO transcript
           (archive_id, source_asset_id, provider, model_version, prompt_version, language,
            status, method, policy_version, completed_at)
         VALUES ($1,$2,'test','v1','v1','en','ready','speech_to_text','policy-1', now())
         RETURNING id`,
        [archiveId, source.id],
      );
      await tx.query(
        `INSERT INTO transcript_segment (archive_id, transcript_id, idx, start_ms, end_ms, text)
         VALUES ($1,$2,0,0,7000,
                 'I started teaching in 1971, at a school near the cantonment.'),
                ($1,$2,1,7000,15000,
                 'The first class I ever taught had fifty-three children in it and one blackboard.'),
                ($1,$2,2,15000,23000,
                 'I met Vijay at a wedding in 1969 and we were married two years later.')`,
        [archiveId, transcript.id],
      );
    });
  });

  const tell = (client: TestClient, news: string) =>
    client.post<{
      answer: {
        about: string | null;
        clip: { text: string } | null;
        spokenByArchive: string;
        reasonCode: string | null;
        quotedText: string | null;
      };
    }>(`/v1/archives/${archiveId}/voice/tell`, { news });

  it('answers news about a job with what she said about her own', async () => {
    // "I got the job" and "I started teaching in 1971" share no words at all.
    const response = await tell(anjali, 'I got the job, Aai');
    expect(response.status).toBe(200);
    expect(response.body.answer.about).toBe('work');
    expect(response.body.answer.reasonCode).toBe('found');
    expect(response.body.answer.clip?.text).toMatch(/teaching|taught|class/);
  });

  it('answers news about a wedding with her own', async () => {
    const response = await tell(anjali, 'We are getting married in December');
    expect(response.body.answer.about).toBe('marriage');
    expect(response.body.answer.clip?.text).toContain('married');
  });

  it('never reacts to the news', async () => {
    // The whole point. No congratulation, no pride, no presence — every one of
    // those is a claim about somebody who cannot make it.
    for (const news of [
      'I got the job, Aai',
      'We are getting married in December',
      'My father died last week',
    ]) {
      const response = await tell(anjali, news);
      const said = response.body.answer.spokenByArchive;
      expect(said).not.toMatch(
        /proud|congratul|happy for|she would|he would|they would|sorry for your|watching over|smiling/i,
      );
      // And it never speaks as them.
      expect(said).not.toMatch(/\bI (?:am|was|remember|feel)\b/);
    }
  });

  it('says plainly when there is nothing, without implying it did not matter', async () => {
    const response = await tell(anjali, 'I have taken up sailing');
    expect(response.body.answer.clip).toBeNull();
    expect(response.body.answer.reasonCode).toBe('nothing_on_this');
    // The sentence people would otherwise read as "she did not care".
    expect(response.body.answer.spokenByArchive).toContain('wouldn’t have mattered');
  });

  it('recognises a subject and still finds nothing, rather than reaching', async () => {
    // She never spoke about illness. Something arbitrary in her voice would be
    // worse than nothing, because the voice makes it sound like a reply.
    const response = await tell(anjali, 'I have been unwell and I am in hospital');
    expect(response.body.answer.about).toBe('illness');
    expect(response.body.answer.clip).toBeNull();
  });

  it('records the subject and nothing else', async () => {
    // What somebody told their dead mother is not something to put in an
    // analytics row. Enforced by the analytics schema, which admits no strings.
    const response = await tell(anjali, 'I got the job at the hospital in Nashik');
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body.answer)).not.toContain('Nashik');
  });

  it('keeps it inside the archive', async () => {
    const outsider = await signUp(h.app, { email: 'teller@example.test', displayName: 'Teller' });
    const response = await tell(outsider, 'I got the job');
    expect([403, 404]).toContain(response.status);
  });

  it('obeys what she decided about the moment it would have played', async () => {
    await storyteller.put(`/v1/archives/${archiveId}/remembrance`, { defaultEffect: 'withhold' });
    await storyteller.post(`/v1/archives/${archiveId}/remembrance/affirm`, {});
    await admin.post(`/v1/admin/archives/${archiveId}/remembrance/activate`, {
      executedByName: 'Priya Nair',
      evidenceKind: 'death_certificate',
      evidenceReference: 'MH/2026/00481',
    });

    const response = await tell(anjali, 'I got the job, Aai');
    expect(response.body.answer.clip).toBeNull();
    expect(response.body.answer.reasonCode).toBe('withheld');
  });
});
