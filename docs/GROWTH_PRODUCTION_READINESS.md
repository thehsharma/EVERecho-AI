# EverEcho v0.3 — production readiness

Evidence labels: **VERIFIED** (executed here) · **SOURCE-SUPPORTED** ·
**INFERENCE** · **ASSUMPTION** · **UNKNOWN**.

## The short answer

**Not production-ready, and not close on the gates that matter.** The product
works end to end locally with no credentials. Real family data remains
prohibited.

This document tracks only what v0.3 changes. The v0.1 and v0.2 blockers in
`docs/PRODUCTION_READINESS.md` and `docs/REALTIME_PRODUCTION_READINESS.md`
remain open and are not restated here.

## Blockers carried forward, all still open

**VERIFIED** as unresolved:

| Blocker | Why it blocks |
| --- | --- |
| Legal review of consent and succession | Not obtained. Not substitutable by code |
| Independent security assessment | Not obtained |
| Production authentication and MFA | `AUTH_DRIVER=local` is a development credential store and fails production config validation |
| Encryption at rest with a separate key custodian | Not implemented |
| Malware scanning against a real scanner | Interface only |
| Backup restoration, actually rehearsed | Documented, never performed |
| Deletion assurance verified against real object storage | Local storage only |
| Accessibility testing with disabled users | Automated scans pass; no human testing |
| Named human accountable for consent and safety incidents | Nobody named |
| Three hosted realtime adapters | Written, never executed against a real provider |

## What v0.3 adds to the blocker list

| Blocker | State |
| --- | --- |
| Answers to family questions and gap questions are typed prose that becomes a citable source. Nothing checks it for content the storyteller would not want retained | Injection findings are counted; the text itself is stored as written. A person can put something in an answer that they would not have put in a memory, and the review queue is the only place it is caught |
| The coverage radar has never been shown to a person over sixty | The whole design turns on it not feeling like a to-do list. That is a claim about how it reads, and reading is not something a test can measure. E-06 in the experiment register is the moderated session that would settle it, status `NOT STARTED` |
| Two gap kinds are declared and undetected | `conflicting_timeline` and `thin_relationship` exist in the schema and the prompt copy with no detector behind either. Nothing claims they work; the schema would mislead somebody reading it without this note |
| Story missions have storage and no product | `story_mission` is a table with no routes and no screen |
| The written composer will answer a question it cannot answer, if the archive happens to use one of its words | **Found by the evaluations during Slice 4, and still open.** `composeAnswer` in `packages/ai/src/llm/local.ts` selects any sentence sharing at least one content word with the question. Adding a single seeded sentence containing the word *food* — "a woman on the platform who gave the children her own food" — made "What was her favourite food?" answer with a citation instead of abstaining, dropping abstention from 100% to 80%. The gold-set case caught it, which is what it is for. The spoken path is stricter (`MIN_QUESTION_COVERAGE = 0.5` over the whole passage) and did not answer, so the two paths disagree about the same question |

### On that last one

Two fixes were tried and measured, and both were worse. Requiring two matched
words broke three legitimate citations ("Where did the family move to?" is
answered by a sentence sharing only *moved*). Requiring the question's rarest
word broke four, because a question routinely uses a word the archive never
does — people say *Pune*, not *city*.

The fixture sentence was reworded to something that does not contain the word,
and the defect was left as it was found. That keeps the gate honest about the
composer rather than about the corpus: the reproduction above restores it in
one line. The real fix is a relevance judgement rather than token overlap,
which is a change to the retrieval path and not something to attempt blind at
the end of a slice.

## Traction

**VERIFIED: zero.** No customers, no paid deposits, no families, no design
partners, no revenue. Every number in `docs/GROWTH_EXPERIMENT_REGISTER.md` is a
hypothesis with status `NOT STARTED`.

The demonstration archive is synthetic and is excluded from any metric that
could be mistaken for traction.

## Readiness verdict

**Build, demonstrate and gather evidence. Do not onboard a real family.**
