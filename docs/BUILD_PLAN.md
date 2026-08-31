# EverEcho v0.1 — Build Plan

**Status:** in progress · **Owner:** autonomous build session · **Started:** 2026-08-31

Evidence labels used throughout: **VERIFIED** (inspected/executed), **INFERENCE**,
**ASSUMPTION** (reversible choice), **UNKNOWN** (needs credentials/counsel/research).

## Repository state at Phase 0

- **VERIFIED** — Repository contained exactly one commit (`e6aff8e Initial commit`) and one
  file, `README.md` (13 bytes). No prior application code, tests, CI or configuration existed.
- **VERIFIED** — No `AGENTS.md` anywhere on the filesystem.
- **VERIFIED** — The EverEcho company package (`EVERECHO_AI_HANDOFF.md`,
  `PRODUCT_CONSTITUTION.md`, `CONSENT_ARCHITECTURE.md`, `DATA_MODEL.md`, …) is **absent**.
  Per the build brief, the brief itself is therefore the authoritative specification.
  Nothing in this repository was overwritten or discarded.
- **VERIFIED** — Working tree clean on branch `claude/everecho-v0-1-build-awtih5`; no unrelated
  work exists to preserve.

## Environment findings (constraints that shaped the architecture)

| Finding | Evidence | Consequence |
|---|---|---|
| Node 22.22.2, pnpm 10.33.0 | VERIFIED (`node -v`, `pnpm -v`) | pnpm workspace monorepo |
| PostgreSQL **16.13 server running locally** | VERIFIED (`pg_isready`, `select version()`) | Integration tests run against a real database in this session |
| `pgvector` extension **not installed** | VERIFIED (no `vector.control` in `/usr/share/postgresql/16/extension`) | Embeddings stored portably as `real[]`; pgvector column + HNSW index added by a conditional migration when the extension exists (see DECISION_LOG D-006) |
| Docker daemon **not reachable** | VERIFIED (`docker info` → no `/var/run/docker.sock`) | `docker-compose.yml` and production Dockerfiles are authored and syntax-reviewed but **not executed** in this session — marked UNKNOWN in the readiness verdict |
| No provider credentials (LLM, STT, OCR, email, billing, S3) | VERIFIED (no keys in environment) | Every provider sits behind an interface with a deterministic local adapter; the whole product and test suite run with zero paid credentials |

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 | Audit, traceability, decision log | done |
| 1 | Monorepo, config, contracts, database, migrations, seed, CI, Docker | in progress |
| 2 | Identity, archives, invitations, consent engine, `authorize()` | pending |
| 3 | Capture, uploads, quarantine, job queue, worker, STT/OCR adapters | pending |
| 4 | Memories, corrections, events, entities, timeline, biography | pending |
| 5 | Retrieval, grounded Q&A, claim verification, citations, evals | pending |
| 6 | Sharing, revocation, export, deletion, audit, billing, notifications | pending |
| 7 | Restricted admin, safety/security incidents, observability | pending |
| 8 | Web frontend (all required screens), a11y, demo mode | pending |
| 9 | Hardening, full test run, documentation, handoff | pending |

This table is updated as each phase lands; it states current reality, not intent.

**Deviation (recorded):** `TRACEABILITY_MATRIX.md` is authored in Phase 9 against the implemented
tree rather than in Phase 0, so every file and test path in it is a verified reference instead of a
prediction. The requirement inventory it traces is fixed by this brief and does not change.

Live detail — what runs, what is mocked, what remains — is maintained in
[`IMPLEMENTATION_HANDOFF.md`](./IMPLEMENTATION_HANDOFF.md) and
[`TRACEABILITY_MATRIX.md`](./TRACEABILITY_MATRIX.md).

## Hard scope boundary held throughout

v0.1 is **not** an AI resurrection product. The following are prohibited, and the prohibition is
enforced in code rather than only in documentation:

- voice cloning, face cloning, avatars, lip-sync, first-person persona chat, posthumous simulation
- automatic death/incapacity transitions triggered by inactivity
- training shared or foundation models on private memory data
- advertising or data sale based on private memories; profiles for minors

Enforcement points: `FEATURE_PERFORM_MODE` and `FEATURE_SUCCESSION_EXECUTION` are typed `false`
and rejected by `loadConfig`; `ConsentMode.Perform` is rejected by the policy compiler;
evidence class `P5_GENERATED_SIMULATION` is rejected by the provenance package; the answer
composer refuses first-person output. Each has a test.
