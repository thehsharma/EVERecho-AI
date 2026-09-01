# Architecture

## The shape of it

A modular monolith behind a typed contract, with background work in a durable
queue and a browser client that never makes an access decision.

```
                    ┌──────────────────────────────────────────┐
   browser ────────▶│ apps/web  (Next.js, server-rendered)      │
                    │  · route protection before render         │
                    │  · nav built from reported capabilities   │
                    └───────────────┬──────────────────────────┘
                                    │ session cookie + CSRF
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │ apps/api  (Fastify, 70 routes)            │
                    │                                           │
                    │  withArchiveAccess()  ◀── the only way to  │
                    │    1. open an archive-scoped transaction   │
                    │    2. load actor + subject from the DB     │
                    │    3. authorize()  ← pure, no I/O          │
                    │    4. record the decision, allow or deny   │
                    │    5. run the handler                      │
                    └───────┬───────────────────────┬───────────┘
                            │                       │
              enqueue in    │                       │  read/write
              the same tx   ▼                       ▼
                    ┌───────────────┐      ┌────────────────────┐
                    │ processing_job│      │ PostgreSQL          │
                    └───────┬───────┘      │  · RLS on content   │
                            │              │  · append-only audit│
                            ▼              └────────────────────┘
                    ┌──────────────────────────────────────────┐
                    │ apps/worker → packages/pipeline           │
                    │  re-checks consent at execution time      │
                    └──────────────────────────────────────────┘
```

## Why a request cannot skip authorisation

`withArchiveAccess` is the only function that returns an archive-scoped database
transaction. Row-level security means an *unscoped* connection reads zero rows
from every content table, so a handler that tried to bypass the gate would find
nothing there. The two mechanisms are deliberately different in kind: one is
application logic that can have bugs, the other is the database refusing.

The decision is recorded either way. Deny records are written on a **separate
connection**, because the transaction is about to roll back and a refusal that
vanishes with it is a refusal nobody can audit.

## Consent

A consent policy is a JSON document, canonically serialised, SHA-256 hashed and
versioned. Changing it supersedes rather than overwrites, so "what had they
agreed to in March?" is always answerable.

Mode is a **ceiling** on capability; each processing activity is granted
**independently**. A storyteller can enable composed answers while still
refusing OCR — their documents simply go unprocessed. Deriving activities from
the mode would collapse exactly the granularity consent needs.

```
preserve  ──▶ organise ──▶ explore ──▶ compose      perform ✗ prohibited
  store        transcribe   search      answers      voice/avatar/persona
               OCR          timeline    biography    (refused in 4 places)
```

`authorize()` returns obligations alongside an allow — `maxSensitivity`,
`excludedSourceIds`, `restrictedTopics` — and retrieval builds its SQL `WHERE`
clause from them. The filter and the decision therefore cannot drift apart.

## The pipeline

Each step commits with the enqueue of the next, so work is never orphaned:

```
upload ticket ──▶ quarantine ──▶ scan ──▶ immutable original (checksummed)
                                            │
                        ┌───────────────────┴───────────────────┐
                   transcribe (audio/video)              OCR (documents)
                        └───────────────────┬───────────────────┘
                                            ▼
                              extract candidates (quoted, located)
                                            ▼
                          ┌── storyteller reviews and approves ──┐
                          │                                       │
                     embed for search                     build timeline
                                                          compose biography
```

Every handler re-checks consent when it runs. A job authorised at enqueue time
may execute after consent was withdrawn; trusting the earlier permission is how
a system transcribes a recording somebody already asked it not to touch.

## Answering a question

```
authenticate → authorize → refuse prohibited/injection requests (before retrieval)
   → retrieve, with the consent filter in the WHERE clause
   → snapshot what was retrieved
   → compose atomic third-person claims
   → verify each claim against the evidence it cites
   → drop what fails; abstain if nothing survives
   → attach claim-level citations
   → record model, prompt, policy and snapshot versions
```

Unauthorised evidence is never loaded into a process that can reach a model.
Filtering after generation would be too late: a model that has read restricted
text can leak it through paraphrase.

## Evidence classes

| Class | Meaning | Where it may appear |
|---|---|---|
| `P0_ORIGINAL_SOURCE` | The file itself | Stored, shown as a source |
| `P1_DIRECT_STATEMENT` | They said this, in these words | Customer answers |
| `P2_CORROBORATED_FACT` | Two independent sources agree | Customer answers |
| `P3_SUPPORTED_SYNTHESIS` | Restatement inside what the evidence supports | Customer answers |
| `P4_MODEL_INFERENCE` | The model guessed | Off by default; never in answers |
| `P5_GENERATED_SIMULATION` | Simulated speech or persona | **Prohibited** — rejected by a database constraint |

## Entity relationships

The full schema is 51 tables. These are the load-bearing relationships:

```
app_user ──1:n── user_session
    │
    │ (an account is not a person)
    │
household ──1:n── archive ──n:1── person   (the subject)
                     │
                     ├──1:n── membership ──n:1── app_user
                     ├──1:n── invitation
                     ├──1:n── consent_policy (versioned; one current)
                     │            └──1:n── consent_record, teach_back_result
                     ├──1:1── succession_directive   (never executes)
                     ├──1:n── dispute_hold
                     │
                     ├──1:n── source_asset ──1:n── asset_version (immutable original)
                     │            └──1:n── transcript ──1:n── transcript_segment
                     │
                     ├──1:n── interview_session ──1:n── interview_prompt ──1:1── interview_response
                     │
                     ├──1:n── memory ──1:n── claim ──1:n── claim_evidence ──n:1── source_asset
                     │            ├──n:m── entity (memory_entity)      └── locator: page/timestamp/segment
                     │            └──1:n── life_event
                     │
                     ├──1:n── contradiction (claim ↔ claim)
                     ├──1:n── correction (append-only; nothing overwritten)
                     ├──1:n── memory_embedding (real[]; optional pgvector column)
                     ├──1:n── generated_artifact (timeline, biography)
                     ├──1:n── generated_response ──1:n── response_claim (P1–P3 only, by constraint)
                     │            └──n:1── retrieval_snapshot
                     ├──1:n── export_job, deletion_request
                     └──1:n── audit_event (append-only, enforced by trigger)
```

Tables under row-level security carry `archive_id` and are invisible without a
scope. Operational tables (`processing_job`, `audit_event`, `app_user`,
`archive`, `membership`, `invitation`) are deliberately exempt: the worker polls
across archives and membership must be queryable by user. None of them holds
memory content.

## Retrieval

Hybrid: PostgreSQL full-text ranking (60%) plus vector similarity (40%).

The lexical half uses an **OR** query built from the question's content words.
`websearch_to_tsquery` requires every term, so one word the archive never uses
returns nothing at all — which reads to a family member as an empty archive
rather than a phrasing mismatch.

Embeddings are stored as portable `real[]` with a PL/pgSQL cosine function. When
pgvector is available a `vector` column and HNSW index are added alongside and
kept in sync by trigger; only the similarity expression in the query changes.
The capability is detected at migration time and recorded in `db_capability`, so
the code path is chosen from evidence rather than from configuration.

Ties are broken deterministically. Two claims with the same score must not
produce different answers on different runs.
