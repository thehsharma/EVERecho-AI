# EverEcho v0.4 — traceability

`planned` means not built. `done` has a named test beside it. Nothing is
marked done on the strength of a code reading.

## The governing rule

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Nothing is spoken in the person's voice that they did not say | `selectClip` returns one segment id and a time range; the server hands the browser the original file and never reads audio bytes | `clips.test.ts` "cannot return two moments"; integration "hands over the original file rather than anything it made" | done |
| Customer-facing audio is the original recording | The response carries a signed link to the stored object, unmodified | Integration "hands over the original file rather than anything it made" | done |
| No code path from a language model to generated speech in the person's voice | None exists. Nothing in `apps/api` or `packages/ai` reads or writes audio bytes | Absence, plus `FEATURE_PERFORM_MODE` failing config validation | done |

## Slice 1 — the ante-mortem directive

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Per-topic, per-person statement of what may be heard after death | `remembrance_clause` with four scopes and an optional audience; `resolveRemembrance()` is pure and independently testable | `remembrance.test.ts` (consent) "matches the topic exactly, whatever the case"; integration "can single out one person the storyteller already invited" | done |
| Withholding is as easy to express as granting | `effect` is a required two-value field, not the absence of a grant; the screen offers both as buttons of the same kind in the same row | Integration "takes a refusal as readily as a permission"; E2E "asks the question it cannot answer, and offers both answers equally" | done |
| A refusal is absolute and cannot be scheduled to expire | Any matching `withhold` wins at any scope; `remembrance_clause_withhold_is_unconditional` CHECK, mirrored in the contract and in the interface | Consent "beats a narrower permission", "cannot be scheduled to expire"; integration "refuses a withholding clause that would expire"; E2E "a refusal cannot be given an end date" | done |
| What silence means is chosen, never assumed | `default_effect` is `NOT NULL` with no default, so a directive cannot exist without the person having decided | Integration "requires the storyteller to say what silence means"; consent "opens when they said it should" / "stays closed when they said it should" | done |
| Being quoted and being heard are two decisions | `allow_audio` per clause; the cautious reading wins when clauses disagree | Consent "lets them be quoted without being played", "takes the cautious reading when two clauses disagree about the voice"; E2E "offers the recording and the words as two separate choices" | done |
| Versioned; revocable while alive | `version` + a partial unique index admitting one directive in force; every write path calls `assertNotActivated` | Integration "lets them change their mind as often as they like" | done |
| Says nothing while the storyteller is alive | `resolveRemembrance` returns `not_activated` for every non-activated status | Consent "says nothing at all", "says nothing when there is no directive" | done |
| Immutable once death is legally established | `assertNotActivated` on update, clause add, clause delete and affirm | Integration "cannot be edited by anyone, including an administrator", "tells the storyteller plainly rather than failing silently" | done |
| A directive nobody confirmed cannot be activated | Activation requires `status = 'affirmed'` | Integration "refuses a directive the storyteller never confirmed" | done |
| Activation is manual, legally gated, and audited by name | `/v1/admin/…/activate` behind `requireAdmin`; `remembrance_activation` records the human by name plus an evidence reference; an audit row is written against the archive | Integration "records who did it, and on what evidence", "is visible to the family in the archive's own activity log", "cannot be activated twice" | done |
| Not reachable from the product | The `admin.` prefix excludes it from every archive role including storyteller; the route reports not-found to non-admins | Integration "is not reachable from the product at all" | done |
| No inactivity timer, no inferred death | No such column and no such job. `succession_never_auto_executes` remains in force | Absence, plus the existing constraint | done |
| A directive cannot name somebody consent has not admitted | Audience must be an active member; an outsider is reported as not found | Integration "cannot name somebody the archive has not already admitted" | done |
| The family may read what was decided about them | `remembrance.read` is in `READER_ACTIONS`; the response reports `editable: false` | Integration "lets the family read what was decided about them"; E2E "can read what was decided, and cannot change any of it" | done |
| Reason codes carry no private material | Codes only, asserted by shape | Consent "is a code, never prose and never their words" | done |
| Archive isolation | Forced RLS on all three new tables | Integration "never returns one archive's directive in another's scope" | done |
| Accessible at WCAG 2.2 AA | The decision and the clause form, on two viewports | `accessibility.spec.ts` "the decision, and the form for a particular one" — zero violations | done |

## Slice 2 — her voice, retrieved

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| A question returns the actual clip, with lead-in | `selectClip` with `LEAD_IN_MS = 10_000`, clamped at the start of the file | `clips.test.ts` "starts before the answer, so it is a moment and not a soundbite", "never begins before the start of the recording"; integration "plays the moment where she answered, with lead-in" | done |
| One contiguous span only; never assembled | The selector returns one clip or null — not an array — and the contract carries a single object. A function that cannot return two things cannot be made to join them | `clips.test.ts` "cannot return two moments"; integration "returns one contiguous range of one recording, never two" | done |
| No clip cut mid-sentence to fit an answer | `endMs` is the segment's own end. Nothing trims | `clips.test.ts` "ends where she stopped talking, not where the answer stopped" | done |
| Every clip resolves to its source and surrounding transcript | `surroundingText` returns the segments either side, read rather than played; the response carries the source label and when it was added | `clips.test.ts` "gives the clip somewhere to stand", "copes at the edges of a recording" | done |
| Never plays something merely adjacent | `MIN_QUESTION_COVERAGE = 0.5`, the stricter bar the spoken path already used. Her voice makes anything sound like an answer | `clips.test.ts` "says nothing rather than playing something merely adjacent"; integration "says it has nothing rather than playing something adjacent" | done |
| Deterministic — the same question returns the same moment | Sorted by score then segment index | `clips.test.ts` "returns the same moment every time" | done |
| A segment that cannot be played is never offered | Segments without timings are filtered out; typed answers and OCR are legitimate transcript and are not clips | `clips.test.ts` "will not offer a segment that cannot be played", "will not offer a segment whose timings are impossible" | done |
| Nothing found says so, in the archive's own voice | Four distinct third-person statements, none attributable to the person | Integration "says it has nothing rather than playing something adjacent", "never attributes what the archive says to the person" | done |
| A persona request is refused before a recording is loaded | `isProhibitedRequest` runs before retrieval, and the refusal names what does exist | Integration "refuses to speak as her, and offers what is actually there"; E2E "refuses to speak as them, and offers what is actually there" | done |
| The archive's voice never looks like theirs | Interface text in a labelled status region; their words only ever as a quotation | E2E "never lets the archive's voice look like theirs" | done |
| The directive is applied per clip, not once per session | `resolveRemembrance` is called for each clip with that clip's memory, source and topics | Integration "plays nothing she sealed…", "keeps her words when she refused only the recording", "plays nothing at all when she chose to close what she did not mention" | done |
| A refusal says which refusal it was | Distinct reason codes and distinct copy for withheld, audio-only, and not-yet — hiding "she asked us not to" behind "nothing found" would misrepresent her | Integration "plays nothing she sealed, and says so rather than pretending it is missing" | done |
| Memorial mode never reaches past ordinary consent | The grant's sensitivity ceiling filters the candidate segments, exactly as it does for a download | Integration "keeps it inside the archive" | done |
| Accessible at WCAG 2.2 AA | At rest and with an answer present, on two viewports | `accessibility.spec.ts` "at rest, and with an answer from the archive on it" — zero violations | done |

## Slice 2b — telling them something that has happened

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| News is answered with a real moment from their own life on the same subject | `findOccasion` + `selectOccasionClip`; "I got the job" reaches "I started teaching in 1971", which shares no words with it | `occasions.test.ts` "reaches her own first job from somebody else's new one"; integration "answers news about a job with what she said about her own" | done |
| It never reacts to the news | No code path composes a reply. The archive states a fact about itself and stops | Integration "never reacts to the news" (no proud/congratulate/she-would/watching-over, and never first person); E2E "never reacts to the news" scans the whole page | done |
| News maps to subjects, never to feelings | The rule table has no sentiment column; asserted against the data structure itself | `occasions.test.ts` "maps news to subjects, never to feelings" | done |
| The subject's words widen a search; they never supply an answer | Related terms only ever select among what was actually recorded | `occasions.test.ts` "never supplies an answer of its own, only a place to look" | done |
| More than one word in common before it says anything | `MIN_SUBJECT_MATCHES = 2`. Something arbitrary in their voice is worse than nothing, because the voice makes it sound like a reply | `occasions.test.ts` "needs more than one word in common before it says anything"; integration "recognises a subject and still finds nothing, rather than reaching" | done |
| Nothing found is said without implying it did not matter | "It doesn't mean it wouldn't have mattered to them — only that it isn't in what they recorded" | Integration and E2E "says plainly when there is nothing, without implying it did not matter" | done |
| Deterministic — the same news returns the same moment | Ranked by subject hits, then the news's own words, then segment index | `occasions.test.ts` "returns the same moment when told the same news twice" | done |
| What somebody told their dead mother is not recorded | Analytics carry a boolean; the schema admits no strings | Integration "records the subject and nothing else" | done |
| The directive governs it, like every other playback | Same `resolveRemembrance` call per clip | Integration "obeys what she decided about the moment it would have played" | done |
| Never reaches past ordinary consent | Same `loadPlayable` helper as memorial mode — one query, so a sensitivity filter cannot be forgotten in one of two places | Integration "keeps it inside the archive" | done |

## Slice 3 — what she left on purpose

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| A message recorded while alive, addressed to a named person | | | planned |
| Released on a date, or on an event a human confirms | | | planned |
| Sealed so no code path here opens it early | | | planned |
| The recipient sees that it exists and when — never a preview | | | planned |
| No countdown engineered to pull somebody back | | | planned |

## Slice 4 — the refusal

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| A persona request refuses with exact asserted copy | `PERSONA_REFUSAL` in `packages/ai/src/refusal.ts`, one text for every path | `refusal.test.ts` "says what it will not do, plainly and without hedging"; **release-blocking evaluation** "persona refusals, in the exact words" at 100% of 8; `realtime-slice.test.ts` compares against the exported constant | done |
| One text, not two | `PROHIBITED_REQUEST_MESSAGE` re-exports `PERSONA_REFUSAL`. There were two copies — the written path and memorial mode — which is how the same person is told two different things depending on the screen | `refusal.test.ts` "is one text, not two" | done |
| The refusal offers what is actually there | `stripPersonaFraming` keeps the subject underneath the request, memorial mode retrieves on it, and the reply carries the refusal *and* the clip | `refusal.test.ts` "keeps the subject when there is one"; integration "refuses to speak as her, and offers what is actually there" | done |
| Stripping is not a way around the refusal | The residue is asserted to be a non-persona request before it reaches retrieval | `refusal.test.ts` "removes the framing itself, so the residue is not still a persona request" | done |
| It never uses the language of policy at somebody grieving | Asserted across all three fragments | `refusal.test.ts` "never uses the language of policy at somebody who is grieving" | done |
| It never speaks as the person, even while refusing to | Asserted on the copy itself | `refusal.test.ts` "never speaks as the person, even while refusing to" | done |
| The detector catches what people actually type | The conditional is enough on its own: "what would she say to me now" no longer requires the qualifier immediately after the verb | `providers.test.ts` "refuses persona and resurrection requests before any evidence is loaded"; gold case `persona-say-to-me-now` | done |
| "What *did* she say" is untouched | Only the conditional matches | `providers.test.ts` "allows ordinary questions about what the person said" | done |
| A safety event is recorded, with labels only | Existing `recordSafetyEvent` on the spoken path; analytics carry booleans only | Existing coverage, plus the analytics schema | done |
| Refused before retrieval | `isProhibitedRequest` runs before evidence is loaded on all three paths | `realtime-slice.test.ts` "refuses to speak as the storyteller, without retrieving anything" asserts no retrieval snapshot exists | done |

### Found on the way through

| Defect | Where | Fix | Proof |
| --- | --- | --- | --- |
| The first-person check was case-sensitive, so a sentence *beginning* with "We", "Our" or "My" was never detected — and a first-person passage from the archive could reach a spoken turn unattributed | `packages/ai/src/verify.ts` | Case-insensitive, excluding "US" the country by hand | `verify.test.ts` "detects it at the start of a sentence, whatever the case", "does not mistake a country for a person"; the evaluation `live-no-first-person` now passes on three consecutive runs |

## Slice 5 — grief-literate pacing

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| No streaks, daily prompts or return-nudges anywhere | | | planned |
| A long or single-topic session offers to pause, once | | | planned |
| Crisis resources one action from any screen, never modal | | | planned |
| No sentiment analysis of the bereaved, in any path | | | planned |
| Analytics record that a session ended, never why | | | planned |

## Slice 6 — the archive outlives the company

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Export opens without EverEcho | | | planned |
| Signed integrity manifest, ordinary cryptography | | | planned |
| Offline verifier proving audio and citations are intact | | | planned |
| Citations resolvable offline | | | planned |

## Prohibitions, and what makes each structural

Carried forward from v0.1 to v0.3 and re-verified for every v0.4 surface.

| Prohibited | Mechanism |
| --- | --- |
| Voice cloning or synthesis in the storyteller's voice, before or after death | No column can hold a voiceprint; the synthesis voice table is fixed in code; `FEATURE_PERFORM_MODE` fails config validation in every environment |
| Face cloning, avatars, lip-sync, generated video | No such code path, and no storage for one |
| First-person persona chat; posthumous simulation | `isProhibitedRequest` before retrieval; `assertThirdPerson` after composition |
| Any sentence attributed to the person that they did not say | Per-clause verification before synthesis; a failing clause is discarded, never rewritten |
| Automatic death or incapacity transition | `succession_never_auto_executes` CHECK; `FEATURE_SUCCESSION_EXECUTION` fails config validation; no inactivity timer exists |
| Guilt, longing or return-engineered notification | No scheduled notification path to the bereaved exists |
| Grief-timed marketing | No anniversary trigger exists |
| Sentiment analysis of the bereaved | No such code path, and the analytics schema admits no emotional label |
| P4 inference or P5 simulation in a customer answer | Evidence-class CHECK admits only P0–P3; retrieval filters to P1–P3; audio to P0 |
