# ADR: build the media plane, buy the models

**Status.** Accepted for v0.2. Revisit when any reversal trigger below fires.

**Decision.** EverEcho runs its own WebSocket media plane and its own turn
orchestration, and buys speech recognition, composition and speech synthesis
as replaceable adapters behind typed interfaces. It does not adopt an
end-to-end realtime voice-agent platform.

---

## What was actually considered

| Option | What it gives | Why not, or not yet |
| --- | --- | --- |
| **End-to-end voice agent platform** (a hosted "talk to your data" product) | Fastest path to a demonstration | The safety argument is the product. Verification per clause before synthesis, third-person assertion, abstention, consent re-read at five points per turn — none of these is a setting on a platform, and a platform that speaks before we have verified is not usable at any price |
| **LiveKit Agents** (WebRTC transport plus an agent framework) | Real WebRTC: jitter buffers, packet loss, echo cancellation, mobile networks. A mature realtime stack | Genuinely better transport than ours. Rejected *for now* on scope, not on merit — see below |
| **A realtime speech-to-speech model** (audio in, audio out) | Lowest latency, most natural turn-taking | Structurally incompatible. Audio-to-audio gives no intermediate text to verify against evidence, so there is no point at which a claim can be checked before it is spoken. The whole product would become "trust the model" |
| **Own media plane, bought models** (chosen) | Every safety property is ours to enforce; providers are replaceable | We own reconnection, backpressure, jitter and mobile-network behaviour, which are not trivial |

---

## Why the speech-to-speech option is not a cost decision

It is worth being explicit, because it will be proposed again and it is the
most attractive option on every axis except one.

A speech-to-speech model produces audio directly from audio. There is no clause
to verify, no citation to attach, and no moment between "the model decided what
to say" and "a grieving family member heard it". Every safety property this
product has depends on that moment existing:

- per-clause verification against cited evidence
- third-person assertion, with a first-person clause discarded rather than
  rewritten
- the exact abstention sentence when the evidence does not support an answer
- server-composed attribution, so the model cannot supply its own presentation
  text

None of these can be bolted onto audio-to-audio. Adopting it would not be
trading safety for latency; it would be removing the mechanism by which safety
is possible at all.

**This is not reversible by a better model.** A more accurate speech-to-speech
model is still one with no verification point.

---

## Why not LiveKit, given it is better transport

Three reasons, in order of weight:

1. **The transport is not where the risk is.** Our WebSocket plane moves bytes
   and decides nothing: admission, authorisation, retrieval, persistence and
   what may be learned all live in the driver. Swapping the transport is an
   adapter change, which is exactly why the driver was made
   transport-independent before the socket was written.
2. **It would have been the third thing to get right at once.** The consent
   model, the learning policy and the verification pipeline were all new in
   v0.2. Adding WebRTC — TURN servers, ICE, codec negotiation, an SFU — would
   have meant three unfamiliar systems interacting on the first attempt.
3. **We do not yet know we need it.** WebSocket audio over a good connection is
   adequate. Whether it is adequate on an Indian mobile network for an elderly
   person on a tablet is **UNKNOWN**, and that is a measurement, not an
   argument.

**Reversal triggers, any one of which is sufficient:**

- Measured packet loss or jitter that WebSocket audio handles badly in real use
- Echo cancellation proving inadequate on speakerphone, which is how this will
  actually be used
- More than two people in a conversation — a storyteller and a grandchild
  together is a real use case and an SFU is the right answer to it
- Mobile-network handover (wifi to cellular mid-sentence) dropping conversations

None of these is a guess about the future. Each is something a first real
deployment will answer in a week.

---

## What "buy the models" is constrained by

Bought, but not on the vendor's terms:

- **The interface is ours.** `StreamingSpeechToText`, `StreamingLanguageModel`,
  `StreamingTextToSpeech`. Each has a deterministic local implementation, and
  the whole product runs on those with no credentials — which is what keeps the
  interfaces honest rather than shaped around one vendor's SDK.
- **No training, structurally.** `mip_opt_out=true` is hard-coded with no
  setting able to change it, and the provider factory refuses to start if any
  configured provider declares that it may train on what it is sent.
- **The voice is ours to name.** A table in code maps EverEcho voice
  identifiers to generic stock voices. No configuration and no database row can
  name a voice belonging to a person.
- **The model gets six proposal tools.** No retrieval tool, and no database,
  shell, HTTP or code-execution tool. Retrieval happens first, authorised by
  the server, so what this reader may see is settled before the model sees
  anything.
- **Its output is not trusted.** Every clause is verified against its cited
  evidence before a word is spoken.

A vendor who cannot meet the first two is not a vendor for this product,
regardless of quality or price.

---

## What this costs us

Honestly stated, because the decision is not free:

- We own reconnection, backpressure, idle timeouts, concurrent-session limits
  and cross-instance cancellation. All are built and tested; none has met a
  real network.
- We have no WebRTC. No jitter buffer, no adaptive bitrate, no native echo
  cancellation beyond what `getUserMedia` provides.
- The local composer is extractive and works from a question bank. It is a real
  interviewer in structure and a limited one in range.
- Three adapters are written and unexecuted, so the hosted path is a careful
  reading of three protocols rather than a tested integration.

The first and second are the ones that would send us to LiveKit. The third and
fourth are answered by credentials.
