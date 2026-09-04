-- The ante-mortem directive (v0.4).
--
-- What the storyteller decides, while alive and competent, about what may be
-- heard after they die: which topics, which people, from when. It is the
-- permission model for everything else in this release, which is why it is
-- built first.
--
-- Three properties are structural rather than careful:
--
-- Withholding is a first-class statement, not the absence of a grant. A
-- directive that only records permissions treats silence as consent, and
-- after death nobody can correct the record.
--
-- Death is established by a person, never inferred. There is no inactivity
-- column here because there is no inactivity timer, and adding one would
-- require a migration somebody would have to justify in writing.
--
-- Once activated, the directive is closed to change. The person it speaks for
-- cannot revise it any more, so nobody else may either.

CREATE TABLE remembrance_directive (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,

  -- Versioned rather than edited. The storyteller may change their mind as
  -- often as they like while alive, and the record of what they thought
  -- before is part of what the archive is.
  version       integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','affirmed','superseded','activated')),

  -- What silence means.
  --
  -- The hardest question in this table, and the storyteller has to answer it
  -- rather than the schema: when they have died and no clause covers what
  -- somebody is asking for, does it open or stay closed?
  --
  -- There is no defensible default. Assuming 'permit' treats never getting
  -- round to it as consent. Assuming 'withhold' seals the archives of
  -- everyone who did not finish the form, which is most people, and destroys
  -- the thing their family was promised. So it is NOT NULL with no default:
  -- a directive cannot be affirmed without the person having decided.
  default_effect text NOT NULL CHECK (default_effect IN ('permit','withhold')),

  -- Their own words about why, in their own voice where they wanted it to be.
  -- A permission that carries the person's authority reads differently to the
  -- family than a checkbox does.
  note                 text CHECK (note IS NULL OR length(note) <= 4000),
  note_source_asset_id uuid REFERENCES source_asset(id) ON DELETE SET NULL,

  affirmed_at   timestamptz,
  -- Set only when a named human executes it against documentary evidence.
  activated_at  timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT remembrance_directive_affirmed_has_time
    CHECK ((status IN ('affirmed','superseded','activated')) = (affirmed_at IS NOT NULL)),
  CONSTRAINT remembrance_directive_activated_has_time
    CHECK ((status = 'activated') = (activated_at IS NOT NULL))
);
CREATE UNIQUE INDEX remembrance_directive_version
  ON remembrance_directive (archive_id, version);
-- At most one directive is in force at a time. A second affirmed version
-- would leave two answers to the same question and no way to choose.
CREATE UNIQUE INDEX remembrance_directive_current
  ON remembrance_directive (archive_id)
  WHERE status IN ('affirmed','activated');

-- One statement. Either a permission or a refusal, about one subject, for one
-- audience, from one time.
CREATE TABLE remembrance_clause (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  directive_id  uuid NOT NULL REFERENCES remembrance_directive(id) ON DELETE CASCADE,

  -- 'permit' and 'withhold' are the same size in the schema because they are
  -- the same size in the interface. A person sealing one topic and opening
  -- everything else must be able to say exactly that.
  effect        text NOT NULL CHECK (effect IN ('permit','withhold')),

  -- What it is about. A topic, one memory, one recording, or the whole
  -- archive. Narrower beats wider when they disagree; see resolution below.
  scope         text NOT NULL CHECK (scope IN ('archive','topic','memory','source')),
  topic         text CHECK (topic IS NULL OR length(btrim(topic)) BETWEEN 1 AND 120),
  memory_id     uuid REFERENCES memory(id) ON DELETE CASCADE,
  source_asset_id uuid REFERENCES source_asset(id) ON DELETE CASCADE,

  -- Who it is for. NULL means everyone the archive already permits — it never
  -- widens beyond that, because a directive cannot grant access to somebody
  -- consent has not already admitted.
  audience_user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,

  -- "Not yet." A grandchild's eighteenth birthday, a year of quiet.
  not_before    timestamptz,

  -- Whether the actual recording may be heard, as distinct from whether the
  -- words may be read. Some people will happily have their words quoted and
  -- not want their voice played, and that is not the same decision.
  allow_audio   boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),

  -- The scope names exactly the thing it is about.
  CONSTRAINT remembrance_clause_scope_target CHECK (
    (scope = 'archive' AND topic IS NULL AND memory_id IS NULL AND source_asset_id IS NULL) OR
    (scope = 'topic'   AND topic IS NOT NULL AND memory_id IS NULL AND source_asset_id IS NULL) OR
    (scope = 'memory'  AND memory_id IS NOT NULL AND topic IS NULL AND source_asset_id IS NULL) OR
    (scope = 'source'  AND source_asset_id IS NOT NULL AND topic IS NULL AND memory_id IS NULL)
  ),
  -- A refusal is unconditional. "Not before" on a withholding clause would
  -- mean "withheld until then, released after", which is a permission wearing
  -- a refusal's clothes and would be read the wrong way by whoever wrote the
  -- next feature.
  CONSTRAINT remembrance_clause_withhold_is_unconditional
    CHECK (effect = 'permit' OR not_before IS NULL)
);
CREATE INDEX remembrance_clause_directive
  ON remembrance_clause (directive_id, effect);
CREATE INDEX remembrance_clause_audience
  ON remembrance_clause (archive_id, audience_user_id)
  WHERE audience_user_id IS NOT NULL;

-- The act of establishing that somebody has died.
--
-- This table exists so that "who decided this, and on what evidence" has an
-- answer that outlives everyone involved. It is written once and never
-- updated: a correction is a new row with kind 'reversed'.
CREATE TABLE remembrance_activation (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id     uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  directive_id   uuid NOT NULL REFERENCES remembrance_directive(id) ON DELETE CASCADE,

  kind           text NOT NULL CHECK (kind IN ('activated','reversed')),

  -- The human who did it, by name, not by user id alone: the account may be
  -- deleted long before anyone asks who authorised this.
  executed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  executed_by_name    text NOT NULL CHECK (length(btrim(executed_by_name)) BETWEEN 1 AND 200),

  -- What they saw. A reference to a document held outside this system, never
  -- the document itself: a death certificate in an application database is a
  -- liability, not a record.
  evidence_kind      text NOT NULL
                       CHECK (evidence_kind IN ('death_certificate','court_order','other')),
  evidence_reference text NOT NULL CHECK (length(btrim(evidence_reference)) BETWEEN 1 AND 200),
  note               text CHECK (note IS NULL OR length(note) <= 2000),

  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX remembrance_activation_archive
  ON remembrance_activation (archive_id, created_at DESC);

DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY[
    'remembrance_directive', 'remembrance_clause', 'remembrance_activation'
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
