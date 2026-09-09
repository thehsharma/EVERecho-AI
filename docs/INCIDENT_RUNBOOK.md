# Incident runbook

## First, decide which kind of incident this is

| Kind | Looks like | Page? |
|---|---|---|
| **Consent** | Someone saw something they should not have | Yes, immediately |
| **Safety** | Distress language, a storyteller in danger | Yes, immediately |
| **Security** | Suspected takeover, injection succeeded, data exposure | Yes |
| **Accuracy** | A fabricated or wrongly-cited claim reached a reader | Same day |
| **Availability** | Uploads failing, jobs dead-lettering, API down | Same day |

Consent and safety outrank everything, including availability. An archive that
is down is a bad day. An archive that showed a family something the storyteller
withheld is the product failing at the only thing it promised.

## Common to every incident

1. **Record it first.** `POST /v1/admin/incidents` — or insert into `incident`
   if the API is the thing that is broken. Summary is metadata only, never
   content.
2. **Do not open the archive.** Support has no standing content access, and the
   answer is almost never inside it. If operational metadata is genuinely
   needed, request break-glass with a stated purpose; it is time-bounded and
   appears in the storyteller's own activity log.
3. **Preserve the audit trail.** It is append-only; do not attempt to prune it.

## Someone saw something they should not have

1. **Stop the exposure.** Revoke the membership
   (`PATCH /v1/archives/:id/members/:membershipId`, `status: revoked`). This
   clears the archive's caches in the same request.
2. **Establish the blast radius** from the audit trail:
   ```sql
   SELECT created_at, actor_display, action, resource_type, outcome, reason_code
   FROM audit_event
   WHERE archive_id = $1 AND actor_user_id = $2
   ORDER BY created_at DESC;
   ```
   Allowed `source.download` and `export.download` rows are the ones that mean
   bytes actually left.
3. **Find the decision that allowed it.** Every allow records a
   `policy_version`. Load that consent version and re-run `authorize()` against
   it in a unit test with the exact actor, action and resource. Either the
   policy permitted it — a product or copy failure — or the engine has a bug.
4. **Write the failing test before the fix.** The consent matrix is the one
   place in this codebase where a regression is unacceptable.
5. **Tell the storyteller.** Plainly, without minimising, in their own activity
   log and directly. They are the person harmed.

## Distress language during an interview

The interview stops itself and shows region-appropriate emergency information;
a `safety_event` is recorded with **no content**, only that it happened.

1. Do not open the archive to see what was said. It will not help and it is not
   yours to read.
2. Confirm the emergency information shown for `SAFETY_EMERGENCY_INFO_REGION` is
   correct and current.
3. Escalate to whoever holds the duty-of-care role at
   `SAFETY_ESCALATION_EMAIL`. EverEcho is not a crisis service and must not
   behave like one.
4. If the pattern list missed something it should have caught, add it to
   `DISTRESS_PATTERNS` with a test — that is a release-blocking fix.

## A fabricated or mis-cited claim

1. Get the `generated_response` id from the reader. Its `retrieval_snapshot_id`
   records exactly what was retrieved, and `model_and_prompt_version` records
   what composed it.
2. Check whether the claim's citations resolve to real `claim_evidence` rows.
   If they do not, verification failed — that is release-blocking.
3. Add the question to `apps/api/evals/gold-set.ts` as a case. If it should have
   abstained, expect abstention.
4. Run `pnpm eval`. It fails the build if citation correctness drops below 95%,
   unsupported claims rise above 1%, sensitive abstention falls below 100%, or
   any permission leak appears.

## Jobs dead-lettering

A job that gives up raises an `availability` incident automatically.

```sql
SELECT type, count(*), max(last_error)
FROM processing_job WHERE status = 'dead_lettered' GROUP BY type;
```

`consent_revoked` in `last_error` is **not** a failure — it means the
storyteller withdrew permission after the job was queued and the worker stopped,
which is the system working. Anything else is a real fault. Fix the cause, then
requeue by setting `status = 'queued'` and `run_after = now()`.

## The API is down

1. `GET /readyz` names which dependency is unhealthy.
2. `degraded` with `vector_index` is not an outage — it means the portable
   search path is in use.
3. Check the worker separately. The API can be healthy while nothing is
   processing; `GET /v1/operations/worker` shows queue depth and the age of the
   oldest waiting job.

## Afterwards

Every incident gets a resolution note and, where it revealed a gap, a test.
Consent and accuracy incidents also get an entry in `DECISION_LOG.md` if they
changed how something works — the next person needs to know why.
