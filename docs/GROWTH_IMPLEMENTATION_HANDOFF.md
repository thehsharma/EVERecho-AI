# EverEcho v0.3 — implementation handoff

For whoever continues this build, including a future session of this one.

## Where the build is

**Phase 0 complete.** Baseline verified and recorded in
`docs/GROWTH_BUILD_PLAN.md`. Planning documents created.

**Phase 1 complete.** The Family Question Inbox works end to end:

```
authorised relative asks → storyteller's private inbox → answer / decline /
defer / restrict → the answer becomes a citable source → suggestions the
storyteller must approve → approval reaches retrieval → revoking the relative
blocks all of it
```

Verified: 424 unit and integration tests (26 new for this slice), 106 browser
tests (18 new), 44 accessibility scans with zero violations, 48/48 evaluations,
`pnpm verify` clean.

**Phase 2 complete.** The contributor loop works end to end: eight proposal
kinds, provenance on each, contradictions surfaced at proposal time, a
correction that keeps the original, and an alternate account that changes
nothing at all.

Verified: 438 unit and integration tests (14 new), 129 browser tests (23 new),
48 accessibility scans with zero violations, 48/48 evaluations, `pnpm verify`
clean.

**Phase 3, capsules: complete.** Recipient-scoped, embargoed, expiring,
withdrawable, audited on refusal as well as on open, and unable to widen
consent — a story made more private leaves the capsule on its own.

Verified: 453 unit and integration tests (15 new), 141 browser tests (15 new),
50 accessibility scans with zero violations, 48/48 evaluations, `pnpm verify`
clean.

**Phase 3, gift and reservation: complete.** A storyteller's decline releases
the buyer's deposit automatically, with a reason code, and tells the buyer
nothing about why.

**Phase 4, gap radar: complete.** The archive's own words are read for things
they mention and never explain; the storyteller can answer, put one away for a
while, or refuse it permanently. Answering produces a source and a review
queue, never a memory.

Verified: 480 unit and integration tests (27 new for this slice), 153 browser
tests (12 new), 40 accessibility scans per viewport with zero violations,
48/48 evaluations, `pnpm verify` clean, 107 OpenAPI routes.

> The accessibility figure is recomputed from the spec: 34 screens reached
> through `scan()` plus 6 states scanned after interaction, run on two
> viewports. Earlier entries in this file carry a differently derived number;
> this is the one that can be reproduced from `tests/e2e/accessibility.spec.ts`.

**Known incomplete in Phase 4.** Two gap kinds — `conflicting_timeline` and
`thin_relationship` — exist in the schema, the CHECK constraint and the prompt
copy, and **no detector emits either**. They were left declared because the
contradiction machinery that would feed the first already exists elsewhere and
the storage should not have to change when it is wired up. Nothing in the
product claims they work. Story missions have a table and no routes or screen.

**A note on the browser fixtures.** "Never ask again" is permanent by design,
so the gap specs consume demonstration fixtures that do not come back: a full
two-viewport run uses four of the eleven the seed produces. The suite expects a
seeded database, and if the questions run out the assertion fails with
`no coverage questions left in the demonstration archive — run pnpm db:seed`
rather than skipping. It is not a flake; it is the fixture asking to be reseeded.

**Next, in order:** multilingual (Phase 4's second half — English, Hindi and
Hinglish with the original preserved and any translation labelled as a derived
artefact), then portability (Phase 5).

The traceability matrix (`docs/GROWTH_TRACEABILITY_MATRIX.md`) is the live
status. Anything marked `planned` there is not built. Anything marked `done`
has tests named beside it.

## How to continue

```
Read all applicable repository instructions and docs/GROWTH_IMPLEMENTATION_HANDOFF.md.
Verify the current Git state and the last recorded test results.
Continue from the first unfinished traceability item.
Do not redo completed work, do not overwrite unrelated changes, and do not stop after planning.
```

## Run it

```bash
service postgresql start      # if the database is not running
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                      # api :4000, web :3000, worker
pnpm verify                   # format, lint, typecheck, tests, evaluations
pnpm test:e2e                 # browser suite, two viewports
```

No credentials are needed for anything. Every provider has a deterministic
local implementation.

## The one thing to understand before changing anything

Everything new enters the existing pipeline rather than going around it:

```
authenticate → authorise → retrieve authorised P1–P3 evidence → detect
restrictions and contradictions → draft atomic third-person claims → verify
each claim → cite → answer or abstain → log content-free metadata
```

A family question's answer becomes a real `source_asset`, `transcript` and
`transcript_segment`, and the candidate extracted from it is an ordinary
`memory_candidate`. That is deliberate (see `GROWTH_DECISION_LOG.md` G-001): it
means retrieval, citation opening, export, deletion and the integrity manifest
need no special cases, and a family member clicking a citation lands on the
actual words.

## Things not to break

1. **`authorize()` is the only decision point.** Server-side, before every
   read, search, generation, link, share, export and delete. The frontend never
   decides access.
2. **Nothing biographical becomes fact without a person deciding.** Candidates
   are proposals. The CHECK constraint, the authorisation rule and the
   evaluation case are three independent mechanisms and all three should stay.
3. **A sharing surface never widens consent.** Capsules and restricted answers
   narrow; the recipient grant is the ceiling, re-checked on every read.
4. **Private declines stay private.** The reason never leaves the API.
5. **Analytics take numbers, booleans and enums.** The schema refuses strings,
   which is what keeps it true.

## Test commands

| Scope | Command |
| --- | --- |
| Everything | `pnpm verify` |
| Unit + integration | `npx vitest run` |
| One file | `npx vitest run <path>` |
| Browser | `pnpm test:e2e` |
| One browser file | `npx playwright test tests/e2e/<file>` |
| Evaluations | `pnpm eval` |

`PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium` is needed in this
environment.
