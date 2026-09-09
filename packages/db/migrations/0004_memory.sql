-- Memories, claims, evidence and generated artefacts.
--
-- The unit of truth is the *claim*: one atomic assertion, with the exact place
-- in the exact source that supports it. A memory is a presentation of claims;
-- an answer is a selection of them. Nothing reaches a reader without evidence.

CREATE TABLE place (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id  uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  name        text NOT NULL,
  region      text,
  country     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX place_archive_name_key ON place (archive_id, lower(name));

CREATE TABLE entity (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id  uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('person','organisation','object')),
  name        text NOT NULL,
  aliases     text[] NOT NULL DEFAULT '{}',
  notes       text,
  status      text NOT NULL DEFAULT 'candidate'
                CHECK (status IN ('candidate','approved','rejected','superseded')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX entity_archive_name_key ON entity (archive_id, kind, lower(name));

CREATE TABLE relationship (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id      uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  from_entity_id  uuid NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  to_entity_id    uuid NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  notes           text,
  status          text NOT NULL DEFAULT 'candidate'
                    CHECK (status IN ('candidate','approved','rejected','superseded')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationship_not_self CHECK (from_entity_id <> to_entity_id)
);
CREATE UNIQUE INDEX relationship_key ON relationship (archive_id, from_entity_id, to_entity_id, kind);

CREATE TABLE memory (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  title               text NOT NULL,
  body                text NOT NULL,
  -- Nothing is searchable or answerable until the storyteller approves it.
  status              text NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate','approved','rejected','superseded')),
  sensitivity         text NOT NULL DEFAULT 'normal'
                        CHECK (sensitivity IN ('normal','sensitive','restricted','embargoed')),
  evidence_class      text NOT NULL DEFAULT 'P1_DIRECT_STATEMENT'
                        CHECK (evidence_class IN ('P0_ORIGINAL_SOURCE','P1_DIRECT_STATEMENT',
                                                  'P2_CORROBORATED_FACT','P3_SUPPORTED_SYNTHESIS',
                                                  'P4_MODEL_INFERENCE')),
  origin              text NOT NULL CHECK (origin IN ('interview','upload_extraction','storyteller_written','contributor_proposed')),
  occurred_on         text,
  occurred_precision  text CHECK (occurred_precision IN ('day','month','year','decade','unknown')),
  place_id            uuid REFERENCES place(id) ON DELETE SET NULL,
  topics              text[] NOT NULL DEFAULT '{}',
  version             integer NOT NULL DEFAULT 1,
  was_corrected       boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  approved_at         timestamptz,
  approved_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  deleted_at          timestamptz,
  -- Generated simulation is prohibited; it cannot even be spelled here.
  CONSTRAINT memory_no_simulation CHECK (evidence_class <> 'P5_GENERATED_SIMULATION')
);
CREATE INDEX memory_archive_idx ON memory (archive_id, created_at DESC);
CREATE INDEX memory_approved_idx ON memory (archive_id, status) WHERE status = 'approved' AND deleted_at IS NULL;

CREATE TABLE memory_entity (
  memory_id   uuid NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  entity_id   uuid NOT NULL REFERENCES entity(id) ON DELETE CASCADE,
  archive_id  uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  PRIMARY KEY (memory_id, entity_id)
);

CREATE TABLE life_event (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  memory_id           uuid REFERENCES memory(id) ON DELETE CASCADE,
  title               text NOT NULL,
  start_date          text,
  start_precision     text CHECK (start_precision IN ('day','month','year','decade','unknown')),
  end_date            text,
  end_precision       text CHECK (end_precision IN ('day','month','year','decade','unknown')),
  place_id            uuid REFERENCES place(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'candidate'
                        CHECK (status IN ('candidate','approved','rejected','superseded')),
  evidence_class      text NOT NULL DEFAULT 'P1_DIRECT_STATEMENT',
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX life_event_archive_idx ON life_event (archive_id, start_date);

CREATE TABLE claim (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  memory_id             uuid REFERENCES memory(id) ON DELETE CASCADE,
  text                  text NOT NULL,
  evidence_class        text NOT NULL
                          CHECK (evidence_class IN ('P0_ORIGINAL_SOURCE','P1_DIRECT_STATEMENT',
                                                    'P2_CORROBORATED_FACT','P3_SUPPORTED_SYNTHESIS',
                                                    'P4_MODEL_INFERENCE')),
  status                text NOT NULL DEFAULT 'candidate'
                          CHECK (status IN ('candidate','approved','rejected','superseded')),
  sensitivity           text NOT NULL DEFAULT 'normal'
                          CHECK (sensitivity IN ('normal','sensitive','restricted','embargoed')),
  subject_entity_id     uuid REFERENCES entity(id) ON DELETE SET NULL,
  topics                text[] NOT NULL DEFAULT '{}',
  superseded_by_claim_id uuid REFERENCES claim(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claim_no_simulation CHECK (evidence_class <> 'P5_GENERATED_SIMULATION')
);
CREATE INDEX claim_archive_idx ON claim (archive_id);
CREATE INDEX claim_memory_idx ON claim (memory_id);

-- The link between an assertion and the exact words that support it.
CREATE TABLE claim_evidence (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  claim_id              uuid NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  source_asset_id       uuid NOT NULL REFERENCES source_asset(id) ON DELETE CASCADE,
  transcript_segment_id uuid REFERENCES transcript_segment(id) ON DELETE SET NULL,
  locator               jsonb NOT NULL,
  quoted_text           text NOT NULL,
  extraction_method     text NOT NULL,
  model_version         text NOT NULL,
  prompt_version        text NOT NULL,
  policy_version        text NOT NULL,
  confidence            real NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  processing_ms         integer,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX claim_evidence_claim_idx ON claim_evidence (claim_id);
CREATE INDEX claim_evidence_source_idx ON claim_evidence (source_asset_id);

CREATE TABLE contradiction (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  claim_a_id    uuid NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  claim_b_id    uuid NOT NULL REFERENCES claim(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('date_conflict','place_conflict','fact_conflict','relationship_conflict')),
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','accepted')),
  detail        text,
  detected_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolution    text,
  CONSTRAINT contradiction_distinct_claims CHECK (claim_a_id <> claim_b_id)
);
CREATE UNIQUE INDEX contradiction_pair_key ON contradiction (archive_id, claim_a_id, claim_b_id);

-- Every edit is kept. "Correct" never means "overwrite".
CREATE TABLE correction (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id      uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  target_type     text NOT NULL,
  target_id       uuid NOT NULL,
  previous_value  jsonb NOT NULL,
  next_value      jsonb NOT NULL,
  actor_user_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  actor_role      text NOT NULL,
  reason          text,
  -- A contributor proposes; only the storyteller's own corrections apply directly.
  status          text NOT NULL DEFAULT 'applied'
                    CHECK (status IN ('proposed','applied','rejected')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  reviewed_at     timestamptz
);
CREATE INDEX correction_target_idx ON correction (archive_id, target_type, target_id);

CREATE TABLE memory_embedding (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  memory_id     uuid NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  chunk_idx     integer NOT NULL,
  text          text NOT NULL,
  -- Portable everywhere; a pgvector column is added alongside when available.
  embedding     real[] NOT NULL,
  model         text NOT NULL,
  dim           integer NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX memory_embedding_key ON memory_embedding (memory_id, chunk_idx);
CREATE INDEX memory_embedding_archive_idx ON memory_embedding (archive_id);

CREATE TABLE generated_artifact (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id      uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('biography','timeline','session_summary')),
  content         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','edited','approved')),
  model_version   text NOT NULL,
  prompt_version  text NOT NULL,
  policy_version  text NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX generated_artifact_current_key ON generated_artifact (archive_id, kind);

CREATE TABLE retrieval_snapshot (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id      uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  query_hash      text NOT NULL,
  candidate_ids   jsonb NOT NULL,
  policy_version  text NOT NULL,
  max_sensitivity text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX retrieval_snapshot_archive_idx ON retrieval_snapshot (archive_id, created_at DESC);

CREATE TABLE generated_response (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id                uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  actor_user_id             uuid REFERENCES app_user(id) ON DELETE SET NULL,
  -- The question itself is memory-adjacent content; only its hash is retained
  -- for deduplication and evaluation. The text lives with the response record.
  question_hash             text NOT NULL,
  question_text             text NOT NULL,
  answer_mode               text NOT NULL CHECK (answer_mode IN ('grounded','abstained')),
  answer_text               text NOT NULL,
  abstained                 boolean NOT NULL,
  abstention_reason         text,
  policy_version            text NOT NULL,
  retrieval_snapshot_id     uuid REFERENCES retrieval_snapshot(id) ON DELETE SET NULL,
  model_and_prompt_version  text NOT NULL,
  perspective               text NOT NULL DEFAULT 'third_person',
  created_at                timestamptz NOT NULL DEFAULT now(),
  -- First-person composition about the storyteller is prohibited.
  CONSTRAINT response_third_person_only CHECK (perspective = 'third_person')
);
CREATE INDEX generated_response_archive_idx ON generated_response (archive_id, created_at DESC);

CREATE TABLE response_claim (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id              uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  generated_response_id   uuid NOT NULL REFERENCES generated_response(id) ON DELETE CASCADE,
  idx                     integer NOT NULL,
  text                    text NOT NULL,
  evidence_class          text NOT NULL
                            CHECK (evidence_class IN ('P1_DIRECT_STATEMENT','P2_CORROBORATED_FACT','P3_SUPPORTED_SYNTHESIS')),
  confidence              real NOT NULL,
  verified                boolean NOT NULL,
  source_ids              uuid[] NOT NULL DEFAULT '{}',
  citations               jsonb NOT NULL DEFAULT '[]',
  contradiction_ids       uuid[] NOT NULL DEFAULT '{}',
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- Customer-visible claims may only ever be P1-P3.
  CONSTRAINT response_claim_customer_classes
    CHECK (evidence_class IN ('P1_DIRECT_STATEMENT','P2_CORROBORATED_FACT','P3_SUPPORTED_SYNTHESIS'))
);
CREATE UNIQUE INDEX response_claim_key ON response_claim (generated_response_id, idx);

CREATE TABLE provenance_record (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  subject_type  text NOT NULL,
  subject_id    uuid NOT NULL,
  record        jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provenance_record_subject_idx ON provenance_record (archive_id, subject_type, subject_id);
