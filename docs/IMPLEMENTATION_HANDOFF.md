# Implementation handoff

Written so another session — Claude, Codex, Gemini or a person — can pick this
up cold. Last updated at the end of the build session that created the
repository.

## Where things stand

All nine phases of the build brief are implemented. The product runs end to end
with no paid credentials: `pnpm db:migrate && pnpm db:seed`, then the three dev
processes, then <http://localhost:3000/demo>.

| | |
|---|---|
| Source | 172 TypeScript files, ~25,000 lines |
| Database | 51 tables, 8 migrations, 28 tables under `FORCE ROW LEVEL SECURITY` |
| API | 70 routes, OpenAPI generated from the schemas that validate them |
| Web | 33 routes |
| Tests | 193 unit and integration, 54 browser, 32 AI evaluation cases |

Measured results and the readiness verdict are in
[`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md). Requirement-by-requirement
coverage is in [`TRACEABILITY_MATRIX.md`](./TRACEABILITY_MATRIX.md).

## Read these first, in this order

1. [`../README.md`](../README.md) — how to run it, in fifteen minutes.
2. [`DECISION_LOG.md`](./DECISION_LOG.md) — fifteen decisions, why, and what it
   would cost to reverse each. Read this before disagreeing with anything.
3. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — request flow and the data model.
4. `packages/consent/src/authorize.ts` — a single pure function that everything
   else depends on. If you understand this file you understand the product.
5. `apps/api/src/lib/access.ts` — the only way to obtain an archive-scoped
   transaction, and therefore the only way to reach content.

## The invariants — break these and the product is a different product

1. **`authorize()` stays pure.** No I/O, no clock, no database. Everything it
   needs arrives as an argument. This is what makes the permission matrix
   testable and what stops callers authorising against stale state.
2. **Consent is never updated in place.** New version, supersede the old. A
   `UPDATE consent_policy SET document = …` is always a bug.
3. **Deny audit records are written on a separate connection.** The request
   transaction is about to roll back. This was a real bug once already.
4. **Evidence is filtered before generation, in the SQL `WHERE`.** Filtering
   after generation is too late: a model that has read restricted text can leak
   it through paraphrase.
5. **Approval gates searchability.** Nothing is embedded, retrieved or answered
   from until the storyteller approves it.
6. **Originals are never edited.** Corrections are new rows referencing them.
7. **The prohibitions are enforced in four places** — configuration, the policy
   engine, database constraints and the composer. Removing any one of them makes
   the other three a matter of care rather than structure.
8. **Never `Promise.all` over one database transaction.** A pg client runs one
   query at a time; concurrent queries interleave on the wire. This was also a
   real bug.

## Immediate next actions

In the order I would do them.

1. **Wire Stripe webhook verification.**
   `packages/adapters/src/billing.ts` → `StripeBillingAdapter.verifyWebhook`
   returns `null`, which fails closed. Use `stripe.webhooks.constructEvent` with
   the raw body and `BILLING_WEBHOOK_SECRET`. The local adapter's tests show the
   idempotent-replay path it needs to satisfy. Half a day.

2. **Run the Docker stack once and fix what breaks.**
   `docker compose -f infra/docker/docker-compose.yml up`. Nothing in
   `infra/docker` has ever been executed. Expect the pnpm workspace copy in
   `Dockerfile.api` to need adjusting. Then verify pgvector actually applies
   migration `0008` and that retrieval results match the portable path — that
   comparison is the valuable part. One day.

3. **Add password reset.** There is currently no route back for a user who
   forgets. Follow the invitation-token pattern in `modules/invitations.ts`:
   random token, store only its hash, short expiry, single use, and revoke every
   session on completion. One day.

4. **Write the embedding backfill script.** Changing `EMBEDDINGS_DIM` or
   `EMBEDDINGS_DRIVER` silently invalidates every stored vector, and retrieval
   degrades without saying so. A script that re-embeds approved memories, plus a
   startup check comparing `memory_embedding.dim` against configuration. Half a
   day.

5. **Get the legal review started.** It is the longest-lead item and blocks a
   pilot entirely. Everything needing review is marked `legal-copy-*` in
   `packages/config/src/schema.ts` and rendered in the footer, the teach-back
   and the succession screen.

## Things that will surprise you

- **`pnpm typecheck` covers the web app too**, via a `paths` entry in the root
  `tsconfig.json`. If you move `apps/web`, update it.
- **Workspace packages are consumed as TypeScript source**, not built output
  (D-002). There is no build step for packages, and no stale `dist` can be run.
- **The job queue is in PostgreSQL, not Redis** (D-004), so that enqueueing is
  transactional with the domain change that caused it. Redis is cache and rate
  limiting only.
- **`pgvector` is optional.** Migration `0008` is allowed to fail; the
  capability is recorded in `db_capability` and retrieval picks its query path
  from that. A `degraded` on `/readyz` for `vector_index` is not an outage.
- **The local composer is extractive** and cannot invent a memory. That is why
  demo mode exercises the real provenance and abstention paths. It is not a
  language model and the UI never calls it one.
- **The local speech adapter does not recognise speech.** It segments text
  captured alongside a recording — which is what browser interviews produce —
  and reports honestly when there is none. It never fabricates a transcript.
- **`.env` is loaded by `packages/config`**, walking up from the working
  directory. Real environment variables always win.
- **E2E tests need a running stack.** They do not start it. See the `browser`
  job in `.github/workflows/ci.yml` for the exact sequence.
- **Playwright needs `PLAYWRIGHT_CHROMIUM_PATH`** in environments where the
  pre-installed Chromium revision differs from what Playwright expects.

## Where to add things

| To add… | Start at | Then |
|---|---|---|
| A capability | `packages/contracts/src/actions.ts` | The compiler will demand entries in `ACTION_REQUIREMENTS` and a decision in `ROLE_ACTIONS`. That is deliberate |
| A route | `apps/api/src/modules/*.ts` with `defineRoute` | Regenerate OpenAPI with `pnpm openapi`; CI fails if it is stale |
| A background job | `packages/pipeline/src/handlers/` | Register in `HANDLERS`; add the type to `jobTypeSchema`; call `assertProcessingAllowed` first |
| A migration | `packages/db/migrations/NNNN_name.sql` | Never edit an applied one — the runner refuses on a checksum change |
| A screen | `apps/web/src/app/` | Add it to the accessibility scan list in `tests/e2e/accessibility.spec.ts` |
| An eval case | `apps/api/evals/gold-set.ts` | `pnpm eval` fails the build if a target regresses |

## Deviations from the build brief, and why

| Brief said | Built | Reason |
|---|---|---|
| Redis-backed durable jobs | PostgreSQL queue; Redis for cache and rate limiting | Enqueue must be transactional with the domain change (D-004) |
| `argon2` implied by convention | Node's built-in `scrypt` | No native build; local auth is dev-only anyway (D-005) |
| Packages: domain, contracts, consent, provenance, ai, ui, config | Added `adapters`, `db`, `pipeline`; folded `provenance` into `ai` and the design system into `apps/web` | Non-AI providers needed the same interface treatment; the design system is one stylesheet and a component file, and a package for it would be ceremony (D-013) |
| Traceability matrix in Phase 0 | Written in Phase 9 | So every path in it is a verified reference rather than a prediction |
| pgvector | Optional, with a portable fallback | Not installable in the build environment; the fallback works everywhere (D-006) |

## What I would not change without good reason

The consent engine's shape, the four-layer isolation, the append-only audit
trail, extraction-quotes-rather-than-paraphrases, and the refusal to make any of
the prohibited capabilities reachable by configuration. Everything else is
negotiable.
