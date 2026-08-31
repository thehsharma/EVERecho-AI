-- Jobs, exports, deletion, audit, safety, security, billing and notifications.
--
-- These tables are deliberately NOT under row-level security: the worker polls
-- across archives, and support tooling reads operational metadata without ever
-- touching content. They carry archive_id for scoping, and authorize() guards them.

CREATE TABLE processing_job (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id        uuid REFERENCES archive(id) ON DELETE CASCADE,
  type              text NOT NULL,
  payload           jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','running','succeeded','failed','dead_lettered','cancelled')),
  attempts          integer NOT NULL DEFAULT 0,
  max_attempts      integer NOT NULL DEFAULT 5,
  run_after         timestamptz NOT NULL DEFAULT now(),
  locked_at         timestamptz,
  locked_by         text,
  last_error        text,
  -- Enqueue is idempotent: retrying a request never doubles the work.
  idempotency_key   text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  dead_lettered_at  timestamptz
);
CREATE UNIQUE INDEX processing_job_idempotency_key
  ON processing_job (type, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX processing_job_claim_idx ON processing_job (status, run_after)
  WHERE status IN ('queued', 'running');
CREATE INDEX processing_job_archive_idx ON processing_job (archive_id, created_at DESC);

CREATE TABLE export_job (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  requested_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'queued'
                          CHECK (status IN ('queued','running','ready','failed','expired')),
  options               jsonb NOT NULL DEFAULT '{}',
  storage_key           text,
  checksum_sha256       text,
  byte_size             bigint,
  manifest              jsonb,
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz,
  expires_at            timestamptz
);
CREATE INDEX export_job_archive_idx ON export_job (archive_id, created_at DESC);

CREATE TABLE deletion_request (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id            uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  requested_by_user_id  uuid REFERENCES app_user(id) ON DELETE SET NULL,
  scope                 text NOT NULL CHECK (scope IN ('archive','source','memory')),
  target_id             uuid,
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','completed','failed','cancelled')),
  -- Each step records its own completion so a crashed deletion resumes.
  steps                 jsonb NOT NULL DEFAULT '[]',
  reason                text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  completed_at          timestamptz
);
CREATE INDEX deletion_request_archive_idx ON deletion_request (archive_id, created_at DESC);

-- Append-only. An UPDATE or DELETE here is rejected by trigger, because proving
-- what happened requires that the record of it cannot be quietly rewritten.
CREATE TABLE audit_event (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id      uuid,
  actor_user_id   uuid,
  actor_display   text NOT NULL DEFAULT 'system',
  action          text NOT NULL,
  resource_type   text NOT NULL,
  resource_id     uuid,
  outcome         text NOT NULL CHECK (outcome IN ('allow','deny','success','failure')),
  reason_code     text,
  policy_version  text,
  request_id      text,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_event_archive_idx ON audit_event (archive_id, created_at DESC);
CREATE INDEX audit_event_actor_idx ON audit_event (actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION refuse_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
  BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION refuse_mutation();

CREATE TABLE safety_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid REFERENCES archive(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  -- Metadata only. A safety record never quotes what the storyteller said.
  context       jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  handled_at    timestamptz
);

CREATE TABLE security_event (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES app_user(id) ON DELETE SET NULL,
  archive_id    uuid REFERENCES archive(id) ON DELETE SET NULL,
  kind          text NOT NULL,
  severity      text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  ip_hash       text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_event_kind_idx ON security_event (kind, created_at DESC);

CREATE TABLE incident (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('safety','security','accuracy','consent','availability')),
  severity          text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
  summary           text NOT NULL,
  archive_id        uuid REFERENCES archive(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at   timestamptz,
  resolved_at       timestamptz,
  resolution_note   text
);
CREATE INDEX incident_status_idx ON incident (status, created_at DESC);

-- Break-glass: exceptional support access, always time-bound and always audited.
CREATE TABLE break_glass_grant (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id        uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  admin_user_id     uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  incident_id       uuid REFERENCES incident(id) ON DELETE SET NULL,
  purpose           text NOT NULL,
  scope             text NOT NULL DEFAULT 'metadata_only' CHECK (scope = 'metadata_only'),
  granted_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz NOT NULL,
  revoked_at        timestamptz
);
CREATE INDEX break_glass_active_idx ON break_glass_grant (admin_user_id, archive_id)
  WHERE revoked_at IS NULL;

CREATE TABLE billing_customer (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  provider              text NOT NULL,
  provider_customer_id  text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX billing_customer_key ON billing_customer (provider, provider_customer_id);

CREATE TABLE reservation (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  archive_id        uuid REFERENCES archive(id) ON DELETE SET NULL,
  currency          text NOT NULL CHECK (currency IN ('INR','USD')),
  amount_minor      integer NOT NULL CHECK (amount_minor >= 0),
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','paid','refunded','failed','cancelled')),
  provider          text NOT NULL,
  provider_ref      text,
  idempotency_key   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  refunded_at       timestamptz
);
CREATE UNIQUE INDEX reservation_idempotency_key ON reservation (user_id, idempotency_key);

CREATE TABLE subscription (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_customer_id   uuid NOT NULL REFERENCES billing_customer(id) ON DELETE CASCADE,
  plan                  text NOT NULL,
  status                text NOT NULL CHECK (status IN ('active','past_due','cancelled','none')),
  provider_ref          text,
  current_period_end    timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Webhook idempotency: a replayed provider event is processed exactly once.
CREATE TABLE webhook_event (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider            text NOT NULL,
  provider_event_id   text NOT NULL,
  signature_verified  boolean NOT NULL,
  event_type          text NOT NULL,
  payload             jsonb NOT NULL,
  received_at         timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz
);
CREATE UNIQUE INDEX webhook_event_key ON webhook_event (provider, provider_event_id);

-- Notifications carry no memory content, ever. Subject lines are template ids.
CREATE TABLE notification (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES app_user(id) ON DELETE CASCADE,
  email             text NOT NULL,
  archive_id        uuid REFERENCES archive(id) ON DELETE SET NULL,
  template          text NOT NULL,
  template_version  text NOT NULL,
  -- Only substitution values that are safe to place in an inbox.
  variables         jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'queued'
                      CHECK (status IN ('queued','sent','failed','suppressed')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz
);
CREATE INDEX notification_status_idx ON notification (status, created_at);

CREATE TABLE analytics_event (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  opaque_actor_id   text,
  opaque_archive_id text,
  props             jsonb NOT NULL DEFAULT '{}',
  occurred_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX analytics_event_name_idx ON analytics_event (name, occurred_at DESC);

-- Detected capabilities of this database, recorded by the migration runner.
CREATE TABLE db_capability (
  name        text PRIMARY KEY,
  available   boolean NOT NULL,
  detail      text,
  detected_at timestamptz NOT NULL DEFAULT now()
);
