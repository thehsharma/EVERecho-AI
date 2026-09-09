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

---

## RT-013 — Frames are taken off the socket before admission finishes

**Decision.** The WebSocket handler attaches its `message` listener before its
first `await`, buffers what arrives during admission, and delivers it once the
driver exists. Frames are then handled one at a time, in order.

**Why.** The handshake completes before the route handler runs, so a browser
sends `session.hello` while the server is still reading consent from the
database. `ws` emits that frame whether or not anything is listening, so a
listener attached after those reads never hears it and the person waits at
"getting ready" over a socket that is open and perfectly healthy. Ordering is
the same class of problem one layer up: an interruption must not land before
the audio it was meant to interrupt.

**Reversal trigger.** A transport that guarantees delivery of pre-handshake
frames — LiveKit's data channel, for instance — would make the buffer
unnecessary. The ordering queue stays regardless.

---

## RT-014 — Hosted real-time providers are opt-in per stage, and local by default

**Decision.** Three independent drivers — `REALTIME_STT_DRIVER`,
`REALTIME_LLM_DRIVER`, `REALTIME_TTS_DRIVER` — each defaulting to `local`. The
local implementations are complete: the whole conversation runs with no
credentials and no network.

**Why.** Sending a finished transcript to a provider and sending live
microphone audio to one are different decisions, and a deployment should be
able to make them separately. A single `PROVIDER=hosted` switch would force a
deployment that wants a better recogniser to also send every question and every
answer off the host.

**Reversal trigger.** If the three stages are always configured together in
practice, collapse them into one setting.

---

## RT-015 — `mip_opt_out=true` is hard-coded, not configurable

**Decision.** Every Deepgram connection carries `mip_opt_out=true`. It is set
by the adapter, in code, with no environment variable able to change it. The
provider factory additionally refuses to start if any configured provider
declares `permitsModelTraining`.

**Why.** "No provider is ever permitted to train a model on this conversation"
is a sentence on a permissions screen that a storyteller reads before agreeing
to be recorded. A setting is something somebody can turn off; a hard-coded
query parameter and a start-up check are not.

**Reversal trigger.** None that keeps the promise. If a provider stops
offering an opt-out, the adapter is removed rather than the parameter.

---

## RT-016 — The model is given proposal tools only, and no retrieval tool

**Decision.** The hosted composer is offered six tools, all of which record an
intention for a person to review. It has no tool that reads an archive, and no
database, shell, HTTP or code-execution tool of any kind. Retrieval happens
before composition, authorised by the server, with only permitted passages
placed in the prompt.

**Why.** A model that can ask for evidence is a model whose requests have to be
authorised, and an authorisation path driven by model output is one more place
a prompt injection can aim at. Retrieving first means the question of what this
reader may see is settled before the model sees anything at all.

**Reversal trigger.** Multi-hop questions that pre-retrieval genuinely cannot
serve. The tool would then be added with its own `authorize()` call on every
invocation, never with the session's initial decision.

---

## RT-017 — The composer cites by passage number, and the server resolves it

**Decision.** Passages are numbered in the prompt; the model ends each sentence
with the numbers supporting it; the adapter strips the markers and maps them to
evidence ids. A clause whose citation is missing, malformed, or points at a
passage that was never supplied arrives with no evidence and is discarded by
the verifier.

**Why.** Free prose cannot carry structured citations reliably, and a tool call
per sentence would not stream. Numbering is the smallest thing that streams and
still fails safe: the worst outcome of a mis-citation is silence, never a
confident sentence attached to the wrong source.

**Reversal trigger.** A structured streaming format that carries citations
natively.

---

## RT-018 — Revocation is written to the database, not only to open sockets

**Decision.** Narrowing consent or the learning policy ends every live
conversation in the archive with an UPDATE, and *then* closes the sockets this
process holds. Each live connection also re-reads its own session every five
seconds.

**Why.** Closing the sockets one API instance happens to hold is not
revocation; it is revocation on one machine. The only thing every instance
shares is the database. A conversation mid-turn already obeys immediately —
consent is re-read before every decision point — so the sweep exists for the
one sitting silent between turns, which is exactly the case a person leaves
open on a tablet and forgets about.

**Reversal trigger.** A pub/sub channel every instance subscribes to would
replace the sweep with a push. The database write stays either way: it is what
makes the decision durable rather than in flight.

---

## RT-019 — Narrowing ends the conversation rather than trying to continue it

**Decision.** A learning policy that permits strictly less than before ends
every live session outright. Widening does not.

**Why.** A conversation in flight has retrieval, composition and synthesis at
different stages, each authorised a moment ago under rules that no longer hold.
Working out which of that is still permitted is a guess, and the failure mode
of guessing wrong is material a storyteller has just said they did not want.
Ending it costs them a restart; the alternative costs them the thing they were
trying to prevent. Widening is not narrowing and must not hang up on somebody
who just granted more — a distinction with its own test.

---

## RT-020 — A spending ceiling degrades to text; it does not end the call

**Decision.** Session, daily and archive-wide ceilings are checked before every
assistant turn. Reaching one turns the voice off and says so. The conversation
continues in text.

**Why.** An unbounded voice session is an unbounded invoice, and the person
holding the microphone has no idea what it is costing. But losing the voice is
an inconvenience and losing the session is losing what somebody was in the
middle of saying. The same reasoning applies to a speech provider whose circuit
has opened.

---

## RT-021 — Under backpressure, audio is dropped and text is not

**Decision.** When the socket's unsent buffer passes half a megabyte, audio
frames are dropped and everything else is still sent. The person is told once.

**Why.** `send` never blocks, so a browser on a slow connection does not slow
the server down — it makes it accumulate. Something has to give, and audio is
the right thing: a gap in the audio is a gap, while a transcript missing a
clause is a transcript that lies about what was said.

---

## RT-022 — Everything a conversation produced is exported and deleted with it

**Decision.** The export bundle carries the conversations word for word, their
corrections, the summaries, every suggestion with the words it came from, every
decision made about one, all learning-policy versions, and the requester's own
preferences. Deletion removes all of it, and the stored audio objects before
the rows that name them.

**Why.** An export that covered uploads but not conversations would be quietly
keeping something back, and a deletion that removed a memory but left the
suggestion it came from would delete the memory while keeping the same words.
Deleting the audio objects first matters for a different reason: cascading the
rows away first would leave the audio in object storage with nothing pointing
at it, which is the worst possible outcome — undeletable and unfindable.
