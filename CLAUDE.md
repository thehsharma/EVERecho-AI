# EverEcho

A consented family memory archive. People record their own life story, review
everything before it is kept, and decide exactly who may see what. A family
member can ask questions and get answers that cite the recording or document
they came from — or an honest "I don't have enough evidence in this archive to
answer that reliably".

**It never pretends to be the person.** That is not a feature that was cut; it
is the point of the product, and most of the code below exists to make it
structurally impossible.

---

## Run it

```bash
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                 # api :4000, web :3000, worker
```

Sign in at `http://localhost:3000/sign-in` as `kamala@everecho.example`
(storyteller) or `anjali@everecho.example` (family), password
`demo-passphrase-2026`. The demonstration archive is entirely invented.

**No credentials are needed for anything.** Every AI provider has a
deterministic local implementation and the whole product — uploads,
transcription, extraction, grounded answers, live voice conversation — runs
offline.

```bash
pnpm verify              # format, lint, typecheck, tests, evaluations
pnpm test:e2e            # browser suite, two viewports
pnpm eval                # AI evaluations + measured local latency
```

`service postgresql start` if the database is not running.

---

## Layout

```
apps/api        Fastify 5 modular monolith
apps/web        Next.js 16 App Router, React 19
apps/worker     durable job runner
packages/
  contracts     Zod schemas — the single source of truth for the API
  consent       the authorisation engine, pure and independently testable
  db            migrations, repositories, RLS scoping
  ai            provider interfaces, local implementations, hosted adapters
  realtime      state machine, VAD, turn detection, cost meter, breaker
  pipeline      ingestion, derivation, export, deletion handlers
  adapters      storage, email, billing, cache, analytics, scanning
```

Packages are consumed as **TypeScript source** — no build step. `tsc --noEmit`
typechecks the whole graph at once.

---

## Things that will surprise you

- **RLS is forced on 43 tables**, scoped per transaction with
  `set_config('everecho.archive_id', …, true)`. A query outside
  `withArchiveScope` sees nothing. This has caught real bugs.
- **The job queue is in PostgreSQL** (`FOR UPDATE SKIP LOCKED`), so enqueueing
  is transactional with the domain change. An approval and the job that indexes
  it commit together or not at all.
- **`authorize()` is pure** — actor, action, resource, subject, context in;
  ALLOW plus obligations, or DENY plus a reason code, out. Obligations are
  compiled into the retrieval `WHERE` clause, so "what may this person see" is
  answered by the query rather than by a filter afterwards.
- **The local speech recogniser cannot recognise speech, and says so.** It
  emits `no_recognisable_speech` rather than inventing words. A fabricated
  transcript would become a fabricated memory.
- **OpenAPI is generated from the same Zod schemas that validate at runtime**
  (`z.toJSONSchema()`), so the documentation cannot drift from the behaviour.

---

## The rules this codebase enforces

These are not style preferences. Each has a mechanism, and the mechanism is the
point — a rule with only a comment behind it is a wish.

1. **Nothing is spoken or written that is not supported by cited evidence.**
   Verification runs per clause, before synthesis. A clause that fails is
   discarded, never rewritten: rewriting means guessing what it should have
   said.

2. **The assistant never speaks as the storyteller.** `isProhibitedRequest`
   runs before retrieval; `attribute()` is applied server-side so the model
   cannot supply its own presentation text; `assertThirdPerson` discards
   anything that still reads as the person, and records a safety event.

3. **No biographical memory is saved without the storyteller deciding.** A
   CHECK constraint, an authorisation rule, and an evaluation measured against
   the database — three independent mechanisms.

4. **Consent is re-read before every decision point**, not captured at session
   start. A storyteller who revokes mid-sentence is obeyed mid-sentence.

5. **No voice is ever cloned.** There is no column able to hold a voiceprint.
   The synthesis voice comes from a table fixed in code.

6. **No provider may train on anything.** `mip_opt_out=true` is hard-coded with
   no setting able to change it, and the provider factory refuses to start with
   a provider that declares otherwise.

7. **No memory text in logs, analytics, traces or error messages.** Reason
   codes only. Analytics props admit numbers, booleans and a severity enum by
   schema, so a string cannot be passed by accident.

8. **Never claim something was tested when it was not.** Three provider
   adapters are written and have never run against their real providers, and
   every one of them says so in its own header, in
   `docs/REALTIME_PRODUCTION_READINESS.md`, and in `.env.example`.

---

## Working here

- **Fix the cause, not the test.** The intermittent browser failure in v0.2 was
  a dropped WebSocket frame, not a flaky assertion. Six speculative fixes
  preceded finding it; the seventh was the actual cause.
- **Write the comment that explains why, not what.** `// increment counter` is
  noise. `// Random per instance, because two sessions constructed in the same
  millisecond would collide on the idempotency key` is the reason somebody will
  need in a year.
- **Never ingest real family data during development.** The demonstration
  archive is synthetic and must stay that way.
- **Never commit secrets.** `.env` is ignored; `.env.example` documents every
  variable with safe defaults.
- **Ask before**: spending money, deploying, running a destructive migration,
  or making a materially different product decision. Not before ordinary
  implementation choices.

---

## Where the documentation is

| Question | Document |
| --- | --- |
| How is this built? | `docs/ARCHITECTURE.md` |
| Why is it built that way? | `docs/DECISION_LOG.md`, `docs/REALTIME_DECISION_LOG.md` |
| Is it ready? | `docs/PRODUCTION_READINESS.md`, `docs/REALTIME_PRODUCTION_READINESS.md` |
| What proves each requirement? | `docs/TRACEABILITY_MATRIX.md`, `docs/REALTIME_TRACEABILITY_MATRIX.md` |
| I am picking this up cold | `docs/IMPLEMENTATION_HANDOFF.md`, `docs/REALTIME_IMPLEMENTATION_HANDOFF.md` |
| Something is broken at 3am | `docs/INCIDENT_RUNBOOK.md`, `docs/REALTIME_INCIDENT_RUNBOOK.md` |
| What data is kept, and for how long? | `docs/DATA_LIFECYCLE.md`, `docs/REALTIME_DATA_LIFECYCLE.md` |
| What are we defending against? | `docs/THREAT_MODEL.md` |
| What does it cost, how fast is it? | `docs/REALTIME_COST_AND_LATENCY.md` |
| Why not buy a voice platform? | `docs/ADR-REALTIME-BUILD-VS-BUY.md` |
| What if the company disappears? | `docs/SHUTDOWN_PORTABILITY.md` |

---

## Status

**v0.2, unreleased.** Everything runs locally with no credentials. Three hosted
provider adapters are written and unexecuted. Nothing has been deployed and no
money has been spent.

Read `docs/REALTIME_PRODUCTION_READINESS.md` §3 and §7 before trusting any of
this with a real family's memories.
