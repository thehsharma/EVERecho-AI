# Traceability matrix

Every requirement from the build brief, where it is implemented, and what proves
it. Paths were checked against the tree; test names are the actual assertions.

Status: **done** · **partial** (works, with a stated limit) · **interface only**
(complete and type-checked, never executed here) · **not built**.

## Roles and authority

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Six distinct roles | `packages/consent/src/matrix.ts` `ROLE_ACTIONS` | `authorize.test.ts` covers every role | done |
| Buyer cannot consent for the storyteller | `authorize.ts` — checked before the role table so the reason is specific | `authorize.test.ts` "the buyer cannot consent…"; `consent-journey.test.ts` asserts `buyer_cannot_consent_for_storyteller` | done |
| Buyer does not become owner by paying | `archive.buyer_user_id` ≠ `storyteller_user_id`; buyer lacks `membership.revoke`, `archive.delete` | `consent-journey.test.ts` "cannot withdraw anyone's access" | done |
| Storyteller controls everything | `ACTION_REQUIREMENTS.storytellerOnly` | `authorize.test.ts`; E2E "the storyteller is in control" | done |
| Family/explorer sees only what was granted | `doc.recipients` grant lookup | `authorize.test.ts` "recipient grants"; eval `outsider-cannot-read` | done |
| Contributor proposes, never overwrites | `correction.status = 'proposed'`; `mayContribute` on the grant | `authorize.test.ts` "refuses a contribution from a family member" | done |
| Steward is narrowly delegated | `ROLE_ACTIONS.steward` — 7 actions, no content | `authorize.test.ts` "the steward is not the owner" | done |
| Admin has no standing content access | `authorize.ts` returns `admin_scope_metadata_only`; break-glass required | `authorize.test.ts` "administrators have no path to memories"; E2E support tools | done |
| Every check server-side | `withArchiveAccess` is the only source of a scoped transaction | All 48 integration tests | done |

## The 27 required journeys

| # | Journey | Where | Proof | Status |
|---|---|---|---|---|
| 1–3 | Buyer signs up, creates an archive, invites a storyteller | `modules/auth.ts`, `archives.ts`, `invitations.ts` | `consent-journey.test.ts` | done |
| 4–5 | Storyteller receives it independently and may decline privately | `GET/POST /v1/invitations/:token`; `decline_reason` never sent to the inviter | `consent-journey.test.ts` "refuses an invitation opened by someone it was not addressed to" | done |
| 6 | Consent teach-back | `packages/consent/src/teachback.ts`; `modules/consent.ts` | `policy.test.ts`; `consent-journey.test.ts` "teaches rather than blocks" | done |
| 7 | Storyteller chooses initial permissions | `PUT /v1/archives/:id/consent`; `components/consent-editor.tsx` | `consent-journey.test.ts` "activates the archive once consent is granted" | done |
| 8 | Guided browser-audio interview or text | `modules/interviews.ts`; `components/interview-panel.tsx` | Unit tests on question selection; interface exercised in E2E a11y scan | partial — MediaRecorder capture is not driven by an automated test |
| 9 | Uploads | `modules/sources.ts`; `lib/upload.ts` | `pipeline.test.ts` "quarantines an upload…" | done |
| 10 | Per-source privacy and processing choices | `sourcePrivacyChoicesSchema`; `PATCH …/privacy` | `authorize.test.ts` "per-source and per-topic control" | done |
| 11 | Immutable original stored | `handlers/ingest.ts` `scanSource`; `asset_version` | `pipeline.test.ts` asserts checksum and promotion | done |
| 12 | Authorised transcription/OCR, asynchronous | `transcribeSource`, `ocrSource` | `pipeline.test.ts` "produces a transcript whose words are exactly what was captured" | done |
| 13 | Candidate extraction | `extractCandidates` | `pipeline.test.ts` "quotes the source exactly in every claim" | done |
| 14 | Storyteller reviews and corrects | `POST …/memories/:id/review`; `PATCH …/memories/:id` | `pipeline.test.ts`; E2E review queue | done |
| 15 | Approved memories become searchable | `embedMemory` runs on approval only | `pipeline.test.ts` "approval is what makes a memory answerable" | done |
| 16 | Source-linked timeline | `handlers/derive.ts` `buildTimeline` | `pipeline.test.ts` asserts coverage and undated separation | done |
| 17 | Editable third-person biography | `composeBiography`; `assertThirdPerson` | `pipeline.test.ts` asserts no first person outside quotes | done |
| 18–19 | Family invited, receives only authorised access | `invitations.ts`; recipient grants | `pipeline.test.ts`; eval boundary cases | done |
| 20–21 | Evidence-supported question with claim-level citations | `modules/qa.ts` | `pipeline.test.ts`; eval citation cases at 100%; E2E opens a citation | done |
| 22–23 | Unsupported or restricted question abstains | `qa.ts` abstention paths | eval `abstain-*` at 100%; E2E abstention | done |
| 24–25 | Revocation affects UI, API, retrieval and links at once | `PATCH …/members/:id` clears caches; RLS and grants re-evaluated per request | `pipeline.test.ts` "withdraws access, and every route stops answering at once" | done |
| 26 | Export | `handlers/lifecycle.ts` `runExport`; `zip.ts` | `pipeline.test.ts` asserts a real zip with manifest and checksums | done |
| 27 | Deletion with visible progress | `runDeletion`; `components/lifecycle.tsx` | `pipeline.test.ts` asserts every step done and all content gone | done |

## Screens

All 33 required screens exist under `apps/web/src/app`. The public set
(landing, how-it-works, trust, pricing, sign-in, sign-up, support, demo) and all
16 archive screens pass automated WCAG 2.2 AA scans with zero violations
(`tests/e2e/accessibility.spec.ts`).

Succession is present and labelled as a recorded directive that never executes.

## Consent architecture

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Five modes, `perform` hard-disabled | `consentModeSchema`; refused by `loadConfig`, `compileConsentPolicy` and a DB `CHECK` | `load.test.ts`, `policy.test.ts`, `consent-journey.test.ts` | done |
| Consent covers 20+ dimensions independently | `consentPolicyDocumentSchema` | `authorize.test.ts` mode/activity/category/recipient matrices | done |
| Voice and likeness denied by default and ungrantable | `voiceAndLikeness` forced false in the compiler; DB `CHECK` | `policy.test.ts` "refuses a granted synthetic voice" | done |
| Pure `authorize()` | `packages/consent/src/authorize.ts` — no I/O | `authorize.test.ts` "is a pure function of its inputs" | done |
| Called before reads, links, prompts, generation, exports, jobs, admin | `withArchiveAccess`; `assertProcessingAllowed` | 48 integration tests | done |
| Workers re-check current consent | `packages/pipeline/src/context.ts` | `runner.ts` marks `consent_revoked` as cancelled, not failed | done |
| Buyer and storyteller onboarding separate | Distinct routes; accepting ≠ consenting | `consent-journey.test.ts` | done |
| Teach-back answers, versions, hashes, actor, context stored | `teach_back_result`, `consent_record`, `consent_policy` | `consent-journey.test.ts` "keeps every consent version" | done |
| Revocation: audit, caches, links, retrieval, jobs, future generation | `modules/archives.ts` and `consent.ts` | `pipeline.test.ts` revocation test | done |
| Succession never triggered by inactivity | No inactivity code path exists; `execution_enabled` is a DB `CHECK` pinned false | `succession` screen; schema constraint | done |

## Ingestion and provenance

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Full pipeline order | `handlers/ingest.ts` | `pipeline.test.ts` end to end | done |
| Every unit retains source, version, locator, method, model, prompt, policy, approval, corrections | `claim_evidence` columns | `pipeline.test.ts`; export contains them | done |
| P0–P5 classes with MVP rules | `evidenceClassSchema`; `response_claim` `CHECK` limits to P1–P3 | `verify.test.ts` "never returns a prohibited evidence class" | done |
| UI distinguishes original, transcription, correction, corroboration, synthesis, uncertainty, contradiction, prohibited | `ProvenanceTag`, `EvidenceClassTag`, contradiction notices | E2E "drafts marked as drafts" | done |

## AI interviewer and Q&A

| Requirement | Implementation | Proof | Status |
|---|---|---|---|
| Versioned system prompt, one question at a time, skippable | `packages/ai/src/prompts/interview.ts` | `providers.test.ts` | done |
| Follows unresolved references; never inserts facts | `LocalLlmAdapter.nextQuestion`, `unresolvedReferences` | `providers.test.ts` "records an unresolved reference instead of guessing" | done |
| Distress handling stops the flow, shows regional resources | `detectsDistress`, `interviews.ts` safety branch | `providers.test.ts`; `safety_event` carries no content | done |
| Interviewer test set (skips, contradictions, distress, injection, persona) | `providers.test.ts`, `gold-set.ts` | 145 unit + 32 eval cases | done |
| Q&A pipeline in the required order | `modules/qa.ts` | `pipeline.test.ts`; evals | done |
| Never sends unauthorised evidence to the model | Consent filter in the SQL `WHERE` | eval `cross-archive-retrieval`, `candidate-not-answerable` | done |
| Structured response contract | `generatedResponseSchema` | Response validated against its contract on every request | done |
| P1–P3 only; third person; abstention wording | `response_claim` `CHECK`; `assertThirdPerson`; `ABSTENTION_TEXT` | evals; E2E | done |
| Injection isolation, contradiction detection, snapshots, verification, versioning, immutable records | `injection.ts`, `verify.ts`, `retrieval_snapshot`, `generated_response` | `verify.test.ts`, `providers.test.ts`, evals | done |
| Eval targets: ≥95% citation, <1% unsupported, 100% abstention, zero leakage | `apps/api/evals/` | **Measured: 100%, 0.00%, 100%, 0** | done |

## Privacy and security

| Requirement | Status | Where |
|---|---|---|
| TLS, encryption at rest, KMS envelope encryption | **not built** (TLS/at-rest are deployment; envelope encryption would go in the storage adapter) | `DEPLOYMENT.md`, `PRIVACY_ENGINEERING.md` |
| Tenant/archive isolation, RLS | done — 28 tables under `FORCE ROW LEVEL SECURITY` | `0006_rls.sql`; verified in tests and evals |
| Least privilege, separated environments | documented | `DEPLOYMENT.md` |
| MFA / passkey-ready | **partial** — columns and adapter boundary exist; enrolment flow not built | `app_user.mfa_*`, `AUTH_DRIVER` |
| Session revocation, recovery controls | done (revocation); password reset **not built** | `modules/auth.ts` |
| Rate limiting | done, per account where known | `server.ts` |
| Upload validation, malware scanning, quarantine | done (local scanner is not an antivirus) | `scanning.ts`, `scanSource` |
| Private storage, expiring signed URLs, download auditing | done | `storage.ts`, `sources.ts` |
| CSRF, XSS, SSRF, SQL injection, IDOR, CSP, security headers | done — parameterised SQL throughout; no user-controlled outbound URLs; CSP and headers via helmet; IDOR covered by RLS plus per-resource re-checks | `server.ts`, integration tests |
| Webhook signature verification | done for the local adapter; **interface only** for Stripe (fails closed) | `billing.ts` |
| Log redaction, no-training defaults, provider retention | done | `audit.ts`, `config/schema.ts` |
| Export, deletion propagation | done | `lifecycle.ts` |
| Backups, restore, disaster recovery, shutdown portability | documented, **unrehearsed** | `BACKUP_RESTORE.md`, `SHUTDOWN_PORTABILITY.md` |
| Dependency and secret scanning | done in CI | `.github/workflows/ci.yml` |
| Threat model, incident response | done | `THREAT_MODEL.md`, `INCIDENT_RUNBOOK.md` |

## Emotional safety

| Requirement | Where | Status |
|---|---|---|
| Generated content identified as AI-assisted | `ProvenanceTag`, `aiAssisted` on every response | done |
| Never claims the storyteller is speaking | `assertThirdPerson`; `perspective` DB `CHECK` | done |
| No guilt reminders, no engagement mechanics | No notification scheduler exists; no streaks, counts or nudges anywhere | done |
| Pause and exit everywhere | Interview pause/skip/prefer-not-to-answer; private decline | done |
| Sensitive topics need explicit consent; embargo supported | `sensitivity`, `embargo_until`, `restrictedTopics` | done |
| Dispute freezes distribution without deleting sources | `dispute_hold` | done — `authorize.test.ts` |
| Self-harm path stops the flow and shows regional information | `interviews.ts` | done |

## Deliverables

All 35 deliverables from the brief exist. The exceptions worth naming: Docker
Compose and the Dockerfiles are authored and syntax-validated but **never
executed**; the ERD is a text diagram in `ARCHITECTURE.md` rather than a
rendered image.
