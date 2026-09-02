-- Private story capsules (v0.3).
--
-- A storyteller packaging chosen memories for named people. The whole design
-- follows from one rule: a capsule narrows what consent already permits and can
-- never widen it. Everything below exists to make that true even when somebody
-- forwards a link, or opens one a year after access was withdrawn.
--
-- There is no public capsule. There is no "anyone with the link" mode. A
-- capsule is read by a named, authenticated person, or it is not read.

CREATE TABLE story_capsule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id       uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  created_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,

  title            text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  note             text CHECK (note IS NULL OR length(note) <= 2000),

  -- Nothing before this time, for anyone. A birthday, an anniversary, a
  -- graduation: the storyteller decides when, and the server enforces it.
  embargo_until    timestamptz,
  -- Nothing after this time either. Optional, because not every capsule is
  -- temporary.
  expires_at       timestamptz,

  -- Reading is always permitted to a grantee; taking a copy is separate,
  -- because a copy outlives every revocation.
  allow_download   boolean NOT NULL DEFAULT false,

  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','revoked')),
  revoked_at       timestamptz,
  revoked_reason   text,

  consent_policy_version integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,

  CONSTRAINT story_capsule_revoked_has_time
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CONSTRAINT story_capsule_window_ordered
    CHECK (embargo_until IS NULL OR expires_at IS NULL OR embargo_until < expires_at)
);
CREATE INDEX story_capsule_archive
  ON story_capsule (archive_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- What is in it. Approved memories only: a capsule cannot be a way to share
-- something that has not been through review.
CREATE TABLE capsule_item (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id   uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  capsule_id   uuid NOT NULL REFERENCES story_capsule(id) ON DELETE CASCADE,
  memory_id    uuid NOT NULL REFERENCES memory(id) ON DELETE CASCADE,
  idx          integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX capsule_item_unique ON capsule_item (capsule_id, memory_id);

-- Who it is for. Named people, always: there is no anonymous grant.
CREATE TABLE capsule_grant (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id   uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  capsule_id   uuid NOT NULL REFERENCES story_capsule(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT capsule_grant_revoked_has_time
    CHECK ((status = 'revoked') = (revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX capsule_grant_unique ON capsule_grant (capsule_id, user_id);
CREATE INDEX capsule_grant_user ON capsule_grant (user_id, status);

-- Every open, and every refusal.
--
-- The refusals matter more than the opens: "somebody tried to read this after
-- I withdrew it" is exactly what a storyteller has a right to know, and it is
-- not knowable from a table that records only success.
CREATE TABLE capsule_access_event (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id   uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  capsule_id   uuid NOT NULL REFERENCES story_capsule(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (action IN ('opened','refused','downloaded')),
  -- A reason code, never content. Same rule as everywhere else.
  reason_code  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capsule_access_capsule ON capsule_access_event (capsule_id, created_at DESC);

DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY['story_capsule', 'capsule_item', 'capsule_grant',
                                 'capsule_access_event'];
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
