import { createHash } from 'node:crypto';
import { storageKeyFor } from '@everecho/adapters';
import { enqueueJob, type Transaction } from '@everecho/db';
import { detectContradiction, detectInjection, extractYears } from '@everecho/ai';
import { assertProcessingAllowed, type PipelineContext } from '../context';

export interface JobArgs {
  ctx: PipelineContext;
  tx: Transaction;
  archiveId: string;
  payload: Record<string, unknown>;
}

interface SourceRecord {
  id: string;
  archive_id: string;
  kind: 'audio' | 'video' | 'photo' | 'document' | 'text';
  mime_type: string;
  original_filename: string;
  quarantine_key: string | null;
  storage_key: string;
  byte_size: number;
  privacy: {
    allowTranscription: boolean;
    allowOcr: boolean;
    allowEmbedding: boolean;
    allowGeneration: boolean;
  };
}

async function loadSource(tx: Transaction, sourceId: string): Promise<SourceRecord | null> {
  return tx.maybeOne<SourceRecord>(
    `SELECT id, archive_id, kind, mime_type, original_filename, quarantine_key, storage_key,
            byte_size, privacy
     FROM source_asset WHERE id = $1 AND deleted_at IS NULL`,
    [sourceId],
  );
}

/**
 * Quarantine, scan, then promote to an immutable original.
 *
 * Nothing reads the file for meaning until it has been through here, and the
 * promoted original is written under its own key with its checksum recorded as
 * an asset_version — the file itself is never rewritten again.
 */
export async function scanSource({ ctx, tx, payload }: JobArgs): Promise<void> {
  const source = await loadSource(tx, String(payload.sourceId));
  if (!source || !source.quarantine_key) return;

  const bytes = await ctx.storage.get(source.quarantine_key);
  const result = await ctx.scanner.scan(bytes, {
    filename: source.original_filename,
    mimeType: source.mime_type,
  });

  if (result.verdict !== 'clean') {
    await tx.query(
      `UPDATE source_asset SET status = 'rejected', scan_result = $2, scan_detail = $3,
                               processing_stage = 'failed', processing_detail = $4, updated_at = now()
       WHERE id = $1`,
      [
        source.id,
        result.verdict,
        result.detail,
        result.verdict === 'infected'
          ? 'This file did not pass our safety check and has not been added.'
          : 'This file type could not be accepted.',
      ],
    );
    await tx.query(
      `INSERT INTO security_event (archive_id, kind, severity, metadata)
       VALUES ($1, 'upload_rejected', $2, $3)`,
      [
        source.archive_id,
        result.verdict === 'infected' ? 'high' : 'low',
        JSON.stringify({ verdict: result.verdict, scanner: result.scanner }),
      ],
    );
    // The quarantined bytes are removed: a rejected upload is not kept.
    await ctx.storage.delete(source.quarantine_key);
    return;
  }

  const originalKey = storageKeyFor({
    archiveId: source.archive_id,
    sourceId: source.id,
    kind: 'original',
    version: 1,
  });
  const stored = await ctx.storage.put(originalKey, bytes, source.mime_type);
  await ctx.storage.delete(source.quarantine_key);

  await tx.query(
    `INSERT INTO asset_version (archive_id, source_asset_id, version, kind, storage_key, checksum_sha256, byte_size, note)
     VALUES ($1, $2, 1, 'original', $3, $4, $5, 'immutable original')
     ON CONFLICT (source_asset_id, version) DO NOTHING`,
    [source.archive_id, source.id, originalKey, stored.checksumSha256, stored.byteSize],
  );
  await tx.query(
    `UPDATE source_asset SET status = 'stored', scan_result = 'clean', storage_key = $2,
                             quarantine_key = NULL, checksum_sha256 = $3,
                             processing_stage = 'queued', processing_detail = NULL, updated_at = now()
     WHERE id = $1`,
    [source.id, originalKey, stored.checksumSha256],
  );

  const isSpoken = source.kind === 'audio' || source.kind === 'video';
  await enqueueJob(tx, {
    archiveId: source.archive_id,
    type: isSpoken ? 'transcribe_source' : 'ocr_source',
    payload: { sourceId: source.id },
    idempotencyKey: `${isSpoken ? 'stt' : 'ocr'}:${source.id}`,
  });
}

/** Text the browser captured while the storyteller was speaking. */
async function sidecarTextFor(tx: Transaction, sourceId: string): Promise<{ text: string; durationMs: number | null } | null> {
  const row = await tx.maybeOne<{ record: { text?: string; durationMs?: number | null } }>(
    `SELECT record FROM provenance_record
     WHERE subject_type = 'sidecar_text' AND subject_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [sourceId],
  );
  if (!row?.record.text) return null;
  return { text: row.record.text, durationMs: row.record.durationMs ?? null };
}

async function markStage(
  tx: Transaction,
  sourceId: string,
  stage: string,
  detail: string | null,
  status?: string,
): Promise<void> {
  await tx.query(
    `UPDATE source_asset SET processing_stage = $2, processing_detail = $3,
                             status = coalesce($4, status), updated_at = now()
     WHERE id = $1`,
    [sourceId, stage, detail, status ?? null],
  );
}

export async function transcribeSource({ ctx, tx, payload }: JobArgs): Promise<void> {
  const source = await loadSource(tx, String(payload.sourceId));
  if (!source) return;

  await assertProcessingAllowed(ctx, tx, {
    archiveId: source.archive_id,
    action: 'processing.transcribe',
    resource: { sourceId: source.id },
  });
  if (!source.privacy.allowTranscription) {
    await markStage(tx, source.id, 'skipped', 'You chose not to have this recording transcribed.', 'processed');
    return;
  }

  await markStage(tx, source.id, 'transcribing', null, 'processing');
  const bytes = await ctx.storage.get(source.storage_key);
  const sidecar = await sidecarTextFor(tx, source.id);
  const result = await ctx.stt.transcribe({
    audio: bytes,
    mimeType: source.mime_type,
    sidecarText: sidecar?.text ?? null,
    durationMs: sidecar?.durationMs ?? null,
  });

  if (result.status === 'unavailable') {
    // An honest stop, not a fabricated transcript. The recording is kept and
    // can be transcribed later once a provider is configured.
    await markStage(tx, source.id, 'skipped', result.reason, 'processed');
    return;
  }

  const policyVersion = await currentPolicyVersion(tx, source.archive_id);
  const transcript = await tx.one<{ id: string }>(
    `INSERT INTO transcript (archive_id, source_asset_id, provider, model_version, language,
                             status, method, policy_version, completed_at)
     VALUES ($1,$2,$3,$4,$5,'ready','speech_to_text',$6, now()) RETURNING id`,
    [source.archive_id, source.id, result.provider, result.modelVersion, result.language, policyVersion],
  );
  for (const segment of result.segments) {
    await tx.query(
      `INSERT INTO transcript_segment (archive_id, transcript_id, idx, start_ms, end_ms, text, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [source.archive_id, transcript.id, segment.idx, segment.startMs, segment.endMs, segment.text, segment.confidence],
    );
  }

  await enqueueJob(tx, {
    archiveId: source.archive_id,
    type: 'extract_candidates',
    payload: { sourceId: source.id, transcriptId: transcript.id },
    idempotencyKey: `extract:${transcript.id}`,
  });
}

export async function ocrSource({ ctx, tx, payload }: JobArgs): Promise<void> {
  const source = await loadSource(tx, String(payload.sourceId));
  if (!source) return;

  await assertProcessingAllowed(ctx, tx, {
    archiveId: source.archive_id,
    action: 'processing.ocr',
    resource: { sourceId: source.id },
  });
  if (!source.privacy.allowOcr) {
    await markStage(tx, source.id, 'skipped', 'You chose not to have this document read.', 'processed');
    return;
  }

  await markStage(tx, source.id, 'transcribing', null, 'processing');
  const bytes = await ctx.storage.get(source.storage_key);
  const result = await ctx.ocr.extract({ bytes, mimeType: source.mime_type });

  if (result.status === 'unavailable') {
    await markStage(tx, source.id, 'skipped', result.reason, 'processed');
    return;
  }

  const policyVersion = await currentPolicyVersion(tx, source.archive_id);
  const transcript = await tx.one<{ id: string }>(
    `INSERT INTO transcript (archive_id, source_asset_id, provider, model_version, language,
                             status, method, policy_version, completed_at)
     VALUES ($1,$2,$3,$4,'en','ready','ocr',$5, now()) RETURNING id`,
    [source.archive_id, source.id, result.provider, result.modelVersion, policyVersion],
  );
  result.pages.forEach(async () => undefined);
  for (const [index, page] of result.pages.entries()) {
    await tx.query(
      `INSERT INTO transcript_segment (archive_id, transcript_id, idx, page_no, text, confidence)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [source.archive_id, transcript.id, index, page.page, page.text, page.confidence],
    );
  }

  await enqueueJob(tx, {
    archiveId: source.archive_id,
    type: 'extract_candidates',
    payload: { sourceId: source.id, transcriptId: transcript.id },
    idempotencyKey: `extract:${transcript.id}`,
  });
}

async function currentPolicyVersion(tx: Transaction, archiveId: string): Promise<string> {
  const row = await tx.maybeOne<{ version: number }>(
    `SELECT version FROM consent_policy WHERE archive_id = $1 AND superseded_at IS NULL`,
    [archiveId],
  );
  return `archive-policy-v${row?.version ?? 0}`;
}

/**
 * Turns transcript segments into candidate memories, claims and evidence.
 *
 * Everything produced here is a *candidate*. None of it is searchable, none of
 * it can appear in an answer, and none of it is presented as true until the
 * storyteller has read it and approved it.
 */
export async function extractCandidates({ ctx, tx, payload }: JobArgs): Promise<void> {
  const source = await loadSource(tx, String(payload.sourceId));
  if (!source) return;

  await assertProcessingAllowed(ctx, tx, {
    archiveId: source.archive_id,
    action: 'processing.extract_candidates',
    resource: { sourceId: source.id },
  });

  const transcriptId = String(payload.transcriptId);
  const segments = await tx.query<{
    id: string;
    idx: number;
    text: string;
    corrected_text: string | null;
    start_ms: number | null;
    end_ms: number | null;
    page_no: number | null;
  }>(
    `SELECT id, idx, text, corrected_text, start_ms, end_ms, page_no
     FROM transcript_segment WHERE transcript_id = $1 ORDER BY idx`,
    [transcriptId],
  );
  if (segments.length === 0) {
    await markStage(tx, source.id, 'ready', 'Nothing readable was found in this file.', 'processed');
    return;
  }

  await markStage(tx, source.id, 'extracting', null, 'processing');

  // Transcript text is data. If it reads like an instruction, that is something
  // the storyteller said or wrote — it is recorded, never obeyed.
  const injectionFindings = segments.flatMap((s) => detectInjection(s.corrected_text ?? s.text));
  if (injectionFindings.length > 0) {
    await tx.query(
      `INSERT INTO security_event (archive_id, kind, severity, metadata)
       VALUES ($1, 'injection_pattern_in_source', 'low', $2)`,
      [source.archive_id, JSON.stringify({ labels: [...new Set(injectionFindings.map((f) => f.label))], sourceId: source.id })],
    );
  }

  const extraction = await ctx.llm.extractCandidates({
    sourceId: source.id,
    sourceKind: source.kind,
    segments: segments.map((s) => ({
      id: s.id,
      idx: s.idx,
      text: s.corrected_text ?? s.text,
      startMs: s.start_ms,
      endMs: s.end_ms,
      page: s.page_no,
    })),
  });

  const policyVersion = await currentPolicyVersion(tx, source.archive_id);
  const newClaims: { id: string; text: string; years: number[] }[] = [];

  for (const candidate of extraction.memories) {
    const memory = await tx.one<{ id: string }>(
      `INSERT INTO memory (archive_id, title, body, status, origin, occurred_on, occurred_precision, topics)
       VALUES ($1,$2,$3,'candidate','upload_extraction',$4,$5,$6) RETURNING id`,
      [
        source.archive_id,
        candidate.title,
        candidate.body,
        candidate.occurredOn?.value ?? null,
        candidate.occurredOn?.precision ?? null,
        candidate.topics,
      ],
    );

    if (candidate.placeName) {
      const place = await tx.one<{ id: string }>(
        `INSERT INTO place (archive_id, name) VALUES ($1, $2)
         ON CONFLICT (archive_id, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [source.archive_id, candidate.placeName],
      );
      await tx.query(`UPDATE memory SET place_id = $2 WHERE id = $1`, [memory.id, place.id]);
    }

    for (const name of candidate.entityNames) {
      const entity = await tx.one<{ id: string }>(
        `INSERT INTO entity (archive_id, kind, name, status) VALUES ($1, 'person', $2, 'candidate')
         ON CONFLICT (archive_id, kind, lower(name)) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
        [source.archive_id, name],
      );
      await tx.query(
        `INSERT INTO memory_entity (memory_id, entity_id, archive_id) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [memory.id, entity.id, source.archive_id],
      );
    }

    if (candidate.occurredOn) {
      await tx.query(
        `INSERT INTO life_event (archive_id, memory_id, title, start_date, start_precision, status)
         VALUES ($1,$2,$3,$4,$5,'candidate')`,
        [source.archive_id, memory.id, candidate.title, candidate.occurredOn.value, candidate.occurredOn.precision],
      );
    }

    for (const claimInput of candidate.claims) {
      const claim = await tx.one<{ id: string }>(
        `INSERT INTO claim (archive_id, memory_id, text, evidence_class, status, topics)
         VALUES ($1,$2,$3,'P1_DIRECT_STATEMENT','candidate',$4) RETURNING id`,
        [source.archive_id, memory.id, claimInput.text, candidate.topics],
      );
      await tx.query(
        `INSERT INTO claim_evidence (archive_id, claim_id, source_asset_id, transcript_segment_id,
                                     locator, quoted_text, extraction_method, model_version,
                                     prompt_version, policy_version, confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          source.archive_id,
          claim.id,
          source.id,
          claimInput.transcriptSegmentId,
          JSON.stringify(claimInput.locator),
          claimInput.quotedText,
          ctx.llm.extractive ? 'extractive_selection' : 'model_extraction',
          ctx.llm.modelVersion,
          'extraction-2026-01',
          policyVersion,
          claimInput.confidence,
        ],
      );
      newClaims.push({ id: claim.id, text: claimInput.text, years: extractYears(claimInput.text) });
    }
  }

  await detectContradictions(tx, source.archive_id, newClaims);

  if (extraction.unresolvedReferences.length > 0) {
    // Good follow-up questions, not guesses. Stored for the interviewer to use.
    await tx.query(
      `INSERT INTO provenance_record (archive_id, subject_type, subject_id, record)
       VALUES ($1, 'unresolved_references', $2, $3)`,
      [source.archive_id, source.id, JSON.stringify({ references: extraction.unresolvedReferences })],
    );
  }

  await markStage(
    tx,
    source.id,
    'ready',
    `${extraction.memories.length} story card(s) ready for you to review.`,
    'processed',
  );
  await tx.query(`UPDATE source_asset SET processed_at = now() WHERE id = $1`, [source.id]);
}

/** Compares new claims against existing approved ones for conflicting dates. */
async function detectContradictions(
  tx: Transaction,
  archiveId: string,
  newClaims: { id: string; text: string; years: number[] }[],
): Promise<void> {
  const dated = newClaims.filter((c) => c.years.length > 0);
  if (dated.length === 0) return;

  const existing = await tx.query<{ id: string; text: string }>(
    `SELECT id, text FROM claim WHERE archive_id = $1 AND status IN ('approved', 'candidate')`,
    [archiveId],
  );

  for (const candidate of dated) {
    for (const other of existing) {
      if (other.id === candidate.id) continue;
      const finding = detectContradiction(
        { text: candidate.text, years: candidate.years },
        { text: other.text, years: extractYears(other.text) },
      );
      if (!finding) continue;
      await tx.query(
        `INSERT INTO contradiction (archive_id, claim_a_id, claim_b_id, kind, detail)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (archive_id, claim_a_id, claim_b_id) DO NOTHING`,
        [archiveId, candidate.id, other.id, finding.kind, finding.detail],
      );
    }
  }
}

/** Embeds an approved memory so it can be retrieved. Approval comes first. */
export async function embedMemory({ ctx, tx, payload }: JobArgs): Promise<void> {
  const memoryId = String(payload.memoryId);
  const memory = await tx.maybeOne<{ id: string; archive_id: string; title: string; body: string; status: string }>(
    `SELECT id, archive_id, title, body, status FROM memory WHERE id = $1 AND deleted_at IS NULL`,
    [memoryId],
  );
  if (!memory || memory.status !== 'approved') return;

  await assertProcessingAllowed(ctx, tx, {
    archiveId: memory.archive_id,
    action: 'processing.embed',
    resource: { type: 'memory', id: memory.id },
  });

  const chunks = chunkText(`${memory.title}\n${memory.body}`);
  const vectors = await ctx.embeddings.embed(chunks);
  await tx.query(`DELETE FROM memory_embedding WHERE memory_id = $1`, [memory.id]);
  for (const [index, chunk] of chunks.entries()) {
    await tx.query(
      `INSERT INTO memory_embedding (archive_id, memory_id, chunk_idx, text, embedding, model, dim)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        memory.archive_id,
        memory.id,
        index,
        chunk,
        vectors[index] ?? [],
        ctx.embeddings.model,
        ctx.embeddings.dim,
      ],
    );
  }
}

/** Overlapping chunks so a sentence spanning a boundary is still retrievable. */
export function chunkText(text: string, maxChars = 600, overlap = 100): string[] {
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + maxChars);
    const slice = text.slice(start, end);
    const breakAt = end < text.length ? slice.lastIndexOf(' ') : slice.length;
    chunks.push(slice.slice(0, breakAt > maxChars * 0.5 ? breakAt : slice.length).trim());
    if (end >= text.length) break;
    start += Math.max(1, (breakAt > 0 ? breakAt : maxChars) - overlap);
  }
  return chunks.filter(Boolean);
}

export { createHash };
