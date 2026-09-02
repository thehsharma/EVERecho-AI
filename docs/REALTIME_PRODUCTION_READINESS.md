# Real-time conversation: production readiness

What has actually been run, what has not, and what a deployment must do before
a real family uses this. Every claim carries an evidence label:

| Label | Meaning |
| --- | --- |
| **VERIFIED** | Executed in this build; the output is in the transcript. |
| **SOURCE-SUPPORTED** | Stated by an authoritative document, not executed here. |
| **INFERENCE** | Reasoned from something verified. |
| **ASSUMPTION** | Believed, not established. |
| **UNKNOWN** | Not established, and not guessed. |

Last updated: Phase 4 of the v0.2 build.

---

## 1. The short answer

The conversation is **complete and running end to end with no paid
credentials**. The hosted provider adapters are **written, type-checked and
unit-tested against the published protocols, and have never been executed
against a real provider**. Nothing in this repository has been deployed, and no
money has been spent.

A deployment that changes nothing sends nothing anywhere. That is the default,
not a configuration a careful operator has to remember to choose.

---

## 2. What was executed

**VERIFIED**, at the end of Phase 4:

| Check | Result |
| --- | --- |
| Unit and integration tests | 378 passed, 15 files |
| Browser tests (Chromium, two viewports) | 80 passed |
| AI evaluations | 32/32 cases; four release-blocking targets met |
| Typecheck (`tsc --noEmit`, whole graph) | clean |
| Lint (`eslint .`) | clean |
| Format (`prettier --check`) | clean |

The browser suite was run six consecutive times with no failure after the
transport defect described in §5 was fixed.

**VERIFIED**: the WebSocket media plane is tested against a real listening
server — a real handshake, real cookies, real origin checks — not a mock.

**VERIFIED**: the deterministic local providers are not a happy path around the
product's rules. They run the same authorisation, retrieval, verification,
audit and provenance code as a hosted deployment would.

---

## 3. What has *not* been executed

**UNKNOWN** — every one of these is untested against the real service, and no
statement about how it behaves in production should be made from this build:

| Adapter | Status |
| --- | --- |
| `AnthropicStreamingLanguageModel` | Never called the Claude API. Written against the published streaming and strict-tool-use documentation; its stream handling is tested by replaying the documented event sequence. |
| `DeepgramStreamingSpeechToText` | Never connected to Deepgram. URL, headers, framing and message parsing tested through an injected socket. |
| `DeepgramStreamingTextToSpeech` | Never connected to Deepgram. Same. |
| LiveKit transport | Not written. The WebSocket plane is the transport; see RT-002 and RT-013. |

**SOURCE-SUPPORTED**: the protocol details these adapters implement — the
Messages API streaming events and `strict: true`, Deepgram's `/v1/listen` and
`/v1/speak` WebSocket messages, and `mip_opt_out` — come from the vendors'
current documentation, consulted during Phase 4.

### What a first real run has to establish

None of this can be answered from here:

1. Whether Deepgram's `Results` frames arrive at the cadence the caption UI
   assumes, and what its interim/final ratio does to the turn detector.
2. Whether `endpointing=300` is right for a storyteller who pauses to think.
   **ASSUMPTION**: it is too aggressive for elderly speakers and will need
   raising; the local turn detector already waits 1800 ms in interview mode for
   this reason.
3. Real first-token and first-audio latency, end to end, on Indian networks.
4. Whether `strict: true` tool calls arrive intact under streaming with
   `input_json_delta`, including for the six-key enum in
   `record_low_risk_preference_candidate`.
5. Whether the model reliably ends sentences with `[n]` citation markers, and
   what share of clauses are consequently discarded by the verifier. A high
   discard rate would show up as an assistant that abstains too often — safe,
   but not useful.
6. Cost per minute of conversation, measured rather than modelled.

---

## 4. The promises, and where each one actually lives

A promise that lives only in a prompt is not a promise. This is where each of
the product's commitments is enforced.

| Promise | Enforced by | Evidence |
| --- | --- | --- |
| No provider trains on this conversation | `mip_opt_out=true` hard-coded in the adapter; provider factory refuses any provider declaring `permitsModelTraining`; config refuses `AI_PROVIDER_NO_TRAINING=false` alongside a hosted real-time driver | **VERIFIED** by test |
| The storyteller's voice is never synthesised | Fixed table of generic stock voices in code; adapter throws at construction on anything else; `isPermittedVoice` allow-list; no database column can hold a voiceprint | **VERIFIED** by test and by schema |
| Nothing is spoken that is not supported by cited evidence | Per-clause verification before synthesis; unsupported clauses discarded, not rewritten | **VERIFIED** by test |
| The assistant never speaks as the storyteller | Server-side attribution, then third-person assertion; a clause that still reads as first person is discarded and a safety event recorded | **VERIFIED** by test |
| It says it does not know rather than guessing | Abstention on empty, irrelevant, contradictory or restricted evidence; question-coverage floor | **VERIFIED** by test and by evaluation |
| No biographical memory is saved without review | Candidates are proposals; approval is the storyteller's alone in the consent matrix; six-key CHECK constraint on the only auto-saved table | **VERIFIED** by test and by schema |
| Revocation is obeyed mid-sentence | Consent re-read at five points per turn, not captured at connect | **VERIFIED** by test |
| No memory text in logs, traces or analytics | Reason codes only on every error path; analytics props admit numbers, booleans and a severity enum by schema | **VERIFIED** by test |
| No provider key reaches the browser | Adapters are server-side only; the browser holds a session cookie and nothing else | **VERIFIED** by inspection |

**INFERENCE**, and worth stating plainly: `retentionDays: 0` on the hosted
adapters is a *declaration*, not an enforcement. Zero retention is a
contractual setting on the provider account. This code cannot verify it, and a
deployment that has not arranged it is making a promise it cannot keep.

---

## 5. The defect found by running it

**VERIFIED.** The browser suite failed intermittently — one to three tests per
run — always with the live screen stuck at "Getting ready".

The cause: `@fastify/websocket` completes the handshake and *then* calls the
route handler. The browser sees the 101, fires `open`, and sends
`session.hello` while the handler is still reading the session, the membership
and the consent policy from the database. `ws` emits that frame whether or not
anything is listening, so the listener — attached after those reads — never
received it. The socket stayed open and healthy; the client waited for a state
that had been silently dropped.

Two further defects surfaced in the same code: frames were dispatched into
independent promises, so a later frame could overtake an earlier one; and a
socket that closed during admission was registered afterwards, leaving an entry
no close event could remove.

All three are fixed and pinned by tests, including one that reproduces the race
deterministically by sending the frame in the same write as the upgrade request.

This is recorded here rather than quietly fixed because it is the clearest
evidence in the build for a general point: a conversation that works every time
in development can be broken by a race that only a real browser on a real
network reaches, and no amount of unit testing would have found it.

---

## 6. Before a real family uses this

Not yet done. In order:

1. **Provider contracts.** Zero retention and no training, in writing, on the
   account. Without these, §4's declarations are unsupported.
2. **Run the adapters.** Every item in §3 needs a real run and a recorded
   result. Until then this document must keep saying UNKNOWN.
3. **Reliability** (Phase 5): reconnection under real packet loss, backpressure
   under a slow consumer, per-session and per-archive cost limits, circuit
   breakers, cancellation across instances.
4. **Learning pipeline** (Phase 6): duplicate and contradiction detection at
   scale, correction versioning, embedding refresh on approval, revocation and
   deletion propagation with receipts.
5. **Accessibility and evaluation** (Phase 7): axe scans on the five new
   screens, realtime evaluation cases, latency and cost measurement.
6. **A legal review** of the consent and learning documents, which has not
   happened and is not something this build can substitute for.

**Do not deploy this to real people until §3 is empty and §6 is done.**
