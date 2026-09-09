# Backup and restore

An archive that cannot be restored is not backed up. Everything here assumes a
restore is rehearsed, not hoped for.

## What has to be backed up together

Three stores that must be consistent with one another:

| Store | Contains | If it alone is lost |
|---|---|---|
| PostgreSQL | Everything except file bytes | Total loss: the files remain but nothing knows what they are |
| Object storage | Originals, derived files, exports | Story cards survive with citations pointing at nothing |
| Secrets | `SESSION_SECRET`, `STORAGE_SIGNING_SECRET`, provider keys | Sessions and signed links break; data is intact |

The database references object keys. Restoring a database newer than the object
store leaves dangling references; the other way round leaves orphaned bytes.
**Snapshot the database first, then the object store**, and record both
timestamps together.

## Recommended shape

```bash
# Database — a consistent snapshot
pg_dump --format=custom --no-owner --no-privileges \
  --file="everecho-$(date -u +%Y%m%dT%H%M%SZ).dump" "$DATABASE_URL"

# Object storage — versioned bucket replication to a second region is
# preferable to a copy job you have to remember to run.
aws s3 sync "s3://$S3_BUCKET" "s3://$BACKUP_BUCKET" --delete
```

Backup storage is production data. It carries the same encryption, the same
access restriction and the same audit expectation. Anyone who can read a backup
can read every family's memories.

## Restoring

```bash
createdb everecho_restored
pg_restore --no-owner --no-privileges --dbname=everecho_restored backup.dump
DATABASE_URL=postgres://.../everecho_restored pnpm db:migrate   # no-op if current
```

Then point the object storage configuration at the restored bucket and start the
API against the restored database.

## Proving a restore worked

Not "the process exited zero". These:

```sql
-- Every source's bytes are still reachable, and its checksum still matches.
SELECT count(*) FROM source_asset WHERE deleted_at IS NULL AND storage_key = '';
-- expect 0

-- Every claim still has evidence.
SELECT count(*) FROM claim c
WHERE NOT EXISTS (SELECT 1 FROM claim_evidence e WHERE e.claim_id = c.id);
-- expect 0

-- Consent is intact: exactly one current policy per archive that has any.
SELECT archive_id, count(*) FROM consent_policy WHERE superseded_at IS NULL
GROUP BY archive_id HAVING count(*) <> 1;
-- expect no rows

-- No orphaned embeddings.
SELECT count(*) FROM memory_embedding e
WHERE NOT EXISTS (SELECT 1 FROM memory m WHERE m.id = e.memory_id);
-- expect 0
```

Then a functional check, which is the one that matters: sign in as a
storyteller, open a story, click a citation and confirm the quoted passage
appears. Provenance surviving a restore is the whole product surviving a
restore.

## Deletion and backups

A backup taken before a deletion still contains the deleted material. This is
the one place where "deleted" is not immediately true, and it must be stated
honestly to storytellers rather than glossed.

Two defensible policies. Pick one, write it down, and tell people which:

1. **Short retention** — backups age out within a stated window (30 days is
   common), and an erasure request is complete when the last backup containing
   it expires. Simple, and the delay is explainable.
2. **Erasure replay** — deletions are re-applied to a restored backup before it
   is ever promoted. Stronger, and considerably more machinery.

v0.1 assumes the first and does not implement the second.

## Rehearsal

A restore that has not been performed is a plan, not a backup. Quarterly, into
a scratch database, running the queries above and the functional check. Record
the date and the measured recovery time; a recovery objective nobody has timed
is a guess.

## Disaster recovery targets

| | Target | What it depends on |
|---|---|---|
| Recovery point | ≤ 24 hours | Snapshot frequency; continuous archiving reduces this to minutes |
| Recovery time | ≤ 4 hours | Database size and object-store replication |

These are **stated intentions, not measured results**. Nothing in this build
session exercised a restore — no second environment existed. Measure them before
promising them to anyone.
