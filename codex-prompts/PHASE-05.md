# Phase 05 — Capture and the pipeline

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §7, §8 and §5. Update
docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. THE PIPELINE, in this order, each step committing WITH the enqueue of the
   next so work is never orphaned:

     upload ticket → quarantine → scan → immutable original (checksummed)
       ├─ transcribe (audio/video)        ─┐
       └─ OCR (documents)                 ─┴→ extract candidates (quoted, located)
                                              → storyteller reviews and approves
                                                 ├→ embed for search
                                                 └→ build timeline / compose biography

2. EVERY HANDLER RE-CHECKS CONSENT WHEN IT RUNS.
   A job authorised at enqueue time may execute after consent was withdrawn.
   Trusting the earlier permission is how a system transcribes a recording
   somebody already asked it not to touch. A job refused at execution is marked
   `consent_revoked` and CANCELLED, not failed — it did not go wrong, it was
   obeyed.

3. Uploads
   Signed PUT ticket → quarantine → malware scan → promote to an immutable
   asset_version with a checksum. The local scanner recognises the EICAR test
   string and catches files whose bytes do not match their declared type, and
   IT DOES NOT CLAIM TO BE AN ANTIVIRUS — say so in its header.
   Validate size and MIME against UPLOAD_MAX_BYTES / UPLOAD_ALLOWED_MIME.
   Private storage; expiring HMAC-signed URLs; downloads audited.

   STORAGE_LOCAL_DIR MUST NOT be resolved against process.cwd(). Four
   processes run from four directories; resolving against cwd meant the worker
   wrote uploads and exports where the API could not find them, so in local
   development every export 404ed and every recording was unplayable, silently,
   for three releases (AL-005). Resolve it against a single fixed root.

4. Per-source privacy and processing choices
   PATCH …/sources/:id/privacy. Sensitivity, embargo_until, excluded-source
   and restricted-topic controls are per source, and they OVERRIDE every other
   grant.

5. Provider adapters, each with a DETERMINISTIC LOCAL implementation
   - STT local: CANNOT RECOGNISE SPEECH, and says so. It emits
     `no_recognisable_speech` rather than inventing words. A fabricated
     transcript would become a fabricated memory. It transcribes text captured
     alongside a recording and reports honestly when there is none.
   - OCR local: reads plain text and PDFs with a text layer; says a scan needs
     a real provider rather than returning nothing.
   - Embeddings local: hashed, deterministic.
   - LLM local: can only SELECT AND QUOTE from the archive. It cannot invent a
     memory — which is why demo mode exercises the real provenance and
     abstention paths rather than a happy path around them.
   The whole product must run offline with no credentials.

6. Candidate extraction
   Extraction QUOTES rather than paraphrases. Every claim carries: source,
   version, locator (page / timestamp / segment), method, model, prompt
   version, policy version, approval state and corrections.

7. The guided interview
   POST/GET interviews, answer, finish, approve-summary.
   - Versioned system prompt; ONE question at a time; always skippable;
     "prefer not to answer" is a first-class answer.
   - Follows unresolved references and NEVER inserts facts — it records an
     unresolved reference instead of guessing.
   - Distress handling STOPS THE FLOW and shows regional resources. Never
     advice, never a diagnosis. The safety_event carries NO CONTENT, only that
     it happened.

8. apps/worker: polls the queue, bounded concurrency, max attempts, and a
   seed command that builds the synthetic demonstration archive THROUGH THE
   REAL PIPELINE — not by inserting rows.

## Definition of done

Named integration tests, against a real database:
- "quarantines an upload until it is scanned"
- asserts the checksum and the promotion to an immutable version
- "produces a transcript whose words are exactly what was captured"
- "quotes the source exactly in every claim"
- asserts a job whose consent was withdrawn is CANCELLED, not failed
- asserts the local STT reports no_recognisable_speech rather than producing
  text
- unit tests: "records an unresolved reference instead of guessing", distress
  detection, injection inside an interview answer, a persona request

## Do not

- Do not have the local STT return placeholder words. Honest failure is the
  feature.
- Do not let extraction paraphrase. If it cannot quote, it has nothing.
- Do not write a memory here. Extraction produces CANDIDATES.
```
