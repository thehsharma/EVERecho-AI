-- How they felt about it (v0.4).
--
-- The archive has always kept what happened and never how it felt, which is
-- most of what anybody wants from somebody's life story.
--
-- The whole design turns on one distinction. Emotion in this product is
-- *stated by the person about themselves*, never detected, inferred or
-- generated. There is no sentiment analysis anywhere in this codebase and
-- there will not be: deciding from a recording that somebody sounded sad, and
-- writing that into their archive, is putting a claim about their inner life in
-- their mouth. This table holds only what they said about their own feelings,
-- in their own words.
--
-- So there is no mood column, no valence score, no enum of permitted emotions.
-- A fixed vocabulary would be the product deciding what a person is allowed to
-- have felt.

CREATE TABLE memory_feeling (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id    uuid NOT NULL REFERENCES archive(id) ON DELETE CASCADE,
  memory_id     uuid NOT NULL REFERENCES memory(id) ON DELETE CASCADE,

  -- Their words. Free text on purpose.
  body          text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),

  -- Said aloud, where they wanted it to be. The recording is promoted to a
  -- real source with a transcript, so it plays and cites like anything else,
  -- and so deletion and export reach it with no special case.
  source_asset_id       uuid REFERENCES source_asset(id) ON DELETE SET NULL,
  transcript_segment_id uuid REFERENCES transcript_segment(id) ON DELETE SET NULL,

  -- Whether anybody else may see it.
  --
  -- Decided per note, at the moment of writing, rather than inherited from a
  -- setting somewhere. "I will tell you what happened but not what it did to
  -- me" is an ordinary and reasonable thing to want, and it has to be sayable
  -- in the same breath as saying the thing.
  shared        boolean NOT NULL DEFAULT true,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One per memory. A second would be a revision, and a revision that keeps the
-- old one visible beside it would show the family two answers to "how did she
-- feel about this" with no way to choose.
CREATE UNIQUE INDEX memory_feeling_unique ON memory_feeling (memory_id);
CREATE INDEX memory_feeling_archive ON memory_feeling (archive_id, created_at DESC);

ALTER TABLE memory_feeling ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_feeling FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_feeling_archive_scope ON memory_feeling FOR ALL
  USING (archive_id = everecho_current_archive())
  WITH CHECK (archive_id = everecho_current_archive());
