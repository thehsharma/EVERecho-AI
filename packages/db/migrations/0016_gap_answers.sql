-- Answering a gap (v0.3).
--
-- The radar is only half a loop if the only thing a person can do with a
-- question is put it away. This is the other half: the storyteller answers in
-- their own words, the answer becomes a real source with a real transcript,
-- and what it suggests goes to the same review queue as everything else.
--
-- Nothing here writes a memory. A gap answer produces candidates, and a
-- candidate is a suggestion until the storyteller approves it — the same rule
-- as the interview and the family question inbox, enforced the same way.

ALTER TABLE memory_candidate
  ADD COLUMN memory_gap_id uuid REFERENCES memory_gap(id) ON DELETE SET NULL;
CREATE INDEX memory_candidate_gap
  ON memory_candidate (memory_gap_id)
  WHERE memory_gap_id IS NOT NULL;

-- Still exactly one origin. A candidate that came from a conversation, an
-- answer to a family question, and a gap answer all at once has no coherent
-- citation, so the constraint widens to three columns rather than relaxing.
ALTER TABLE memory_candidate
  DROP CONSTRAINT memory_candidate_has_one_origin;
ALTER TABLE memory_candidate
  ADD CONSTRAINT memory_candidate_has_one_origin
    CHECK (num_nonnulls(session_id, family_question_response_id, memory_gap_id) <= 1);

-- What the storyteller actually wrote, kept beside the gap it answers. The
-- words are mirrored into a transcript segment so citation, export and
-- deletion work on them with no special cases; this column is the record of
-- which question they were an answer to.
ALTER TABLE memory_gap
  ADD COLUMN answered_at timestamptz,
  ADD COLUMN answer_source_asset_id uuid REFERENCES source_asset(id) ON DELETE SET NULL;

-- 'resolved' now means one of two different things, and they are not the same
-- to a person: "I have said what there is to say about this" and "I answered
-- it". Both close the question; only the second has a source behind it.
ALTER TABLE memory_gap
  ADD CONSTRAINT memory_gap_answered_is_resolved
    CHECK (answered_at IS NULL OR status = 'resolved');
