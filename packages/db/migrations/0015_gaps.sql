-- Memory gaps and story missions (v0.3).
--
-- A calm coverage tool: what the archive mentions but never explains. An
-- unnamed "he", a date given only as "a few years later", a story that stops
-- mid-sentence, a person who appears once and never again.
--
-- The whole design is constrained by what this must never become. There is no
-- score, no percentage complete, no streak and no column that could hold one.
-- An archive is not a form to fill in, and a person cannot be behind on their
-- own life. `never_ask` exists because "no" has to be permanent to be real —
-- a dismissal that quietly returns next month is not a dismissal.

CREATE TABLE memory_gap (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,

  kind          text NOT NULL CHECK (kind IN (
                  'unresolved_person',    -- "he said we should go" — who?
                  'missing_date',         -- "a few years later" — when?
                  'missing_place',        -- somewhere, unnamed
                  'conflicting_timeline', -- two dates that cannot both be right
                  'unfinished_story',     -- referred to, never told
                  'thin_relationship'     -- named often, barely described
                )),

  -- The exact words that produced it, so the storyteller can see why they are
  -- being asked. Never a guess about what the answer is.
  reference     text NOT NULL CHECK (length(btrim(reference)) BETWEEN 1 AND 500),
  -- The memory it came from, so the question has a place to stand.
  memory_id     uuid REFERENCES memory(id) ON DELETE CASCADE,

  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','dismissed','snoozed','resolved')),
  -- A "not now" with a date on it. Nothing reappears before this.
  snoozed_until timestamptz,
  -- A permanent no. Nothing of this kind about this reference is offered again.
  never_ask     boolean NOT NULL DEFAULT false,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT memory_gap_snoozed_has_date
    CHECK ((status = 'snoozed') = (snoozed_until IS NOT NULL))
);
-- One open gap per reference per kind: noticing the same unnamed "he" in four
-- memories is one question, not four.
CREATE UNIQUE INDEX memory_gap_unique
  ON memory_gap (archive_id, kind, lower(reference));
CREATE INDEX memory_gap_open ON memory_gap (archive_id, status, created_at DESC);

-- An invitation to tell something, never an instruction.
CREATE TABLE story_mission (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  gap_id        uuid REFERENCES memory_gap(id) ON DELETE SET NULL,

  prompt        text NOT NULL CHECK (length(btrim(prompt)) BETWEEN 1 AND 500),
  -- Why it was offered, so a person can tell a prompt from a fact.
  rationale     text,

  status        text NOT NULL DEFAULT 'offered'
                  CHECK (status IN ('offered','completed','dismissed','snoozed')),
  snoozed_until timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT story_mission_completed_has_time
    CHECK ((status = 'completed') = (completed_at IS NOT NULL))
);
CREATE INDEX story_mission_open ON story_mission (archive_id, status, created_at DESC);

DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY['memory_gap', 'story_mission'];
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
