import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drainQueue, type PipelineContext } from '@everecho/pipeline';
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
 * The contributor loop, against a real database.
 *
 * The assertions that matter most are the ones about what does *not* happen:
 * a contributor cannot approve their own proposal, a correction keeps the
 * previous value, and an alternate account changes nothing at all.
 */

let h: Harness;
let buyer: TestClient;
let storyteller: TestClient;
let contributor: TestClient;
let family: TestClient;
let archiveId: string;
let memoryId: string;

async function invite(
  from: TestClient,
  as: TestClient,
  input: { email: string; displayName: string; role: string },
): Promise<void> {
  const created = await from.post(`/v1/archives/${archiveId}/invitations`, {
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    expiresInDays: 14,
  });
  if (created.status !== 201) {
    throw new Error(`invitation failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const token = invitationTokenFrom(h.ctx);
  await as.post(`/v1/invitations/${token}/respond`, { decision: 'accept' });
}

beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil Deshpande' });
  storyteller = await signUp(h.app, {
    email: 'kamala@example.test',
    displayName: 'Kamala Deshpande',
  });
  contributor = await signUp(h.app, { email: 'ravi@example.test', displayName: 'Ravi Deshpande' });
  family = await signUp(h.app, { email: 'anjali@example.test', displayName: 'Anjali Deshpande' });

  const created = await buyer.post<{ id: string }>('/v1/archives', {
    name: 'Kamala’s stories',
    subject: { displayName: 'Kamala Deshpande', birthYear: 1948 },
    subjectIsAdult: true,
  });
  archiveId = created.body.id;

  await invite(buyer, storyteller, {
    email: 'kamala@example.test',
    displayName: 'Kamala Deshpande',
    role: 'storyteller',
  });
  await storyteller.post(`/v1/archives/${archiveId}/consent/teach-back`, {
    answers: CORRECT_TEACH_BACK,
  });
  await storyteller.put(`/v1/archives/${archiveId}/consent`, { document: consentDocument() });

  await invite(storyteller, contributor, {
    email: 'ravi@example.test',
    displayName: 'Ravi Deshpande',
    role: 'contributor',
  });
  await invite(storyteller, family, {
    email: 'anjali@example.test',
    displayName: 'Anjali Deshpande',
    role: 'family',
  });

  // One approved memory for proposals to be about.
  const memory = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.one<{ id: string }>(
      `INSERT INTO memory
         (archive_id, title, body, status, origin, sensitivity, evidence_class, approved_at)
       VALUES ($1,'Moving to Pune','We moved to Pune in 1962 because my father took a job on the railways.',
               'approved','interview','normal','P1_DIRECT_STATEMENT', now())
       RETURNING id`,
      [archiveId],
    ),
  );
  memoryId = memory.id;

  // A real approved memory has claims. Without one the contradiction link has
  // nothing to attach to, and the test would be passing on a shape that never
  // occurs in the product.
  await h.ctx.db.withArchiveScope(archiveId, (tx) =>
    tx.query(
      `INSERT INTO claim (archive_id, memory_id, text, evidence_class, status)
       VALUES ($1,$2,'We moved to Pune in 1962 because my father took a job on the railways.',
               'P1_DIRECT_STATEMENT','approved')`,
      [archiveId, memoryId],
    ),
  );
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('who may propose', () => {
  it('lets a contributor propose', async () => {
    const response = await contributor.post<{ proposal: { id: string; status: string } }>(
      `/v1/archives/${archiveId}/contributions`,
      {
        kind: 'note',
        title: 'The neighbours',
        body: 'The Kulkarnis lived next door and their son taught me to ride a bicycle.',
        evidence: [{ firstHand: true, note: 'I was there.' }],
      },
    );
    expect(response.status).toBe(201);
    expect(response.body.proposal.status).toBe('pending');
  });

  it('refuses a family member who was not given permission to contribute', async () => {
    const response = await family.post(`/v1/archives/${archiveId}/contributions`, {
      kind: 'note',
      title: 'Something',
      body: 'Something I remember about the house.',
    });
    expect(response.status).toBe(403);
    expect(response.reasonCode).toBe('role_not_permitted');
  });

  it('refuses a correction to something that is not there', async () => {
    const response = await contributor.post(`/v1/archives/${archiveId}/contributions`, {
      kind: 'correction',
      targetType: 'memory',
      targetId: '00000000-0000-4000-8000-000000000000',
      title: 'Wrong year',
      body: 'It was 1963.',
    });
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('proposal_target_missing');
  });

  it('refuses a correction that does not say what it is about', async () => {
    const response = await contributor.post(`/v1/archives/${archiveId}/contributions`, {
      kind: 'correction',
      title: 'Wrong year',
      body: 'It was 1963.',
    });
    expect(response.status).toBe(400);
  });
});

describe('a contributor cannot decide', () => {
  let proposalId: string;

  beforeAll(async () => {
    const created = await contributor.post<{ proposal: { id: string } }>(
      `/v1/archives/${archiveId}/contributions`,
      { kind: 'note', title: 'A detail', body: 'The tree in the courtyard was a neem.' },
    );
    proposalId = created.body.proposal.id;
  });

  it('refuses to let them approve their own proposal', async () => {
    const response = await contributor.post(
      `/v1/archives/${archiveId}/contributions/${proposalId}/approve`,
      {},
    );
    expect(response.status).toBe(403);
  });

  it('refuses to let the buyer approve one', async () => {
    const response = await buyer.post(
      `/v1/archives/${archiveId}/contributions/${proposalId}/approve`,
      {},
    );
    expect([403, 404]).toContain(response.status);
  });

  it('lets them take back their own, and not somebody else’s', async () => {
    const mine = await contributor.post<{ proposal: { status: string } }>(
      `/v1/archives/${archiveId}/contributions/${proposalId}/withdraw`,
      {},
    );
    expect(mine.status).toBe(200);
    expect(mine.body.proposal.status).toBe('withdrawn');

    const theirs = await family.post(
      `/v1/archives/${archiveId}/contributions/${proposalId}/withdraw`,
      {},
    );
    expect([403, 404]).toContain(theirs.status);
  });
});

describe('a correction keeps the original', () => {
  const runWorker = () => drainQueue(h.ctx as unknown as PipelineContext, { workerId: 'test' });

  it('records the previous value, bumps the version and reaches retrieval', async () => {
    const proposed = await contributor.post<{ proposal: { id: string } }>(
      `/v1/archives/${archiveId}/contributions`,
      {
        kind: 'correction',
        targetType: 'memory',
        targetId: memoryId,
        title: 'The year was 1963',
        body: 'We moved to Pune in 1963 because my father took a job on the railways.',
        evidence: [{ firstHand: false, note: 'My mother’s letters are dated 1963.' }],
      },
    );
    expect(proposed.status).toBe(201);

    const approved = await storyteller.post<{
      proposal: { resultingCorrectionId: string | null };
    }>(`/v1/archives/${archiveId}/contributions/${proposed.body.proposal.id}/approve`, {
      note: 'She is right, the letters settle it.',
    });
    expect(approved.status).toBe(200);
    expect(approved.body.proposal.resultingCorrectionId).toBeTruthy();
    await runWorker();

    const memory = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ body: string; version: number; was_corrected: boolean }>(
        `SELECT body, version, was_corrected FROM memory WHERE archive_id = $1 AND id = $2`,
        [archiveId, memoryId],
      ),
    );
    expect(memory.body).toContain('1963');
    expect(memory.version).toBe(2);
    expect(memory.was_corrected).toBe(true);

    // The original is still there, in full, attributed to whoever proposed it.
    const correction = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ previous_value: { body: string }; actor_role: string; status: string }>(
        `SELECT previous_value, actor_role, status FROM correction
          WHERE archive_id = $1 AND target_id = $2`,
        [archiveId, memoryId],
      ),
    );
    expect(correction.previous_value.body).toContain('1962');
    expect(correction.actor_role).toBe('contributor');
    expect(correction.status).toBe('applied');
  });

  it('does not record a correction as a disagreement', async () => {
    // A fix is not a family dispute, and marking it as one would leave a
    // permanent contradiction on a memory that was simply improved.
    const proposals = await storyteller.get<{
      proposals: { kind: string; contradictsMemoryIds: string[] }[];
    }>(`/v1/archives/${archiveId}/contributions`);
    const correction = proposals.body.proposals.find((p) => p.kind === 'correction');
    expect(correction?.contradictsMemoryIds).toEqual([]);
  });
});

describe('an alternate account overwrites nothing', () => {
  it('stands beside the original and is linked to it as a disagreement', async () => {
    const before = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ body: string; version: number }>(
        `SELECT body, version FROM memory WHERE archive_id = $1 AND id = $2`,
        [archiveId, memoryId],
      ),
    );

    const proposed = await contributor.post<{
      proposal: { id: string; contradictsMemoryIds: string[] };
    }>(`/v1/archives/${archiveId}/contributions`, {
      kind: 'alternate_account',
      targetType: 'memory',
      targetId: memoryId,
      title: 'I remember it as the year after',
      body: 'My uncle always said the family moved after the monsoon of 1964, not before it.',
      evidence: [{ firstHand: false, note: 'What my uncle told me.' }],
    });
    expect(proposed.status).toBe(201);
    // The disagreement is surfaced at proposal time, before anyone decides.
    expect(proposed.body.proposal.contradictsMemoryIds).toEqual([memoryId]);

    const approved = await storyteller.post<{ proposal: { resultingMemoryId: string | null } }>(
      `/v1/archives/${archiveId}/contributions/${proposed.body.proposal.id}/approve`,
      {},
    );
    expect(approved.status).toBe(200);
    const newMemoryId = approved.body.proposal.resultingMemoryId;
    expect(newMemoryId).toBeTruthy();

    // The storyteller's memory is untouched — same words, same version.
    const after = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ body: string; version: number }>(
        `SELECT body, version FROM memory WHERE archive_id = $1 AND id = $2`,
        [archiveId, memoryId],
      ),
    );
    expect(after).toEqual(before);

    // The second account exists, marked as somebody else's recollection.
    const alternate = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ origin: string; evidence_class: string }>(
        `SELECT origin, evidence_class FROM memory WHERE archive_id = $1 AND id = $2`,
        [archiveId, newMemoryId],
      ),
    );
    expect(alternate.origin).toBe('contributor_proposed');
    // Not a direct statement: it is not the storyteller speaking.
    expect(alternate.evidence_class).toBe('P3_SUPPORTED_SYNTHESIS');

    // And the two are linked, open, for a reader to see rather than resolved.
    // Contradictions join claims, so this checks the claim on each memory.
    const contradiction = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ status: string; a_memory: string; b_memory: string }>(
        `SELECT x.status, ca.memory_id AS a_memory, cb.memory_id AS b_memory
           FROM contradiction x
           JOIN claim ca ON ca.id = x.claim_a_id
           JOIN claim cb ON cb.id = x.claim_b_id
          WHERE x.archive_id = $1 AND cb.memory_id = $2`,
        [archiveId, newMemoryId],
      ),
    );
    expect(contradiction.a_memory).toBe(memoryId);
    expect(contradiction.status).toBe('open');

    // The second account is citable, and the citation says whose it is.
    const provenance = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ filename: string; method: string; quoted_text: string }>(
        `SELECT sa.original_filename AS filename, e.extraction_method AS method, e.quoted_text
           FROM claim c
           JOIN claim_evidence e ON e.claim_id = c.id
           JOIN source_asset sa ON sa.id = e.source_asset_id
          WHERE c.archive_id = $1 AND c.memory_id = $2`,
        [archiveId, newMemoryId],
      ),
    );
    expect(provenance.filename).toContain('A family member’s account');
    expect(provenance.method).toBe('contributor_proposal');
    expect(provenance.quoted_text).toContain('monsoon');
  });
});

describe('rejection', () => {
  it('declines a proposal and changes nothing', async () => {
    const proposed = await contributor.post<{ proposal: { id: string } }>(
      `/v1/archives/${archiveId}/contributions`,
      { kind: 'date', title: 'A date', body: 'I think this was 1970.', payload: { year: 1970 } },
    );
    const rejected = await storyteller.post<{ proposal: { status: string } }>(
      `/v1/archives/${archiveId}/contributions/${proposed.body.proposal.id}/reject`,
      { note: 'Not right, I was still in Nagpur then.' },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.body.proposal.status).toBe('rejected');

    const again = await storyteller.post(
      `/v1/archives/${archiveId}/contributions/${proposed.body.proposal.id}/reject`,
      {},
    );
    expect(again.status).toBe(409);
    expect(again.reasonCode).toBe('proposal_already_decided');
  });
});

describe('who sees what', () => {
  it('shows the storyteller everything and a contributor only their own', async () => {
    const all = await storyteller.get<{ proposals: unknown[] }>(
      `/v1/archives/${archiveId}/contributions`,
    );
    const mine = await contributor.get<{ proposals: { proposedByUserId: string }[] }>(
      `/v1/archives/${archiveId}/contributions`,
    );
    expect(all.body.proposals.length).toBeGreaterThan(0);
    expect(mine.body.proposals.length).toBeGreaterThan(0);
    expect(mine.body.proposals.length).toBeLessThanOrEqual(all.body.proposals.length);

    const contributorId = (await contributor.get<{ user: { id: string } }>('/v1/me')).body.user.id;
    expect(mine.body.proposals.every((p) => p.proposedByUserId === contributorId)).toBe(true);
  });

  it('shows the storyteller what the target says today, beside the proposal', async () => {
    const all = await storyteller.get<{
      proposals: { kind: string; targetSummary: string | null }[];
    }>(`/v1/archives/${archiveId}/contributions`);
    const alternate = all.body.proposals.find((p) => p.kind === 'alternate_account');
    expect(alternate?.targetSummary).toContain('Pune');
  });
});

describe('archive isolation holds for proposals', () => {
  it('never returns one archive’s proposals in another’s scope', async () => {
    const other = await buyer.post<{ id: string }>('/v1/archives', {
      name: 'A different family',
      subject: { displayName: 'Someone Else' },
      subjectIsAdult: true,
    });
    const leaked = await h.ctx.db.withArchiveScope(other.body.id, (tx) =>
      tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM contributor_proposal`),
    );
    expect(leaked.n).toBe(0);

    const unscoped = await h.ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM contributor_proposal`,
    );
    expect(unscoped[0]?.n).toBe(0);
  });
});

describe('the coverage radar', () => {
  /**
   * A list of questions, and never a score. The tests below are mostly about
   * what it refuses to do: infer, nag, or come back after being told not to.
   */
  it('offers a question about something the archive never explained', async () => {
    await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query(
        `INSERT INTO memory (archive_id, title, body, status, origin, sensitivity, evidence_class,
                             approved_at)
         VALUES ($1,'Leaving','He told us to leave before the monsoon, so we packed that night.',
                 'approved','interview','normal','P1_DIRECT_STATEMENT', now())`,
        [archiveId],
      ),
    );

    const response = await storyteller.get<{
      gaps: { id: string; kind: string; prompt: string; reference: string }[];
    }>(`/v1/archives/${archiveId}/gaps`);
    expect(response.status).toBe(200);

    const gap = response.body.gaps.find((g) => g.kind === 'unresolved_person');
    expect(gap).toBeDefined();
    // It quotes the words that produced it, so the question explains itself.
    expect(gap!.prompt).toContain(gap!.reference);
    expect(gap!.prompt).toContain('?');
  });

  it('never reports a score, a percentage or a completeness verdict', async () => {
    const response = await storyteller.get(`/v1/archives/${archiveId}/gaps`);
    const body = JSON.stringify(response.body);
    expect(body).not.toMatch(/percent|score|complete|streak|progress|remaining/i);
  });

  it('keeps it to the storyteller', async () => {
    // What an archive does not say about somebody is nobody else's business,
    // and a list of gaps handed to family is a list they could chase them with.
    for (const client of [family, contributor, buyer]) {
      const response = await client.get(`/v1/archives/${archiveId}/gaps`);
      expect([403, 404]).toContain(response.status);
    }
  });

  it('does not come back once it is told never to ask again', async () => {
    const before = await storyteller.get<{ gaps: { id: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    const target = before.body.gaps[0];
    expect(target).toBeDefined();

    const dismissed = await storyteller.post(
      `/v1/archives/${archiveId}/gaps/${target!.id}/dismiss`,
      { decision: 'never' },
    );
    expect(dismissed.status).toBe(200);

    // Re-detection runs on every read, and must not resurrect it.
    const after = await storyteller.get<{ gaps: { id: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    expect(after.body.gaps.some((g) => g.id === target!.id)).toBe(false);
  });

  it('hides a snoozed one until its time, then offers it again', async () => {
    const before = await storyteller.get<{ gaps: { id: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    // Asserted rather than skipped: a test that quietly passes when the state
    // it needs is absent has stopped checking anything.
    const target = before.body.gaps[0];
    expect(target).toBeDefined();

    await storyteller.post(`/v1/archives/${archiveId}/gaps/${target!.id}/dismiss`, {
      decision: 'snooze',
      snoozeDays: 30,
    });
    const hidden = await storyteller.get<{ gaps: { id: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    expect(hidden.body.gaps.some((g) => g.id === target!.id)).toBe(false);

    // Brought forward rather than waited for: the rule is about the clock,
    // and the test should not be.
    await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query(`UPDATE memory_gap SET snoozed_until = now() - interval '1 day' WHERE id = $1`, [
        target!.id,
      ]),
    );
    const back = await storyteller.get<{ gaps: { id: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    expect(back.body.gaps.some((g) => g.id === target!.id)).toBe(true);
  });
});

describe('answering something the radar asked', () => {
  /**
   * The other half of the loop. A radar that can only be dismissed is a list
   * of complaints; the point is that saying more is easy, and that saying more
   * still does not put anything into the archive without a decision.
   */

  /**
   * A gap of its own, named by the reference it must produce.
   *
   * Matching on the reference rather than taking the first item is what makes
   * these independent of each other: a gap is unique per (kind, reference),
   * so a test that reused a phrase an earlier one had already closed would
   * find nothing and quietly test nothing.
   */
  const freshGap = async (body: string, reference: string) => {
    await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query(
        `INSERT INTO memory (archive_id, title, body, status, origin, sensitivity, evidence_class,
                             approved_at)
         VALUES ($1,'A story',$2,'approved','interview','normal','P1_DIRECT_STATEMENT', now())`,
        [archiveId, body],
      ),
    );
    const listed = await storyteller.get<{ gaps: { id: string; reference: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    const gap = listed.body.gaps.find((g) => g.reference === reference);
    expect(gap).toBeDefined();
    return gap!;
  };

  it('keeps the answer as a real source, with a transcript that can be cited', async () => {
    const gap = await freshGap(
      'My aunt gave us the key on the morning we left, and said nothing.',
      'my aunt',
    );

    const answered = await storyteller.post<{ sourceAssetId: string; candidateCount: number }>(
      `/v1/archives/${archiveId}/gaps/${gap.id}/answer`,
      { body: 'That was my mother-in-law, Shanta. She ran the shop below us for years.' },
    );
    expect(answered.status).toBe(200);

    const stored = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ kind: string; status: string; text: string }>(
        `SELECT sa.kind, sa.status, ts.text
           FROM source_asset sa
           JOIN transcript t ON t.source_asset_id = sa.id
           JOIN transcript_segment ts ON ts.transcript_id = t.id
          WHERE sa.id = $1`,
        [answered.body.sourceAssetId],
      ),
    );
    expect(stored.kind).toBe('text');
    expect(stored.status).toBe('processed');
    // The exact words, so a citation resolves to what was actually written.
    expect(stored.text).toContain('Shanta');
  });

  it('writes no memory of its own — everything waits for a decision', async () => {
    const gap = await freshGap(
      'My cousin took me to the station in the dark, that other time.',
      'my cousin',
    );

    const before = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM memory WHERE archive_id = $1`, [
        archiveId,
      ]),
    );
    await storyteller.post(`/v1/archives/${archiveId}/gaps/${gap.id}/answer`, {
      body: 'My cousin Prakash drove us. He was nineteen and had borrowed the car.',
    });
    const after = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM memory WHERE archive_id = $1`, [
        archiveId,
      ]),
    );
    // Not "fewer new memories". None. The storyteller decides, or nothing
    // happens — this is measured against the database, not asserted in prose.
    expect(after.n).toBe(before.n);
  });

  it('leaves anything it suggests in the review queue, tied back to the question', async () => {
    const gap = await freshGap(
      'My sister sent us a letter after the wedding, and we kept it.',
      'my sister',
    );
    await storyteller.post(`/v1/archives/${archiveId}/gaps/${gap.id}/answer`, {
      body: 'That was Meera, my eldest sister. She wrote to us every year until 1994.',
    });

    const candidates = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.query<{ status: string; session_id: string | null }>(
        `SELECT status, session_id FROM memory_candidate WHERE memory_gap_id = $1`,
        [gap.id],
      ),
    );
    for (const candidate of candidates) {
      expect(candidate.status).toBe('pending');
      // Origin is exactly one thing. A gap answer is not a conversation.
      expect(candidate.session_id).toBeNull();
    }
  });

  it('closes the question once it is answered, without a second nudge', async () => {
    const gap = await freshGap(
      'My friend showed me the house, the old place, before it was sold.',
      'my friend',
    );
    await storyteller.post(`/v1/archives/${archiveId}/gaps/${gap.id}/answer`, {
      body: 'It was on Tilak Road, above the tailor. My aunt Sudha lived there until 1988.',
    });

    const after = await storyteller.get<{ gaps: { id: string }[] }>(
      `/v1/archives/${archiveId}/gaps`,
    );
    expect(after.body.gaps.some((g) => g.id === gap.id)).toBe(false);
  });

  it('refuses to answer one that was put away for good', async () => {
    const gap = await freshGap(
      'The neighbour brought us food every evening that winter.',
      'the neighbour',
    );
    await storyteller.post(`/v1/archives/${archiveId}/gaps/${gap.id}/dismiss`, {
      decision: 'never',
    });

    // "Never" has to hold against the id as well as against the list, or it is
    // only a filter.
    const response = await storyteller.post(`/v1/archives/${archiveId}/gaps/${gap.id}/answer`, {
      body: 'I would rather not have been asked this at all.',
    });
    expect(response.status).toBe(404);
  });

  it('lets nobody else answer for the storyteller', async () => {
    const gap = await freshGap('That man wrote to us from the coast, that first year.', 'that man');
    for (const client of [family, contributor, buyer]) {
      const response = await client.post(`/v1/archives/${archiveId}/gaps/${gap.id}/answer`, {
        body: 'I think I know who that was.',
      });
      expect([403, 404]).toContain(response.status);
    }
  });
});
