# Phase 08 — Sharing, lifecycle, audit, billing, admin

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §4 (revocation), §11
(export), §12 and §14-C. Update docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. REVOCATION THAT REACHES EVERYTHING AT ONCE
   Revoking a membership must stop: the UI, the API, retrieval, signed links
   and downloads — immediately, in the same request. No cached grant.
   Re-evaluated per request. A background job authorised before the revocation
   is CANCELLED at execution.

2. Export (packages/pipeline/src/handlers/lifecycle.ts + zip.ts)
   POST/GET …/exports. A real zip with a manifest and per-file checksums,
   containing sources, transcripts, memories, claims, citations, corrections,
   consent history and audit trail. Every claim's provenance travels with it.
   (Phase 12 makes the export portable, signed and offline-verifiable — build
   the plain export here.)

   WRITE AND READ. Provide `readZip` beside `createZip` and test the round
   trip. The reference build's hand-rolled writer went three releases without
   its output ever being read back, and it was broken.

3. Deletion — a RECORDED, RESUMABLE, STEP-WISE PLAN (D-014)
   POST/GET …/deletion-requests. Not one destructive statement: a plan whose
   steps are recorded, each marked done as it completes, so an interrupted
   deletion resumes rather than restarting or half-finishing. Visible progress
   in the UI. When it finishes, ALL content is gone — assert it against the
   database, table by table.

4. Audit
   GET …/audit. Append-only, enforced by trigger. Records ALLOWS AND DENIES.
   Reason codes only — no memory text, ever, in audit, logs, analytics, traces
   or error messages.

5. Billing (adapters, local by default)
   POST /v1/billing/reservations, GET /v1/billing, refund, webhook,
   local-checkout completion.
   - The local provider is a REAL state machine with no money in it: checkout
     returns a URL into this app, and webhooks are HMAC-signed exactly as a
     provider's would be, including the idempotent-replay path.
   - NO CARD DATA IS STORED.
   - A RELEASE IS NOT A REFUND: a `released` status distinct from `refunded`,
     with a reason code. (Phase 11 wires the storyteller's decline to it.)
   - Stripe's `verifyWebhook` FAILS CLOSED if you cannot test it. Say so in
     the adapter header, in the readiness doc and in .env.example rather than
     implying it works.

6. Admin — narrowly scoped, audited, and not reachable from the product
   GET /v1/admin/incidents, POST /v1/admin/incidents/:id,
   POST /v1/admin/break-glass, GET /v1/admin/archives/:id/operational.
   Admins have NO STANDING CONTENT ACCESS. Break-glass is purpose-limited,
   time-bound and audited by name. The `admin.` action prefix excludes these
   from every archive role INCLUDING storyteller, and the routes report
   NOT FOUND to non-admins.

7. Observability: pino logging with redaction, a local analytics adapter whose
   props schema admits numbers, booleans and a three-value severity ONLY, and
   an error monitor boundary. Health: /readyz, /v1/meta,
   /v1/operations/worker.

8. Notifications: NO SCHEDULER TO A FAMILY MEMBER EXISTS. No streaks, counts,
   nudges or reminders. Do not build one "for later".

## Definition of done

Named tests:
- "withdraws access, and every route stops answering at once"
- asserts a deletion request marks every step done and asserts all content is
  gone, measured against the database
- asserts an interrupted deletion RESUMES
- asserts the export zip is a real zip that reads back byte-identically,
  including an EMPTY FILE (where offset arithmetic usually breaks)
- asserts audit rows exist for DENIES as well as allows
- asserts the billing webhook is idempotent on replay
- asserts break-glass is required, time-bound and audited by name
- asserts an admin route reports NOT FOUND to a non-admin

## Do not

- Do not delete a source when a dispute hold is active. A hold freezes
  distribution WITHOUT deleting.
- Do not log a memory, a transcript, a question or an answer. Reason codes.
- Do not implement a "soft delete" that leaves content readable.
```
