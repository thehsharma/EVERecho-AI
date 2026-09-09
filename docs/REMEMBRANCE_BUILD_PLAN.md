# EverEcho v0.4 — the remembrance release

**Presence without pretence.**

## Verified baseline

Executed at the start of this release, on
`claude/everecho-v0-1-build-awtih5` at `d68abf2`:

| Gate | Result |
| --- | --- |
| `pnpm verify` | clean |
| Unit and integration | **480 passed**, 20 files |
| AI evaluations | **48 / 48**, all six release-blocking metrics met |
| Browser suite | 153 passed, two viewports |
| Accessibility | 40 scans per viewport, zero violations |
| Migrations | 16 applied |
| OpenAPI | 107 routes |

Nothing below was assumed. Where this document says a mechanism already
exists, it was read in the repository first.

## What already exists that this release builds on

| Existing | Where | What v0.4 does with it |
| --- | --- | --- |
| `succession_directive`, with `execution_enabled` and `legal_review_status` frozen by CHECK constraints | `0002_consent.sql` | Slice 1 extends it into a per-topic, per-person directive. The two constraints stay |
| `story_capsule` with `embargo_until`, `capsule_grant`, `capsule_access_event` | `0013_capsules.sql` | Slice 3 is a sealed capsule the company cannot open early. Grants and access events are reused |
| `transcript_segment.start_ms` / `end_ms` | `0003_capture.sql` | Slice 2 is a clip: one contiguous segment span in a real recording |
| `isProhibitedRequest` + `PROHIBITED_REQUEST_MESSAGE` | `packages/ai/src/injection.ts` | Slice 4 turns the refusal from a message into a response that offers her actual voice |
| `interview_session.safety_notice_shown_at` — that it happened, never what was said | `0003_capture.sql` | Slice 5 follows the same discipline for the bereaved |
| Export pipeline and `SHUTDOWN_PORTABILITY.md` | `packages/pipeline` | Slice 6 adds the signed manifest and offline verifier |
| `authorize()` returning obligations compiled into the retrieval `WHERE` | `packages/consent` | The directive becomes an obligation, not a filter applied afterwards |

## The rule this release is built to respect

> Nothing is ever spoken in the person's voice that the person did not
> actually say.

Not paraphrased, not in their style, not stitched from fragments. Played, or
not played. Every mechanism below exists to make that structural rather than
a matter of care.

The distinction that makes the whole release buildable: **retrieved, never
generated.** Customer-facing audio is `P0_ORIGINAL_SOURCE` only — bytes from
a file the storyteller recorded. There is no code path from a language model
to a customer's speakers.

## Order, and why

| Slice | Why here |
| --- | --- |
| 1 — the ante-mortem directive | Everything after death is governed by it. Building playback first would mean building it against a permission model that does not exist yet |
| 2 — her voice, retrieved | The product. Needs the directive to know what may be heard |
| 4 — the refusal | Moved ahead of 3: it needs Slice 2 to have something to offer, and it is the highest-traffic path in the release |
| 3 — what she left on purpose | Independent of 2, and the emotionally strongest thing here. Sealed capsules are a narrow extension of machinery that already works |
| 5 — grief-literate pacing | Cross-cutting. Applied once the surfaces it paces exist |
| 6 — the archive outlives the company | Last, because it exports everything the earlier slices create |

## Definition of done, per slice

Real screens, real persistence, server-side authorisation, audit history
covering refusals as well as successes, unit and integration tests, browser
tests on two viewports, an accessibility scan at WCAG 2.2 AA with zero
violations, evaluation cases wherever behaviour is AI-dependent, and a row in
`REMEMBRANCE_TRACEABILITY_MATRIX.md` naming the test that proves it.

A slice is not done because it works. It is done when something fails if it
stops working.
