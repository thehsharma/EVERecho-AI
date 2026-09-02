-- Contributor proposals (v0.3).
--
-- The second source of approved content, and the first place a careless or
-- malicious relative can do damage. The whole table exists to make one thing
-- impossible: a contributor changing what the storyteller said.
--
-- Nothing here is ever applied by the person who proposed it. A proposal is a
-- request with evidence attached; approving it is a separate act by the
-- storyteller, recorded separately, and the original survives it.
--
-- The hardest case is the alternate account — a relative who remembers it
-- differently. That is not a correction and must never be applied as one:
-- both accounts are kept, linked by a contradiction, and nobody's memory is
-- overwritten by somebody else's. Families disagree about the past. A product
-- that resolves that disagreement automatically has decided who was right.

CREATE TABLE contributor_proposal (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id         uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  proposed_by_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,

  kind               text NOT NULL CHECK (kind IN (
                       'media',              -- a photograph or document
                       'date',               -- when something happened
                       'place',              -- where
                       'person',             -- who
                       'relationship',       -- how two people are connected
                       'correction',         -- this detail is wrong
                       'note',               -- context, not a claim about the past
                       'alternate_account'   -- I remember it differently
                     )),

  -- What it is about, when it is about something. A correction and an
  -- alternate account always name a target; a new person or a note need not.
  target_type        text CHECK (target_type IS NULL OR
                                 target_type IN ('memory','entity','place','event','source_asset')),
  target_id          uuid,

  title              text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body               text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),

  -- Structured detail for the kinds that have one: a date, a place name, a
  -- relationship. Free-form on purpose — the shape differs per kind and is
  -- validated by the contract, not by the column.
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- A photograph or document the contributor uploaded. It went through the
  -- same quarantine, scan and consent path as anything the storyteller
  -- uploads: there is no second ingestion route.
  source_asset_id    uuid REFERENCES source_asset(id) ON DELETE SET NULL,

  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected','withdrawn')),

  sensitivity        text NOT NULL DEFAULT 'normal'
                       CHECK (sensitivity IN ('normal','sensitive','restricted','embargoed')),

  -- Approved memories this disagrees with. Surfaced to the storyteller, never
  -- resolved for them.
  contradicts_memory_ids uuid[] NOT NULL DEFAULT '{}',

  -- What approving it produced, so the trail runs both ways.
  resulting_memory_id  uuid REFERENCES memory(id) ON DELETE SET NULL,
  resulting_correction_id uuid REFERENCES correction(id) ON DELETE SET NULL,

  reviewed_by_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  review_note        text CHECK (review_note IS NULL OR length(review_note) <= 2000),

  consent_policy_version integer,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz,

  -- A correction or an alternate account is about something specific.
  CONSTRAINT contributor_proposal_targeted
    CHECK (kind NOT IN ('correction','alternate_account')
           OR (target_type IS NOT NULL AND target_id IS NOT NULL)),
  -- A decided proposal records who decided and when.
  CONSTRAINT contributor_proposal_decided_has_reviewer
    CHECK ((status IN ('approved','rejected')) = (reviewed_at IS NOT NULL)),
  -- Only an approved proposal can have produced anything.
  CONSTRAINT contributor_proposal_result_requires_approval
    CHECK (status = 'approved'
           OR (resulting_memory_id IS NULL AND resulting_correction_id IS NULL))
);
CREATE INDEX contributor_proposal_review
  ON contributor_proposal (archive_id, status, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX contributor_proposal_target
  ON contributor_proposal (archive_id, target_type, target_id)
  WHERE deleted_at IS NULL;
CREATE INDEX contributor_proposal_author
  ON contributor_proposal (archive_id, proposed_by_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Why the contributor believes it.
--
-- A proposal with no evidence is an opinion, and an opinion about somebody
-- else's life does not become family history. The storyteller may still accept
-- one — a grandchild saying "you told me this at the wedding" is real evidence
-- of a kind — but the distinction has to survive into the record, which is
-- what `first_hand` is for.
CREATE TABLE proposal_evidence (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id         uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  proposal_id        uuid NOT NULL REFERENCES contributor_proposal(id) ON DELETE CASCADE,
  source_asset_id    uuid REFERENCES source_asset(id) ON DELETE SET NULL,
  quoted_text        text,
  locator            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- False when the contributor is reporting what somebody else told them.
  first_hand         boolean NOT NULL DEFAULT false,
  note               text CHECK (note IS NULL OR length(note) <= 2000),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposal_evidence_proposal ON proposal_evidence (proposal_id);

-- Isolation, on the same forced-RLS pattern as everything archive-scoped.
DO $$
DECLARE
  t text;
  content_tables text[] := ARRAY['contributor_proposal', 'proposal_evidence'];
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
