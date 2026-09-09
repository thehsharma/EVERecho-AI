# Data lifecycle

From the moment something arrives to the moment it is gone, and what is retained
on purpose.

## A recording, end to end

| Stage | Where it lives | What may touch it | How long |
|---|---|---|---|
| Upload reserved | `source_asset` row, status `uploading` | Nothing | Until confirmed or abandoned |
| Bytes arriving | Quarantine key in object storage | The scanner only | Minutes |
| Scanned clean | Promoted to `archives/{id}/original/{sourceId}/v1`, checksum recorded in `asset_version` | Nothing reads it without a consented activity | Until deleted |
| Scanned infected | Deleted immediately; `security_event` written | — | Not retained |
| Transcribed | `transcript`, `transcript_segment` | Only if `transcription` is consented and the source is not excluded | Until deleted |
| Extracted | `memory`, `claim`, `claim_evidence` as **candidates** | Invisible to everyone but the storyteller | Until approved or rejected |
| Approved | Same rows, status `approved` | Searchable and answerable within the consent policy | Until deleted |
| Indexed | `memory_embedding` | Retrieval | Until the memory changes or is deleted |
| Answered from | `generated_response`, `response_claim`, `retrieval_snapshot` | The person who asked | Until deleted |

The original is never edited. Corrections and re-transcriptions become new rows
that reference it.

## Retention

| Data | Retained | Why |
|---|---|---|
| Memory content | Until the storyteller deletes it | It is theirs |
| Consent versions | For the life of the archive | "What had they agreed to in March?" must stay answerable |
| Audit events | For the life of the archive, plus a deletion tombstone that outlives it | Proving a refusal or a deletion happened requires the record surviving |
| Export archives | 7 days, then the object expires | A download link that lives forever is a second copy nobody is tracking |
| Sessions | `SESSION_TTL_SECONDS`, default 14 days | — |
| Invitations | Until answered or `expiresInDays`, default 14 | An invitation that never expires is a permanent standing offer |
| Security events | Indefinitely | Small, no content, and needed to see patterns |
| Analytics | Indefinitely | Opaque ids and counts only |
| Provider-side copies | `AI_PROVIDER_RETENTION_DAYS`, default 0 | Consented separately and explicitly |
| Backups | Operator-defined; see `BACKUP_RESTORE.md` | The one place deleted content persists |

## Deletion

Ordered so that nothing is ever left pointing at something already gone:

1. **Generated answers and artefacts** — the most derived, and the most
   surprising to a family if it survived.
2. **Embeddings** — search indexes.
3. **Claims and their evidence links.**
4. **Story cards**, and for a whole archive, events, entities and places.
5. **Transcripts.**
6. **Stored objects** — originals, derived files, and any export archives.
7. **Remaining rows** — sources, interviews, provenance, corrections.
8. **Caches**, by archive prefix.
9. **Queued work**, cancelled.
10. **An audit tombstone**, written and kept.

Each step commits its own completion into `deletion_request.steps`, so a crash
resumes rather than restarting, and the person watching sees real progress
rather than a spinner.

**Scopes.** A whole archive, one source (and everything derived from it), or one
story. Deleting a source removes the claims that cited it, which is why the
evaluation suite asserts that no evidence rows and no orphaned vectors remain.

**What deletion does not reach.** Backups taken before it, until they age out.
Any export the storyteller already downloaded — that copy is theirs. The audit
tombstone, deliberately.

## Revocation, which is not deletion

Withdrawing access takes effect at once: the membership is revoked, caches for
the archive are cleared, signed links stop verifying when they expire (default
five minutes), retrieval stops returning the material, and queued processing
that is no longer permitted is cancelled in the same transaction. Nothing is
destroyed — the storyteller can grant access again.

Narrowing consent behaves the same way: cancelled jobs, cleared caches, a new
policy version. The worker re-checks at execution time as a second line, because
a job may already have been claimed.

## Data residency

`DATA_REGION` is recorded on every archive and shown in the interface footer.
Enforcing it is a deployment concern — one installation per region, with
storage and database in that region. The application does not move data between
regions and has no cross-region code path.
