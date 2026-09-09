# EverEcho v0.3 — growth traceability matrix

Every v0.3 requirement, where it is implemented, and what proves it.

Status: **done** · **partial** (works, with a stated limit) · **planned** (not
built yet) · **gated** (deliberately not built pending evidence or legal
review).

Updated after each vertical slice. Nothing is marked done before its tests run.

---

## P0 — the family growth engine

### Slice 1: Family Question Inbox

**Status: done.** 26 integration tests, 18 browser tests across two viewports,
4 accessibility scans with zero violations.

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Authorised family member submits a question | `POST /v1/archives/:id/family-questions`; `familyQuestion.create` | `family-questions.test.ts` "lets an authorised family member ask"; E2E "sends a question and sees it waiting" | done |
| Membership, topic restriction, sensitivity ceiling and current consent checked | `withArchiveAccess` → pure `authorize()`; restricted-topic check on both the topic hint and the question text | "reports the archive as missing to a stranger", "refuses a question about a subject the storyteller closed", "refuses it however the asker labels the topic" | done |
| Question reaches the storyteller's private inbox only | `listInboxQuestions` (storyteller) vs `listAskedQuestions` (own only); inbox route refuses a non-storyteller | "refuses the inbox to a family member", "refuses the inbox to the person who paid", "shows a relative only their own questions" | done |
| Answer, skip, decline, mark private, defer, restrict to recipients | `respondToFamilyQuestionRequestSchema` discriminated union; `visibility` enum | "shows a restricted answer to the named recipient and to nobody else", "keeps a privately-answered question private from the asker", "refuses a restricted answer with nobody named" | done |
| Extracted content becomes a provenance-linked candidate, never silent fact | Answer promoted to `source_asset` + `transcript` + `transcript_segment`; `storeCandidates` with a `question_answer` origin | "promotes the answer to a real, citable source and suggests nothing as fact"; "links every suggestion to the answer it came from" | done |
| Storyteller approves, edits or rejects | Existing `/memory-candidates/:id/approve`, generalised to answer-derived candidates | "turns an approved answer into retrievable, citable evidence" | done |
| Asker receives the answer with provenance and claim-level citations | `askedQuestionSchema` carries the source; the question screen renders a citation chip | "shows the asker the answer with a source they can open" | done |
| Approved knowledge updates retrieval immediately | `embed_memory` enqueued in the same transaction as approval | "answers a family member’s question from it, with a citation"; "still abstains on something the answer did not cover" | done |
| Revocation blocks UI, API, retrieval, signed links and downloads at once | Membership revocation, re-checked per request with no cache | "stops a revoked relative asking, reading and seeing answers already given" | done |
| Content-free funnel events | `family_question_asked`, `family_question_decided` — counts, booleans and enums only | Analytics schema refuses strings by construction | done |
| All required states rendered | empty, loading, pending, answered, declined, private, restricted, approval-required, revoked, failed | `question-composer.tsx`, `question-inbox.tsx`; E2E covers each visible state | done |
| Archive isolation | Forced RLS on both new tables | "never returns one archive’s questions in another’s scope" (scoped and unscoped) | done |
| A private decline stays private | `decline_reason` never selected by an asker-facing query | "tells the asker the question is closed and nothing else"; asserts the reason appears nowhere in the payload | done |

### Slice 2: Contributor mode

**Status: done.** 14 integration tests, 23 browser tests across two viewports,
4 accessibility scans with zero violations.

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Propose photos, documents, dates, places, people, corrections, notes, alternate accounts | `contributor_proposal.kind` — eight kinds; `POST /v1/archives/:id/contributions` | `contributions.test.ts` "lets a contributor propose"; E2E covers the kind selector | done |
| No silent overwrite of an approved memory | Approval is a separate act by the storyteller; a correction writes `previous_value` first; an alternate account writes nothing to the original | "records the previous value, bumps the version and reaches retrieval"; "stands beside the original" asserts the target is byte-identical after approval | done |
| Every proposal carries provenance, source consent, status, approval | `proposal_evidence` with `first_hand`; the proposal becomes a `source_asset` on approval so the second account is citable | "the second account is citable, and the citation says whose it is" | done |
| Contradictions surfaced, not resolved | `contradicts_memory_ids` at proposal time; a `contradiction` row linking both claims, left `open` | "the disagreement is surfaced at proposal time, before anyone decides"; contradiction status asserted `open` | done |
| Original and every correction version preserved | `correction.previous_value`; `memory.version` incremented; `was_corrected` set | "records the previous value…" asserts version 2 and the 1962 original still present | done |
| A contributor cannot decide their own proposal | `contribution.approve` is storyteller-only; the review screen renders decisions only when the API reports the capability | "refuses to let them approve their own proposal"; E2E "is never offered a decision on their own suggestion" | done |
| Contributing is a grant, not a role | `CONTRIBUTION_ACTIONS` gated on `mayContribute` in `authorize()` | "refuses a family member who was not given permission to contribute" | done |
| Archive isolation | Forced RLS on both new tables | "never returns one archive’s proposals in another’s scope" | done |

### Slice 3: Capsules, gift and reservation

**Status: done.** Capsules: 15 integration tests, 15 browser tests, 2
accessibility scans. Gift and reservation: the buyer/consent separation and
private decline were already enforced in v0.1; what v0.3 adds is the link
between the decline and the money.

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Recipient-scoped capsule with expiry, embargo, download denial | `story_capsule` + `capsule_grant`; `requireOpenCapsule` re-checks all four on every read | `capsules.test.ts` "will not open before its time", "will not open after it expires" | done |
| Immediate revocation and access audit history | `POST …/revoke`; `capsule_access_event` records opens *and* refusals | "stops the moment it is withdrawn"; "records who opened it and who was turned away" | done |
| Authentication by default; scoped expiring tokens only when enabled | Every route is `auth: 'required'` behind `withArchiveAccess`. **No token path exists at all** — there is no public capsule and no "anyone with the link" mode, and the schema offers no way to ask for one | "reports it as missing to somebody outside the archive" | done |
| No indexing, public metadata, previews or private text in notifications | No public route; analytics carry counts only; the revocation reason is never returned to a recipient | "the reason the storyteller gave is not sent to the recipient" | done |
| A capsule never broadens the consent of its sources | The reader's own sensitivity ceiling is applied to the capsule's contents on every open | "drops a story that was made more private after the capsule was built" | done |
| Taking a copy is separate from reading | `capsule.download` gated by the `export` activity, the grant's `mayExport` and the capsule's own `allowDownload` | `EXPORTING_ACTIONS` in `authorize()`; stated in the UI at the moment of the decision | done |
| Only a storyteller may make one | `capsule.create` is storyteller-only; the screen offers creation only when the API reports the capability | "refuses to let a family member make one"; E2E "is not offered a way to make one" | done |
| Archive isolation | Forced RLS on all four new tables | "never returns one archive’s capsules in another’s scope" | done |
| Buyer may reserve; cannot consent for the storyteller or gain access by paying | `buyer_cannot_consent_for_storyteller` in `authorize()`; the buyer's role holds no content rights | `authorize.test.ts`; `consent-journey.test.ts` "cannot withdraw anyone's access" | done (v0.1) |
| Private acceptance and private decline | Invitation respond; `decline_reason` never sent to the inviter | `consent-journey.test.ts` "refuses an invitation opened by someone it was not addressed to" | done (v0.1) |
| Refund / reservation-release state; no card data stored | `released` status distinct from `refunded`, with a reason code; the deposit is released automatically when the storyteller declines; the local provider signs the same webhook a real one would | `consent-journey.test.ts` "releases the deposit when the storyteller declines, and tells the buyer nothing" | done |

### Slice 4: Gap radar and answering

The detector is pure and runs over approved memories only, so it can never
surface material the storyteller has not already accepted. Answering closes the
loop through the same source → candidate → review path the interview uses.

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Coverage detection for unnamed people, vague dates, unnamed places, unfinished stories | `detectGaps` in `packages/ai/src/gaps.ts`, over approved memories only | `gaps.test.ts` "spots a person who is never named", "spots a date given only as a feeling", "spots a story that was promised and never told", "spots a place that is never named" | done |
| Conflicting-timeline and thin-relationship kinds | Declared in the schema, the CHECK constraint and `promptForGap`; **no detector emits them yet** | `gaps.test.ts` covers the prompt copy only | partial — see the handoff |
| Snooze, never ask again, resolved | `POST …/gaps/:gapId/dismiss`; `never_ask` filters the list *and* refuses the answer endpoint | Integration "does not come back once it is told never to ask again", "hides a snoozed one until its time, then offers it again", "refuses to answer one that was put away for good"; E2E "a question put away for good does not come back" | done |
| No sensitive inference | The detector reports absences of detail in a sentence, never the absence of a subject | `gaps.test.ts` "says nothing about a life that is simply short on entries", "infers nothing about health, money, belief or relationships" | done |
| No legacy score, no percentage, no streak | No such column, contract field, response field or UI element exists | Integration "never reports a score, a percentage or a completeness verdict"; E2E "shows questions about the archive, and never a score" scans the whole page for any measure | done |
| No pressure | "Not now" and "Never ask again" sit beside answering at the same weight, with no confirmation step and no persuasion; the list is capped at three until asked to show more | E2E "offers ‘never ask again’ at the same weight as answering"; `gaps.test.ts` "invites rather than reports a deficiency" | done |
| Does not ask who the storyteller is | A bare pronoun becomes a question only when it acted on the narrator or the family (`INTERACTION`) | `gaps.test.ts` "does not ask who the storyteller is", "still asks when the pronoun acted on the family" | done |
| Does not ask about somebody the sentence already names | `isNamedInPlace` suppresses a relation followed by a capitalised name | `gaps.test.ts` "does not ask who a relation is when the sentence already says", "does not treat the next sentence’s first word as the name" | done |
| Answering produces a source, never a memory | `promoteGapAnswerToSource` writes `source_asset` + `transcript` + `transcript_segment`; extraction runs under the learning policy and leaves candidates pending | Integration "keeps the answer as a real source, with a transcript that can be cited", "writes no memory of its own — everything waits for a decision" (measured against the database), "leaves anything it suggests in the review queue, tied back to the question" | done |
| Exactly one candidate origin | `memory_candidate_has_one_origin` widened to three columns; `originColumns()` derives them in one place | Integration asserts `session_id` is null on a gap-answer candidate; the CHECK is the enforcement | done |
| Storyteller only | `memoryGap.read/answer/dismiss` are all `storytellerOnly: true`; the nav entry is gated on the reported capability | Integration "keeps it to the storyteller", "lets nobody else answer for the storyteller"; E2E "nobody but the storyteller is offered it" | done |
| Accessible at WCAG 2.2 AA | The list and the open answer box, on two viewports | `accessibility.spec.ts` "the questions, and one of them open to answer" — zero violations | done |
| English, Hindi, Hinglish with the original preserved | | | planned |
| Translation stored as a separately labelled derived artefact citing the original | | | planned |
| Named entities preserved; user can correct script and detection | | | planned |
| Honest failure when a language combination is unsupported | | | planned |
| Story missions | `story_mission` table exists; **no routes and no screen** | — | planned |

---

## P1 — trust, portability and durable value

| Requirement | Status |
| --- | --- |
| Family knowledge graph with provenance on every edge | planned |
| Portable archive package with omissions recorded but not disclosed | planned |
| Signed integrity manifest (ordinary crypto; no blockchain, tokens or NFTs) | planned |
| Print-ready memory book and secure QR lifecycle | planned |
| Opt-in family timeline calendar, no grief targeting | planned |
| Legacy steward directive — workflow states only, activation legally gated | planned |
| Consent-controlled imports from user-supplied exports only | planned |

---

## P2 — expansion, behind evidence gates

| Requirement | Status |
| --- | --- |
| Founder / family-business vault | **gated** — needs 3 paid design partners (E-10) |
| Institutional oral-history workspace | **gated** — needs a committed design partner |
| Consent and provenance API/SDK | **gated** — needs the internal policy engine independently reviewed and used in production |

---

## Prohibitions, and what makes each structural

Carried forward from v0.1 and v0.2 and re-verified for every v0.3 surface.

| Prohibited | Mechanism |
| --- | --- |
| Voice or face cloning, avatars, lip-sync | No column can hold a voiceprint; the voice table is fixed in code; `FEATURE_PERFORM_MODE` fails config validation in every environment |
| First-person persona chat, posthumous simulation | `isProhibitedRequest` before retrieval; `assertThirdPerson` after composition |
| Automatic death or incapacity transition | `FEATURE_SUCCESSION_EXECUTION` fails config validation; no inactivity timer exists |
| Scraping private accounts | Imports accept user-supplied exports only, with source-level consent |
| Shared-model training on private data | `mip_opt_out=true` hard-coded; provider factory refuses a provider that permits training |
| Advertising on, or sale of, memory data | No such code path |
| Profiles for minors | `subjectIsAdult` required at archive creation |
| Cross-archive learning or retrieval | Forced RLS on 43 tables, per-transaction scoping, evaluation case checks an unscoped connection sees zero rows |
| P4 inference or P5 simulation in a customer answer | Evidence class CHECK admits only P0–P3 for candidates; retrieval filters to P1–P3 |
| Silent storage of recordings, transcripts or inferred facts | CHECK constraint ties audio storage to consent; the capture screens state what is kept before anything records |
