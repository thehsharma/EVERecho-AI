-- Consent, teach-back, succession and dispute holds.
--
-- Consent is never updated in place. Every change writes a new version and
-- supersedes the previous one, so "what had they agreed to on 3 March?" is
-- always answerable.

CREATE TABLE consent_policy (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  version               integer NOT NULL CHECK (version >= 1),
  mode                  text NOT NULL CHECK (mode IN ('preserve','organise','explore','compose')),
  document              jsonb NOT NULL,
  policy_hash           text NOT NULL CHECK (policy_hash ~ '^[0-9a-f]{64}$'),
  consent_copy_version  text NOT NULL,
  legal_copy_version    text NOT NULL,
  policy_engine_version text NOT NULL,
  created_by_user_id    uuid REFERENCES app_user(id) ON DELETE SET NULL,
  effective_from        timestamptz NOT NULL DEFAULT now(),
  superseded_at         timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  -- The prohibition is enforced by the database as well as the compiler.
  CONSTRAINT consent_policy_no_perform_mode CHECK (mode <> 'perform'),
  CONSTRAINT consent_policy_no_voice_cloning CHECK (
    (document -> 'voiceAndLikeness' ->> 'syntheticVoice') = 'false'
    AND (document -> 'voiceAndLikeness' ->> 'syntheticLikeness') = 'false'
    AND (document -> 'voiceAndLikeness' ->> 'personaSimulation') = 'false'
  ),
  CONSTRAINT consent_policy_no_model_training CHECK (
    (document -> 'providerProcessing' ->> 'noModelTraining') = 'true'
  )
);
CREATE UNIQUE INDEX consent_policy_version_key ON consent_policy (archive_id, version);
CREATE UNIQUE INDEX consent_policy_current_key
  ON consent_policy (archive_id) WHERE superseded_at IS NULL;

ALTER TABLE archive
  ADD CONSTRAINT archive_current_consent_policy_fk
  FOREIGN KEY (current_consent_policy_id) REFERENCES consent_policy(id) ON DELETE SET NULL;

-- Append-only record of consent acts (granted, updated, revoked, declined).
CREATE TABLE consent_record (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  consent_policy_id   uuid REFERENCES consent_policy(id) ON DELETE SET NULL,
  actor_user_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action              text NOT NULL CHECK (action IN ('granted','updated','revoked','declined','teachback_passed','teachback_failed')),
  summary             text,
  -- Session context, recorded where lawful; hashed, never raw.
  ip_hash             text,
  user_agent_family   text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consent_record_archive_idx ON consent_record (archive_id, created_at DESC);

CREATE TABLE teach_back_result (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  attempt               integer NOT NULL CHECK (attempt >= 1),
  answers               jsonb NOT NULL,
  passed                boolean NOT NULL,
  incorrect_question_ids text[] NOT NULL DEFAULT '{}',
  consent_copy_version  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX teach_back_archive_idx ON teach_back_result (archive_id, created_at DESC);

-- Recorded intent only. v0.1 never transitions an archive automatically, and
-- the constraint below makes that structural rather than a matter of care.
CREATE TABLE succession_directive (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id              uuid NOT NULL UNIQUE REFERENCES archive(id) ON DELETE CASCADE,
  status                  text NOT NULL DEFAULT 'recorded'
                            CHECK (status IN ('recorded','under_review','not_executable')),
  steward_email           text,
  instructions            text,
  cooling_period_days     integer NOT NULL DEFAULT 30 CHECK (cooling_period_days BETWEEN 7 AND 365),
  execution_enabled       boolean NOT NULL DEFAULT false,
  legal_review_status     text NOT NULL DEFAULT 'pending_qualified_legal_review',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT succession_never_auto_executes CHECK (execution_enabled = false),
  CONSTRAINT succession_requires_legal_review
    CHECK (legal_review_status = 'pending_qualified_legal_review')
);

-- A dispute freezes distribution. It never deletes the storyteller's sources.
CREATE TABLE dispute_hold (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  raised_by_user_id   uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reason              text NOT NULL,
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','resolved','withdrawn')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolution_note     text
);
CREATE INDEX dispute_hold_active_idx ON dispute_hold (archive_id) WHERE status = 'active';
