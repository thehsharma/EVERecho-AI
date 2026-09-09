# Production readiness

## Verdict

**Not ready for a real family's memories. Ready to be run, reviewed and piloted
internally with synthetic data.**

What is built is genuinely built: the consent engine, provenance, isolation and
deletion are the parts most likely to be faked in a project like this, and they
are the parts with the most tests behind them. What is missing is mostly the
operational surface around them, plus four things that need a person rather than
an engineer: legal review, a security review, a real accessibility review with
disabled users, and a decision about who is accountable when something goes
wrong.

## Measured in this build

Against a real PostgreSQL 16, in the session that produced this repository:

| | Result |
|---|---|
| Unit and integration tests | **193 passing** (145 unit, 48 integration, no mocks) |
| Browser tests | **54 passing** across desktop and tablet |
| Accessibility | **0 WCAG 2.2 AA violations** on 8 public pages and 16 archive screens |
| AI evaluations | **32/32 cases passing** |
| Claim-to-citation correctness | **100%** (target ≥ 95%) |
| Unsupported material claims | **0.00%** (target ≤ 1%) |
| Abstention on no-evidence and sensitive | **100%** (target 100%) |
| Permission leaks | **0** (target 0) |
| Lint, formatting, types | Clean |

Reproduce with `pnpm verify`, then `pnpm test:e2e` against a running stack.

## Blocking before real memories go in

| # | What | Why it blocks | Who |
|---|---|---|---|
| 1 | **Legal review** of consent copy, teach-back wording, terms and the succession screen, in India, the EU, the UK and the US | Every legal string is a draft. A consent flow that is not legally sound is not consent | Counsel |
| 2 | **Independent security review**, particularly the consent engine and RLS | The isolation is tested by the people who wrote it | External |
| 3 | **Encryption at rest with a customer-managed key** | Anyone with database or backup access reads everything. The storage adapter is where it goes | Engineering |
| 4 | **Production authentication** — OIDC or passkeys, and MFA enrolment | `AUTH_DRIVER=local` is refused in production, so there is currently no production auth path | Engineering |
| 5 | **A real malware scanner** (`SCAN_DRIVER=clamav`) | The local scanner catches EICAR and type mismatches; it is not an antivirus | Engineering |
| 6 | **Rehearsed restore** | An unrehearsed backup is a plan. Recovery targets in `BACKUP_RESTORE.md` are stated, not measured | Operations |
| 7 | **Accessibility review with disabled users** | Zero axe violations is a floor, not a finding. Nobody using a screen reader has tried this | Product |
| 8 | **Named accountability** for consent and safety incidents | `INCIDENT_RUNBOOK.md` says "escalate"; there is no one to escalate to | Owner |

## Complete but never executed here

Each is implemented and type-checked; none was run, because nothing was
reachable. Verify before relying on any of it.

| Area | State | First thing to check |
|---|---|---|
| Docker Compose and images | Compose config validates; never built | `docker compose up` and watch the migrate step |
| S3 / MinIO storage | Full adapter via the AWS SDK | Upload, then a presigned download, then deletion |
| Redis cache | Full adapter | That revocation clears keys across two API instances |
| pgvector | Optional migration plus a synced column and HNSW index | That retrieval results match the portable path |
| Hosted composition (Anthropic) | Official SDK, forced strict tool use | That verification still drops unsupported claims |
| Hosted speech-to-text and OCR | Complete | That locators still point at real spans |
| SMTP email | Complete | That no memory content appears in a subject line |
| Stripe billing | Checkout and refund complete; **`verifyWebhook` returns `null`** | Wire signature verification before enabling. It fails closed, which is the safe direction |

## Known gaps, stated plainly

- **No password reset.** A user who forgets their password has no route back.
- **No MFA enrolment**, though the columns and the adapter boundary exist.
- **No notification scheduling.** Emails are sent inline; there is no digest or
  reminder system — deliberately, given how easily reminders become nudges.
- **No admin UI for incidents** beyond a read-only list.
- **Contributor proposals are recorded but there is no review queue for them.**
- **OpenTelemetry is configured but not instrumented.**
- **No backfill for changing the embedding model.** Changing
  `EMBEDDINGS_DIM` invalidates stored vectors and needs a re-embed script.
- **The local speech adapter cannot recognise speech.** It transcribes text
  captured alongside a recording and reports honestly otherwise. Real audio
  needs a provider.
- **Interview audio capture is not covered by an automated test.** MediaRecorder
  and the browser's speech recognition are exercised by hand only.
- **The ERD is a text diagram**, not a rendered image.

## What would make me comfortable piloting this

With one or two families who understand it is early, after items 1, 2, 4 and 5
above, and with:

- A named person who reads the audit trail weekly.
- A rehearsed restore.
- A rehearsed deletion, verified end to end by someone who did not build it.
- An agreement about what happens to the archives if the pilot stops — see
  `SHUTDOWN_PORTABILITY.md`.

The technical work is further along than the operational and legal work. That is
the honest summary.
