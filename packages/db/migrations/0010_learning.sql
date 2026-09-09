-- Candidate knowledge, interaction preferences, and the RLS that binds them.
--
-- Layer 3 of the memory architecture. A candidate is never a fact: it is a
-- proposal that carries its own provenance and waits for the storyteller.

CREATE TABLE memory_candidate (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id             uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  session_id             uuid REFERENCES realtime_session(id) ON DELETE SET NULL,

  kind                   text NOT NULL
                           CHECK (kind IN ('memory','person','place','date','relationship',
                                           'preference','unresolved_reference')),
  status                 text NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','approved','rejected','superseded',
                                             'expired','withdrawn')),

  title                  text NOT NULL,
  body                   text NOT NULL DEFAULT '',
  occurred_on_value      text,
  occurred_on_precision  text CHECK (occurred_on_precision IS NULL OR
                                     occurred_on_precision IN ('day','month','year','decade','unknown')),
  topics                 text[] NOT NULL DEFAULT '{}',
  entity_names           text[] NOT NULL DEFAULT '{}',
  place_name             text,
  data_categories        text[] NOT NULL DEFAULT '{}',
  sensitivity            text NOT NULL DEFAULT 'normal'
                           CHECK (sensitivity IN ('normal','sensitive','restricted','embargoed')),
  evidence_class         text NOT NULL DEFAULT 'P1_DIRECT_STATEMENT'
                           CHECK (evidence_class IN ('P0_ORIGINAL_SOURCE','P1_DIRECT_STATEMENT',
                                                     'P2_CORROBORATED_FACT','P3_SUPPORTED_SYNTHESIS')),
  confidence             real NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),

  duplicate_of_memory_id    uuid REFERENCES memory(id) ON DELETE SET NULL,
  duplicate_of_candidate_id uuid REFERENCES memory_candidate(id) ON DELETE SET NULL,
  contradicts_memory_ids    uuid[] NOT NULL DEFAULT '{}',

  -- Which extractor produced it, so one bad extractor's output can be found
  -- and withdrawn as a set.
  extractor_name         text NOT NULL,
  extractor_version      text NOT NULL,
  prompt_version         text NOT NULL,

  -- Almost always true. Only a low-risk interaction preference under an
  -- explicit auto-save policy is ever false.
  requires_storyteller_review boolean NOT NULL DEFAULT true,

  reviewed_by_user_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at            timestamptz,
  review_note            text,
  approved_memory_id     uuid REFERENCES memory(id) ON DELETE SET NULL,

  created_at             timestamptz NOT NULL DEFAULT now(),
  deleted_at             timestamptz,

  -- A model inference (P4) or simulated speech (P5) can never be a candidate:
  -- the CHECK above admits only P0–P3, so the prohibition is structural.

  -- Anything biographical must be reviewed. Only preferences may skip it.
  CONSTRAINT candidate_only_preferences_skip_review
    CHECK (requires_storyteller_review OR kind = 'preference'),
  -- Sensitive material always requires review, whatever the extractor decided.
  CONSTRAINT candidate_sensitive_requires_review
    CHECK (requires_storyteller_review OR sensitivity = 'normal'),
  -- An approved candidate must say which memory it became.
  CONSTRAINT candidate_approved_has_memory
    CHECK (status <> 'approved' OR approved_memory_id IS NOT NULL)
);
CREATE INDEX memory_candidate_pending ON memory_candidate (archive_id, created_at DESC)
  WHERE status = 'pending' AND deleted_at IS NULL;
CREATE INDEX memory_candidate_session ON memory_candidate (session_id);

-- Every candidate points at the exact turn it came from. There is no path by
-- which a candidate exists without its source.
CREATE TABLE memory_candidate_evidence (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id             uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  candidate_id           uuid NOT NULL REFERENCES memory_candidate(id) ON DELETE CASCADE,
  turn_id                uuid REFERENCES realtime_turn(id) ON DELETE CASCADE,
  source_asset_id        uuid REFERENCES source_asset(id) ON DELETE CASCADE,
  transcript_segment_id  uuid REFERENCES transcript_segment(id) ON DELETE SET NULL,
  locator                jsonb NOT NULL DEFAULT '{}'::jsonb,
  quoted_text            text NOT NULL,
  -- Whether the storyteller said it themselves, or reported someone else
  -- saying it. Conflating the two is how family history acquires false
  -- first-hand testimony.
  first_hand             boolean NOT NULL DEFAULT true,
  speaker_label          text,
  created_at             timestamptz NOT NULL DEFAULT now(),

  -- Evidence must come from somewhere.
  CONSTRAINT candidate_evidence_has_origin
    CHECK (turn_id IS NOT NULL OR source_asset_id IS NOT NULL)
);
CREATE INDEX candidate_evidence_candidate ON memory_candidate_evidence (candidate_id);

/**
 * Partial transcripts are structurally ineligible as evidence.
 *
 * A trigger rather than a CHECK because the condition lives on another table.
 * A half-heard sentence is the most dangerous input this system can receive:
 * it looks like a quotation and is not one.
 */
CREATE OR REPLACE FUNCTION everecho_candidate_evidence_requires_final_turn()
RETURNS trigger AS $$
DECLARE
  ok boolean;
BEGIN
  IF NEW.turn_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT is_final AND NOT cancelled INTO ok FROM realtime_turn WHERE id = NEW.turn_id;
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'candidate evidence must reference a final, uncancelled turn (turn %)', NEW.turn_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER candidate_evidence_final_turn
  BEFORE INSERT OR UPDATE ON memory_candidate_evidence
  FOR EACH ROW EXECUTE FUNCTION everecho_candidate_evidence_requires_final_turn();

-- Every approval, rejection and auto-save decision, with the policy that
-- allowed it. This is how a storyteller can later ask "why is this here?".
CREATE TABLE learning_decision (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  candidate_id        uuid REFERENCES memory_candidate(id) ON DELETE SET NULL,
  session_id          uuid REFERENCES realtime_session(id) ON DELETE SET NULL,
  decision            text NOT NULL
                        CHECK (decision IN ('approved','rejected','auto_saved','withdrawn',
                                            'deduplicated','deferred')),
  decided_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  -- 'system' only ever appears for deduplication and policy-driven withdrawal.
  decided_by          text NOT NULL DEFAULT 'user' CHECK (decided_by IN ('user','system')),
  learning_policy_id  uuid REFERENCES learning_policy(id) ON DELETE SET NULL,
  consent_policy_version text,
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learning_decision_archive ON learning_decision (archive_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Interaction preferences.
--
-- Per user, not per archive: how fast someone likes to be spoken to is a fact
-- about them, not about a family's memories. Deliberately NOT archive-scoped
-- and therefore not under archive RLS — it holds no memory content, and the
-- CHECK below is what keeps it that way.
-- ---------------------------------------------------------------------------
CREATE TABLE interaction_preference (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  key                     text NOT NULL,
  value                   text NOT NULL CHECK (length(value) <= 120),
  origin                  text NOT NULL DEFAULT 'explicit'
                            CHECK (origin IN ('explicit','auto_saved')),
  learning_policy_version integer,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  -- The allow-list, enforced by the database.
  --
  -- An allow-list rather than a deny-list because a deny-list fails open the
  -- moment somebody adds a preference type and forgets to exclude it. A bug in
  -- application code cannot write a key this constraint does not name, so
  -- "we never silently remember anything about your life" is a property of the
  -- schema rather than of our care.
  CONSTRAINT interaction_preference_low_risk_only CHECK (key IN (
    'interface_language',
    'captions_enabled',
    'speaking_rate',
    'interview_pace',
    'preferred_session_minutes',
    'clarifying_question_frequency'
  ))
);
CREATE UNIQUE INDEX interaction_preference_key ON interaction_preference (user_id, key);

-- ---------------------------------------------------------------------------
-- Row-level security for every new archive-scoped content table.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY[
    'learning_policy',
    'realtime_session', 'realtime_session_participant', 'realtime_reconnect_token',
    'realtime_event', 'realtime_turn', 'transcript_revision',
    'realtime_audio_segment', 'interruption_event', 'conversation_summary',
    'realtime_provider_usage', 'realtime_safety_event',
    'memory_candidate', 'memory_candidate_evidence', 'learning_decision'
  ];
BEGIN
  FOREACH t IN ARRAY content_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL '
      'USING (archive_id = everecho_current_archive()) '
      'WITH CHECK (archive_id = everecho_current_archive())',
      t || '_archive_scope', t
    );
  END LOOP;
END $$;

-- Candidate bodies are searchable by the storyteller reviewing them, but they
-- are a separate index from `memory.search_tsv`: nothing in the retrieval path
-- may reach a candidate, and giving them a distinct column keeps that visible.
ALTER TABLE memory_candidate
  ADD COLUMN review_tsv tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B')
  ) STORED;
CREATE INDEX memory_candidate_review_tsv ON memory_candidate USING gin (review_tsv);
