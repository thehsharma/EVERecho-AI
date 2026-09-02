-- Family questions (v0.3).
--
-- The loop that turns one storyteller into an archive: an authorised relative
-- asks something, the storyteller decides privately what to do about it, and
-- an answer they choose to give becomes evidence like any other source.
--
-- Two things in here are load-bearing and easy to lose in a refactor:
--
-- A question is not a memory. It never enters retrieval, it never becomes a
-- fact, and its text is never reachable by anyone except the asker and the
-- storyteller. The `answer_source_asset_id` column is the only bridge between
-- this table and the archive, and it is only ever set by an explicit answer.
--
-- A decline is private. `decline_reason` exists for the storyteller's own
-- record and is never returned to the asker, in any shape, including by
-- inference from a status the asker can see.

-- ---------------------------------------------------------------------------
-- The question
-- ---------------------------------------------------------------------------
CREATE TABLE family_question (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id         uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  asked_by_user_id   uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,

  -- The asker's own words. Never retrieved, never composed from, never
  -- indexed for search: it is a request, not evidence.
  body               text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 2000),

  -- An optional hint about what it is about, chosen by the asker from the
  -- archive's own topics. Used to route and to respect restrictions; never
  -- treated as a claim about the storyteller's life.
  topic              text,

  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','answered','declined','deferred','withdrawn')),

  -- Set when the storyteller decides. Separate from `updated_at` so that
  -- "how long did this sit in the inbox" is answerable.
  decided_at         timestamptz,

  -- The storyteller's own note about why they declined or deferred. Never
  -- leaves the API towards the asker. See G-004.
  decline_reason     text CHECK (decline_reason IS NULL OR length(decline_reason) <= 2000),

  -- The consent version in force when the question was accepted, so a later
  -- read can tell whether the ground has moved underneath it.
  consent_policy_version integer,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  -- A decided question has a decision time; a pending one does not.
  CONSTRAINT family_question_decided_has_time
    CHECK ((status = 'pending') = (decided_at IS NULL))
);
CREATE INDEX family_question_inbox
  ON family_question (archive_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX family_question_asker
  ON family_question (archive_id, asked_by_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- The response
-- ---------------------------------------------------------------------------
CREATE TABLE family_question_response (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id         uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  question_id        uuid NOT NULL REFERENCES family_question(id) ON DELETE CASCADE,

  -- Always the storyteller. Recorded rather than assumed, because "who
  -- actually said this" is the question every citation eventually asks.
  responded_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE RESTRICT,

  kind               text NOT NULL CHECK (kind IN ('answer','decline','defer')),

  -- The storyteller's own words. Present only for an answer: a decline has
  -- nothing to say to the asker, and storing a body for one would be a
  -- private note in a table the asker can read.
  body               text,

  -- Who may see this answer. Narrower than the archive's consent, never
  -- wider — the recipient grant remains the ceiling and is re-checked on
  -- every read. See G-005.
  visibility         text NOT NULL DEFAULT 'asker_only'
                       CHECK (visibility IN ('asker_only','all_authorised','restricted','private')),

  -- Named recipients, when visibility is 'restricted'. Empty otherwise.
  restricted_to_user_ids uuid[] NOT NULL DEFAULT '{}',

  -- The answer promoted to a real source, so retrieval, citation opening,
  -- export and deletion work on it with no special cases. See G-001.
  answer_source_asset_id uuid REFERENCES source_asset(id) ON DELETE SET NULL,

  sensitivity        text NOT NULL DEFAULT 'normal'
                       CHECK (sensitivity IN ('normal','sensitive','restricted','embargoed')),

  created_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  -- An answer says something; a decline or deferral does not.
  CONSTRAINT family_question_response_answer_has_body
    CHECK ((kind = 'answer') = (body IS NOT NULL AND length(btrim(body)) > 0)),
  -- Named recipients only make sense when the answer is restricted to them.
  CONSTRAINT family_question_response_restricted_has_recipients
    CHECK ((visibility = 'restricted') = (array_length(restricted_to_user_ids, 1) IS NOT NULL)),
  -- Only an answer can become a source. A decline is not evidence of anything.
  CONSTRAINT family_question_response_source_requires_answer
    CHECK (answer_source_asset_id IS NULL OR kind = 'answer')
);
-- One decision per question. A storyteller who changes their mind withdraws
-- and the asker may ask again; silently replacing an answer somebody has
-- already read is not a correction, it is a rewrite of what they were told.
CREATE UNIQUE INDEX family_question_response_one
  ON family_question_response (question_id)
  WHERE deleted_at IS NULL;
CREATE INDEX family_question_response_archive
  ON family_question_response (archive_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Candidates can now come from an answer as well as a conversation
-- ---------------------------------------------------------------------------
ALTER TABLE memory_candidate
  ADD COLUMN family_question_response_id uuid
    REFERENCES family_question_response(id) ON DELETE SET NULL;
CREATE INDEX memory_candidate_question_response
  ON memory_candidate (family_question_response_id)
  WHERE family_question_response_id IS NOT NULL;

-- A candidate comes from somewhere. Exactly one origin, always: a conversation
-- or an answer, never both and never neither. Without this a candidate could
-- reach approval with nothing to cite.
ALTER TABLE memory_candidate
  ADD CONSTRAINT memory_candidate_has_one_origin
    CHECK (num_nonnulls(session_id, family_question_response_id) <= 1);

-- ---------------------------------------------------------------------------
-- Isolation
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY['family_question', 'family_question_response'];
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
