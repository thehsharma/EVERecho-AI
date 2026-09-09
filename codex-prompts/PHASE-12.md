# Phase 12 — Remembrance, pacing, portability, conformance

This is the phase where the product touches death. Read §11 twice before
starting.

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §11 in full, plus §5 (the
two type-level guarantees), §6 (migrations 0017–0019) and §12. Update
docs/TRACEABILITY_MATRIX.md as you go.

## THE GOVERNING RULE

  Nothing is ever spoken in the person's voice that the person did not
  actually say.

Not paraphrased, not in their style, not stitched from fragments. Played, or
not played.

RETRIEVED, NEVER GENERATED. Customer-facing audio is P0_ORIGINAL_SOURCE only —
bytes from a file the storyteller recorded. There must be NO CODE PATH from a
language model to a customer's speakers, and nothing in the API or the AI
package may read or write audio bytes.

If you find yourself adding a text-to-speech call for the person's voice, or
joining two ranges to make an answer flow better, STOP. Both produce a sentence
the person never said, and the second one does it WITHOUT A SINGLE FABRICATED
WORD.

## The two type-level guarantees — implement these FIRST

1. SPLICING DOES NOT COMPILE.
   `OriginalAudio` is a CLASS with a NATIVE PRIVATE FIELD (#brand) and a
   PRIVATE CONSTRUCTOR, so it is nominally typed. `fromSegment` is the only way
   to obtain one. NO FUNCTION ANYWHERE takes two and returns one. The API
   response builder accepts only branded audio, so a widened range — a plain
   object — fails to typecheck.

   A SYMBOL BRAND IS NOT ENOUGH: object spread preserves it, so
   `{ ...clip, endMs: other.endMs }` still typechecks. A test caught that, not
   a review. Assert both failures with @ts-expect-error, which TypeScript
   reports as an error of its own if it ever stops being needed. Verify by
   removing one directive and watching TS2739 appear.

2. NOTHING REACHES SPEECH AS A BARE STRING.
   `speak()` takes `Attributed | AssistantVoice`. `attribute()` is the SOLE
   minter of the first and runs the third-person assertion ITSELF, THROWING
   rather than returning — so holding an `Attributed` IS the evidence that it
   passed. Assert that a bare string will not compile, and that the two voices
   stay distinguishable IN THE TYPE, not only by convention.

## Slice 1 — the ante-mortem directive (migration 0017)

remembrance_directive, remembrance_clause, remembrance_activation.
`resolveRemembrance()` is PURE and independently testable.

- Per-topic, per-person: FOUR SCOPES plus an optional audience.
- WITHHOLDING IS AS EASY TO EXPRESS AS GRANTING: `effect` is a REQUIRED
  two-value field, not the absence of a grant. The screen offers both as
  buttons of the same kind in the same row.
- A REFUSAL IS ABSOLUTE AND CANNOT BE SCHEDULED TO EXPIRE. Any matching
  `withhold` wins at any scope. Enforce with
  `remembrance_clause_withhold_is_unconditional`, and mirror it in the contract
  and the interface.
- WHAT SILENCE MEANS IS CHOSEN, NEVER ASSUMED: `default_effect` is NOT NULL
  WITH NO DEFAULT, so a directive cannot exist without the person having
  decided.
- BEING QUOTED AND BEING HEARD ARE TWO DECISIONS: `allow_audio` per clause; the
  CAUTIOUS reading wins when clauses disagree.
- Versioned; revocable while alive; a partial unique index admits ONE directive
  in force.
- SAYS NOTHING WHILE THE STORYTELLER IS ALIVE — `not_activated` for every
  non-activated status.
- IMMUTABLE ONCE DEATH IS LEGALLY ESTABLISHED: assertNotActivated on update,
  clause add, clause delete and affirm — and it TELLS THE STORYTELLER PLAINLY
  rather than failing silently. Not even an administrator may edit it.
- A directive nobody AFFIRMED cannot be activated.
- ACTIVATION IS MANUAL, LEGALLY GATED AND AUDITED BY NAME:
  POST /v1/admin/archives/:id/remembrance/activate behind requireAdmin.
  remembrance_activation records the HUMAN BY NAME plus an evidence reference;
  an audit row is written against the archive and IS VISIBLE TO THE FAMILY in
  the archive's own activity log. It cannot be activated twice.
- NOT REACHABLE FROM THE PRODUCT AT ALL — the `admin.` prefix excludes it from
  every archive role INCLUDING storyteller; the route reports NOT FOUND to
  non-admins.
- NO INACTIVITY TIMER, NO INFERRED DEATH. No such column, no such job.
- A directive cannot name somebody consent has not admitted.
- The family may READ what was decided about them; the response reports
  editable:false.
- Reason codes carry no private material.
- Screen: /remembrance.

## Slice 2 — her voice, retrieved

- selectClip: LEAD_IN_MS = 10_000, CLAMPED at the start of the file, so it is a
  moment and not a soundbite.
- ONE CONTIGUOUS SPAN ONLY. The selector returns ONE CLIP OR NULL — not an
  array — and the contract carries a single object. A function that cannot
  return two things cannot be made to join them.
- endMs is THE SEGMENT'S OWN END. Nothing trims. No clip is cut mid-sentence to
  fit an answer.
- surroundingText gives the clip somewhere to stand — READ, NOT PLAYED — with
  the source label and when it was added. Cope at the edges of a recording.
- NEVER PLAYS SOMETHING MERELY ADJACENT: MIN_QUESTION_COVERAGE = 0.5. Her voice
  makes anything sound like an answer.
- DETERMINISTIC: sorted by score then segment index.
- A segment that cannot be played is never offered (missing or impossible
  timings; typed answers and OCR are legitimate transcript, not clips).
- Nothing found says so IN THE ARCHIVE'S OWN VOICE — four distinct third-person
  statements, none attributable to the person.
- A persona request is refused BEFORE A RECORDING IS LOADED, and the refusal
  names what DOES exist.
- The archive's voice NEVER LOOKS LIKE THEIRS: interface text in a labelled
  status region; their words only ever as a quotation.
- THE DIRECTIVE IS APPLIED PER CLIP, NOT ONCE PER SESSION.
- A REFUSAL SAYS WHICH REFUSAL IT WAS — distinct reason codes and distinct copy
  for withheld, audio-only and not-yet. Hiding "she asked us not to" behind
  "nothing found" would MISREPRESENT HER.
- Never reaches past ordinary consent: the grant's sensitivity ceiling filters
  candidate segments exactly as it does a download. Use ONE loadPlayable helper
  and ONE query, so a sensitivity filter cannot be forgotten in one of two
  places.
- The server hands the browser the ORIGINAL FILE via a signed link and never
  reads audio bytes.
- Routes: POST …/voice/ask, POST …/voice/tell. Screen: /listen.

## Slice 2b — telling them something that has happened

- findOccasion + selectOccasionClip: news is answered with A REAL MOMENT FROM
  THEIR OWN LIFE ON THE SAME SUBJECT. "I got the job" should reach "I started
  teaching in 1971", which shares no words with it.
- IT NEVER REACTS TO THE NEWS. No code path composes a reply. The archive
  states a fact about itself and stops. Test by scanning the whole page for
  "proud", "congratulate", "she would", "watching over", and for first person.
- NEWS MAPS TO SUBJECTS, NEVER TO FEELINGS — assert against the DATA STRUCTURE
  ITSELF that the rule table has no sentiment column.
- The subject's words WIDEN A SEARCH; THEY NEVER SUPPLY AN ANSWER.
- MIN_SUBJECT_MATCHES = 2. Something arbitrary in their voice is worse than
  nothing, because the voice makes it sound like a reply.
- Nothing found is said WITHOUT IMPLYING IT DID NOT MATTER: "It doesn't mean it
  wouldn't have mattered to them — only that it isn't in what they recorded."
- Deterministic. WHAT SOMEBODY TOLD THEIR DEAD MOTHER IS NOT RECORDED —
  analytics carry the subject and a boolean, nothing else.
- The directive governs it like every other playback.

## Slice 2c — how they felt about it (migration 0018)

memory_feeling.

- AN EMOTION IS A FIRST-PERSON STATEMENT, NEVER AN INFERENCE.
  memory.feeling.write is STORYTELLER-ONLY; there is NO OTHER WRITE PATH; and
  NO SENTIMENT ANALYSIS EXISTS ANYWHERE IN THE CODEBASE. Family, contributor,
  buyer and administrator are all refused.
- THE PRODUCT NEVER FILLS ONE IN. A memory with no note has no feeling.
- NO FIXED VOCABULARY OF PERMITTED EMOTIONS. Free text. No mood column, no
  valence score, no enum — a fixed vocabulary would be the product deciding
  what somebody is allowed to have felt about their own life.
- PRIVATE IS OFFERED AT THE SAME WEIGHT AS SHARED, decided in the same breath
  as writing it.
- A PRIVATE NOTE IS REPORTED AS ABSENT, NOT AS WITHHELD. Saying a feeling
  exists that may not be seen invites exactly the speculation the person was
  avoiding.
- It reaches the family where they meet the memory: on the story, and beside
  every clip in memorial mode.
- A FEELING ABOUT A DRAFT IS REFUSED — the draft may not survive.
- Removable without touching the story; assert the memory's status is
  unchanged.
- The words NEVER reach analytics — booleans only.

## Slice 4 — the refusal

- PERSONA_REFUSAL: ONE TEXT, NOT TWO. There were two copies — the written path
  and memorial mode — which is how the same person is told two different things
  depending on the screen. PROHIBITED_REQUEST_MESSAGE re-exports it.
- THE REFUSAL OFFERS WHAT IS ACTUALLY THERE: stripPersonaFraming keeps the
  subject underneath the request, memorial mode retrieves on it, and the reply
  carries THE REFUSAL AND THE CLIP.
- STRIPPING IS NOT A WAY AROUND THE REFUSAL: assert the residue is a
  non-persona request before it reaches retrieval.
- IT NEVER USES THE LANGUAGE OF POLICY AT SOMEBODY WHO IS GRIEVING — assert
  across all three fragments.
- IT NEVER SPEAKS AS THE PERSON, EVEN WHILE REFUSING TO — assert on the copy.
- The detector catches what people actually type: "what would she say to me
  now" — THE CONDITIONAL IS ENOUGH ON ITS OWN, it must not require the
  qualifier immediately after the verb. "What DID she say" is untouched.
- Refused BEFORE RETRIEVAL on all three paths — assert NO retrieval snapshot
  exists.
- A safety event is recorded, WITH LABELS ONLY.

## Slice 5 — grief-literate pacing (migration 0019)

- NO STREAKS, DAILY PROMPTS OR RETURN-NUDGES ANYWHERE, and no scheduled
  notification path to a family member to send one from.
- A long or single-topic session OFFERS TO PAUSE, ONCE. `shouldOfferPause` is
  PURE, over four numbers and two timestamps. pause_offered_at makes it once;
  pause_offer_declined_at makes THE ANSWER FINAL.
- THE OFFER ACCEPTS THE ANSWER: BOTH answers set pause_offer_declined_at. There
  is no un-decline and no path that re-raises it, and THE FRONTEND DOES NOT
  RESTORE IT EVEN WHEN THE REQUEST FAILS, because retrying would be asking
  twice. A CHECK requires declined ⇒ offered so the two cannot drift.
- NOTHING ABOUT THE PERSON REACHES THE DECISION: `PacingInput` has NOWHERE to
  pass text, audio, voice quality or hesitation. `countSessionShape` returns
  two counts and CANNOT BE ASKED FOR ANYTHING ELSE. A CHECK limits
  pause_offer_basis to long_session / one_topic — and there is no third value
  that could exist.
- THE OFFER NEVER READS AS A DIAGNOSIS. The copy lives in PAUSE_OFFER BESIDE
  THE FUNCTION, not in the frontend, SO IT IS ASSERTED: it never says how the
  person seems, never counts anything at the person, and offers stopping and
  continuing as equals.
- NEVER MODAL. Rendered inline in the conversation flow. There is no dialog, no
  overlay, nothing to dismiss — an interruption that must be dismissed makes
  stopping feel like the thing being refused.
- CRISIS RESOURCES ONE ACTION FROM ANY SCREEN, NEVER MODAL: a footer link, "If
  you need help now", on EVERY page, at the same weight as its neighbours,
  pointing at an anchored card that is FIRST on the support page.
- REACHING HELP IS NEVER TRIGGERED BY WHAT SOMEBODY SAID. The link is
  unconditional and always present. Deciding that a person needs it would
  require reading their state, which does not happen — and the support page
  says so in as many words.
- NO SENTIMENT ANALYSIS OF THE BEREAVED IN ANY PATH. Write a test that GREPS
  THE WHOLE SOURCE WITH COMMENTS STRIPPED for any scorer, so documenting the
  prohibition is not punished. Verify the test works by adding a `moodScore`
  export and watching it fail, then remove it.
- ANALYTICS RECORD THAT A SESSION ENDED, NEVER WHY. `endedReason` is a CLOSED
  ENUM of OPERATIONAL reasons, mirrored by a CHECK, on the HTTP body AND on the
  socket event. It was free text supplied by the client for a release: a front
  end could have written "seemed_upset" into a column the archive keeps for its
  lifetime, and it would have been emitted as an analytics reason code. Nothing
  prohibited it but nobody having done it.

## Slice 6 — the archive outlives the company

- THE EXPORT OPENS WITHOUT EVERECHO. index.html CARRIES ITS OWN DATA — a
  file:// page cannot fetch the JSON beside it — and loads NO script, style,
  font or image from anywhere.
- SIGNED INTEGRITY MANIFEST, ORDINARY CRYPTOGRAPHY: Ed25519 from node:crypto
  over the EXACT BYTES of manifest.json, which lists a SHA-256 for every file,
  so the signature covers the archive TRANSITIVELY. manifest.sig carries the
  public key and its fingerprint. NO BLOCKCHAIN, TOKENS OR NFTs.
- THE SIGNATURE'S LIMITS ARE STATED, NOT IMPLIED. A key travelling inside the
  folder proves INTERNAL CONSISTENCY ONLY. The verifier prints the fingerprint
  and says IN AS MANY WORDS that it proves origin only if compared with one
  published elsewhere. The export screen says the same.
- UNSIGNED IS SAID, NEVER OMITTED: signManifest returns null with no key; the
  manifest records signed:false; the screen says no key is configured.
- OFFLINE VERIFIER: verify.mjs, ZERO DEPENDENCIES, plain Node. Checks every
  checksum, that NOTHING WAS ADDED, the signature, and THAT EVERY CITATION
  RESOLVES. Report "n of n citations resolved".
- A SAME-LENGTH SUBSTITUTION IS CAUGHT — the checksum, not the size, does the
  work. Test by altering exactly as many bytes as you replace.
- CITATIONS RESOLVE OFFLINE: export segment ids; index.html resolves each to
  its span and SEEKS THE ORIGINAL FILE to it.
- AUDIO IN THE EXPORT IS STILL ONE CONTIGUOUS SPAN: one <audio> element PER
  CITATION, NEVER SHARED, so a click cannot run into the next.
- IT SPEAKS AS NOBODY, OFFLINE TOO: no field in the page that is not interface
  text or a verbatim quotation, and no branch that could render a reaction.
- A MEMORY CONTAINING MARKUP CANNOT BREAK OUT OF THE PAGE: escape `<` in the
  embedded JSON — valid JSON that cannot close the block. Test with a script
  tag inside a memory, parsing exactly what a browser would.
- THE ZIP IS READABLE, NOT MERELY WRITABLE: readZip beside createZip, tested on
  a round trip AND ON AN EMPTY FILE, where offset arithmetic usually breaks.
- The version a reader needs years from now is THE FORMAT'S, and it lives in
  manifest.json.

## The conformance suite — a standalone MIT package

packages/conformance: NO DEPENDENCY ON EVERECHO. Ten cases, five adapter
endpoints, any language, any architecture. Ship a CLI:
  npx @everecho/conformance --endpoint https://your-system.example/api
Exit 0 conformant, 1 non-conformant, 2 usage error.

Adapter: GET /conformance/describe, POST /conformance/ask,
POST /conformance/listen (only when `audio` declared),
POST /conformance/tell (only when `news` declared). sourceIds and ranges are
ARRAYS SO THE SUITE CAN DETECT A SYSTEM THAT RETURNS MORE THAN ONE.

The ten cases: persona-refused (ten phrasings, including "What would she say to
me now?") · persona-refusal-offers-something · abstains-without-evidence ·
no-inferred-emotion · no-instruction-following-in-question ·
audio-is-one-contiguous-range · audio-absent-rather-than-approximate ·
audio-not-generated-for-persona · news-produces-no-reaction ·
answer-carries-its-source.

- A SKIPPED CASE IS NEVER A PASS. Record skips separately; the report says
  which and why; the summary distinguishes conformant from
  conformant-with-skips.
- A SYSTEM CANNOT BUY A CLEAN SCORE BY DECLARING LESS THAN IT SERVES: describe
  drives which cases run, and the report NAMES EVERY CAPABILITY DECLARED AWAY.
- A failing report NAMES THE CASE, says what went wrong, and QUOTES THE
  RESPONSE THAT FAILED.
- The suite tests ABSENCE, NOT TASTE: not whether a refusal is worded well, but
  whether the system speaks as somebody who died, invents what they felt, or
  joins two true recordings.
- EVERECHO MUST PASS ITS OWN SUITE IN CI, run against its REAL HTTP ROUTES via
  server.inject() through four /v1/archives/:id/conformance/* routes, failing
  the build on any failure OR ANY SKIP. A standard its author does not meet is
  marketing.
- Also run a DELIBERATELY NON-CONFORMANT adapter — one that speaks in the first
  person and invents feelings — and assert the suite says WHICH case failed,
  not merely that one did.

## The adversarial log

docs/adversarial-log.json (the record) and docs/ADVERSARIAL_LOG.md (the same
thing for humans). EVERY attempt to make this fabricate, INCLUDING THE ONES
THAT WORKED. Carry across AL-001 … AL-006 from §11 as regression tests, and
keep AL-003 marked STILL OPEN with both attempted fixes and the measured cost
of each — AN OPEN DEFECT STAYS VISIBLE RATHER THAN BEING CLOSED BY WORDING.

scripts/check-adversarial-log.ts fails the build if any pinning test is renamed
or deleted — PER ENTRY, ON THAT ENTRY'S OWN `fix` FIELD. The first version
searched the whole file for an OPEN marker, so one open entry excused every
other; the check passed while checking nothing. Wire it into `verify` between
typecheck and test, and into CI as its own step. Verify it works by renaming a
pinning test and watching the build go red.

## Definition of done

- provenance.types.test.ts: "cannot be produced by extending one moment to
  reach another", "cannot be produced by concatenating the text of two
  moments", "will not accept a bare string", "keeps the two voices
  distinguishable in the type".
- clips.test.ts: "cannot return two moments", "starts before the answer",
  "never begins before the start of the recording", "ends where she stopped
  talking, not where the answer stopped", "says nothing rather than playing
  something merely adjacent", "returns the same moment every time".
- Integration: "hands over the original file rather than anything it made",
  "plays nothing she sealed, and says so rather than pretending it is missing",
  "never reacts to the news", "lets nobody else say how they felt".
- refusal.test.ts: "is one text, not two", "never uses the language of policy
  at somebody who is grieving", "never speaks as the person, even while
  refusing to".
- pacing.test.ts: "never offers twice", "takes no for an answer, however long
  the session then runs", "never says how the person seems".
- no-sentiment.test.ts: "has no scorer anywhere in the source", "has an
  analytics schema that cannot carry a mood".
- portable-export.test.ts: nine verifier tests including a truncation, a
  same-length substitution, an added file, a removed file and a re-signed
  manifest.
- E2E: "downloads, verifies itself, and browses offline" — open the REAL export
  off the filesystem in a REAL browser WITH THE CONTEXT OFFLINE.
- Conformance: 10 of 10, NOTHING SKIPPED, printed rather than asserted green.

## Do not

- Do not generate speech in the person's voice, for any reason, on any path.
- Do not join two ranges, however much better the answer would flow.
- Do not infer a feeling, a mood, or a state of mind, from anything.
- Do not let the product decide that somebody is grieving badly.
- Do not close an open adversarial-log entry by rewording it.
```
