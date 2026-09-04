# Real-time conversation: traceability matrix

Every requirement from the v0.2 brief, where it lives, and what proves it.
Paths were checked against the tree; test names are the actual assertions.

Status: **done** · **partial** (works, with a stated limit) · **interface only**
(complete and type-checked, never executed against the real provider) ·
**not built**.

Evidence at the last full run: **398** unit and integration tests, **88**
browser tests across two viewports, **48/48** evaluation cases with six
release-blocking metrics met, typecheck, lint and format clean.

---

## Mode A — the live story interview

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Storyteller speaks; a clearly-identified AI interviewer replies | `components/live-conversation.tsx` identity notice; `ASSISTANT_IDENTITY` | E2E "You are talking to an AI assistant", "It is not Kamala Deshpande" | done |
| One gentle question at a time | `nextInterviewQuestion`; interview branch of `LocalStreamingLanguageModel` | `streaming.test.ts` "asks a question and never asserts a fact"; eval `live-interview-asks` | done |
| English / Hindi / Hinglish code-switching | `detectLanguage`; Devanagari exact, Hinglish by marker words | `streaming.test.ts` three language cases | done |
| Skip, pause, resume, "prefer not to answer", end | `session.pause` / `session.resume` / `session.end`; state machine `PAUSED` | `machine.test.ts`; E2E "keeps every voice action reachable by keyboard" | done |
| Recognises unclear dates and unresolved people | `findUnresolvedReferences` | `streaming.test.ts` "spots a pronoun that names nobody", "spots a vague date"; eval `live-interview-unresolved` | done |
| Grounded follow-ups that insert no facts | Interview clauses carry `evidenceIds: []` and are questions | `streaming.test.ts` asserts the clause cites nothing because it claims nothing | done |
| Streamed transcript the storyteller can correct | `transcript.partial` / `transcript.final`; `POST …/turns/:id/corrections` → `transcript_revision` | `realtime-slice.test.ts` correction case; revisions exported | done |
| Proposes memories after the conversation | `extractCandidates` → `storeCandidates`; `learning.summary` event | `realtime-slice.test.ts`; E2E "None of this is in your archive yet" | done |
| **Never auto-approves a biographical memory** | `candidate_only_preferences_skip_review` CHECK; `learning.candidate.approve` is storyteller-only | `authorize-realtime.test.ts` (3 roles × 4 actions); eval `live-nothing-auto-approved` | done |
| Never a therapist, never a diagnosis | `PROHIBITED_REQUEST_MESSAGE`; distress detection offers resources, not advice | `providers.test.ts` distress cases; eval `live-refuse-persona` | done |

## Mode B — the live archive assistant

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Only authorised P1–P3 evidence | `retrieval.ts` compiles obligations into the `WHERE` clause | `authorize-realtime.test.ts`; eval `cross-archive-retrieval` | done |
| Third person only | `assertThirdPerson` after server-side `attribute()`; a first-person clause is discarded and a safety event recorded | eval `live-no-first-person` over every spoken turn | done |
| Neutral licensed assistant voice, never the storyteller's | `PERMITTED_VOICE_PREFIXES`; `DEEPGRAM_VOICES` table in code; checked at assembly and again per clause | `hosted-providers.test.ts` "refuses any voice that is not on the permitted list"; eval `live-voice-permitted` | done |
| Claim-level citations shown while speaking | `assistant.citation` emitted per clause, before its audio | E2E "a citation sits with the clause it supports" | done |
| Source inspectable by timestamp / page / segment | `RealtimeCitation` carries the locator; source drawer | E2E "opening a source shows the words it came from" | done |
| The exact abstention sentence | `ABSTENTION_TEXT` | E2E asserts the sentence verbatim; eval `live-abstain-unknown`, `live-abstain-invented-person` | done |
| Never fills silence with a guess | Abstention on empty, irrelevant, contradictory or restricted evidence; `MIN_QUESTION_COVERAGE` | `streaming.test.ts` "abstains rather than returning a cited but irrelevant quotation" | done |
| Never claims to be the storyteller | `isProhibitedRequest` before retrieval; refusal text | eval `live-refuse-persona`, `live-refuse-speak-as` | done |
| Never claims consciousness or contact with the dead | Same path; system prompts state it as a prohibition | `providers.test.ts` "tells the model what it is never allowed to do" | done |

## What "learn automatically" means

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Short-lived session context | `learning_policy.sessionContext`; history passed per turn, never persisted as a profile | `learning.test.ts` | done |
| Automatic extraction of candidates, people, places, dates, preferences, unresolved references | `candidates.ts` `extractCandidates` | `realtime-slice.test.ts`; E2E `/learned` | done |
| Each candidate linked to the exact turn or source | `memory_candidate_evidence.turn_id` + trigger refusing non-final turns | eval `live-evidence-is-real` | done |
| Duplicate and contradiction detection | `findDuplicate` (bidirectional coverage); `contradicts_memory_ids` | `realtime-slice.test.ts` duplicate case | done |
| Sensitive and biographical candidates go to review | `requires_storyteller_review` default true + CHECK constraint | `learning.test.ts` `candidateRequiresReview` | done |
| Indexes only what consent authorises | `approval.ts` enqueues `embed_memory` only on approval | `pipeline.test.ts` "approval is what makes a memory answerable" | done |
| Explicit opt-in auto-save, narrow class only | `LOW_RISK_PREFERENCE_KEYS` (6); `interaction_preference` CHECK allow-list | `learning.test.ts`; E2E "This is the whole list" | done |
| Corrections create new versions with provenance | `transcript_revision`, `memory.version`, `was_corrected` | `realtime-slice.test.ts`; revisions in the export | done |
| Retrieval updates immediately after an approved change | `embed_memory` enqueued in the same transaction as approval | `pipeline.test.ts` | done |
| Inspect, edit, revoke, export, delete everything | `/learned`, `/learning`, `/account/preferences`; export bundle; deletion plan | `realtime-slice.test.ts` "everything the conversation remembered can be taken back" (5 cases) | done |
| **The base model never retrains** | No training path exists; `mip_opt_out=true` hard-coded; factory refuses `permitsModelTraining`; config refuses it | `hosted-providers.test.ts` "opts out of model training on every connection"; `load.test.ts` | done |

## Architecture

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Four memory layers, physically separated | Turn context (in process) · `realtime_turn` · `memory_candidate` · `memory` | Migration `0009` + `0010`; RLS over 15 tables | done |
| Learning policy separate from consent, consent is the ceiling | `packages/consent/src/learning.ts` `resolveLearningObligations` intersects with consent | `learning.test.ts` (26 cases); `authorize-realtime.test.ts` "reports a consent refusal before a learning refusal" | done |
| Pure, exhaustively tested session state machine | `packages/realtime/src/machine.ts` — 13 states, transitions exhaustive by construction | `machine.test.ts` (16 cases) | done |
| Typed provider interfaces, each with a deterministic local implementation | `streaming/types.ts` + `streaming/local.ts`; `providers.ts` + `local.ts` | The entire product runs with no credentials | done |
| A small, strict Claude tool surface | Six proposal tools, `strict: true`, `additionalProperties: false`. No database, shell, HTTP or code-execution tool | `hosted-providers.test.ts` "refuses a tool the product does not offer" | done |
| ~15 new tables | 16 across `0009` and `0010`; 67 tables total, 43 forced-RLS | Migration checksums; RLS block | done |
| Versioned transport events | `REALTIME_PROTOCOL_VERSION`; mismatch closes the socket | `realtime-transport.test.ts` protocol-version case | done |
| Latency and cost instrumentation | `realtime_turn.latency`; `realtime_provider_usage`; `readSpend` | `realtime-slice.test.ts` usage case; `GET …/usage` | done |
| WCAG 2.2 AA | Five new screens scanned with axe, including live mid-conversation | `accessibility.spec.ts` — 36 tests, zero violations | done |

## The 34 deliverables

| # | Deliverable | Where | Status |
|---|---|---|---|
| 1 | Audit and baseline verification | `REALTIME_BUILD_PLAN.md` | done |
| 2 | Architecture and transport decision | `REALTIME_DECISION_LOG.md` RT-001…RT-002 | done |
| 3 | Session state machine | `packages/realtime/src/machine.ts` | done |
| 4 | Consent actions for realtime | `packages/contracts/src/actions.ts`; `matrix.ts` | done |
| 5 | Learning policy document and engine | `packages/consent/src/learning.ts` | done |
| 6 | Migrations for the conversation layer | `0009_realtime.sql` | done |
| 7 | Migrations for the learning layer | `0010_learning.sql` | done |
| 8 | Provider interfaces | `packages/ai/src/streaming/types.ts` | done |
| 9 | Deterministic local providers | `streaming/local.ts`; `realtime/local.ts` | done |
| 10 | Session driver | `apps/api/src/realtime/driver.ts` | done |
| 11 | Turn orchestrator with per-clause verification | `orchestrator.ts` | done |
| 12 | Retrieval under obligations | `retrieval.ts` | done |
| 13 | Candidate extraction and storage | `candidates.ts` | done |
| 14 | Approval promoting a conversation to a real source | `approval.ts` | done |
| 15 | REST surface | `routes.ts` — 17 paths, 89 operations total | done |
| 16 | WebSocket media plane | `ws.ts` | done |
| 17 | Barge-in and cancellation | `CancellationToken`; `interruption_event` | done |
| 18 | Browser client | `apps/web/src/lib/realtime-client.ts` | done |
| 19 | Live conversation screen | `components/live-conversation.tsx` | done |
| 20 | Learning policy editor | `components/learning-policy-editor.tsx` | done |
| 21 | Candidate review | `components/candidate-review.tsx` | done |
| 22 | Preference manager | `components/preference-manager.tsx` | done |
| 23 | Production STT adapter | `streaming/deepgram.ts` | interface only |
| 24 | Production streaming LLM adapter | `streaming/anthropic.ts` | interface only |
| 25 | Production TTS adapter | `streaming/deepgram.ts` | interface only |
| 26 | Reconnection and idempotency | reconnect tokens; `(session_id, client_event_id)` unique | done |
| 27 | Backpressure and session limits | `MAX_BUFFERED_BYTES`; `MAX_CONCURRENT_SESSIONS_PER_USER`; `IDLE_TIMEOUT_MS` | done |
| 28 | Cost limits and circuit breakers | `checkBudget`; `packages/realtime/src/breaker.ts` | done |
| 29 | Cross-instance cancellation and revocation | `endLiveSessions` + five-second sweep | done |
| 30 | Learning lifecycle: dedup, contradictions, corrections, revocation | `candidates.ts`; `transcript_revision`; deletion plan | done |
| 31 | Export and deletion of everything remembered | `handlers/lifecycle.ts` | done |
| 32 | Realtime evaluations | `evals/gold-set.ts` `LIVE_CASES`; six release-blocking metrics | done |
| 33 | Accessibility and responsive QA | `accessibility.spec.ts`; two viewports throughout | done |
| 34 | `CLAUDE.md` and the handoff documents | repository root; `docs/REALTIME_*` | done |

## What is deliberately absent

Each of these is a prohibition, not a gap. The strongest form of "we do not do
this" is having nowhere to put it.

| Prohibited | Why it cannot happen here |
|---|---|
| Voice cloning of anyone | No voiceprint column exists; the voice table is fixed in code; `isPermittedVoice` is checked at assembly and per clause |
| Face cloning, avatars, lip-sync | No such code, no such column, no such dependency |
| First-person persona chat | `isProhibitedRequest` runs before retrieval; `assertThirdPerson` after composition |
| Posthumous simulation | `FEATURE_PERFORM_MODE` fails configuration validation in every environment |
| Automatic death or incapacity transitions | `FEATURE_SUCCESSION_EXECUTION` likewise |
| Shared-model training on private memories | `mip_opt_out=true`; factory refuses a provider that permits training; `modelTraining: true` refused by name before schema validation |
| Cross-archive memory | Forced RLS on 43 tables; `set_config('everecho.archive_id', …)` per transaction; eval `cross-archive-rls` |
| Advertising on, or sale of, memory data | No advertising or data-sharing code path exists |
| Profiles for minors | `subjectIsAdult` required at archive creation |
| Silent storage of audio or transcripts | `realtime_audio_storage_requires_consent` CHECK; the live screen states what is kept before anything is listening |
| Memory text in logs, analytics or traces | Reason codes only; analytics props admit numbers, booleans and a severity enum by schema |
| Provider keys in the browser | Adapters are server-side only; the browser holds a session cookie |
| Generic database, shell, HTTP or code-execution tools for the model | Six proposal tools, and an unknown tool name is dropped rather than honoured |
