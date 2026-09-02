import { createHash } from 'node:crypto';
import type { Transaction } from '@everecho/db';
import {
  enqueueJob,
  findCandidate,
  listCandidateEvidence,
  recordLearningDecision,
  type MemoryCandidateRow,
} from '@everecho/db';
import { conflict, notFound } from '../errors';
import type { AppContext } from '../context';
import { EXTRACTION_PROMPT_VERSION, EXTRACTOR_VERSION } from './candidates';

/**
 * Approving a candidate is the moment a conversation becomes family history.
 *
 * The approved memory is deliberately **structurally identical** to one derived
 * from an uploaded recording: a real `source_asset`, a real `transcript`, real
 * `transcript_segment` rows, a real `claim` and real `claim_evidence`. That is
 * not tidiness — it means retrieval, citation opening, export and deletion all
 * work on it with no special cases, and a family member clicking through to the
 * source lands on the actual words that were said.
 *
 * The conversation itself becomes the source, because that is what it is.
 */
export async function approveCandidate(
  ctx: AppContext,
  tx: Transaction,
  input: {
    archiveId: string;
    candidateId: string;
    userId: string;
    keepPrivate: boolean;
    note: string | null;
    policyVersion: string;
  },
): Promise<{ memoryId: string; candidate: MemoryCandidateRow }> {
  const candidate = await findCandidate(tx, input.archiveId, input.candidateId);
  if (!candidate) throw notFound();
  if (candidate.status !== 'pending') {
    throw conflict('This suggestion has already been decided.', 'candidate_not_pending');
  }
  // An unresolved reference is a prompt for a better question, not a memory.
  if (candidate.kind === 'unresolved_reference') {
    throw conflict(
      'That is a note about something the conversation left unclear, not a memory to approve.',
      'candidate_not_approvable',
    );
  }

  const evidence = await listCandidateEvidence(tx, [input.candidateId]);
  if (evidence.length === 0) {
    // Should be impossible: the schema requires evidence to have an origin.
    throw conflict(
      'This suggestion has no source and cannot be approved.',
      'candidate_no_evidence',
    );
  }

  // Where the words came from. A conversation is promoted to a source on the
  // first approval from it; an answer to a family question was already promoted
  // when it was given, because the person who asked could cite it immediately.
  const sessionId = candidate.session_id;
  const sourceAssetId = sessionId
    ? await ensureConversationSource(ctx, tx, {
        archiveId: input.archiveId,
        sessionId,
        policyVersion: input.policyVersion,
      })
    : (evidence.find((e) => e.source_asset_id)?.source_asset_id ?? null);

  if (!sourceAssetId) {
    throw conflict(
      'This suggestion is not linked to a source and cannot be approved yet.',
      'candidate_no_source',
    );
  }

  const memory = await tx.one<{ id: string }>(
    `INSERT INTO memory
       (archive_id, title, body, status, origin, sensitivity, evidence_class,
        occurred_on, occurred_precision, topics)
     VALUES ($1,$2,$3,'approved',$9,$4,$5,$6,$7,$8)
     RETURNING id`,
    [
      input.archiveId,
      candidate.title,
      candidate.body,
      // Keeping it private raises the sensitivity so recipient grants exclude
      // it, rather than adding a second visibility mechanism that could drift
      // out of step with the one consent already enforces.
      input.keepPrivate ? 'restricted' : candidate.sensitivity,
      candidate.evidence_class,
      candidate.occurred_on_value,
      candidate.occurred_on_precision,
      candidate.topics,
      // A conversation is an interview; an answer to a family question is the
      // storyteller writing something down. Both are their own words, and the
      // difference is worth keeping in the record.
      candidate.session_id ? 'interview' : 'storyteller_written',
    ],
  );

  if (candidate.place_name) {
    const place = await tx.one<{ id: string }>(
      `INSERT INTO place (archive_id, name) VALUES ($1,$2)
       ON CONFLICT (archive_id, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [input.archiveId, candidate.place_name],
    );
    await tx.query(`UPDATE memory SET place_id = $2 WHERE id = $1`, [memory.id, place.id]);
  }

  for (const name of candidate.entity_names) {
    const entity = await tx.one<{ id: string }>(
      `INSERT INTO entity (archive_id, kind, name) VALUES ($1,'person',$2)
       ON CONFLICT (archive_id, kind, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [input.archiveId, name],
    );
    await tx.query(
      `INSERT INTO memory_entity (memory_id, entity_id, archive_id) VALUES ($1,$2,$3)
       ON CONFLICT DO NOTHING`,
      [memory.id, entity.id, input.archiveId],
    );
  }

  if (candidate.occurred_on_value) {
    await tx.query(
      `INSERT INTO life_event (archive_id, memory_id, title, start_date, start_precision, status)
       VALUES ($1,$2,$3,$4,$5,'approved')`,
      [
        input.archiveId,
        memory.id,
        candidate.title,
        candidate.occurred_on_value,
        candidate.occurred_on_precision,
      ],
    );
  }

  const claim = await tx.one<{ id: string }>(
    `INSERT INTO claim (archive_id, memory_id, text, evidence_class, status, topics)
     VALUES ($1,$2,$3,$4,'approved',$5) RETURNING id`,
    [input.archiveId, memory.id, candidate.body, candidate.evidence_class, candidate.topics],
  );

  for (const item of evidence) {
    // Each piece of conversational evidence becomes a transcript segment on the
    // conversation source, so the citation resolves to an exact span. An answer
    // already has its segment: it was written when the answer was given.
    const segmentId =
      item.transcript_segment_id ??
      (await ensureSegmentForTurn(tx, {
        archiveId: input.archiveId,
        sourceAssetId,
        turnId: item.turn_id,
        text: item.quoted_text,
      }));

    await tx.query(
      `INSERT INTO claim_evidence
         (archive_id, claim_id, source_asset_id, transcript_segment_id, locator, quoted_text,
          extraction_method, model_version, prompt_version, policy_version, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.archiveId,
        claim.id,
        sourceAssetId,
        segmentId,
        JSON.stringify(
          segmentId ? { kind: 'transcript_segment', segmentId } : { kind: 'whole_asset' },
        ),
        item.quoted_text,
        candidate.session_id ? 'conversation_extraction' : 'answer_extraction',
        EXTRACTOR_VERSION,
        EXTRACTION_PROMPT_VERSION,
        input.policyVersion,
        candidate.confidence,
      ],
    );
  }

  const updated = await tx.one<MemoryCandidateRow>(
    `UPDATE memory_candidate
        SET status = 'approved', approved_memory_id = $3, reviewed_by_user_id = $4,
            reviewed_at = now(), review_note = $5
      WHERE archive_id = $1 AND id = $2
      RETURNING *`,
    [input.archiveId, input.candidateId, memory.id, input.userId, input.note],
  );

  await recordLearningDecision(tx, {
    archiveId: input.archiveId,
    candidateId: input.candidateId,
    sessionId: candidate.session_id,
    decision: 'approved',
    decidedByUserId: input.userId,
    consentPolicyVersion: input.policyVersion,
    note: input.note,
  });

  // Enqueued in this transaction, so an approved memory cannot exist without
  // the job that makes it findable. Retrieval reflects the change as soon as
  // the worker runs, and the worker re-checks consent before it writes.
  await enqueueJob(tx, {
    archiveId: input.archiveId,
    type: 'embed_memory',
    payload: { memoryId: memory.id },
    idempotencyKey: `embed:${memory.id}`,
  });

  void ctx;
  return { memoryId: memory.id, candidate: updated };
}

/**
 * The conversation, as a source.
 *
 * Created once per session, on the first approval from it. Nothing is stored
 * for it in object storage: the words live in `realtime_turn` and are mirrored
 * into transcript segments here, which is enough for a citation to resolve and
 * avoids duplicating memory content into a second store that deletion would
 * then have to find.
 */
async function ensureConversationSource(
  ctx: AppContext,
  tx: Transaction,
  input: { archiveId: string; sessionId: string; policyVersion: string },
): Promise<string> {
  const existing = await tx.maybeOne<{ id: string }>(
    `SELECT sa.id FROM source_asset sa
      WHERE sa.archive_id = $1 AND sa.storage_key = $2 AND sa.deleted_at IS NULL`,
    [input.archiveId, conversationStorageKey(input.sessionId)],
  );
  if (existing) return existing.id;

  const session = await tx.one<{ started_at: Date; mode: string; language: string }>(
    `SELECT started_at, mode, language FROM realtime_session WHERE archive_id = $1 AND id = $2`,
    [input.archiveId, input.sessionId],
  );

  const stamp = session.started_at.toISOString().slice(0, 16).replace('T', ' ');
  const source = await tx.one<{ id: string }>(
    `INSERT INTO source_asset
       (archive_id, kind, status, original_filename, mime_type, byte_size, storage_key,
        scan_result, privacy, processing_stage, processed_at)
     VALUES ($1,'text','processed',$2,'text/plain',0,$3,'clean',$4,'ready', now())
     RETURNING id`,
    [
      input.archiveId,
      `Conversation — ${stamp}`,
      conversationStorageKey(input.sessionId),
      // Nothing was uploaded, so there is nothing to scan and nothing excluded.
      JSON.stringify({ excluded: false, note: 'Live conversation held in this archive.' }),
    ],
  );

  await tx.query(
    `INSERT INTO transcript
       (archive_id, source_asset_id, provider, model_version, prompt_version, language,
        status, method, policy_version, completed_at)
     VALUES ($1,$2,'everecho-conversation','v1',$3,$4,'ready','typed',$5, now())`,
    [
      input.archiveId,
      source.id,
      EXTRACTION_PROMPT_VERSION,
      session.language === 'auto' ? 'en' : session.language,
      input.policyVersion,
    ],
  );

  void ctx;
  return source.id;
}

function conversationStorageKey(sessionId: string): string {
  return `conversation/${sessionId}`;
}

/**
 * Mirrors one conversational turn into a transcript segment.
 *
 * Idempotent by turn: approving two candidates that quote the same turn
 * produces one segment, so a citation always resolves to the same span.
 */
async function ensureSegmentForTurn(
  tx: Transaction,
  input: {
    archiveId: string;
    sourceAssetId: string;
    turnId: string | null;
    text: string;
  },
): Promise<string | null> {
  if (!input.turnId) return null;

  const transcript = await tx.maybeOne<{ id: string }>(
    `SELECT id FROM transcript WHERE archive_id = $1 AND source_asset_id = $2 LIMIT 1`,
    [input.archiveId, input.sourceAssetId],
  );
  if (!transcript) return null;

  const turn = await tx.maybeOne<{
    idx: number;
    text: string;
    is_final: boolean;
    cancelled: boolean;
  }>(`SELECT idx, text, is_final, cancelled FROM realtime_turn WHERE archive_id = $1 AND id = $2`, [
    input.archiveId,
    input.turnId,
  ]);
  // Defence in depth behind the database trigger: a partial or cancelled turn
  // is not evidence, so it does not become a citable segment either.
  if (!turn || !turn.is_final || turn.cancelled) return null;

  const existing = await tx.maybeOne<{ id: string }>(
    `SELECT id FROM transcript_segment WHERE archive_id = $1 AND transcript_id = $2 AND idx = $3`,
    [input.archiveId, transcript.id, turn.idx],
  );
  if (existing) return existing.id;

  const segment = await tx.one<{ id: string }>(
    `INSERT INTO transcript_segment
       (archive_id, transcript_id, idx, start_char, end_char, text, confidence)
     VALUES ($1,$2,$3,0,$4,$5,1.0)
     RETURNING id`,
    [input.archiveId, transcript.id, turn.idx, turn.text.length, turn.text],
  );
  void input.text;
  void createHash;
  return segment.id;
}
