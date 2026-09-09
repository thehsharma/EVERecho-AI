-- Releasing a reservation when the storyteller says no (v0.3).
--
-- The gift flow already prevented a buyer from consenting on somebody else's
-- behalf, and a decline already stayed private. What was missing was the link
-- between the two facts: a storyteller declining left the buyer's deposit
-- sitting in `paid` with nothing pointing at the reason, so a support person
-- would have had to work out by hand which deposits belonged to archives that
-- never started.
--
-- `released` is deliberately distinct from `refunded`. A refund is something
-- the buyer asked for; a release is something the product did because the
-- person it was bought for said no. They are the same movement of money and
-- completely different events, and collapsing them would lose the only signal
-- that says how often this happens.

ALTER TABLE reservation
  DROP CONSTRAINT IF EXISTS reservation_status_check;

ALTER TABLE reservation
  ADD CONSTRAINT reservation_status_check
    CHECK (status IN ('pending','paid','refunded','failed','cancelled','released'));

ALTER TABLE reservation
  ADD COLUMN released_at timestamptz,
  -- Why it was released, as a reason code. Never the storyteller's own words:
  -- their reason for declining is theirs, and this column is read by whoever
  -- is looking at the money.
  ADD COLUMN release_reason_code text
    CHECK (release_reason_code IS NULL OR
           release_reason_code IN ('storyteller_declined','archive_deleted','operator_release'));

ALTER TABLE reservation
  ADD CONSTRAINT reservation_released_has_time
    CHECK ((status = 'released') = (released_at IS NOT NULL));
