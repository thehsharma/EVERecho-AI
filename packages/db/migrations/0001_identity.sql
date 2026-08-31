-- Identity, households, archives, membership and invitations.
--
-- Two ideas are load-bearing here and are worth stating once:
--   1. An *account* (app_user) is not a *person* (person). The storyteller may
--      never hold an account; a buyer holds one but is not the subject.
--   2. Paying for an archive does not make you its owner. `archive.buyer_user_id`
--      and `archive.storyteller_user_id` are separate columns on purpose.

CREATE TABLE app_user (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email               text NOT NULL,
  display_name        text NOT NULL,
  password_hash       text,
  auth_provider       text NOT NULL DEFAULT 'local',
  external_subject    text,
  mfa_secret          text,
  mfa_enabled         boolean NOT NULL DEFAULT false,
  is_platform_admin   boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'suspended', 'deleted')),
  accepted_legal_copy_version text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_login_at       timestamptz,
  CONSTRAINT app_user_email_is_lowercase CHECK (email = lower(email))
);
CREATE UNIQUE INDEX app_user_email_key ON app_user (email);
CREATE UNIQUE INDEX app_user_external_subject_key
  ON app_user (auth_provider, external_subject) WHERE external_subject IS NOT NULL;

-- Sessions store only a hash: a stolen database does not yield usable sessions.
CREATE TABLE user_session (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash    text NOT NULL UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  last_seen_at  timestamptz,
  -- Hashed, never raw: an audit trail should not become a tracking database.
  ip_hash             text,
  user_agent_family   text
);
CREATE INDEX user_session_user_idx ON user_session (user_id) WHERE revoked_at IS NULL;

-- The represented person. Deliberately separate from any account.
CREATE TABLE person (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name  text NOT NULL,
  given_name    text,
  family_name   text,
  birth_year    integer CHECK (birth_year IS NULL OR birth_year BETWEEN 1850 AND 2100),
  death_year    integer CHECK (death_year IS NULL OR death_year BETWEEN 1850 AND 2100),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE household (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  created_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE archive (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id              uuid NOT NULL REFERENCES household(id) ON DELETE RESTRICT,
  subject_person_id         uuid NOT NULL REFERENCES person(id) ON DELETE RESTRICT,
  name                      text NOT NULL,
  status                    text NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','awaiting_storyteller','declined','active',
                                                'frozen','export_only','deleting','deleted')),
  -- Who paid, and who it is about. Never the same authority.
  buyer_user_id             uuid REFERENCES app_user(id) ON DELETE SET NULL,
  storyteller_user_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  current_consent_policy_id uuid,
  life_state                text NOT NULL DEFAULT 'living' CHECK (life_state IN ('living','posthumous')),
  data_region               text NOT NULL DEFAULT 'local',
  subject_is_adult          boolean NOT NULL DEFAULT true
                              CHECK (subject_is_adult),  -- v0.1 creates no profiles for minors
  created_by_user_id        uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  deleted_at                timestamptz
);
CREATE INDEX archive_household_idx ON archive (household_id);
CREATE INDEX archive_storyteller_idx ON archive (storyteller_user_id);
CREATE INDEX archive_buyer_idx ON archive (buyer_user_id);

CREATE TABLE membership (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  user_id             uuid REFERENCES app_user(id) ON DELETE CASCADE,
  email               text NOT NULL,
  display_name        text NOT NULL,
  role                text NOT NULL CHECK (role IN ('storyteller','buyer','family','contributor','steward','support_admin')),
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','active','revoked','expired')),
  invited_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  granted_at          timestamptz,
  revoked_at          timestamptz,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
-- One live membership per person per archive; revoked rows are kept as history.
CREATE UNIQUE INDEX membership_active_user_key
  ON membership (archive_id, user_id) WHERE status IN ('pending','active') AND user_id IS NOT NULL;
CREATE INDEX membership_user_idx ON membership (user_id) WHERE status = 'active';
CREATE INDEX membership_archive_idx ON membership (archive_id);
-- Exactly one storyteller per archive.
CREATE UNIQUE INDEX membership_one_storyteller
  ON membership (archive_id) WHERE role = 'storyteller' AND status IN ('pending','active');

CREATE TABLE invitation (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id          uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  email               text NOT NULL,
  display_name        text NOT NULL,
  role                text NOT NULL CHECK (role IN ('storyteller','buyer','family','contributor','steward')),
  -- Only the hash is stored; the token exists solely in the invitation link.
  token_hash          text NOT NULL UNIQUE,
  status              text NOT NULL DEFAULT 'sent'
                        CHECK (status IN ('sent','accepted','declined','revoked','expired')),
  personal_note       text,
  created_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  idempotency_key     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  accepted_at         timestamptz,
  declined_at         timestamptz,
  -- A private decline stays private: the reason is never shown to the inviter.
  decline_reason      text
);
CREATE UNIQUE INDEX invitation_idempotency_key
  ON invitation (archive_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX invitation_archive_idx ON invitation (archive_id);
CREATE INDEX invitation_email_idx ON invitation (email) WHERE status = 'sent';
