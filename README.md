# EverEcho v0.1

> **EverEcho is a working codename pending trademark clearance.** The product
> name lives in configuration (`PRODUCT_NAME`); renaming it is a settings
> change, not a find-and-replace.

Turn a consenting **living** person's recorded stories and chosen media into a
private family timeline, a short editable biography and a searchable archive —
where every AI-assisted answer shows its sources.

**What this is not.** EverEcho does not clone anyone's voice, generate a face
or avatar, chat as the person, or continue as them after they die. It will not
invent a memory to fill a gap. These are not roadmap items held back by policy:
they are refused by configuration, by the consent engine, by database
constraints and by the code that composes answers, each with a test.

---

## Getting it running

You need **Node 22+**, **pnpm 10+** and **PostgreSQL 16**. Nothing else, and no
paid API keys — every provider has a working local adapter.

```bash
git clone <this repository> && cd EVERecho-AI
pnpm install
cp .env.example .env          # the defaults work as they are

# Create the database (once)
createdb everecho             # or: psql -c 'CREATE DATABASE everecho'

pnpm db:migrate               # applies the schema
pnpm db:seed                  # builds a synthetic demonstration archive
```

Then start the three processes, each in its own terminal:

```bash
pnpm dev:api                  # http://localhost:4000
pnpm dev:worker               # background processing
pnpm dev:web                  # http://localhost:3000
```

Open <http://localhost:3000/demo> and sign in as any of the demonstration
accounts. They all use the password `demo-passphrase-2026`:

| Sign in as | Email | What they see |
|---|---|---|
| The storyteller | `kamala@everecho.example` | Everything, including drafts awaiting review |
| Who set it up | `anil@everecho.example` | Membership and billing — **no memories** |
| A family member | `anjali@everecho.example` | Approved stories, timeline, cited answers |
| A contributor | `ravi@everecho.example` | The same, plus suggesting corrections |
| Support | `support@everecho.example` | Operational metadata only, never content |

Every person and story in that archive is invented. No real personal data is
bundled with this repository.

**With Docker instead:** `docker compose -f infra/docker/docker-compose.yml up`.
That path adds Redis, MinIO and pgvector — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).
It was authored but **never executed** in the session that produced it, because
no Docker daemon was reachable; watch the first run rather than trusting it.

### If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| `ECONNREFUSED ... 5432` | PostgreSQL is not running | Start it, then re-run `pnpm db:migrate` |
| `Invalid environment configuration` | A setting is missing or is a dev default in production | The error names each problem; every setting is documented in `.env.example` |
| Sign-in fails for demo accounts | The seed has not run | `pnpm db:seed` |
| `pgvector: not available` | The extension is not installed | Nothing is broken — the portable array search runs instead (see D-006) |
| A recording is "left as it is" | No speech provider configured | Expected: the local adapter does not recognise speech and says so rather than inventing a transcript |

## What the commands do

| Command | What it does |
|---|---|
| `pnpm dev:api` / `dev:web` / `dev:worker` | Run one process in watch mode |
| `pnpm db:migrate` | Apply migrations. Already-applied files are skipped; an edited one is a hard error |
| `pnpm db:reset` | Drop and rebuild the schema. Refuses to run in production |
| `pnpm db:seed` | Build the synthetic demonstration archive through the real pipeline |
| `pnpm test` | Unit and integration tests (integration needs PostgreSQL) |
| `pnpm test:e2e` | Playwright journeys and accessibility scans against a running stack |
| `pnpm eval` | AI evaluations against a freshly seeded archive; exits non-zero if a release target is missed |
| `pnpm openapi` | Regenerate `docs/openapi.json` from the routes |
| `pnpm verify` | Everything CI runs, in order |

## How it is put together

```
apps/
  web/        Next.js App Router — 33 routes, server-side protected
  api/        Fastify modular monolith — 70 routes, OpenAPI generated from them
  worker/     Polls the durable job queue and runs the pipeline
packages/
  config/     Every environment variable, declared and validated once
  contracts/  Shared Zod schemas, the closed action vocabulary, deny reasons
  consent/    authorize() as a pure function, plus the policy compiler
  provenance/ (folded into ai/) claim verification and evidence classes
  ai/         Providers, prompts, retrieval, injection isolation, verification
  adapters/   Storage, email, billing, scanning, cache, analytics
  db/         Migrations, connection pool, shared repositories
  pipeline/   Job handlers, shared by the worker and the tests
infra/        Docker Compose and production Dockerfiles
docs/         Architecture, privacy, threat model, runbooks, handoff
```

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how a request flows, and
[`docs/DECISION_LOG.md`](docs/DECISION_LOG.md) for why things are the way they
are — including the choices that deviate from the obvious.

## The two ideas everything rests on

**Consent is a compiled, versioned, hashed policy — not a checkbox.** Changing
it never mutates a row; it writes a new version and supersedes the old one.
`authorize(actor, action, resource, subject, context)` is a pure function with
no I/O, called before every database read, every signed link, every prompt and
every background job. Row-level security sits behind it as defence in depth: an
unscoped database connection reads **zero** rows from every content table.

**Every claim carries the exact words it came from.** Extraction quotes rather
than paraphrases. Verification checks each claim against the evidence it cites
and drops anything unsupported. When nothing survives, the system abstains
rather than composing something plausible.

## What is verified, and what is not

Measured in the session that built this, against a real PostgreSQL 16:

- **193 unit and integration tests** pass. Integration tests run against a real
  database with a freshly migrated schema and no mocks.
- **54 browser tests** pass on desktop and tablet viewports against the running
  application, including **zero WCAG 2.2 AA violations** across every public
  page and all 16 archive screens.
- **32 AI evaluation cases** pass, with all four release-blocking targets met:
  100% claim-to-citation correctness, 0% unsupported material claims, 100%
  abstention on no-evidence and sensitive cases, zero permission leaks.

Not verified here, and honest about it: Docker, S3/MinIO, Redis, hosted AI
providers, SMTP, Stripe and pgvector all have complete implementations that were
type-checked but never executed, because none was reachable. See
[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) for the full list
and what would need to happen before a real family's memories go in.

## Documentation

| Document | What it covers |
|---|---|
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Request flow, the data model, the pipeline |
| [`DECISION_LOG.md`](docs/DECISION_LOG.md) | Choices made, and what it would take to reverse them |
| [`PRIVACY_ENGINEERING.md`](docs/PRIVACY_ENGINEERING.md) | Where personal data lives and what touches it |
| [`THREAT_MODEL.md`](docs/THREAT_MODEL.md) | What we are defending against, including the family |
| [`DATA_LIFECYCLE.md`](docs/DATA_LIFECYCLE.md) | From upload to deletion, with retention |
| [`INCIDENT_RUNBOOK.md`](docs/INCIDENT_RUNBOOK.md) | What to do when something goes wrong |
| [`BACKUP_RESTORE.md`](docs/BACKUP_RESTORE.md) | Backups, and proving a restore works |
| [`SHUTDOWN_PORTABILITY.md`](docs/SHUTDOWN_PORTABILITY.md) | What happens to families if this company stops |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Running it somewhere real |
| [`PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) | The honest checklist |
| [`DEMO_WALKTHROUGH.md`](docs/DEMO_WALKTHROUGH.md) | A guided tour that shows the refusals too |
| [`TRACEABILITY_MATRIX.md`](docs/TRACEABILITY_MATRIX.md) | Requirement → code → test |
| [`IMPLEMENTATION_HANDOFF.md`](docs/IMPLEMENTATION_HANDOFF.md) | State, blockers, exact next actions |
| [`openapi.json`](docs/openapi.json) | Generated from the routes that serve it |

## Licence and status

Validation-stage software. Legal wording throughout is a **draft pending review
by qualified counsel** in India, the EU, the UK and the US. Technical safeguards
described in these documents are not a legal certification.
