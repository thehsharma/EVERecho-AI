# Phase 11 — The family growth loop

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §10 in full, plus §6
(migrations 0011–0016) and §12. Update docs/TRACEABILITY_MATRIX.md as you go.

## The rule that governs the whole phase

EVERY SLICE ENTERS THE EXISTING PIPELINE RATHER THAN GOING AROUND IT.

A family question's answer becomes a real source_asset, a real transcript,
real transcript_segment rows and a real memory_candidate — structurally
identical to an uploaded recording. That way retrieval, citation opening,
export, deletion and the integrity manifest need NO SPECIAL CASES, and a
family member clicking a citation lands on the actual words.

Do not add a parallel path. If you find yourself writing "if it came from a
question", stop and make it a source instead.

## Slice 1 — Family Question Inbox (migration 0011)

  authorised relative asks → the storyteller's PRIVATE inbox → answer / skip /
  decline / mark private / defer / restrict to named recipients → the answer
  becomes a citable source → suggestions the storyteller must approve →
  approval reaches retrieval → revoking the relative blocks all of it

- Check membership, topic restriction, sensitivity ceiling and CURRENT consent.
  Run the restricted-topic check on BOTH the topic hint AND THE QUESTION TEXT,
  so it is refused however the asker labels it.
- The inbox is STORYTELLER-ONLY. A relative sees only their own questions.
  Refuse the inbox to family, to contributors and to the person who paid.
- A PRIVATE DECLINE STAYS PRIVATE: decline_reason is never selected by an
  asker-facing query and never leaves the API. Assert it appears NOWHERE in
  the payload.
- Restricting an answer NARROWS; it never widens. A restricted answer with
  nobody named is refused.
- The AI is NOT in the loop — the answer is the evidence.
- Render every state: empty, loading, pending, answered, declined, private,
  restricted, approval-required, revoked, failed.
- Screens: /questions (asker), /inbox (storyteller).

## Slice 2 — Contributor mode (migration 0012)

Eight proposal kinds: photos, documents, dates, places, people, corrections,
notes, alternate accounts.

- NO SILENT OVERWRITE. Approval is a separate act by the storyteller.
- A correction writes previous_value FIRST and bumps memory.version.
- AN ALTERNATE ACCOUNT WRITES NOTHING TO THE ORIGINAL — it stands beside it.
  Assert the target is BYTE-IDENTICAL after approval.
- proposal_evidence carries provenance and `first_hand`. On approval the
  proposal becomes a source_asset, so the second account is CITABLE and the
  citation says WHOSE IT IS.
- CONTRADICTIONS ARE SURFACED AT PROPOSAL TIME, BEFORE ANYONE DECIDES, and
  left `open`. A CORRECTION IS NOT A CONTRADICTION.
- A contributor CANNOT DECIDE THEIR OWN PROPOSAL, and is never OFFERED the
  decision — the screen renders decisions only when the API reports the
  capability.
- Contributing is a GRANT (`mayContribute`), not a role. A family member
  without it is refused.
- Screens: /contribute, /proposals.

## Slice 3 — Capsules, gift and reservation (migrations 0013, 0014)

- story_capsule + capsule_item + capsule_grant + capsule_access_event.
  `requireOpenCapsule` re-checks recipient, embargo, expiry AND revocation ON
  EVERY READ.
- capsule_access_event records OPENS AND REFUSALS.
- THERE IS NO CAPSULE LINK, ONLY A CAPSULE. Every route is auth:'required'.
  NO token path exists at all — no public capsule, no "anyone with the link",
  and THE SCHEMA OFFERS NO WAY TO ASK FOR ONE. No indexing, no public
  metadata, no previews, no private text in notifications.
- A CAPSULE NEVER BROADENS THE CONSENT OF ITS SOURCES: apply the reader's own
  sensitivity ceiling to the contents on every open, so a story made more
  private after the capsule was built DROPS OUT.
- TAKING A COPY IS SEPARATE FROM READING: capsule.download is gated by the
  `export` activity, the grant's mayExport AND the capsule's own allowDownload.
  Say so in the UI at the moment of the decision.
- Only a storyteller may create one, and nobody else is offered the control.
- The revocation reason is NEVER returned to a recipient.
- GIFT AND RESERVATION: a storyteller's decline RELEASES the buyer's deposit
  AUTOMATICALLY, with a reason code, in a `released` status distinct from
  `refunded` — and TELLS THE BUYER NOTHING ABOUT WHY.
- Screens: /capsules, /capsules/[capsuleId].

## Slice 4 — Gap radar (migrations 0015, 0016)

The archive's own words are read for things they mention and never explain.

- Detect: unnamed people, vague dates, unnamed places, unfinished stories.
  Declare `conflicting_timeline` and `thin_relationship` in the schema, the
  CHECK and the prompt copy, but DO NOT CLAIM THEY WORK until a detector emits
  them — mark those rows `partial` and say so in the handoff.
- Runs over APPROVED MEMORIES ONLY.
- NO SCORE, NO PERCENTAGE, NO STREAK, NO COMPLETENESS VERDICT — and no column
  that could hold one. A test scans the whole page for any measure.
- NO PRESSURE: "Not now" and "Never ask again" sit beside answering AT THE
  SAME WEIGHT, with no confirmation step and no persuasion. Cap the list at
  three until asked to show more.
- "NEVER" MUST HOLD AGAINST THE ID, not only against the list: it filters the
  list AND refuses the answer endpoint.
- DETECTION READS SENTENCES, NEVER LIVES. It infers nothing about health,
  money, belief or relationships. It says nothing about a life that is simply
  short on entries. It does not ask who the storyteller is — a bare pronoun
  becomes a question only when it acted on the narrator or the family. It does
  not ask about somebody the sentence already names, and it does not treat the
  next sentence's first word as the name.
- ANSWERING PRODUCES A SOURCE, NEVER A MEMORY: promoteGapAnswerToSource writes
  source_asset + transcript + transcript_segment; extraction runs under the
  learning policy and leaves candidates PENDING. Assert against the database
  that no memory was written.
- memory_candidate_has_one_origin widens to THREE origin columns (session,
  question, gap); derive them in ONE place.
- All three actions are storyteller-only, and the nav entry is gated on the
  reported capability.
- Screen: /gaps.

- story_mission: create the table. NO ROUTES, NO SCREEN. Mark it `planned`.

## Definition of done

Named tests per slice, plus for every slice:
- archive isolation: "never returns one archive's X in another's scope",
  tested scoped AND unscoped
- revocation: "stops a revoked relative asking, reading and seeing answers
  already given"
- analytics carry counts, booleans and enums only
- a11y scans on two viewports, zero violations, including an open answer box

## Do not

- Do not let a question's answer become a memory directly.
- Do not send a decline reason anywhere.
- Do not build a public capsule link, however convenient.
- Do not add a completeness metric of any shape.
```
