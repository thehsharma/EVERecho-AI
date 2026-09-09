-- Grief-literate pacing (v0.4 slice 5).
--
-- Two changes, both about what this product refuses to know.
--
-- 1. A session may end for exactly one of a fixed set of operational reasons.
--
-- The column was free text and the reason was supplied by the client, so a
-- front end could have written "seemed_upset" or "crying" into it and the
-- server would have stored it, emitted it as an analytics reason code, and
-- kept it for the life of the archive. Nothing prohibited it but the absence
-- of anybody having done it yet.
--
-- The set below is deliberately mechanical. Every value describes something
-- that happened to the session — a person pressed a button, a timer fired, a
-- permission changed, a provider failed. None of them describes a person. That
-- is the property worth having, and a CHECK constraint is the only way to have
-- it: a comment saying "do not put feelings here" is a wish.
--
-- 2. A long session may be offered a pause, once, and the answer is final.
--
-- Recorded per session rather than per person, because the offer is about this
-- conversation and not about who is having it. `pause_offer_declined_at` is
-- what makes "once" true — a system that asks a grieving person the same
-- question a second time has not accepted their answer.

ALTER TABLE realtime_session
  ADD CONSTRAINT realtime_session_ended_reason_is_operational
  CHECK (
    ended_reason IS NULL OR ended_reason IN (
      'user_ended',        -- somebody pressed stop
      'idle_timeout',      -- nothing happened for long enough
      'consent_changed',   -- permission changed mid-session
      'consent_narrowed',  -- the consent policy was narrowed under a live session
      'learning_policy_narrowed', -- what talking may be used for was narrowed
      'archive_deleted',   -- the archive went away underneath it
      'budget_exhausted',  -- the spend cap was reached
      'provider_failed',   -- the transport or a provider gave up
      'error'              -- anything else, without elaborating
    )
  );

ALTER TABLE realtime_session
  -- When the offer to pause was made. NULL means it has not been made.
  ADD COLUMN pause_offered_at timestamptz,
  -- When it was declined. Set means never offer again, for this session.
  ADD COLUMN pause_offer_declined_at timestamptz,
  -- Why the offer was made: elapsed time, or one topic for many turns. Both
  -- are properties of the conversation. Neither is a claim about the person.
  ADD COLUMN pause_offer_basis text,
  ADD CONSTRAINT realtime_session_pause_basis_is_observable
    CHECK (
      pause_offer_basis IS NULL OR pause_offer_basis IN ('long_session', 'one_topic')
    ),
  -- Declined implies offered. Recording a refusal of something never offered
  -- would mean the two could drift, and "once" is the whole guarantee.
  ADD CONSTRAINT realtime_session_pause_declined_implies_offered
    CHECK (pause_offer_declined_at IS NULL OR pause_offered_at IS NOT NULL);
