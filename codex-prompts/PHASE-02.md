# Phase 02 — Database and isolation

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §6 and §5. Update
docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. MIGRATIONS 0001–0008, hand-written SQL, numbered and CHECKSUMMED
   - 0001_identity: app_user, user_session, person, household, archive,
     membership, invitation
   - 0002_consent: consent_policy, consent_record, teach_back_result,
     succession_directive, dispute_hold
   - 0003_capture: source_asset, asset_version, transcript, transcript_segment,
     interview_session, interview_prompt, interview_response
   - 0004_memory: place, entity, relationship, memory, memory_entity,
     life_event, claim, claim_evidence, contradiction, correction,
     memory_embedding, generated_artifact, retrieval_snapshot,
     generated_response, response_claim, provenance_record
   - 0005_operations: processing_job, export_job, deletion_request,
     audit_event, safety_event, security_event, incident, break_glass_grant,
     billing_customer, reservation, subscription, webhook_event, notification,
     analytics_event, db_capability
   - 0006_rls: FORCE ROW LEVEL SECURITY on every content table
   - 0007_search: full-text indexes
   - 0008_vector.optional: pgvector column + HNSW index, applied ONLY if the
     extension exists

   `pnpm db:migrate` skips already-applied files and treats an EDITED one as a
   HARD ERROR. `pnpm db:reset` refuses to run in production.

2. ROW-LEVEL SECURITY, scoped per transaction
   Every content table carries archive_id and is invisible without
   `set_config('everecho.archive_id', …, true)` set inside the transaction.

   Operational tables are DELIBERATELY exempt — processing_job, audit_event,
   app_user, archive, membership, invitation — because the worker polls across
   archives and membership must be queryable by user. None of them holds
   memory content. State this in a comment in 0006 with that reasoning.

3. CONSTRAINTS that are part of the product, not of tidiness
   - succession_never_auto_executes: execution_enabled pinned false
   - response_claim evidence class CHECK: P1–P3 only
   - candidate evidence CHECK: P0–P3 only
   - append-only TRIGGER on audit_event
   - consent_policy: exactly one current version per archive
   - voiceAndLikeness fields CHECK-pinned false
   - archive: subjectIsAdult required
   Give each constraint a NAME. A named constraint tells you what you broke.

4. pgvector as a CONDITIONAL upgrade, not a requirement (D-006)
   Embeddings stored as portable real[] with a PL/pgSQL cosine function. When
   pgvector exists, add a vector column and HNSW index ALONGSIDE and keep them
   in sync by trigger; only the similarity expression in the query changes.
   Detect the capability at migration time and record it in db_capability, so
   the code path is chosen from EVIDENCE rather than from configuration.

5. packages/db: pool, migrate/reset CLIs, repositories (archives, membership,
   consent, audit, jobs). One helper — `withArchiveScope` — is the only place
   that sets the scope.

6. The durable job queue in PostgreSQL, FOR UPDATE SKIP LOCKED, so an
   approval and the job that indexes it commit together or not at all.

## Definition of done

- An integration test opens an UNSCOPED connection and asserts it reads ZERO
  rows from every content table. This is the load-bearing test of the phase.
- A test asserts a second archive's rows are invisible under the first's scope.
- A test asserts an edited migration file is rejected by `db:migrate`.
- A test asserts the append-only trigger refuses an UPDATE on audit_event.
- A test asserts execution_enabled cannot be set true.
- The pgvector path and the portable path return the SAME ranking on the same
  data — if pgvector is unavailable in this environment, mark that row
  `interface only` and say so, do not mark it done.

## Watch for

- Never `Promise.all` over one database transaction. A pg client runs one query
  at a time; concurrent queries interleave on the wire. This was a real bug.
- Integration tests run against a REAL database with a freshly migrated schema
  and NO mocks. A mocked database cannot prove RLS.
```
