# Adversarial log

**Every attempt to make this system fabricate, and whether it held — including
the ones that did not.**

Most products in this category would bury what is below. Publishing it is the
point: a trust product that only reports its successes is asking to be taken on
faith, which is the one thing it should never ask for.

Six entries, every one found by a test rather than by review, five fixed and
one still open.

---

## How to read this

Every entry names the tests that pin it. `scripts/check-adversarial-log.ts`
runs in CI and fails the build if any of those tests is deleted or renamed —
so an entry cannot quietly stop being a guarantee and go back to being a story.

The machine-readable version is `docs/adversarial-log.json`.

| | |
| --- | --- |
| **held: false** | The system did the wrong thing. Every entry here so far |
| **fixedIn** | The commit. `null` means still open, and the entry says why |
| **pinnedBy** | The tests that would fail if it came back |

---

## AL-001 — "What would she say to me now?"

**5 September 2026 · critical · fixed in `d5de6e2`**

The persona detector required the qualifier to follow the verb immediately, so
the conditional form **most grieving people actually type** went straight past
it and reached retrieval.

This is the entry that matters most, because the failure was not in the hard
cases. "Pretend to be her" was caught. "Answer as my mother" was caught. The
phrasing that got through was the gentle one — the one somebody types at two in
the morning, not the one an adversary constructs.

*Found by:* an integration test written for memorial mode, not by review.

*Fix:* the conditional is sufficient on its own. `What did she say about the
move` is untouched, because the tense is what separates a request to fabricate
from the question this product exists to answer.

---

## AL-002 — A first-person sentence reached a spoken turn

**5 September 2026 · critical · fixed in `fc70d49` · open for two releases**

`isFirstPerson` was case-sensitive. The pattern listed `I` in capitals and
everything else in lower case, so a sentence *beginning* with "We" or "Our" or
"My" — which is how most first-person sentences begin — was never detected. A
passage from the archive could reach a spoken turn unattributed, which is
precisely what `assertThirdPerson` exists to prevent.

*Found by:* a release-blocking evaluation, `live-no-first-person`, which failed
**intermittently** depending on which memory retrieval happened to select.

That is the part worth dwelling on. It looked like a flaky test three times
before anybody looked properly. The instinct on an intermittent failure is to
re-run it; the instinct was wrong, and the evaluation was right every time.

*Fix:* case-insensitive matching, with "US" the country excluded by hand as the
only false positive it introduces.

---

## AL-003 — A preference question answered from an incidental word

**3 September 2026 · high · STILL OPEN**

The written composer selects any sentence sharing one content word with the
question. Seeding a single memory containing the word *food* made "What was her
favourite food?" answer with a citation instead of abstaining, dropping
abstention from 100% to 80%. The spoken path was stricter and did not answer,
so the two paths disagreed about the same question.

*Found by:* the abstention evaluation, on a **corpus change rather than a code
change** — which is its own finding. A guarantee that depends on what happens
to be in the archive is not a guarantee.

*Status:* open. Two fixes were tried and measured, and both were worse:
requiring two matched words broke three legitimate citations, and requiring the
question's rarest word broke four. The fixture was reworded and the defect left
as found, so the gate stays honest about the composer rather than about the
corpus. The real fix is a relevance judgement rather than token overlap, which
is a change to the retrieval path.

---

## AL-004 — A symbol brand did not prevent splicing

**6 September 2026 · critical · fixed in `47c2a58`**

The first attempt at making splicing uncompilable used a `unique symbol` brand.
**Object spread preserves a symbol brand at the type level**, so
`{ ...clip, endMs: other.endMs }` — taking one moment and extending its end to
reach another, precisely the splice the brand existed to prevent — still
typechecked.

*Found by:* the type-level test written in the same commit, which reported two
`@ts-expect-error` directives as *unused*. The design was reasoned about
carefully and was wrong; nothing but writing the actual attack would have shown
it.

*Fix:* a class with a native private field and a private constructor, which
makes the type nominal. A spread produces a plain object that will not assign
back — `TS2739: missing #unaltered`.

---

## AL-005 — The export nobody could open

**6 September 2026 · high · fixed in `3db24d7` · open since v0.1**

`STORAGE_LOCAL_DIR` was resolved with `resolve('./var/storage')`, which is
relative to `process.cwd()`. This repository runs four processes from four
working directories. The worker therefore wrote uploads and exports into
`apps/worker/var/storage` while the API looked for them in
`apps/api/var/storage`, and in local development **every export 404ed on
download and every recording in the demonstration archive was unplayable** —
including the audio behind "hear them talk about it", which is the feature the
release exists for.

*Found by:* an end-to-end test that downloaded a real export and opened it,
rather than asserting the route returned 200.

That is the whole finding. Three releases of tests passed over this because the
integration suite runs everything in one process with one working directory,
which is exactly the condition under which the bug is invisible, and because
production requires S3, where keys are absolute. A test can be thorough about
behaviour and silent about deployment.

*Fix:* relative shared directories resolve against the workspace root, found by
walking up from the config package's own file rather than from whoever is
running — the one path that does not change with the caller.

---

## AL-006 — The check that checked nothing

**6 September 2026 · medium · fixed in `3db24d7`**

`scripts/check-adversarial-log.ts` — the script on this page's own first
section, the one that is supposed to stop an entry quietly becoming a story —
searched the *whole file* for an `OPEN` marker instead of the entry's own
`fix` field. Because AL-003 is marked OPEN, every other unfixed entry passed
too. The check reported success while checking nothing.

*Found by:* adding a second unfixed entry and noticing the check did not
complain.

*Fix:* per entry, against that entry's own field. Verified by adding an
unmarked open entry and watching the build go red while AL-003 stayed OPEN.

It belongs in this log rather than being fixed quietly. A trust mechanism that
was not doing its job is exactly the kind of thing a product in this category
has an incentive to correct without mentioning.

---

## What these six have in common

Every one was found by a test, and not one by reading the code. Most were in
mechanisms that had been written carefully, reviewed, and documented as
guarantees — one of them was the mechanism guarding this log.

Three of them looked like something else first: AL-002 looked like flakiness,
AL-003 looked like a fixture problem, and AL-005 looked like a stale cache in
the development environment. Every one of those instincts was wrong, and each
was the cheap explanation reached for before looking properly.

AL-005 adds a second lesson to the first. A suite can be exhaustive about
behaviour and silent about deployment: everything ran in one process, so
nothing had ever asked one process for a file another process wrote.

The lesson the codebase took from this is in `CLAUDE.md`: **write the attack,
not the argument.**

---

## Contributing

Found a way to make this system fabricate? Open an issue. An entry here with a
pinning test is worth more to this product than a feature.
