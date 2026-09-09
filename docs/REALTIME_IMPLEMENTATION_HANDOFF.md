# Real-time conversation: implementation handoff

For whoever picks this up next. It assumes you have read `ARCHITECTURE.md` and
`IMPLEMENTATION_HANDOFF.md` for v0.1, and covers only what the conversation
layer adds.

---

## Run it

```bash
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                 # api :4000, web :3000, worker
```

Sign in as `kamala@everecho.example` (the storyteller) or
`anjali@everecho.example` (family), password `demo-passphrase-2026`, and open
**Talk** on the demonstration archive. No credentials are needed: every
provider has a deterministic local implementation and the whole conversation
runs offline.

```bash
pnpm verify              # format, lint, typecheck, tests, evaluations
pnpm test:e2e            # browser suite, both viewports
```

---

## Where things are

```
packages/realtime/          the pure parts: state machine, VAD, turn detection,
                            cost meter, circuit breaker
packages/ai/src/streaming/  provider interfaces, local implementations,
                            Deepgram and Claude adapters
packages/consent/src/learning.ts
                            the learning policy: a second versioned document,
                            with consent as a hard ceiling over it
apps/api/src/realtime/      driver, orchestrator, retrieval, candidates,
                            approval, routes, WebSocket plane
apps/web/src/lib/realtime-client.ts
                            the browser side: audio capture, playback, events
apps/web/src/components/live-conversation.tsx
                            the screen
```

### The one diagram worth having

```
browser ──ws──► ws.ts ──► SessionDriver ──► runAssistantTurn
                            │                    │
                            │                    ├─ 1 prohibited request?
                            │                    ├─ 2 injection?
                            │                    ├─ 3 retrieval (obligations in the WHERE clause)
                            │                    ├─ 4 snapshot
                            │                    ├─ 5 composition (sees only authorised passages)
                            │                    ├─ 6 verification, per clause
                            │                    ├─ 7 third-person assertion
                            │                    └─ 8 synthesis, per clause
                            │
                            └─ authorizeNow() before every one of 3, 5, 8,
                               persistence, and post-session extraction
```

Steps 6 and 7 run before step 8 **on each clause individually**. That ordering
is the whole safety argument. Speech cannot be retracted.

---

## The five things not to break

1. **`authorizeNow()` is called per decision point, not per session.** A
   storyteller who revokes mid-sentence must be obeyed mid-sentence. Caching
   the decision at connect time would be a natural-looking optimisation and
   would silently remove the guarantee.

2. **Verification happens before synthesis, per clause.** If you find yourself
   batching clauses to reduce round trips, you have moved verification after
   speech.

3. **`attribute()` is server-side.** The storyteller's own words are first
   person. Presenting them as `Name said: "…"` is the difference between
   reporting and impersonating. A model that could supply its own presentation
   text could smuggle unverified words past step 6.

4. **The voice table is in code.** `DEEPGRAM_VOICES` and
   `PERMITTED_VOICE_PREFIXES`. Moving either into configuration or the database
   turns "we never synthesise a person's voice" from a property of the build
   into a property of an environment file.

5. **`mip_opt_out=true` is not a setting.** Neither is the factory's refusal to
   start with a provider that declares `permitsModelTraining`.

---

## How the state machine works

Thirteen states, one pure transition table, exhaustive by construction:

```
CREATED → CONNECTING → READY ⇄ LISTENING → TRANSCRIBING → THINKING → SPEAKING
                          ↑                                              │
                          └──────────────────────────────────────────────┘
   any live state → PAUSED → READY
   any live state → INTERRUPTED → READY
   any live state → RECONNECTING → READY
   any state      → ENDING → ENDED
   any state      → FAILED
```

`acceptsAudio()` returns true for READY, LISTENING and TRANSCRIBING — and
deliberately **not** for SPEAKING. An audio frame while the assistant is
talking is barge-in, not input, and the driver treats it that way.

The server is the sole authority. A client may render a state and request a
transition; it can never assign one. A refused transition triggers `resync()`,
because a client left with no idea where the conversation is will sit showing
"getting ready" while the session is live — which is exactly the bug §5 of the
readiness document describes.

---

## Adding a provider

1. Implement `StreamingSpeechToText`, `StreamingLanguageModel` or
   `StreamingTextToSpeech` from `packages/ai/src/streaming/types.ts`.
2. Declare honest `capabilities`. `sendsDataOffHost` drives the consent
   provider gates; `permitsModelTraining: true` will refuse to start.
3. Add a driver value to `packages/config/src/schema.ts` and a branch in
   `createStreamingProviders`.
4. Write contract tests that inject a fake socket or client. The existing ones
   in `hosted-providers.test.ts` are the pattern: URL and header construction,
   frame encoding, message parsing, cancellation.
5. **Do not describe it as production-tested until it has run against the real
   provider**, and record the run in `REALTIME_PRODUCTION_READINESS.md`.

---

## Things that will surprise you

- **Packages are consumed as TypeScript source.** No build step. `tsc --noEmit`
  typechecks the whole graph at once.
- **The job queue is in PostgreSQL** (`FOR UPDATE SKIP LOCKED`), so enqueueing
  is transactional with the domain change it belongs to. An approval and the
  job that indexes it commit together or not at all.
- **RLS is forced on 43 tables** and scoped per transaction with
  `set_config('everecho.archive_id', …, true)`. A query outside
  `withArchiveScope` sees nothing. This is deliberate and has caught real bugs.
- **The local speech recogniser cannot recognise speech, and says so.** It
  emits `no_recognisable_speech` rather than inventing words, and the browser's
  own recogniser supplies real text alongside the audio. A fabricated
  transcript here would become a fabricated memory.
- **The demonstration archive is entirely invented.** Never ingest real family
  data during development.

---

## Where to start, in order

1. Get credentials and run the three adapters. Everything in §3 of the
   readiness document is unknown until you do, and nothing else is worth doing
   first.
2. Measure the clause-discard rate with a real model. If the model marks
   citations inconsistently, the assistant abstains too often — safe, useless.
3. Replace the modelled figures in `REALTIME_COST_AND_LATENCY.md` with measured
   ones and set the ceilings from them.
4. Then Phase 8: everything in §6 of the readiness document.
