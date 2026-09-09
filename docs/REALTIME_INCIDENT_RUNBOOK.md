# Real-time conversation: incident runbook

For an operator at three in the morning. Each entry names the signal, what it
means, what to do, and what not to do.

The rule that governs all of them: **no incident is a reason to read a
conversation.** There is no operator path to memory text, transcripts or audio,
and adding one to diagnose an outage would be a larger incident than the one
being diagnosed. Everything below is diagnosable from reason codes, counts and
timings, and if something is not, that is a gap to fix in the instrumentation
rather than an exception to make.

---

## 1. People report "Getting ready" that never becomes ready

**Signal.** `socket refused` warnings absent, sessions created, sockets
upgraded, no `session.state` reaching clients.

**Most likely.** A frame arriving before the handler is ready to hear it. This
was a real defect (see `REALTIME_PRODUCTION_READINESS.md` §5) and is fixed and
pinned by a test, so a recurrence means the fix has been regressed — check that
`socket.on('message', …)` in `ws.ts` is still attached before the first
`await`.

**Also possible.** The origin allow-list. If `WEB_PUBLIC_URL` does not exactly
match the browser's origin — scheme, host and port — every upgrade is refused
with `origin_not_allowed`, which the logs will show.

**Do not.** Widen the origin list to "make it work". A permissive origin check
is indistinguishable from no origin check, and a WebSocket upgrade carries
cookies cross-origin.

---

## 2. The assistant abstains far more than usual

**Signal.** A rise in turns with `abstained = true`, or a flat count of
`assistant.citation` events against a normal count of user turns.

**Diagnose.** Abstention is correct behaviour, so the question is which kind:

| Reason code | Meaning | Action |
| --- | --- | --- |
| `insufficient_evidence` | Retrieval returned nothing | Check that approved memories still have embeddings — a failed `embed_memory` job leaves memories invisible to search |
| `question_not_covered` | Evidence found but it does not answer the question | Usually correct. A spike suggests a retrieval regression |
| `prohibited_request` | Somebody asked it to be the person | Correct. Never "fix" |
| `provider_error` | The composer failed | See §3 |

**Do not.** Lower `MIN_QUESTION_COVERAGE` to reduce abstention. It exists
because a cited but irrelevant quotation looks more reliable than no answer,
not less.

---

## 3. A provider is failing

**Signal.** `provider_unreachable`, `provider_rate_limited` or
`provider_error`, then a `speech_provider_unavailable` warning to clients.

**What already happened.** The breaker opened after three consecutive failures
and turns degraded to text. Conversations continue. This is the designed
behaviour, not the incident.

**Do.** Check the provider's status page. The breaker probes once per cooldown
(30 s by default) and closes itself when the probe succeeds; nothing needs
restarting.

**If it is a credential problem** (`provider_unauthorised`), rotate the key and
restart the API. Conversations in flight continue in text.

**Do not.** Restart to "clear" a breaker. It costs every live conversation its
socket to skip a thirty-second wait that is already handling itself.

---

## 4. Spend is climbing

**Signal.** `realtime_provider_usage.estimated_cost_minor` rising faster than
sessions, or people reporting the voice switching off.

**What already happened.** A ceiling was reached and conversations degraded to
text. Nobody was cut off.

```sql
-- Today, by archive. Counts and money only; no content.
SELECT archive_id, sum(estimated_cost_minor) AS minor, count(*) AS sessions
  FROM realtime_provider_usage
 WHERE updated_at >= date_trunc('day', now())
 GROUP BY archive_id ORDER BY minor DESC LIMIT 20;
```

**Do.** Decide whether the ceiling is wrong or the usage is. Raising
`REALTIME_SESSION_BUDGET_MINOR` is a business decision, not an incident
response.

**Do not.** Set a ceiling to zero to stop spend. Zero means every conversation
is text-only, which people will read as the product being broken.

---

## 5. A storyteller says they withdrew consent and it is still talking

**Treat this as urgent.** It is the most serious class of failure this product
has.

**Check, in order:**

```sql
SELECT id, state, ended_at, ended_reason FROM realtime_session
 WHERE archive_id = $1 AND ended_at IS NULL;
```

If rows come back, `endLiveSessions` did not run — check that the consent or
learning-policy route committed. If rows are ended but a client is still
talking, the five-second sweep is not running: check that the connection's
interval was not cleared early.

**Immediate mitigation.** Ending the sessions in the database is sufficient:
every instance's sweep closes its sockets within five seconds, and every
decision point re-reads consent regardless.

```sql
UPDATE realtime_session
   SET state = 'ENDED', ended_at = now(), ended_reason = 'operator_intervention'
 WHERE archive_id = $1 AND ended_at IS NULL;
```

**Then.** Record it, tell the storyteller what happened in plain language, and
write the regression test before the fix.

---

## 6. Captions lag, or audio is choppy

**Signal.** `connection_too_slow_for_audio` warnings.

**Meaning.** Backpressure. The socket's unsent buffer passed half a megabyte
and audio frames were dropped so that text would keep flowing. This is the
designed trade: a gap in the audio is a gap, while a transcript missing a
clause is a transcript that lies.

**Do.** Check whether it is one person's connection or many. Many means look at
the server's egress, not at the code.

---

## 7. Sockets are refused with `too_many_sessions`

**Meaning.** One account has three conversations open. Usually a browser that
left sockets behind, not abuse.

**Do.** Confirm with `liveConnectionCount()` and the registry's own pruning of
closed sockets. If the count is genuinely stale, restarting the API clears it
without data loss: session state lives in PostgreSQL, so losing the registry
loses connections and never data.

---

## 8. Something was said that should not have been

**The one incident where speed matters less than care.**

1. Find the turn: `realtime_turn` by session and index. Its `claims` column
   holds what was cited.
2. Check whether verification ran: a turn with claims and no evidence rows
   means the verifier was bypassed, which is a code defect of the highest
   severity.
3. Check `realtime_safety_event` for `first_person_composition_discarded` —
   the system catching itself.
4. Preserve the evidence, then disable the hosted composer
   (`REALTIME_LLM_DRIVER=local`) rather than trying to patch a prompt. The
   local composer is extractive and cannot invent.
5. Tell the family what happened. They heard it; they are owed an account of
   it.

**Do not.** Delete the turn. It is the evidence, and the person it happened to
has a right to it.
