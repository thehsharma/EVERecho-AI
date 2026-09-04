import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultLearningDocument } from '@everecho/consent';
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
 * The family growth loop, end to end, against a real PostgreSQL database:
 *
 *   authorised relative asks → storyteller's private inbox → answer, decline
 *   or restrict → the answer becomes a citable source → suggestions the
 *   storyteller must approve → the asker sees the answer with its source →
 *   approval reaches retrieval → revoking the relative blocks all of it
 *
 * No mocks. The same authorisation, consent, provenance and audit paths that
 * serve a real family serve this.
 */

let h: Harness;
let buyer: TestClient;
let storyteller: TestClient;
let family: TestClient;
let cousin: TestClient;
let outsider: TestClient;
let archiveId: string;
let familyUserId: string;
let cousinUserId: string;

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
  const accepted = await as.post(`/v1/invitations/${token}/respond`, { decision: 'accept' });
  if (accepted.status !== 200) {
    throw new Error(`accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  }
}

beforeAll(async () => {
  h = await startHarness();
  buyer = await signUp(h.app, { email: 'anil@example.test', displayName: 'Anil Deshpande' });
  storyteller = await signUp(h.app, {
    email: 'kamala@example.test',
    displayName: 'Kamala Deshpande',
  });
  family = await signUp(h.app, { email: 'anjali@example.test', displayName: 'Anjali Deshpande' });
  cousin = await signUp(h.app, { email: 'ravi@example.test', displayName: 'Ravi Deshpande' });
  outsider = await signUp(h.app, { email: 'nobody@example.test', displayName: 'Nobody' });

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
  await storyteller.put(`/v1/archives/${archiveId}/consent`, {
    document: consentDocument({ restrictedTopics: ['her illness'] }),
  });
  await storyteller.put(`/v1/archives/${archiveId}/learning-policy`, {
    document: defaultLearningDocument(),
  });

  await invite(storyteller, family, {
    email: 'anjali@example.test',
    displayName: 'Anjali Deshpande',
    role: 'family',
  });
  await invite(storyteller, cousin, {
    email: 'ravi@example.test',
    displayName: 'Ravi Deshpande',
    role: 'family',
  });

  familyUserId = (await family.get<{ user: { id: string } }>('/v1/me')).body.user.id;
  cousinUserId = (await cousin.get<{ user: { id: string } }>('/v1/me')).body.user.id;
}, 180_000);

afterAll(async () => {
  await h?.close();
});

describe('who may ask', () => {
  it('lets an authorised family member ask', async () => {
    const response = await family.post<{ question: { id: string; status: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'What was the house in Pune like?', topic: 'childhood' },
    );
    expect(response.status).toBe(201);
    expect(response.body.question.status).toBe('pending');
  });

  it('reports the archive as missing to a stranger', async () => {
    // Not 403: a 403 would confirm that the id names something real.
    const response = await outsider.post(`/v1/archives/${archiveId}/family-questions`, {
      body: 'Tell me everything.',
    });
    expect(response.status).toBe(404);
  });

  it('refuses a question about a subject the storyteller closed', async () => {
    // Refused here rather than put in front of the storyteller, so they are not
    // made to re-decide something they already decided.
    const response = await family.post(`/v1/archives/${archiveId}/family-questions`, {
      body: 'How bad was her illness in the end?',
    });
    expect(response.status).toBe(409);
    expect(response.reasonCode).toBe('restricted_topic');
  });

  it('refuses it however the asker labels the topic', async () => {
    const response = await family.post(`/v1/archives/${archiveId}/family-questions`, {
      body: 'Just a general question.',
      topic: 'her illness',
    });
    expect(response.status).toBe(409);
  });
});

describe('the storyteller’s inbox is theirs alone', () => {
  it('shows the storyteller every question with who asked it', async () => {
    const inbox = await storyteller.get<{
      questions: { id: string; body: string; askedByDisplayName: string; status: string }[];
    }>(`/v1/archives/${archiveId}/family-questions`);
    expect(inbox.status).toBe(200);
    expect(inbox.body.questions.length).toBeGreaterThan(0);
    expect(inbox.body.questions[0]?.askedByDisplayName).toBe('Anjali Deshpande');
  });

  it('refuses the inbox to a family member', async () => {
    // A relative may see their own questions; the inbox is a different thing.
    const response = await family.get(`/v1/archives/${archiveId}/family-questions`);
    expect(response.status).toBe(404);
  });

  it('refuses the inbox to the person who paid for the archive', async () => {
    const response = await buyer.get(`/v1/archives/${archiveId}/family-questions`);
    expect([403, 404]).toContain(response.status);
  });

  it('shows a relative only their own questions', async () => {
    await cousin.post(`/v1/archives/${archiveId}/family-questions`, {
      body: 'Where did she go to school?',
    });
    const mine = await family.get<{ questions: { body: string }[] }>(
      `/v1/archives/${archiveId}/family-questions/asked`,
    );
    expect(mine.status).toBe(200);
    expect(mine.body.questions.every((q) => !q.body.includes('school'))).toBe(true);
  });
});

describe('answering', () => {
  let questionId: string;

  beforeAll(async () => {
    const asked = await family.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'What did the kitchen smell like?' },
    );
    questionId = asked.body.question.id;
  });

  it('promotes the answer to a real, citable source and suggests nothing as fact', async () => {
    const response = await storyteller.post<{
      question: {
        status: string;
        response: {
          sourceId: string | null;
          candidateCount: number;
          pendingCandidateCount: number;
        };
      };
    }>(`/v1/archives/${archiveId}/family-questions/${questionId}/respond`, {
      kind: 'answer',
      body:
        'The kitchen always smelled of cardamom and frying onions in the mornings. ' +
        'My mother ground the spices herself on a stone she brought from her own mother.',
      visibility: 'asker_only',
    });
    expect(response.status).toBe(200);
    expect(response.body.question.status).toBe('answered');

    const sourceId = response.body.question.response.sourceId;
    expect(sourceId).toBeTruthy();

    // A real source with a real transcript segment, so a citation resolves.
    const source = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.maybeOne<{ kind: string; status: string }>(
        `SELECT kind, status FROM source_asset WHERE archive_id = $1 AND id = $2`,
        [archiveId, sourceId],
      ),
    );
    expect(source).toMatchObject({ kind: 'text', status: 'processed' });

    const segment = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.maybeOne<{ text: string }>(
        `SELECT s.text FROM transcript_segment s
           JOIN transcript t ON t.id = s.transcript_id
          WHERE t.archive_id = $1 AND t.source_asset_id = $2`,
        [archiveId, sourceId],
      ),
    );
    expect(segment?.text).toContain('cardamom');

    // Suggestions, not facts.
    expect(response.body.question.response.candidateCount).toBeGreaterThan(0);
    expect(response.body.question.response.pendingCandidateCount).toBe(
      response.body.question.response.candidateCount,
    );
  });

  it('adds nothing to the archive until the storyteller approves', async () => {
    const approved = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ n: number }>(
        `SELECT count(*)::int AS n FROM memory
          WHERE archive_id = $1 AND status = 'approved' AND body ILIKE '%cardamom%'`,
        [archiveId],
      ),
    );
    expect(approved.n).toBe(0);
  });

  it('links every suggestion to the answer it came from', async () => {
    const orphans = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.one<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM memory_candidate c
           LEFT JOIN memory_candidate_evidence e ON e.candidate_id = c.id
          WHERE c.archive_id = $1 AND c.family_question_response_id IS NOT NULL
            AND (e.id IS NULL OR e.source_asset_id IS NULL OR e.quoted_text = '')`,
        [archiveId],
      ),
    );
    expect(orphans.n).toBe(0);
  });

  it('shows the asker the answer with a source they can open', async () => {
    const mine = await family.get<{
      questions: { body: string; answer: { body: string; sourceId: string } | null }[];
    }>(`/v1/archives/${archiveId}/family-questions/asked`);
    const answered = mine.body.questions.find((q) => q.body.includes('kitchen'));
    expect(answered?.answer?.body).toContain('cardamom');
    expect(answered?.answer?.sourceId).toBeTruthy();
  });

  it('refuses a second decision on the same question', async () => {
    const again = await storyteller.post(
      `/v1/archives/${archiveId}/family-questions/${questionId}/respond`,
      { kind: 'decline' },
    );
    expect(again.status).toBe(409);
    expect(again.reasonCode).toBe('question_already_decided');
  });

  it('refuses to let a family member answer on the storyteller’s behalf', async () => {
    const asked = await family.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'Who taught you to cook?' },
    );
    const response = await family.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/respond`,
      { kind: 'answer', body: 'She taught herself.' },
    );
    expect(response.status).toBe(403);
    // The generic role refusal, not `storyteller_only`: answering is not in a
    // family member's role at all, and the role table is checked before the
    // storyteller-only rule. Either message is true; this is the one the
    // engine gives, and asserting the other would be asserting a wish.
    expect(response.reasonCode).toBe('role_not_permitted');
  });
});

describe('declining is private', () => {
  it('tells the asker the question is closed and nothing else', async () => {
    const asked = await family.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'Why did you and your brother stop speaking?' },
    );
    const declined = await storyteller.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/respond`,
      { kind: 'decline', reason: 'Still too raw, and it is not Anjali’s business.' },
    );
    expect(declined.status).toBe(200);

    const mine = await family.get<{ questions: { id: string; status: string; answer: unknown }[] }>(
      `/v1/archives/${archiveId}/family-questions/asked`,
    );
    const seen = mine.body.questions.find((q) => q.id === asked.body.question.id);
    expect(seen?.status).toBe('declined');
    expect(seen?.answer).toBeNull();

    // The reason never leaves the API towards the asker, in any shape.
    expect(JSON.stringify(mine.body)).not.toContain('too raw');
    expect(JSON.stringify(mine.body)).not.toContain('business');
  });

  it('keeps the reason for the storyteller’s own record', async () => {
    const inbox = await storyteller.get<{ questions: { declineReason: string | null }[] }>(
      `/v1/archives/${archiveId}/family-questions?status=declined`,
    );
    expect(inbox.body.questions.some((q) => q.declineReason?.includes('too raw'))).toBe(true);
  });
});

describe('restricting an answer narrows it', () => {
  it('shows a restricted answer to the named recipient and to nobody else', async () => {
    const asked = await cousin.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'What happened to the land in the village?' },
    );
    const answered = await storyteller.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/respond`,
      {
        kind: 'answer',
        body: 'The land was divided between the three brothers in 1971.',
        visibility: 'restricted',
        restrictedToUserIds: [cousinUserId],
      },
    );
    expect(answered.status).toBe(200);

    const theirs = await cousin.get<{ questions: { body: string; answer: unknown }[] }>(
      `/v1/archives/${archiveId}/family-questions/asked`,
    );
    expect(theirs.body.questions.find((q) => q.body.includes('land'))?.answer).not.toBeNull();

    // Anjali did not ask it and was not named, so she never sees it at all.
    const hers = await family.get<{ questions: { body: string }[] }>(
      `/v1/archives/${archiveId}/family-questions/asked`,
    );
    expect(hers.body.questions.some((q) => q.body.includes('land'))).toBe(false);
  });

  it('refuses a restricted answer with nobody named', async () => {
    const asked = await family.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'What was your first job?' },
    );
    const response = await storyteller.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/respond`,
      { kind: 'answer', body: 'A clerk at the railway office.', visibility: 'restricted' },
    );
    expect(response.status).toBe(400);
  });

  it('keeps a privately-answered question private from the asker', async () => {
    const asked = await family.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'Did you ever regret leaving?' },
    );
    await storyteller.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/respond`,
      { kind: 'answer', body: 'Every single day, for about ten years.', visibility: 'private' },
    );
    const mine = await family.get<{ questions: { id: string; answer: unknown }[] }>(
      `/v1/archives/${archiveId}/family-questions/asked`,
    );
    const seen = mine.body.questions.find((q) => q.id === asked.body.question.id);
    // Answered for the storyteller's own record; to the asker it is closed.
    expect(seen?.answer).toBeNull();
    expect(JSON.stringify(mine.body)).not.toContain('ten years');
  });
});

describe('withdrawing', () => {
  it('lets the asker take back their own question', async () => {
    const asked = await family.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'Actually never mind this one.' },
    );
    const withdrawn = await family.post<{ question: { status: string } }>(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/withdraw`,
      {},
    );
    expect(withdrawn.status).toBe(200);
    expect(withdrawn.body.question.status).toBe('withdrawn');
  });

  it('refuses to let one relative withdraw another’s question', async () => {
    const asked = await cousin.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'What was your mother’s maiden name?' },
    );
    const response = await family.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/withdraw`,
      {},
    );
    // Missing, not forbidden: confirming somebody else's question exists is
    // itself a disclosure.
    expect(response.status).toBe(404);
  });
});

describe('approval closes the loop', () => {
  /**
   * The whole point of the slice: a question produces an answer, the answer
   * produces a suggestion, the storyteller approves it, and from that moment
   * the archive can answer questions about it with a citation that leads back
   * to the moment somebody asked.
   */
  const runWorker = () => drainQueue(h.ctx as unknown as PipelineContext, { workerId: 'test' });

  it('turns an approved answer into retrievable, citable evidence', async () => {
    const asked = await cousin.post<{ question: { id: string } }>(
      `/v1/archives/${archiveId}/family-questions`,
      { body: 'What was the neem tree in the courtyard?' },
    );
    await storyteller.post(
      `/v1/archives/${archiveId}/family-questions/${asked.body.question.id}/respond`,
      {
        kind: 'answer',
        body:
          'My mother planted a neem tree in the courtyard the year we arrived, and it was ' +
          'taller than the house by the time I left for college.',
        visibility: 'all_authorised',
      },
    );

    const pending = await storyteller.get<{ candidates: { id: string; body: string }[] }>(
      `/v1/archives/${archiveId}/memory-candidates`,
    );
    const candidate = pending.body.candidates.find((c) => c.body.includes('neem'));
    expect(candidate).toBeDefined();

    const approved = await storyteller.post(
      `/v1/archives/${archiveId}/memory-candidates/${candidate!.id}/approve`,
      { keepPrivate: false },
    );
    expect(approved.status).toBe(200);
    await runWorker();

    // It is now a real memory, with a claim citing the answer as its source.
    const memory = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.maybeOne<{ id: string; origin: string; status: string }>(
        `SELECT id, origin, status FROM memory
          WHERE archive_id = $1 AND body ILIKE '%neem%' AND status = 'approved'`,
        [archiveId],
      ),
    );
    expect(memory).toMatchObject({ status: 'approved', origin: 'storyteller_written' });

    const evidence = await h.ctx.db.withArchiveScope(archiveId, (tx) =>
      tx.maybeOne<{ quoted_text: string; extraction_method: string; filename: string }>(
        `SELECT e.quoted_text, e.extraction_method, sa.original_filename AS filename
           FROM claim c
           JOIN claim_evidence e ON e.claim_id = c.id
           JOIN source_asset sa ON sa.id = e.source_asset_id
          WHERE c.archive_id = $1 AND c.memory_id = $2`,
        [archiveId, memory!.id],
      ),
    );
    expect(evidence?.quoted_text).toContain('neem');
    expect(evidence?.extraction_method).toBe('answer_extraction');
    // The citation leads back to the answer, by name.
    expect(evidence?.filename).toContain('Answer to a family question');
  });

  it('answers a family member’s question from it, with a citation', async () => {
    // Retrieval reflects the approval immediately — no separate reindex step
    // the storyteller has to know about.
    const asked = await cousin.post<{
      response: { abstained: boolean; answerText: string; claims: { citations: unknown[] }[] };
    }>(`/v1/archives/${archiveId}/questions`, { question: 'What was in the courtyard?' });
    expect(asked.status).toBe(200);
    expect(asked.body.response.abstained).toBe(false);
    expect(asked.body.response.answerText.toLowerCase()).toContain('neem');
    expect(asked.body.response.claims[0]?.citations.length).toBeGreaterThan(0);
  });

  it('still abstains on something the answer did not cover', async () => {
    const asked = await cousin.post<{ response: { abstained: boolean } }>(
      `/v1/archives/${archiveId}/questions`,
      { question: 'What did she think about the moon landing?' },
    );
    expect(asked.body.response.abstained).toBe(true);
  });
});

describe('revocation blocks everything at once', () => {
  it('stops a revoked relative asking, reading and seeing answers already given', async () => {
    const before = await family.get<{ questions: unknown[] }>(
      `/v1/archives/${archiveId}/family-questions/asked`,
    );
    expect(before.status).toBe(200);
    expect(before.body.questions.length).toBeGreaterThan(0);

    const members = await storyteller.get<{ members: { id: string; userId: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    );
    const membership = members.body.members.find((m) => m.userId === familyUserId)!;
    const revoked = await storyteller.patch(`/v1/archives/${archiveId}/members/${membership.id}`, {
      status: 'revoked',
    });
    expect(revoked.status).toBe(200);

    // Every route, immediately, with no cache to wait for.
    const asking = await family.post(`/v1/archives/${archiveId}/family-questions`, {
      body: 'One more thing.',
    });
    expect([403, 404]).toContain(asking.status);

    const reading = await family.get(`/v1/archives/${archiveId}/family-questions/asked`);
    expect([403, 404]).toContain(reading.status);

    // Including the answer they had already been given.
    expect(JSON.stringify(reading.body)).not.toContain('cardamom');
  });
});

describe('archive isolation holds for questions', () => {
  it('never returns one archive’s questions in another’s scope', async () => {
    const other = await buyer.post<{ id: string }>('/v1/archives', {
      name: 'A different family',
      subject: { displayName: 'Someone Else' },
      subjectIsAdult: true,
    });

    const leaked = await h.ctx.db.withArchiveScope(other.body.id, (tx) =>
      tx.one<{ n: number }>(`SELECT count(*)::int AS n FROM family_question`),
    );
    expect(leaked.n).toBe(0);

    // And the database itself refuses an unscoped read.
    const unscoped = await h.ctx.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM family_question`,
    );
    expect(unscoped[0]?.n).toBe(0);
  });
});
