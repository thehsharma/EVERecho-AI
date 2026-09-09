# Phase 06 — The memory product

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §5, §6 and §12. Update
docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. Review and approval
   GET/PATCH …/memories/:id, POST …/memories/:id/review.

   APPROVAL IS WHAT MAKES A MEMORY ANSWERABLE. Nothing is embedded, retrieved
   or answered from until the storyteller approves it. Enqueue `embed_memory`
   IN THE SAME TRANSACTION as the approval, so retrieval updates immediately
   and cannot be left behind.

   Enforce "no biographical memory without the storyteller deciding" in THREE
   INDEPENDENT PLACES: a database CHECK, an authorisation rule
   (`memory.review` is storyteller-only), and an evaluation measured against
   the database. Three mechanisms, because one is a matter of care.

2. Corrections — append-only
   ORIGINALS ARE NEVER EDITED. A correction is a NEW ROW referencing the
   original, recording `previous_value` and bumping `memory.version`, with
   `was_corrected` set. The original text must still be readable afterwards —
   assert it.

3. Contradictions — surfaced, not resolved
   A contradiction links two claims and is left `open`. The product's job is
   to show that two accounts disagree, not to decide which is true. A
   CORRECTION IS NOT A CONTRADICTION — they are different rows and different
   meanings.

4. Entities, people, places, relationships, life events
   GET …/people, …/events, …/claims/:claimId. Entities link to memories
   many-to-many.

5. Timeline
   GET …/timeline, built by a derive handler. SOURCE-LINKED: every entry
   points at the claim and the source it came from. Undated material is kept
   SEPARATE rather than guessed into a position.

6. Biography
   GET …/biography, POST …/biography/generate, PATCH …/biography/sections/:id.
   THIRD PERSON ONLY. `assertThirdPerson` runs over the output; no first
   person may appear outside a quotation. Editable by the storyteller.
   Identified as AI-assisted wherever it is shown.

7. Provenance presentation
   The API must give the frontend what it needs to distinguish: original,
   transcription, correction, corroboration, synthesis, uncertainty,
   contradiction, and prohibited. Evidence class travels with every claim.

## Definition of done

Named tests:
- "approval is what makes a memory answerable" — asserts nothing is embedded
  before approval, and that the embed job is enqueued in the same transaction
- asserts a memory cannot be created in an approved state by any path
- "records the previous value, bumps the version and reaches retrieval" —
  asserts version 2 exists AND the original value is still present
- asserts a contradiction row is created with status `open` and is not
  auto-resolved
- asserts the timeline's coverage and that undated entries are separated
- asserts NO FIRST PERSON outside quotes anywhere in a generated biography
- asserts `memory.review` is refused for family, contributor, buyer and admin

## Do not

- Do not "clean up" a claim's wording during review. The words are the
  evidence.
- Do not resolve a contradiction automatically, ever, on any signal.
- Do not let the biography generator write a sentence it cannot cite.
```
