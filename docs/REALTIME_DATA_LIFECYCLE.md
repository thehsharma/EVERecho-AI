# What a conversation leaves behind

Every piece of data a live conversation creates: where it lives, how long, who
can see it, and how it ends. Written to be checkable against the schema rather
than believed.

Companion to `DATA_LIFECYCLE.md`, which covers uploads and memories.

---

## The four layers

Physically separate tables, not one table with a status column. The separation
is the point: it is what stops a conversation quietly becoming family history.

| Layer | Where | Lives for | Who can see it |
| --- | --- | --- | --- |
| 1. Turn context | Process memory, inside one `SessionDriver` | The conversation | Nobody. It is never written anywhere |
| 2. Conversation record | `realtime_turn`, `realtime_event`, `transcript_revision` | Per the learning policy: `never`, `session`, or `until_deleted` | The person who held the conversation |
| 3. Candidate knowledge | `memory_candidate`, `memory_candidate_evidence` | Until decided, then kept as the record of the decision | The storyteller alone |
| 4. Approved archive knowledge | `memory`, `claim`, `claim_evidence`, `memory_embedding` | Until deleted | Whoever consent authorises |

Nothing moves from layer 3 to layer 4 without a person deciding. That is a
CHECK constraint (`candidate_only_preferences_skip_review`), an authorisation
rule (`learning.candidate.approve` is storyteller-only), and an evaluation
measured against the database (`live-nothing-auto-approved`) — three
independent mechanisms, because one would be a promise.

---

## Audio

The most sensitive thing here, and the default is not to keep it.

| Setting | What happens |
| --- | --- |
| `audioRetention: 'never'` (default) | Audio is transcribed in flight and discarded. `realtime_audio_segment` records that a segment existed — its duration, checksum and encoding — with `storage_status = 'not_stored'` and no storage key |
| `'session'` | Kept for the conversation, deleted when it ends |
| `'archive_source'` | The storyteller explicitly promoted the recording to a real archive source, and it is treated exactly like an upload |

Three structural guarantees:

1. **`realtime_audio_segment` has no column that could hold a voice embedding.**
   Not "we do not store one" — there is nowhere to put one. A stored voiceprint
   is the seed of exactly the cloning capability this product refuses.
2. **`realtime_audio_storage_requires_consent`** is a CHECK: a row may not
   carry `storage_status = 'stored'` while `consent_state = 'not_permitted'`.
   Storing audio nobody agreed to is not a bug that can happen; it is a write
   the database rejects.
3. **The live screen says which of the three is in force**, before anything is
   listening, in the same words on every screen: "Recording is not kept."

---

## Transcripts and corrections

A correction never overwrites. `realtime_turn.text` holds the current text and
`transcript_revision` holds every version with who changed it and why, because
what somebody actually said and what they later clarified are two different
facts and a product that collapses them has destroyed something.

Both are exported. Both are deleted with the archive.

---

## Interaction preferences

The only thing this product ever saves without asking, and only under an
explicit opt-in.

Exactly six keys, enforced by a CHECK allow-list on `interaction_preference`:
interface language, captions, speaking pace, interview pace, preferred session
length, clarifying-question frequency.

Nothing about anybody's life can be stored here — not because the code avoids
it but because the database refuses it. The `/account/preferences` screen shows
the complete list with no pagination and no "advanced" section, so a person can
verify that for themselves rather than take our word for it.

These are per person, not per archive. They are not deleted when an archive is
deleted, and they are exported only to the person they belong to.

---

## Retention, by table

| Table | Retention |
| --- | --- |
| `realtime_session`, `realtime_turn`, `realtime_event` | Per the learning policy's transcript setting |
| `transcript_revision` | With the turn it revises |
| `realtime_audio_segment` | Row always; audio object per the audio setting |
| `interruption_event`, `realtime_provider_usage` | With the session. Content-free by construction — counts, durations and latencies only |
| `realtime_safety_event` | With the archive. Labels only; the triggering text is never copied here, because a safety table is exactly where private material ends up being read by people who should not see it |
| `conversation_summary` | With the session |
| `memory_candidate` + evidence | Until decided; then kept as the record |
| `learning_decision` | With the archive. It is the proof that a person decided |
| `learning_policy` | Every version, with the archive. Consent history that loses its old versions is not history |
| `interaction_preference` | Until the person deletes it |
| `audit_event` | Outlives everything, deliberately. See below |

---

## Deletion

The plan runs in order, resumably, with each step committing its own
completion. The conversation steps are:

1. **`suggestions`** — before the memories they refer to. A suggestion holds
   the same words as the memory it produced, so deleting the memory and keeping
   the suggestion would delete nothing at all. Learning decisions go with them:
   they reference candidates with `ON DELETE SET NULL` and would otherwise
   outlive the deletion, and a decision note is something a person wrote about
   their own life.
2. **`conversations`** — **audio objects first**, while the rows that name them
   still exist. Cascading the rows away first would leave audio in object
   storage with nothing pointing at it: undeletable and unfindable, the worst
   possible outcome. Then the sessions, which cascade to participants, tokens,
   events, turns, revisions, audio rows, interruptions, summaries and usage.
   Safety events are deleted explicitly because some have no session and so do
   not cascade. The learning policy goes with the archive.

What survives, on purpose: the `audit_event` tombstone recording that the
deletion happened. Proving a deletion took place requires that the record of it
outlives the thing it deleted. The tombstone carries no content — an action, a
timestamp, and an archive id that now refers to nothing.

---

## Export

`conversations/` in the bundle:

| File | Contents |
| --- | --- |
| `conversations.json` | Every conversation with its turns, word for word |
| `corrections.json` | Every revision, with reason and time |
| `summaries.json` | What each conversation covered |
| `suggestions.json` | Everything proposed, with the words it came from |
| `decisions.json` | What was decided about each, and by whom |
| `learning-history.json` | Every version of what talking could be used for |
| `your-preferences.json` | The requester's own preferences, and nobody else's |

Open formats, no special software, a SHA-256 for every file in the manifest.

The folder holds text rather than audio, because recordings are not kept unless
they were explicitly asked for. The README says so, and says that the assistant
speaks in a generic synthetic voice that is not the storyteller's, and that no
recording of anyone's voice was ever used to make one.

---

## What is never written anywhere

- Memory text, transcript content, questions, filenames or audio in logs,
  analytics, traces, notification previews, email subjects, support dashboards
  or provider-health screens. Error paths carry reason codes; analytics props
  admit numbers, booleans and a severity enum by schema.
- A biometric voice embedding, anywhere, in any form.
- Anything from one archive in a query scoped to another. Forced RLS on 43
  tables, scoped per transaction, with an evaluation case that checks an
  unscoped connection sees zero rows.
