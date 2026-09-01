import { createHash, randomBytes } from 'node:crypto';
import type { RealtimeState } from '@everecho/contracts';
import type { Queryable } from '../pool';

export interface RealtimeSessionRow {
  id: string;
  archive_id: string;
  mode: 'interview' | 'assistant';
  state: RealtimeState;
  language: string;
  text_only: boolean;
  started_by_user_id: string;
  consent_policy_version: string;
  learning_policy_id: string | null;
  learning_policy_version: number | null;
  capabilities: Record<string, boolean>;
  tts_provider: string | null;
  tts_voice_id: string | null;
  sequence: number;
  limit_to_source_ids: string[];
  started_at: Date;
  last_activity_at: Date;
  ended_at: Date | null;
  ended_reason: string | null;
  deleted_at: Date | null;
}

export interface RealtimeTurnRow {
  id: string;
  archive_id: string;
  session_id: string;
  idx: number;
  speaker: 'user' | 'assistant';
  text: string;
  is_final: boolean;
  cancelled: boolean;
  spoken_clause_count: number;
  language: string | null;
  abstained: boolean;
  abstention_reason: string | null;
  claims: unknown[];
  retrieval_snapshot_id: string | null;
  model_name: string | null;
  model_version: string | null;
  prompt_version: string | null;
  tts_provider: string | null;
  tts_voice_id: string | null;
  audio_duration_ms: number | null;
  latency: Record<string, number | null> | null;
  created_at: Date;
  deleted_at: Date | null;
}

export async function insertSession(
  q: Queryable,
  input: {
    archiveId: string;
    mode: 'interview' | 'assistant';
    language: string;
    textOnly: boolean;
    startedByUserId: string;
    consentPolicyVersion: string;
    learningPolicyId: string | null;
    learningPolicyVersion: number | null;
    capabilities: Record<string, boolean>;
    ttsProvider: string;
    ttsVoiceId: string;
    limitToSourceIds: readonly string[];
  },
): Promise<RealtimeSessionRow> {
  return q.one<RealtimeSessionRow>(
    `INSERT INTO realtime_session
       (archive_id, mode, language, text_only, started_by_user_id, consent_policy_version,
        learning_policy_id, learning_policy_version, capabilities, tts_provider, tts_voice_id,
        limit_to_source_ids)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.archiveId,
      input.mode,
      input.language,
      input.textOnly,
      input.startedByUserId,
      input.consentPolicyVersion,
      input.learningPolicyId,
      input.learningPolicyVersion,
      JSON.stringify(input.capabilities),
      input.ttsProvider,
      input.ttsVoiceId,
      input.limitToSourceIds,
    ],
  );
}

export async function findSession(
  q: Queryable,
  archiveId: string,
  sessionId: string,
): Promise<RealtimeSessionRow | null> {
  return q.maybeOne<RealtimeSessionRow>(
    `SELECT * FROM realtime_session
     WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [archiveId, sessionId],
  );
}

/**
 * Applies a state transition, refusing if the session has moved on.
 *
 * The `expectedState` guard makes concurrent transitions safe without a lock:
 * two racing writers cannot both believe they moved the session out of
 * SPEAKING. Returns null when the guard failed, so the caller can re-read.
 */
export async function updateSessionState(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId: string;
    expectedState: RealtimeState;
    nextState: RealtimeState;
    endedReason?: string | null;
  },
): Promise<RealtimeSessionRow | null> {
  const terminal = input.nextState === 'ENDED' || input.nextState === 'FAILED';
  return q.maybeOne<RealtimeSessionRow>(
    `UPDATE realtime_session
        SET state = $4,
            last_activity_at = now(),
            ended_at = CASE WHEN $5::boolean THEN now() ELSE ended_at END,
            ended_reason = CASE WHEN $5::boolean THEN $6::text ELSE ended_reason END
      WHERE archive_id = $1 AND id = $2 AND state = $3 AND deleted_at IS NULL
      RETURNING *`,
    [
      input.archiveId,
      input.sessionId,
      input.expectedState,
      input.nextState,
      terminal,
      input.endedReason ?? null,
    ],
  );
}

/**
 * Attaches a connection to a session, idempotently.
 *
 * Connecting is not a state change a client competes for: a second tab, a
 * reconnect after a dropped socket, or a development double-mount all mean
 * "attach me to this conversation", and all of them must succeed. Doing it as
 * one conditional statement removes the read-then-write race that made two
 * simultaneous connections fight, with the loser left believing the session
 * had never started.
 *
 * A session already under way is returned unchanged, so the caller can report
 * where the conversation actually is.
 */
export async function attachSession(
  q: Queryable,
  archiveId: string,
  sessionId: string,
): Promise<RealtimeSessionRow | null> {
  return q.maybeOne<RealtimeSessionRow>(
    `UPDATE realtime_session
        SET state = CASE
              WHEN state IN ('CREATED', 'CONNECTING', 'RECONNECTING') THEN 'READY'
              ELSE state
            END,
            last_activity_at = now()
      WHERE archive_id = $1 AND id = $2 AND deleted_at IS NULL AND ended_at IS NULL
      RETURNING *`,
    [archiveId, sessionId],
  );
}

/** Monotonic per session. Allocated in the database so two instances cannot collide. */
export async function nextSequence(
  q: Queryable,
  archiveId: string,
  sessionId: string,
): Promise<number> {
  const row = await q.one<{ sequence: number }>(
    `UPDATE realtime_session SET sequence = sequence + 1, last_activity_at = now()
      WHERE archive_id = $1 AND id = $2
      RETURNING sequence`,
    [archiveId, sessionId],
  );
  return row.sequence;
}

/**
 * Records an event. Returns false when this client event was already applied,
 * which is what makes duplicate delivery a no-op rather than a second turn.
 */
export async function recordEvent(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId: string;
    seq: number;
    direction: 'client' | 'server';
    type: string;
    clientEventId?: string | null;
    fromState?: RealtimeState | null;
    toState?: RealtimeState | null;
    reasonCode?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    `INSERT INTO realtime_event
       (archive_id, session_id, seq, direction, type, client_event_id,
        from_state, to_state, reason_code, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      input.archiveId,
      input.sessionId,
      input.seq,
      input.direction,
      input.type,
      input.clientEventId ?? null,
      input.fromState ?? null,
      input.toState ?? null,
      input.reasonCode ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return rows.length > 0;
}

export async function insertTurn(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId: string;
    idx: number;
    speaker: 'user' | 'assistant';
    text: string;
    isFinal: boolean;
    language?: string | null;
  },
): Promise<RealtimeTurnRow> {
  return q.one<RealtimeTurnRow>(
    `INSERT INTO realtime_turn (archive_id, session_id, idx, speaker, text, is_final, language)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      input.archiveId,
      input.sessionId,
      input.idx,
      input.speaker,
      input.text,
      input.isFinal,
      input.language ?? null,
    ],
  );
}

export async function completeAssistantTurn(
  q: Queryable,
  input: {
    archiveId: string;
    turnId: string;
    text: string;
    claims: unknown;
    abstained: boolean;
    abstentionReason: string | null;
    retrievalSnapshotId: string | null;
    modelName: string;
    modelVersion: string;
    promptVersion: string;
    ttsProvider: string | null;
    ttsVoiceId: string | null;
    audioDurationMs: number | null;
    spokenClauseCount: number;
    cancelled: boolean;
    latency: Record<string, number | null>;
  },
): Promise<RealtimeTurnRow> {
  return q.one<RealtimeTurnRow>(
    `UPDATE realtime_turn
        SET text = $3, claims = $4, abstained = $5, abstention_reason = $6,
            retrieval_snapshot_id = $7, model_name = $8, model_version = $9,
            prompt_version = $10, tts_provider = $11, tts_voice_id = $12,
            audio_duration_ms = $13, spoken_clause_count = $14,
            cancelled = $15,
            -- A cancelled turn is never final: it is not a complete statement,
            -- so it can never become evidence for anything.
            is_final = NOT $15::boolean,
            latency = $16
      WHERE archive_id = $1 AND id = $2
      RETURNING *`,
    [
      input.archiveId,
      input.turnId,
      input.text,
      JSON.stringify(input.claims),
      input.abstained,
      input.abstentionReason,
      input.retrievalSnapshotId,
      input.modelName,
      input.modelVersion,
      input.promptVersion,
      input.ttsProvider,
      input.ttsVoiceId,
      input.audioDurationMs,
      input.spokenClauseCount,
      input.cancelled,
      JSON.stringify(input.latency),
    ],
  );
}

export async function finaliseUserTurn(
  q: Queryable,
  archiveId: string,
  turnId: string,
  text: string,
  language: string | null,
): Promise<RealtimeTurnRow> {
  return q.one<RealtimeTurnRow>(
    `UPDATE realtime_turn SET text = $3, is_final = true, language = $4
      WHERE archive_id = $1 AND id = $2
      RETURNING *`,
    [archiveId, turnId, text, language],
  );
}

export async function listTurns(
  q: Queryable,
  archiveId: string,
  sessionId: string,
): Promise<RealtimeTurnRow[]> {
  return q.query<RealtimeTurnRow>(
    `SELECT * FROM realtime_turn
     WHERE archive_id = $1 AND session_id = $2 AND deleted_at IS NULL
     ORDER BY idx ASC`,
    [archiveId, sessionId],
  );
}

export async function nextTurnIndex(
  q: Queryable,
  archiveId: string,
  sessionId: string,
): Promise<number> {
  const row = await q.one<{ next: number }>(
    `SELECT coalesce(max(idx), -1) + 1 AS next FROM realtime_turn
      WHERE archive_id = $1 AND session_id = $2`,
    [archiveId, sessionId],
  );
  return Number(row.next);
}

// ---------------------------------------------------------------------------
// Reconnect tokens
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Mints a short-lived token bound to actor, archive, session and mode.
 *
 * Stored hashed: a leaked database row must not be a usable credential. The
 * plaintext is returned once and never persisted.
 */
export async function mintReconnectToken(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId: string;
    userId: string;
    mode: string;
    ttlSeconds: number;
  },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const row = await q.one<{ expires_at: Date }>(
    `INSERT INTO realtime_reconnect_token
       (archive_id, session_id, user_id, token_hash, mode, expires_at)
     VALUES ($1,$2,$3,$4,$5, now() + make_interval(secs => $6))
     RETURNING expires_at`,
    [
      input.archiveId,
      input.sessionId,
      input.userId,
      hashToken(token),
      input.mode,
      input.ttlSeconds,
    ],
  );
  return { token, expiresAt: row.expires_at };
}

/**
 * Consumes a reconnect token. Single-use: the same token cannot resume two
 * connections, so a captured token is useless once the legitimate client has
 * reconnected.
 */
export async function consumeReconnectToken(
  q: Queryable,
  input: { archiveId: string; sessionId: string; userId: string; token: string },
): Promise<boolean> {
  const rows = await q.query<{ id: string }>(
    `UPDATE realtime_reconnect_token
        SET consumed_at = now()
      WHERE archive_id = $1 AND session_id = $2 AND user_id = $3
        AND token_hash = $4
        AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      RETURNING id`,
    [input.archiveId, input.sessionId, input.userId, hashToken(input.token)],
  );
  return rows.length > 0;
}

/** Called on revocation. A token minted before consent changed must not work. */
export async function revokeReconnectTokens(
  q: Queryable,
  archiveId: string,
  sessionId?: string | null,
): Promise<number> {
  const rows = await q.query<{ id: string }>(
    `UPDATE realtime_reconnect_token SET revoked_at = now()
      WHERE archive_id = $1
        AND ($2::uuid IS NULL OR session_id = $2::uuid)
        AND revoked_at IS NULL AND consumed_at IS NULL
      RETURNING id`,
    [archiveId, sessionId ?? null],
  );
  return rows.length;
}

/** Every session still able to accept audio. Used by revocation. */
export async function listLiveSessions(
  q: Queryable,
  archiveId: string,
): Promise<RealtimeSessionRow[]> {
  return q.query<RealtimeSessionRow>(
    `SELECT * FROM realtime_session
      WHERE archive_id = $1 AND ended_at IS NULL AND deleted_at IS NULL`,
    [archiveId],
  );
}

export async function recordUsage(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId: string;
    sttSeconds?: number;
    ttsCharacters?: number;
    llmInputTokens?: number;
    llmOutputTokens?: number;
    transportSeconds?: number;
    storedAudioBytes?: number;
    estimatedCostMinor?: number;
    currency?: string;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO realtime_provider_usage
       (archive_id, session_id, stt_seconds, tts_characters, llm_input_tokens,
        llm_output_tokens, transport_seconds, stored_audio_bytes, estimated_cost_minor, currency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (session_id) DO UPDATE SET
       stt_seconds = realtime_provider_usage.stt_seconds + EXCLUDED.stt_seconds,
       tts_characters = realtime_provider_usage.tts_characters + EXCLUDED.tts_characters,
       llm_input_tokens = realtime_provider_usage.llm_input_tokens + EXCLUDED.llm_input_tokens,
       llm_output_tokens = realtime_provider_usage.llm_output_tokens + EXCLUDED.llm_output_tokens,
       transport_seconds = realtime_provider_usage.transport_seconds + EXCLUDED.transport_seconds,
       stored_audio_bytes = realtime_provider_usage.stored_audio_bytes + EXCLUDED.stored_audio_bytes,
       estimated_cost_minor =
         realtime_provider_usage.estimated_cost_minor + EXCLUDED.estimated_cost_minor,
       updated_at = now()`,
    [
      input.archiveId,
      input.sessionId,
      input.sttSeconds ?? 0,
      input.ttsCharacters ?? 0,
      input.llmInputTokens ?? 0,
      input.llmOutputTokens ?? 0,
      input.transportSeconds ?? 0,
      input.storedAudioBytes ?? 0,
      input.estimatedCostMinor ?? 0,
      input.currency ?? 'INR',
    ],
  );
}

export async function readUsage(
  q: Queryable,
  archiveId: string,
  sessionId: string,
): Promise<{
  stt_seconds: string;
  tts_characters: number;
  llm_input_tokens: number;
  llm_output_tokens: number;
  transport_seconds: string;
  stored_audio_bytes: string;
  estimated_cost_minor: number;
  currency: string;
} | null> {
  return q.maybeOne(
    `SELECT stt_seconds, tts_characters, llm_input_tokens, llm_output_tokens,
            transport_seconds, stored_audio_bytes, estimated_cost_minor, currency
       FROM realtime_provider_usage WHERE archive_id = $1 AND session_id = $2`,
    [archiveId, sessionId],
  );
}

/**
 * Records a safety observation. Labels only — the triggering text is never
 * copied here, because a safety table is exactly the place private material
 * ends up being read by people who should not see it.
 */
export async function recordSafetyEvent(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId?: string | null;
    turnId?: string | null;
    kind: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    labels: readonly string[];
  },
): Promise<void> {
  await q.query(
    `INSERT INTO realtime_safety_event (archive_id, session_id, turn_id, kind, severity, labels)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.archiveId,
      input.sessionId ?? null,
      input.turnId ?? null,
      input.kind,
      input.severity,
      input.labels,
    ],
  );
}

export async function recordInterruption(
  q: Queryable,
  input: {
    archiveId: string;
    sessionId: string;
    turnId: string | null;
    stopLatencyMs: number | null;
    clausesSpoken: number;
    clausesPlanned: number;
  },
): Promise<void> {
  await q.query(
    `INSERT INTO interruption_event
       (archive_id, session_id, turn_id, stop_latency_ms, clauses_spoken, clauses_planned)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      input.archiveId,
      input.sessionId,
      input.turnId,
      input.stopLatencyMs,
      input.clausesSpoken,
      input.clausesPlanned,
    ],
  );
}
