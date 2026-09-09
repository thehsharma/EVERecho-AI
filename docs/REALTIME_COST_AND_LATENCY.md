# Real-time conversation: cost and latency

What is measured, what is modelled, and what is unknown. Evidence labels as
elsewhere: **VERIFIED** (executed here), **SOURCE-SUPPORTED**, **INFERENCE**,
**ASSUMPTION**, **UNKNOWN**.

The short version: the latency numbers below are real and the cost numbers are
not. Nothing has run against a paid provider, so every rupee in this document
is arithmetic.

---

## 1. Measured latency

**VERIFIED.** Produced by `pnpm eval`, which drives eleven real conversations
end to end and reads `realtime_turn.latency` back out of the database.

| Stage | p50 | p95 | n |
| --- | --- | --- | --- |
| Retrieval | 6 ms | 9 ms | 9 |
| First token | 9 ms | 9 ms | 6 |
| First audio | 9 ms | 11 ms | 6 |
| Whole turn | 29 ms | 209 ms | 11 |

**What this is.** The product's own overhead: authorisation, retrieval under
obligations, composition, per-clause verification, third-person assertion,
persistence and event emission, with local providers and no network anywhere.

**What this is not.** A prediction of what a conversation will feel like. It is
the floor a hosted deployment adds to. The p95 of 209 ms on the whole turn is
the first turn of a session paying for connection setup; steady-state turns sit
near the median.

**Reproduce it:** `pnpm eval`, bottom of the output. It is in the evaluation
run rather than a separate benchmark so that it cannot quietly stop being
measured.

---

## 2. What a hosted turn would add

**UNKNOWN.** Every figure in this section is arithmetic over vendor-published
rates, not observation. Nothing here has been executed.

**INFERENCE**, from the structure rather than from measurement — the stages a
hosted turn adds, in the order they occur:

| Stage | What determines it |
| --- | --- |
| Audio upload | Frame size (320 ms) plus the round trip to the recogniser |
| Recognition endpointing | `endpointing=300` plus the recogniser's own buffering |
| Turn detection | Our own wait: 1800 ms base in interview mode, 900 ms in assistant mode, plus 1200 ms after a trailing conjunction |
| Composition to first clause | Model time to the first complete clause, not the first token — nothing is emitted until a clause can be verified |
| Verification | Measured above: single-digit milliseconds |
| Synthesis to first audio | The speech provider's own first-chunk latency |

**ASSUMPTION**, and the one most likely to be wrong: `endpointing=300` is too
aggressive for an elderly storyteller who pauses to think. The local turn
detector already waits 1800 ms in interview mode for exactly this reason, and
the recogniser's endpointing sits underneath that. Expect to raise it. The
failure mode is the interviewer interrupting somebody mid-thought, which is the
rudest thing this product could do.

**The latency that actually matters** is not any of the above in isolation. It
is the gap between a person stopping speaking and hearing a reply, and the
honest position is that this build cannot tell you what it is.

---

## 3. What is metered

**VERIFIED.** `realtime_provider_usage`, one row per session, accumulating:

| Column | Unit |
| --- | --- |
| `stt_seconds` | Audio seconds sent for recognition |
| `tts_characters` | Characters synthesised |
| `llm_input_tokens`, `llm_output_tokens` | As reported by the provider |
| `transport_seconds` | Socket time |
| `stored_audio_bytes` | Only when the storyteller asked for the recording to be kept |
| `estimated_cost_minor` | The rate card applied to the above |

Every column is a count, a duration or an amount of money. There is no content
in this table, by construction, which is what makes it safe to put on an
operator's screen.

`estimated_cost_minor` is an **estimate and never an invoice**. `LocalCostMeter`
returns zero for everything, which is the honest number for a deployment that
sends nothing anywhere.

---

## 4. The ceilings

**VERIFIED** as behaviour; the numbers themselves are **ASSUMPTION**.

| Setting | Default | Meaning |
| --- | --- | --- |
| `REALTIME_SESSION_BUDGET_MINOR` | 6 000 | ₹60 for one conversation |
| `REALTIME_DAILY_LIMIT_MINOR` | 30 000 | ₹300 across an archive in a day |
| `REALTIME_ARCHIVE_CAP_MINOR` | 300 000 | ₹3 000 in a month |

Chosen to be generous for a real conversation and firm against a runaway loop,
and they should be replaced with measured values as soon as there are any.

Reaching any ceiling **degrades the turn to text and says so**. It does not end
the call. An unbounded voice session is an unbounded invoice and the person
holding the microphone cannot see it — but losing the voice is an inconvenience
and losing the session is losing what somebody was in the middle of saying.

The check is three windows in one query (`readSpend`), because a budget
decision needs all three and a live turn should not wait on three round trips
to learn whether it may speak.

---

## 5. What drives cost, in order

**INFERENCE** from the architecture:

1. **Speech recognition** — charged per second of audio, and audio flows for
   the whole conversation whether or not anybody is talking. Voice activity
   detection is what keeps this from being the entire bill.
2. **Composition** — charged per token, and the input is the dominant half: a
   turn carries retrieved passages plus history. Prompt caching on the system
   prompt and tool definitions is the obvious lever and has not been
   implemented.
3. **Synthesis** — charged per character, and bounded by how much the assistant
   actually says. Abstention is free.
4. **Transport** — per minute, and small against the rest.

**The one structural saving already made:** barge-in cancels the model
generation, the synthesis and the queued browser audio together. Without that,
interrupting the assistant would still pay for the sentence nobody heard. The
Deepgram adapter sends `Clear` on cancellation for precisely this reason —
stopping playback alone would leave the provider generating, and charging for,
audio that will never be played.

---

## 6. Before any of this can be trusted

1. Run all three adapters against their real providers.
2. Record ten real conversations of realistic length and read the usage table.
3. Set the ceilings from those numbers rather than from the guesses in §4.
4. Measure the gap between a person stopping speaking and hearing a reply, on
   an Indian mobile network, on the device an elderly person actually holds.
5. Replace this document's §2 and §5 with measurements and delete the labels.

Until then this document says what it knows and marks the rest **UNKNOWN**,
which is the same standard the product holds itself to when it is asked a
question it has no evidence for.
