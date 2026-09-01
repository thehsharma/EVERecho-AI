# Realtime decision log

Continues `docs/DECISION_LOG.md` (D-001 … D-015). Every entry states what was
decided, why, and what would change the decision.

---

## RT-001 — Realtime is a bounded module in `apps/api`, not `apps/realtime`

**Decision.** `apps/api/src/realtime/` over a transport-independent
`packages/realtime`. No new deployable service in v0.2.

**Why.** `withArchiveAccess()` is the only source of an archive-scoped
transaction; it assembles the actor from the database and writes the audit row.
A separate service would duplicate that or add a network hop inside the
first-audio latency budget. Fastify upgrades WebSockets on the same server and
the same session cookie, so admission control reuses the existing authenticated
hook rather than inventing a second authentication path.

**Reversal trigger.** Concurrent sessions high enough that audio framing delays
REST latency on the same event loop; a need to scale voice independently; or
failure isolation from a hung provider stream.

---

## RT-002 — WebSocket transport in v0.2; WebRTC deferred

**Decision.** Binary WebSocket frames, behind the `RealtimeTransport` interface.

**Why.** WebRTC requires ICE/TURN and a media server for anything beyond a peer
connection — the infrastructure LiveKit exists to sell. Adopting it before any
deterministic test exists would place a vendor in the media path with nothing to
measure it against. WebSocket is testable in CI with synthetic audio and no
microphone.

**Known cost.** TCP head-of-line blocking under packet loss, which WebRTC would
absorb. `INFERENCE`, not measured. Reversal trigger: measured p95 caption drift
above 1 s on real networks.

---

## RT-003 — Learning policy is a separate document from the consent policy

**Decision.** A `learning_policy` table and its own compiler, versioned and
hashed like `consent_policy`, rather than new fields on the consent document.

**Why.** They answer different questions and change on different schedules.
Consent asks what may be done with material the storyteller has given.
Learning asks what a *conversation* may become. Folding them together would
force a fresh teach-back for a caption-preference change, and would let a
consent migration silently alter learning defaults. Separation also lets
`authorize()` keep its existing shape: learning actions consult the learning
policy through the same obligations mechanism.

**Cost.** Two documents for a user to understand. Mitigated by the learning
policy being presented as part of one setup flow, and by the consent mode
remaining a hard ceiling over it.

---

## RT-004 — Consent mode remains a ceiling over the learning policy

**Decision.** A learning policy can only narrow what consent already permits. It
can never widen. `candidateExtraction` requires at least `organise`;
retrieval-affecting approval requires `explore`; live composition requires
`compose`.

**Why.** Two independent grant systems that can each widen the other is how
permission systems develop holes. One ceiling, one narrowing layer, checked in
the same pure function.

---

## RT-005 — Four memory layers, physically separate tables

**Decision.** Turn context (in-session, not persisted as evidence), conversation
record (`realtime_turn`, `transcript_revision`), candidate knowledge
(`memory_candidate`), approved archive knowledge (existing `memory`/`claim`).

**Why.** The failure this product cannot have is a conversation quietly becoming
family history. Physical separation makes that a schema violation rather than a
code-review question: nothing in the retrieval query can reach
`memory_candidate`, because the retrieval query does not name that table.

---

## RT-006 — Partial transcripts are structurally ineligible as evidence

**Decision.** `realtime_turn.is_final` gates candidate extraction, and
`memory_candidate_evidence` has a foreign key only to final turns. An
interrupted assistant turn is stored with `cancelled = true` and never becomes
evidence for anything.

**Why.** A half-heard sentence is the most dangerous input this system can
receive: it looks like a quotation and is not one.

---

## RT-007 — Low-risk preference auto-save is an explicit, enumerated allow-list

**Decision.** `interaction_preference.key` is constrained by a `CHECK` to a
closed set of six interface preferences. Everything else requires review.

**Why.** An allow-list fails closed when someone adds a new preference type; a
deny-list fails open. The constraint lives in the database so that a bug in
application code cannot write a preference the policy does not name.

---

## RT-008 — No biometric voiceprint, ever, at the schema level

**Decision.** `realtime_audio_segment` stores encoding, rate, channels,
duration, checksum, and consent/retention state. There is no column that can
hold a speaker embedding.

**Why.** A voiceprint is biometric data and the seed of exactly the cloning
capability this product refuses. The strongest guarantee is having nowhere to
put one.

---

## RT-009 — Assistant voice is a named generic provider voice, recorded per turn

**Decision.** Every generated audio turn records `tts_provider` and `voice_id`.
The local adapter's voice id is `local-neutral-synthetic-v1`.

**Why.** The claim "we never use the storyteller's voice" should be auditable
after the fact, not merely asserted. Recording the voice id per turn makes it
checkable against a known allow-list.

---

## RT-010 — TTS receives only verified clauses

**Decision.** Text is segmented into clauses, each clause is verified against
its citations, and only verified clauses are sent to the speech synthesiser.
A clause that fails verification is never spoken, even if generation already
produced it.

**Why.** Speech cannot be retracted. A sentence that appears in text for 200 ms
and is then removed is a UI glitch; the same sentence spoken aloud is something
a family member heard.

---

## RT-011 — Live consent re-check at five points, not once per session

**Decision.** Consent is re-checked before retrieval, before model context
assembly, before synthesis, before persistence, and before post-session
extraction — not once at session start.

**Why.** Sessions are long. A storyteller who revokes mid-sentence must be
obeyed mid-sentence, which is impossible if the session captured its permission
at connect time.

---

## RT-012 — Server is the sole authority on session state

**Decision.** The client may render state and request transitions; it may never
assign one. Every server event carries a monotonic sequence number, and
duplicate client events are idempotent by `(session_id, client_event_id)`.

**Why.** A client-authoritative state machine is a permission system a user can
edit in a debugger.
