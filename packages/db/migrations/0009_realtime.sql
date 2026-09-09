-- Real-time conversation (v0.2).
--
-- Four memory layers, physically separated so that a conversation quietly
-- becoming family history is a schema violation rather than a code-review
-- question:
--
--   1. turn context      — in-session only, never a row here
--   2. conversation      — realtime_turn, transcript_revision
--   3. candidate         — memory_candidate (migration 0010)
--   4. approved archive  — the existing memory/claim tables
--
-- Nothing in the retrieval query can reach a candidate, because the retrieval
-- query does not name those tables.

-- ---------------------------------------------------------------------------
-- Learning policy: what a *conversation* may become.
-- Separate from consent_policy, which governs material already given.
-- ---------------------------------------------------------------------------
CREATE TABLE learning_policy (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  version               integer NOT NULL CHECK (version >= 1),
  document              jsonb NOT NULL,
  policy_hash           text NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  policy_engine_version text NOT NULL,
  created_by_user_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  effective_from        timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),

  -- Enforced here as well as in the compiler: a row that permits model
  -- training or cross-archive learning cannot exist, whatever application
  -- code believes.
  CONSTRAINT learning_policy_no_training
    CHECK (document->>'modelTraining' = 'false'),
  CONSTRAINT learning_policy_no_cross_archive
    CHECK (document->>'crossArchiveLearning' = 'false'),
  CONSTRAINT learning_policy_sensitive_reviewed
    CHECK (document->>'sensitiveMemory' = 'always_review'),
  CONSTRAINT learning_policy_approved_search_only
    CHECK (document->>'familySearchEligibility' = 'approved_only')
);
CREATE UNIQUE INDEX learning_policy_version ON learning_policy (archive_id, version);
-- At most one current policy per archive.
CREATE UNIQUE INDEX learning_policy_current
  ON learning_policy (archive_id) WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------
-- Sessions
-- ---------------------------------------------------------------------------
CREATE TABLE realtime_session (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id              uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  mode                    text NOT NULL CHECK (mode IN ('interview','assistant')),
  state                   text NOT NULL DEFAULT 'CREATED'
                            CHECK (state IN ('CREATED','CONNECTING','READY','LISTENING',
                                             'TRANSCRIBING','THINKING','SPEAKING','INTERRUPTED',
                                             'PAUSED','RECONNECTING','ENDING','ENDED','FAILED')),
  language                text NOT NULL DEFAULT 'auto',
  text_only               boolean NOT NULL DEFAULT false,
  started_by_user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,

  -- Which policies were in force. An answer must be reproducible against the
  -- rules that actually applied when it was given, not today's rules.
  consent_policy_version  text NOT NULL,
  learning_policy_id      uuid REFERENCES learning_policy(id) ON DELETE SET NULL,
  learning_policy_version integer,

  -- Resolved capabilities, so a live session does not re-derive them per turn.
  capabilities            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Recorded per session so "we never use the storyteller's voice" is auditable
  -- after the fact against a known allow-list, not merely asserted.
  tts_provider            text,
  tts_voice_id            text,

  sequence                integer NOT NULL DEFAULT 0,
  limit_to_source_ids     uuid[] NOT NULL DEFAULT '{}',

  started_at              timestamptz NOT NULL DEFAULT now(),
  last_activity_at        timestamptz NOT NULL DEFAULT now(),
  ended_at                timestamptz,
  ended_reason            text,
  deleted_at              timestamptz
);
CREATE INDEX realtime_session_archive ON realtime_session (archive_id, started_at DESC);
CREATE INDEX realtime_session_live ON realtime_session (archive_id)
  WHERE ended_at IS NULL AND deleted_at IS NULL;

CREATE TABLE realtime_session_participant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id   uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role         text NOT NULL,
  joined_at    timestamptz NOT NULL DEFAULT now(),
  left_at      timestamptz
);
CREATE UNIQUE INDEX realtime_participant_key ON realtime_session_participant (session_id, user_id);

-- Reconnect tokens are bound to actor, archive, session and mode, and expire
-- quickly. Stored hashed: a leaked database row must not be a usable token.
CREATE TABLE realtime_reconnect_token (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id   uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id   uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash   text NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  mode         text NOT NULL,
  expires_at   timestamptz NOT NULL,
  consumed_at  timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX realtime_reconnect_hash ON realtime_reconnect_token (token_hash);
CREATE INDEX realtime_reconnect_session ON realtime_reconnect_token (session_id);

-- ---------------------------------------------------------------------------
-- Events: an append-only record of the session, for replay and for audit.
-- Payloads carry state and sequence numbers, never transcript text.
-- ---------------------------------------------------------------------------
CREATE TABLE realtime_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id      uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id      uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('client','server')),
  type            text NOT NULL,
  -- Idempotency: a replayed client event is processed exactly once.
  client_event_id text,
  from_state      text,
  to_state        text,
  reason_code     text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX realtime_event_seq ON realtime_event (session_id, direction, seq);
CREATE UNIQUE INDEX realtime_event_idempotency
  ON realtime_event (session_id, client_event_id) WHERE client_event_id IS NOT NULL;
CREATE INDEX realtime_event_session ON realtime_event (session_id, created_at);

-- ---------------------------------------------------------------------------
-- Turns
-- ---------------------------------------------------------------------------
CREATE TABLE realtime_turn (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id            uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  idx                   integer NOT NULL,
  speaker               text NOT NULL CHECK (speaker IN ('user','assistant')),
  text                  text NOT NULL DEFAULT '',

  -- The gate that keeps half-heard speech out of the archive. Candidate
  -- evidence may only reference a final turn (enforced in 0010).
  is_final              boolean NOT NULL DEFAULT false,
  -- An assistant turn cut short by the user speaking over it.
  cancelled             boolean NOT NULL DEFAULT false,
  spoken_clause_count   integer NOT NULL DEFAULT 0,

  language              text,
  abstained             boolean NOT NULL DEFAULT false,
  abstention_reason     text,

  claims                jsonb NOT NULL DEFAULT '[]'::jsonb,
  retrieval_snapshot_id uuid REFERENCES retrieval_snapshot(id) ON DELETE SET NULL,

  model_name            text,
  model_version         text,
  prompt_version        text,
  tts_provider          text,
  tts_voice_id          text,
  audio_duration_ms     integer CHECK (audio_duration_ms IS NULL OR audio_duration_ms >= 0),
  latency               jsonb,

  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,

  -- A cancelled turn is by definition not a complete statement.
  CONSTRAINT realtime_turn_cancelled_not_final CHECK (NOT (cancelled AND is_final))
);
CREATE UNIQUE INDEX realtime_turn_idx ON realtime_turn (session_id, idx);
CREATE INDEX realtime_turn_session ON realtime_turn (session_id, idx);
CREATE INDEX realtime_turn_final ON realtime_turn (session_id) WHERE is_final AND deleted_at IS NULL;

-- Corrections create a new revision rather than overwriting. The original
-- stays, because what someone actually said and what they later clarified are
-- two different facts.
CREATE TABLE transcript_revision (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id        uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  turn_id           uuid NOT NULL REFERENCES realtime_turn(id) ON DELETE CASCADE,
  revision          integer NOT NULL CHECK (revision >= 1),
  text              text NOT NULL,
  reason            text,
  corrected_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transcript_revision_key ON transcript_revision (turn_id, revision);

-- ---------------------------------------------------------------------------
-- Audio segments.
--
-- Audio is not stored by default. There is deliberately NO column able to hold
-- a speaker embedding or voiceprint: a voiceprint is biometric data and the
-- seed of exactly the cloning capability this product refuses, and the
-- strongest guarantee is having nowhere to put one.
-- ---------------------------------------------------------------------------
CREATE TABLE realtime_audio_segment (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id         uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id         uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  turn_id            uuid REFERENCES realtime_turn(id) ON DELETE CASCADE,
  encoding           text NOT NULL,
  sample_rate        integer NOT NULL CHECK (sample_rate BETWEEN 8000 AND 48000),
  channel_count      integer NOT NULL CHECK (channel_count = 1),
  duration_ms        integer NOT NULL CHECK (duration_ms >= 0),
  byte_size          bigint NOT NULL CHECK (byte_size >= 0),
  checksum           text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  storage_key        text,
  storage_status     text NOT NULL DEFAULT 'not_stored'
                       CHECK (storage_status IN ('not_stored','stored','deleted')),
  consent_state      text NOT NULL
                       CHECK (consent_state IN ('not_permitted','session_only','archive_source')),
  retention_state    text NOT NULL DEFAULT 'ephemeral'
                       CHECK (retention_state IN ('ephemeral','session','retained','deleted')),
  provider_processed boolean NOT NULL DEFAULT false,
  provider_name      text,
  -- Set when the storyteller promoted this recording to a real archive source.
  source_asset_id    uuid REFERENCES source_asset(id) ON DELETE SET NULL,
  deletion_receipt_id uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  -- Audio may only carry a storage key when it was actually permitted.
  CONSTRAINT realtime_audio_storage_requires_consent
    CHECK (storage_status <> 'stored' OR consent_state <> 'not_permitted')
);
CREATE INDEX realtime_audio_session ON realtime_audio_segment (session_id);
CREATE INDEX realtime_audio_retained ON realtime_audio_segment (archive_id)
  WHERE storage_status = 'stored' AND deleted_at IS NULL;

-- Interruptions are recorded because barge-in latency is a product quality
-- measure and because an interrupted answer is not the answer that was given.
CREATE TABLE interruption_event (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id       uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id       uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  turn_id          uuid REFERENCES realtime_turn(id) ON DELETE CASCADE,
  stop_latency_ms  integer CHECK (stop_latency_ms IS NULL OR stop_latency_ms >= 0),
  clauses_spoken   integer NOT NULL DEFAULT 0,
  clauses_planned  integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interruption_event_session ON interruption_event (session_id);

-- Conversation summaries. Content-bearing, so archive-scoped and under RLS.
CREATE TABLE conversation_summary (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id    uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  text          text NOT NULL,
  model_name    text,
  model_version text,
  prompt_version text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX conversation_summary_session ON conversation_summary (session_id);

-- ---------------------------------------------------------------------------
-- Operational: usage and safety. Content-free by construction.
-- ---------------------------------------------------------------------------
CREATE TABLE realtime_provider_usage (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id           uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id           uuid NOT NULL REFERENCES realtime_session(id) ON DELETE CASCADE,
  stt_seconds          numeric(12,3) NOT NULL DEFAULT 0,
  tts_characters       integer NOT NULL DEFAULT 0,
  llm_input_tokens     integer NOT NULL DEFAULT 0,
  llm_output_tokens    integer NOT NULL DEFAULT 0,
  transport_seconds    numeric(12,3) NOT NULL DEFAULT 0,
  stored_audio_bytes   bigint NOT NULL DEFAULT 0,
  estimated_cost_minor integer NOT NULL DEFAULT 0,
  currency             text NOT NULL DEFAULT 'INR',
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX realtime_usage_session ON realtime_provider_usage (session_id);

CREATE TABLE realtime_safety_event (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id  uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES realtime_session(id) ON DELETE CASCADE,
  turn_id     uuid REFERENCES realtime_turn(id) ON DELETE SET NULL,
  kind        text NOT NULL,
  severity    text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  -- Labels only. The triggering text is never copied here.
  labels      text[] NOT NULL DEFAULT '{}',
  handled     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX realtime_safety_session ON realtime_safety_event (session_id);
CREATE INDEX realtime_safety_open ON realtime_safety_event (archive_id) WHERE NOT handled;
