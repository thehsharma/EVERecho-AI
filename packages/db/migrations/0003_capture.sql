-- Sources, transcripts and interviews.
--
-- The original file is immutable. Corrections, re-transcriptions and edits all
-- become new rows that reference it; nothing ever rewrites source history.

CREATE TABLE source_asset (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  kind                  text NOT NULL CHECK (kind IN ('audio','video','photo','document','text')),
  status                text NOT NULL DEFAULT 'uploading'
                          CHECK (status IN ('uploading','quarantined','scanning','rejected','stored',
                                            'processing','processed','processing_failed','deleted')),
  original_filename     text NOT NULL,
  mime_type             text NOT NULL,
  byte_size             bigint NOT NULL CHECK (byte_size >= 0),
  checksum_sha256       text CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$'),
  storage_key           text NOT NULL,
  -- Uploads land in quarantine and are only promoted after scanning.
  quarantine_key        text,
  scan_result           text NOT NULL DEFAULT 'pending'
                          CHECK (scan_result IN ('pending','clean','infected','unsupported','error')),
  scan_detail           text,
  privacy               jsonb NOT NULL,
  sensitivity           text NOT NULL DEFAULT 'normal'
                          CHECK (sensitivity IN ('normal','sensitive','restricted','embargoed')),
  embargo_until         timestamptz,
  caption               text,
  uploaded_by_user_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  idempotency_key       text,
  processing_stage      text NOT NULL DEFAULT 'queued'
                          CHECK (processing_stage IN ('queued','scanning','transcribing','extracting','ready','failed','skipped')),
  processing_detail     text,
  processing_attempts   integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  processed_at          timestamptz,
  deleted_at            timestamptz
);
CREATE INDEX source_asset_archive_idx ON source_asset (archive_id, created_at DESC);
CREATE UNIQUE INDEX source_asset_idempotency_key
  ON source_asset (archive_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX source_asset_pending_idx ON source_asset (status) WHERE status IN ('quarantined','stored','processing');

-- Every stored representation of a source, including the immutable original.
CREATE TABLE asset_version (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id        uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  source_asset_id   uuid NOT NULL REFERENCES source_asset(id) ON DELETE CASCADE,
  version           integer NOT NULL CHECK (version >= 1),
  kind              text NOT NULL CHECK (kind IN ('original','normalised','thumbnail','redacted')),
  storage_key       text NOT NULL,
  checksum_sha256   text NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  byte_size         bigint NOT NULL,
  note              text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX asset_version_key ON asset_version (source_asset_id, version);

CREATE TABLE transcript (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id        uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  source_asset_id   uuid NOT NULL REFERENCES source_asset(id) ON DELETE CASCADE,
  provider          text NOT NULL,
  model_version     text NOT NULL,
  prompt_version    text,
  language          text NOT NULL DEFAULT 'en',
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready','failed')),
  method            text NOT NULL CHECK (method IN ('speech_to_text','ocr','typed')),
  -- The consent version in force when this ran, captured at execution time.
  policy_version    text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz
);
CREATE INDEX transcript_source_idx ON transcript (source_asset_id);

CREATE TABLE transcript_segment (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id        uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  transcript_id     uuid NOT NULL REFERENCES transcript(id) ON DELETE CASCADE,
  idx               integer NOT NULL,
  start_ms          integer,
  end_ms            integer,
  page_no           integer,
  start_char        integer,
  end_char          integer,
  text              text NOT NULL,
  confidence        real CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- A storyteller correction supersedes the machine transcript without erasing it.
  corrected_text    text,
  corrected_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  corrected_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX transcript_segment_key ON transcript_segment (transcript_id, idx);
CREATE INDEX transcript_segment_archive_idx ON transcript_segment (archive_id);

CREATE TABLE interview_session (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  mode                text NOT NULL CHECK (mode IN ('text','audio')),
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused','completed','abandoned')),
  created_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  prompt_version      text NOT NULL,
  summary_text        text,
  summary_approved    boolean NOT NULL DEFAULT false,
  -- Recorded when distress language triggered the safety path. Minimal metadata:
  -- that it happened and when, never what was said.
  safety_notice_shown_at timestamptz,
  started_at          timestamptz NOT NULL DEFAULT now(),
  ended_at            timestamptz
);
CREATE INDEX interview_session_archive_idx ON interview_session (archive_id, started_at DESC);

CREATE TABLE interview_prompt (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  interview_session_id  uuid NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
  idx                   integer NOT NULL,
  topic                 text NOT NULL,
  question_text         text NOT NULL,
  prompt_version        text NOT NULL,
  -- Follow-ups reference the response that prompted them, so the chain is auditable.
  follows_response_id   uuid,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX interview_prompt_key ON interview_prompt (interview_session_id, idx);

CREATE TABLE interview_response (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  interview_session_id  uuid NOT NULL REFERENCES interview_session(id) ON DELETE CASCADE,
  interview_prompt_id   uuid NOT NULL REFERENCES interview_prompt(id) ON DELETE CASCADE,
  response_text         text,
  source_asset_id       uuid REFERENCES source_asset(id) ON DELETE SET NULL,
  action                text NOT NULL CHECK (action IN ('answer','skip','prefer_not_to_answer','pause')),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX interview_response_prompt_key ON interview_response (interview_prompt_id);
CREATE INDEX interview_response_session_idx ON interview_response (interview_session_id);

ALTER TABLE interview_prompt
  ADD CONSTRAINT interview_prompt_follows_fk
  FOREIGN KEY (follows_response_id) REFERENCES interview_response(id) ON DELETE SET NULL;
