# Decision Log

Reversible implementation choices are labelled **ASSUMPTION**; anything requiring an owner,
counsel or a credential is labelled **UNKNOWN** and listed in `IMPLEMENTATION_HANDOFF.md`.

---

### D-001 — The build brief is the authoritative specification
**VERIFIED** the EverEcho company package is absent from the repository and filesystem. The brief
explicitly delegates authority in that case. If the package later lands, `PRODUCT_CONSTITUTION.md`,
`CONSENT_ARCHITECTURE.md` and `AI_ACCURACY_PROVENANCE.md` override anything here that conflicts.

### D-002 — TypeScript monorepo, packages consumed as source
**ASSUMPTION.** Workspace packages export `./src/index.ts` directly rather than a compiled `dist`.
`tsx` runs the API and worker, Next.js transpiles workspace packages, Vitest loads TS natively, and
`tsc --noEmit` typechecks the whole graph in one pass.
*Why:* removes a build-ordering failure mode entirely; no stale `dist` can ever be executed.
*Cost:* startup parses TS. *Reversal:* add `tsc -b` + an `exports` `development`/`default`
condition; no source changes required.

### D-003 — Hand-written SQL migrations over an ORM
**ASSUMPTION.** `pg` plus numbered `.sql` migrations and a small runner, not Prisma/Drizzle.
*Why:* row-level security, `FORCE ROW LEVEL SECURITY`, partial indexes, generated tsvector columns
and append-only audit triggers are all first-class in SQL and awkward-to-impossible to express
faithfully through an ORM. It also keeps the schema readable as the reviewable artefact it needs to
be for a consent-critical product. *Cost:* repository code is written by hand.

### D-004 — Durable job queue in PostgreSQL, Redis for cache and rate limiting
**ASSUMPTION**, a deliberate deviation from the brief's "Redis-backed durable jobs".
*Why:* jobs must be enqueued **inside the same transaction** that changes domain state — a source
row and its processing job must commit or fail together, or the archive silently loses work. A
`SELECT … FOR UPDATE SKIP LOCKED` queue gives that atomicity, plus durable retries, visibility
timeouts and a dead-letter state, with one fewer system to lose data in. Redis remains in
`docker-compose.yml` and behind `CacheAdapter` for caching and distributed rate limiting.
*Reversal:* `JobQueue` is an interface; a BullMQ adapter can be added without touching callers.

### D-005 — `scrypt` (Node built-in) rather than `argon2`
**ASSUMPTION.** `argon2` requires a native build step that fails on minimal images and in CI
sandboxes. Node's built-in `crypto.scrypt` (N=16384, r=8, p=1, 64-byte key, per-password salt,
`timingSafeEqual` comparison) needs no native dependency. Local credential auth is
development-only regardless (`loadConfig` refuses `AUTH_DRIVER=local` in production).

### D-006 — Embeddings stored as `real[]`, pgvector as a conditional upgrade
**VERIFIED** pgvector is not installed in this environment. `memory_embedding.embedding real[]` is
the portable source of truth and works everywhere. Migration `0004_vector_optional.sql` is marked
optional: when the extension is present it adds a `vector` column, keeps it in sync with a trigger,
and builds an HNSW index. The retrieval repository swaps only the similarity expression, so both
paths share one query, one ranking and one set of tests.
*Status:* portable path VERIFIED here; pgvector path UNKNOWN (untested — no extension available).

### D-007 — Row-level security with `FORCE`, scoped per request
Content tables carry `archive_id` and are protected by
`USING (archive_id::text = current_setting('everecho.archive_id', true))` with
`FORCE ROW LEVEL SECURITY`, so the table owner is subject to it too. Every request runs inside
`withArchiveScope(archiveId)`, which issues `SET LOCAL`. An unscoped connection reads **zero** rows
from every content table. This is defence in depth *behind* `authorize()`, never a replacement:
a bug that forgets a policy check still cannot read another family's archive.
Operational tables (`processing_job`, `audit_event`, `app_user`, …) are deliberately exempt —
the worker and admin tooling must query across archives — and are guarded by `authorize()` only.

### D-008 — Consent is a compiled, hashed, versioned policy document
A consent policy is a JSON document compiled to an immutable, canonically-serialised, SHA-256
hashed row. Changing consent never mutates a row: it writes a new version and supersedes the old.
`authorize()` is a **pure function** over `(actor, action, resource, subject, context)` with no I/O,
so the full permission matrix is unit-testable without a database.

### D-009 — Workers re-check consent at execution time
A job authorised at enqueue time may execute after consent was revoked. Every worker handler
re-loads the *current* policy and re-runs `authorize()` before doing work, and aborts with
`consent_revoked` if the answer changed. Tested in `deletion-propagation` and `revocation` suites.

### D-010 — Evidence is filtered before generation, never after
Retrieval applies the consent filter in the SQL `WHERE` clause. Unauthorised evidence is never
loaded into a process that can reach a model. Post-generation filtering is treated as a defect,
because a model that has seen restricted text can leak it through paraphrase.

### D-011 — Local AI adapters are deterministic and honest
The local LLM adapter performs **extractive** composition: it selects and re-frames sentences that
exist in the retrieved evidence and cites them; it cannot invent a fact because it has no generative
capacity. This makes demo mode exercise the *real* provenance, verification and abstention paths.
It is not a language model and is never described as one in the UI, which labels output
"AI-assisted (local deterministic composer)".

### D-012 — Third-person only, enforced in code
`packages/provenance` rejects first-person composition about the storyteller, and the answer
composer emits third-person text exclusively. This is the technical expression of "not a griefbot".

### D-013 — `packages/adapters` added to the prescribed package list
The brief names `domain`, `contracts`, `consent`, `provenance`, `ai`, `ui`, `config`. Non-AI
providers (storage, email, billing, malware scanning, analytics, cache) need the same
interface-plus-local-adapter treatment, so they live in `packages/adapters` rather than being
scattered through the API. `packages/db` likewise holds migrations and repositories.

### D-014 — Deletion is a recorded, resumable, step-wise plan
A deletion request materialises an ordered step list (derived content → embeddings → claims and
evidence → transcripts → objects → source rows → cache → audit tombstone). Each step records its
own completion, so a crashed deletion resumes rather than restarting, and the user can watch real
progress instead of a spinner. The audit tombstone is retained by design: proving a deletion
happened requires that the record of it survives.

### D-015 — ESLint 9.39.5, not 10.x
**VERIFIED** `typescript-eslint@8` declares `eslint: ^8.57.0 || ^9.0.0`. ESLint 10 is outside that
range, so the maintenance 9.x line is pinned. TypeScript is pinned to 5.9.3 for the same reason
(`typescript-eslint` supports `>=4.8.4 <6.0.0`; TypeScript 7 is out of range).
