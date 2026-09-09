# Phase 10 — Real-time conversation and consent-controlled learning

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §9 in full, plus §6
(migrations 0009, 0010) and §12 (realtime and learning routes). Update
docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. MIGRATIONS 0009 and 0010
   0009_realtime: learning_policy, realtime_session,
   realtime_session_participant, realtime_reconnect_token, realtime_event,
   realtime_turn, transcript_revision, realtime_audio_segment,
   interruption_event, conversation_summary, realtime_provider_usage,
   realtime_safety_event
   0010_learning: memory_candidate, memory_candidate_evidence,
   learning_decision, interaction_preference

   Constraints: `realtime_audio_storage_requires_consent`,
   `candidate_only_preferences_skip_review`, `memory_candidate_has_one_origin`,
   the interaction_preference allow-list CHECK, unique
   (session_id, client_event_id), and a TRIGGER refusing a NON-FINAL turn as
   candidate evidence. NO COLUMN ANYWHERE MAY HOLD A VOICEPRINT.

2. packages/realtime — a PURE session state machine, 13 states
   CREATED CONNECTING READY LISTENING TRANSCRIBING THINKING SPEAKING
   INTERRUPTED PAUSED RECONNECTING ENDING ENDED FAILED. Terminal: ENDED,
   FAILED. Transitions exhaustive BY CONSTRUCTION, so an unhandled transition
   is a compile error. THE SERVER IS THE SOLE AUTHORITY on session state.
   Also: VAD, turn detection, a cost meter and a circuit breaker.

3. THE FOUR MEMORY LAYERS, PHYSICALLY SEPARATE
   turn context (in process) · realtime_turn · memory_candidate · memory.
   Never one table with a status column.

4. THE LEARNING POLICY — a separate document from consent, and consent is the
   CEILING
     sessionContext: boolean
     transcriptRetention: ephemeral | session | 30_days | until_deleted
     audioRetention: never | session | explicit_archive_source
     candidateExtraction: boolean
     preferenceMemory: ask_every_time | auto_save | never
   `resolveLearningObligations` INTERSECTS with consent and can only narrow.
   A CONSENT refusal is reported BEFORE a LEARNING refusal.

   Low-risk preference ALLOW-LIST, the complete set that may ever be saved
   without review: interface_language, captions_enabled, speaking_rate,
   interview_pace, preferred_session_minutes, clarifying_question_frequency.
   An allow-list, because a deny-list fails open the moment somebody adds a
   preference type and forgets to exclude it. Enforce it AGAIN by a DB CHECK.

   NEVER auto-saved, auto-approved or inferred whatever any policy says:
   health, financial, religious, political, sexual_orientation, biometric.

5. THE WEBSOCKET MEDIA PLANE
   REALTIME_PROTOCOL_VERSION = 1; a mismatch CLOSES THE SOCKET.
   Client→server: session.hello (optional reconnectToken) · audio.chunk
   (base64 PCM16 mono, size-bounded so one frame cannot exhaust memory) ·
   user.speech.started · user.speech.ended · user.turn.commit · user.interrupt
   · session.pause · session.resume · session.end (CLOSED reason enum) ·
   client.ack
   Server→client: session.state · transcript.partial · transcript.final ·
   assistant.thinking · assistant.text.delta · assistant.citation ·
   assistant.audio.chunk · assistant.turn.complete · assistant.turn.cancelled ·
   learning.candidate · learning.summary · policy.changed · warning · error

   assistant.text.delta carries A WHOLE VERIFIED CLAUSE, NEVER A RAW TOKEN.
   Unverified text is never sent. assistant.citation is emitted per clause
   BEFORE its audio.

   Origin checking on the socket. Frames are taken off the socket BEFORE
   admission finishes (RT-013), or a slow admission drops the first frames.

6. MODE A — the live story interview
   A CLEARLY IDENTIFIED AI interviewer. The screen states, in words, that this
   is an AI assistant and that it is not the storyteller. One gentle question
   at a time. English / Hindi / Hinglish (en, hi, hi-Latn, auto) — Devanagari
   detected exactly, Hinglish by marker words. Skip, pause, resume, "prefer not
   to answer", end. Recognises unclear dates and unresolved people. Grounded
   follow-ups that INSERT NO FACTS — an interview clause cites nothing because
   it claims nothing. Streamed transcript the storyteller can correct
   (transcript_revision). Proposes memories AFTER the conversation, never
   during it, and NEVER AUTO-APPROVES A BIOGRAPHICAL MEMORY.
   Never a therapist, never a diagnosis: distress offers resources, not advice.

7. MODE B — the live archive assistant
   Only authorised P1–P3 evidence, filtered in the SQL WHERE. THIRD PERSON
   ONLY — assertThirdPerson after server-side attribute(); a first-person
   clause is DISCARDED and a safety event recorded. A NEUTRAL LICENSED
   ASSISTANT VOICE, never the storyteller's: PERMITTED_VOICE_PREFIXES and a
   voice table FIXED IN CODE, checked at assembly AND AGAIN PER CLAUSE, and
   recorded per turn. Claim-level citations shown WHILE SPEAKING. The exact
   abstention sentence. Never fills silence with a guess. Never claims to be
   the storyteller, to be conscious, or to be in contact with the dead.

8. CANDIDATES AND APPROVAL
   Extract candidates, people, places, dates, preferences and unresolved
   references. EACH CANDIDATE LINKS TO THE EXACT TURN OR SOURCE. Duplicate
   detection (bidirectional coverage) and contradiction detection
   (contradicts_memory_ids). Sensitive and biographical candidates go to
   review — `requires_storyteller_review` defaults TRUE and a CHECK backs it.
   Approval enqueues embed_memory IN THE SAME TRANSACTION.

9. OPERATIONAL REQUIREMENTS
   - Reconnect tokens; idempotency on (session_id, client_event_id)
   - Backpressure: MAX_BUFFERED_BYTES — DROP AUDIO, NEVER TEXT
   - MAX_CONCURRENT_SESSIONS_PER_USER, IDLE_TIMEOUT_MS
   - checkBudget: a spending ceiling DEGRADES TO TEXT, it does not end the call
   - Circuit breakers per provider
   - Revocation written TO THE DATABASE, not only to open sockets, plus a
     five-second sweep, so it crosses instances
   - Narrowing ENDS the conversation rather than trying to continue it
   - LIVE CONSENT RE-CHECK AT FIVE POINTS, not once per session
   - Latency and cost instrumentation: realtime_turn.latency,
     realtime_provider_usage, GET …/usage — content-free
   - Everything a conversation produced is EXPORTED AND DELETED with it

10. HOSTED ADAPTERS — opt-in per stage, LOCAL BY DEFAULT
    REALTIME_STT_DRIVER / REALTIME_LLM_DRIVER / REALTIME_TTS_DRIVER all
    default to local, so a deployment that configures nothing SENDS NOTHING
    ANYWHERE. mip_opt_out=true is HARD-CODED with no setting able to change
    it, and the provider factory REFUSES TO START with a provider that
    declares it permits training.

    If you cannot run an adapter against its real provider, say so IN THE
    ADAPTER'S OWN HEADER, in the readiness document and in .env.example, and
    mark its traceability row `interface only`. Never mark it done.

11. Screens: /talk, /talk/[sessionId], /learned, /learning,
    /account/preferences.

## Definition of done

- machine.test.ts covers every transition.
- A test asserts the protocol-version mismatch closes the socket.
- authorize-realtime tests cover 3 roles × 4 actions.
- An evaluation asserts ZERO memories auto-approved, measured against the
  database.
- An evaluation asserts 100% of spoken clauses carry a valid citation.
- A test asserts a voice not on the permitted list is refused.
- A test asserts mip_opt_out is sent on every connection and that a
  training-permitting provider is refused at startup.
- A test asserts a partial transcript cannot become candidate evidence.
- Tests assert: inspect, edit, revoke, export and delete everything the
  conversation remembered (five cases).
- a11y scans of the five new screens including MID-CONVERSATION.

## Do not

- Do not send an unverified token to the browser or to TTS.
- Do not persist a user profile across sessions. Session context is
  short-lived and passed per turn.
- Do not add a column that could hold a voiceprint, even nullable, even
  unused.
```
