# Privacy engineering

What personal data exists, where it lives, what is allowed to touch it, and how
each of those is enforced rather than merely intended.

## What we hold

| Category | Examples | Where | Protection |
|---|---|---|---|
| **Memory content** | Recordings, photographs, letters, transcripts, story cards, claims | `source_asset`, `transcript*`, `memory`, `claim*`, object storage | Row-level security, consent policy, private buckets, expiring signed links |
| **Derived content** | Embeddings, timeline, biography, generated answers | `memory_embedding`, `generated_artifact`, `generated_response` | Same as above; deleted first during deletion |
| **Identity** | Email, display name, password hash | `app_user` | scrypt hashing, no RLS (must be queryable by login) |
| **Relationship** | Who has access to what, in what capacity | `membership`, `invitation` | `authorize()` only |
| **Consent** | Versioned policy documents, teach-back answers | `consent_policy`, `teach_back_result` | RLS, hashed, append-only versions |
| **Operational** | Audit events, jobs, incidents, security events | `audit_event`, `processing_job`, `incident` | Redacted on write; no content by construction |
| **Analytics** | Event names, counts, buckets | `analytics_event` | Salted opaque ids; schema forbids content |

## The rules, and where each is enforced

**Memory content never reaches a log, an analytics store, an email subject or a
support dashboard.**

- `redactMetadata` (`packages/db/src/repositories/audit.ts`) strips a closed list
  of keys — body, text, title, question, answer, transcript, filename, caption,
  email, token — before an audit row is written. Redaction happens on **write**;
  a redaction applied at read time has already been written to disk.
- The API logger serialises only method, path and request id, and removes
  cookie and authorization headers entirely.
- `analyticsEventSchema` restricts property values to numbers, booleans and a
  three-value bucket. There is no shape a memory could be stored in.
- Email templates take a fixed variable set. Subject lines are deliberately dull
  — "a message about your archive" tells a shoulder-surfer nothing.
- Incident records carry an `ARC-xxxxxxxx` reference rather than an archive id,
  so support staff never hold an identifier they could use to address the
  archive directly.

**Identifiers that reach analytics cannot be resolved back to a person.**
`AnalyticsRecorder.opaque()` HMACs with the session secret and truncates. The
analytics store alone cannot recompute them.

**Session and network context is recorded as hashes, not values.** `ip_hash` is
an HMAC; `user_agent_family` is one of five coarse strings. Enough to notice
something wrong, not enough to follow someone around.

**Providers may not train on memory data.** `noModelTraining` is a field of the
signed consent document and a database `CHECK` constraint. Provider retention is
a separate, explicitly consented number of days, defaulting to zero.

## Isolation

Four layers, deliberately different in kind:

1. **`authorize()`** — a pure function over the current policy, called before
   every read, every signed link, every prompt and every job.
2. **Row-level security** — content tables carry `FORCE ROW LEVEL SECURITY` with
   a policy of `archive_id = current_setting('everecho.archive_id')`. An
   unscoped connection reads zero rows; a cross-archive write is rejected by the
   database. Verified in `tests`, and again in the evaluation suite.
3. **Query-level filters** built from the authorisation decision's obligations,
   so the filter and the decision cannot drift.
4. **Database constraints** for the things that must never be true regardless of
   application code: no perform mode, no granted synthetic voice, no model
   training, third-person responses only, customer claims P1–P3 only.

## Encryption

| At | How | Status |
|---|---|---|
| In transit | TLS at the edge; HSTS via helmet | Deployment responsibility — see `DEPLOYMENT.md` |
| At rest, database | Volume or managed-service encryption | Deployment responsibility |
| At rest, objects | Bucket-level SSE, KMS-managed key | Deployment responsibility |
| Secrets | Environment only; never committed | Enforced by `loadConfig` and secret scanning in CI |

Envelope encryption with a customer-managed key is **not implemented**. The
place it would go is the storage adapter (`packages/adapters/src/storage.ts`),
which already mediates every read and write of object bytes. It is listed in
`PRODUCTION_READINESS.md`.

## Access to production data by staff

There is no route that grants an administrator general browsing of memories.
`authorize()` refuses every content action for a platform admin with no
membership, with `admin_scope_metadata_only`.

Reaching even operational metadata for one archive requires a `break_glass_grant`
— purpose stated, time-bounded, tied to an incident — and the request is written
into **that archive's own audit trail**, where the storyteller can see it. The
grant's scope is a database `CHECK` constraint pinned to `metadata_only`.

## Data subject rights

| Right | How it is served |
|---|---|
| Access | The storyteller sees everything in the interface; family see what they were granted |
| Portability | `POST /v1/archives/:id/exports` — a plain .zip with originals, claims, evidence, permission history and a SHA-256 manifest |
| Rectification | Corrections are versioned; the previous value is kept, the original source is never altered |
| Erasure | `POST /v1/archives/:id/deletion-requests` — a recorded, resumable, step-wise plan |
| Restriction | Restricted topics, excluded sources, embargo dates, sensitivity ceilings |
| Objection | Any consent activity can be withdrawn; queued work that is no longer permitted is cancelled in the same transaction |

## Where a person's data is *not*

Deliberately, so it can be reasoned about:

- Not in any third-party analytics product (the local adapter writes to our own
  database; a hosted driver would receive only opaque ids and counts).
- Not in error monitoring (only a request id crosses that boundary).
- Not in email bodies beyond a name and a link.
- Not in the URL of anything, because signed links carry an opaque storage key.
- Not in browser storage. The web app keeps no memory content client-side beyond
  the render.
