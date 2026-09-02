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

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Propose photos, documents, dates, places, people, corrections, notes, alternate accounts | | | planned |
| No silent overwrite of an approved memory | | | planned |
| Every proposal carries provenance, source consent, status, approval | | | planned |
| Contradictions surfaced, not resolved | | | planned |
| Original and every correction version preserved | | | planned |

### Slice 3: Capsules, gift and reservation

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Recipient-scoped capsule with expiry, embargo, download denial | | | planned |
| Immediate revocation and access audit history | | | planned |
| Authentication by default; scoped expiring tokens only when enabled | | | planned |
| No indexing, public metadata, previews or private text in notifications | | | planned |
| A capsule never broadens the consent of its sources | | | planned |
| Buyer may reserve; cannot consent for the storyteller or gain access by paying | | | planned |
| Private acceptance and private decline | | | planned |
| Refund / reservation-release state; no card data stored | | | planned |

### Slice 4: Gap radar, missions, multilingual

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Coverage detection for people, dates, places, conflicts, unfinished stories | | | planned |
| Dismiss, skip, snooze, never ask again | | | planned |
| No sensitive inference, no legacy score, no pressure | | | planned |
| English, Hindi, Hinglish with the original preserved | | | planned |
| Translation stored as a separately labelled derived artefact citing the original | | | planned |
| Named entities preserved; user can correct script and detection | | | planned |
| Honest failure when a language combination is unsupported | | | planned |

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
