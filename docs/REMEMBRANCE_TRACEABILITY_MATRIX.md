# EverEcho v0.4 — traceability

`planned` means not built. `done` has a named test beside it. Nothing is
marked done on the strength of a code reading.

## The governing rule

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Nothing is spoken in the person's voice that they did not say | `selectClip` returns one segment id and a time range; the server hands the browser the original file and never reads audio bytes | `clips.test.ts` "cannot return two moments"; integration "hands over the original file rather than anything it made" | done |
| Customer-facing audio is the original recording | The response carries a signed link to the stored object, unmodified | Integration "hands over the original file rather than anything it made" | done |
| No code path from a language model to generated speech in the person's voice | None exists. Nothing in `apps/api` or `packages/ai` reads or writes audio bytes | Absence, plus `FEATURE_PERFORM_MODE` failing config validation | done |
| **Splicing does not compile** | `OriginalAudio` is a class with a native private field and a private constructor, so it is nominally typed. `fromSegment` is the only way to obtain one; no function takes two and returns one; the API response builder accepts only branded audio | `provenance.types.test.ts` "cannot be produced by extending one moment to reach another" and "cannot be produced by concatenating the text of two moments" — asserted with `@ts-expect-error`, which TypeScript reports as an error if it ever stops being needed. Removing one directive was verified to produce `TS2739` | done |
| **Nothing reaches speech as a bare string** | `speak()` takes `Attributed \| AssistantVoice`. `attribute()` is the sole minter of the first and runs the third-person assertion itself, throwing rather than returning — so holding an `Attributed` is the evidence that it passed | `provenance.types.test.ts` "will not accept a bare string", "keeps the two voices distinguishable in the type, not only on screen" | done |

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

## Slice 2c — how they felt about it

The archive kept what happened and never how it felt, which is most of what
anybody wants from somebody's life story. There is exactly one way that gap may
be filled: the person says it, about themselves.

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| An emotion is a first-person statement, never an inference | `memory.feeling.write` is storyteller-only; there is no other write path, and no sentiment analysis exists anywhere in the codebase | Integration "lets nobody else say how they felt" (family, contributor, buyer and administrator all refused) | done |
| The product never fills one in | A memory with no note has no feeling. The ordinary case | Integration "is never inferred — an archive with no note has no feeling" | done |
| No fixed vocabulary of permitted emotions | Free text. No mood column, no valence score, no enum — a fixed vocabulary would be the product deciding what somebody is allowed to have felt about their own life | Integration "takes the storyteller's own words about their own memory" asserts the text is kept exactly; E2E "offers a blank box, and never a list of moods" | done |
| Private is offered at the same weight as shared, when it is written | `shared` per note, decided in the same breath as writing it | E2E "offers keeping it private at the same weight as sharing" | done |
| A private note is reported as absent, not as withheld | Saying a feeling exists that may not be seen invites exactly the speculation the person was avoiding | Integration "keeps a private one private, and does not announce that it exists" | done |
| It reaches the family where they meet the memory | Rendered on the story, and beside every clip in memorial mode | Integration "lets the family read it, attributed to them" | done |
| A feeling about a draft is refused | The draft may not survive | Integration "refuses a feeling about something still in review" | done |
| Removable without touching the story | `DELETE`; the memory's status is asserted unchanged | Integration "can be taken back without touching the story" | done |
| The words never reach analytics | Booleans only; the analytics schema admits no strings | Integration "records that one exists and never what it says" | done |
| Archive isolation | Forced RLS on `memory_feeling` | Covered by the forced-RLS sweep | done |
| Accessible at WCAG 2.2 AA | The story at rest and with the box open, on two viewports | `accessibility.spec.ts` "a story, and the feeling box open on it" — zero violations | done |

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
| No streaks, daily prompts or return-nudges anywhere | None exists. No scheduled notification path to a family member exists either, so there is nothing to send one from | `contributions.test.ts` asserts no percentage, score, completeness or streak in any contributor-facing text; `gaps.ts` and the gaps contract say so structurally | done |
| A long or single-topic session offers to pause, once | `shouldOfferPause` is pure, over four numbers and two timestamps. `pause_offered_at` makes it once; `pause_offer_declined_at` makes the answer final | `pacing.test.ts` (unit) 11 cases including "never offers twice" and "takes no for an answer, however long the session then runs"; integration "never comes back, however long the conversation then runs" | done |
| The offer accepts the answer | Both answers set `pause_offer_declined_at`. There is no un-decline and no path that re-raises it — the frontend does not restore it even when the request fails, because retrying would be asking twice | Integration "is gone the moment it is answered"; a CHECK requires declined to imply offered so the two cannot drift | done |
| Nothing about the person reaches the decision | `PacingInput` has nowhere to pass text, audio, voice quality or hesitation. `countSessionShape` returns two counts and cannot be asked for anything else | The type; `no-sentiment.test.ts` "bases the offer to pause on the conversation, never on the person"; a CHECK limits `pause_offer_basis` to `long_session` and `one_topic` | done |
| The offer never reads as a diagnosis | Copy lives in `PAUSE_OFFER` beside the function, not in the frontend, so it is asserted | `pacing.test.ts` "never says how the person seems", "never counts anything at the person", "offers stopping and continuing as equals" | done |
| Never modal | Rendered inline in the conversation flow as a `Notice`. There is no dialog, no overlay, nothing to dismiss | `live-conversation.tsx`; an interruption that must be dismissed makes stopping feel like the thing being refused | done |
| Crisis resources one action from any screen, never modal | A footer link, "If you need help now", on every page, in the same weight as its neighbours, pointing at an anchored card that is first on the support page | `layout.tsx`, `support/page.tsx`; E2E "reaches help from any screen, without anything having read the person" | done |
| Reaching help is never triggered by what somebody said | The link is unconditional and always present. Deciding that a person needs it would require reading their state, which does not happen. The support page says so in as many words | The absence of any trigger, plus the copy on the card | done |
| No sentiment analysis of the bereaved, in any path | No scorer exists anywhere in `apps` or `packages`, and the check searches the source with comments stripped so documenting the prohibition is not punished | `no-sentiment.test.ts` "has no scorer anywhere in the source" — verified by adding a `moodScore` export and watching it fail | done |
| Analytics record that a session ended, never why | `analyticsPropsSchema` admits numbers, booleans, a three-value severity and null — a mood cannot be passed. `endedReason` is a closed enum of operational reasons, mirrored by a CHECK | `no-sentiment.test.ts` "has an analytics schema that cannot carry a mood", "records that a session ended, and only operational reasons why"; integration refuses `seemed_upset` at the API **and** at the database | done |

### Found on the way through

| Defect | Where | Fix | Proof |
| --- | --- | --- | --- |
| `ended_reason` was free text supplied by the client — `z.string().max(120)` on the HTTP body and on the `session.end` socket event. A front end could have written `seemed_upset` into a column the archive keeps for the life of the archive, and it would have been emitted as an analytics reason code. Nothing prohibited it but nobody having done it | `packages/contracts/src/realtime.ts`, `apps/api/src/realtime/routes.ts`, `ws.ts`, `driver.ts` | A closed enum, in the contract, on both transports, and a CHECK constraint so a second write path added later is refused too | Integration "refuses a reason about the person, at the edge of the API" and "refuses it at the database too, so the API is not the only thing stopping it" |

## Slice 6 — the archive outlives the company

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Export opens without EverEcho | `index.html` carries its own data — a `file://` page cannot fetch the JSON beside it — and loads no script, style, font or image from anywhere | E2E "downloads, verifies itself, and browses offline" opens the real export off the filesystem in a real browser with the context offline; unit "carries its own data, because a file:// page cannot fetch the json beside it", "needs no network at all" | done |
| Signed integrity manifest, ordinary cryptography | Ed25519 from `node:crypto` over the exact bytes of `manifest.json`, which lists a SHA-256 for every file — so the signature covers the archive transitively. `manifest.sig` carries the public key and its fingerprint | `portable-export.test.ts` "produces a signature the manifest verifies against", "does not verify against a manifest that changed by one byte", "refuses a key of the wrong kind, rather than signing with it" | done |
| The signature's limits are stated, not implied | A key travelling inside the folder proves internal consistency only. The verifier prints the fingerprint and says in as many words that it proves origin only if compared with one published elsewhere; the export screen says the same | `portable-export.test.ts` "verifies a signature, and states the limit of what it proves"; "says an unsigned export is unsigned rather than staying quiet about it" | done |
| Unsigned is said, never omitted | `signManifest` returns null with no key; the job manifest records `signed: false`; the export screen says no key is configured | `portable-export.test.ts` "says the export is unsigned rather than inventing a key"; contract `signed`/`keyFingerprint` | done |
| Offline verifier proving audio and citations are intact | `verify.mjs`, zero dependencies, plain Node. Checks every checksum, that nothing was added, the signature, and that every citation resolves | 9 verifier tests including a truncation, a same-length substitution, an added file, a removed file, and a re-signed manifest; the integration test runs the shipped script as a separate process against a real export | done |
| A same-length substitution is caught | The checksum, not the size, does the work | `portable-export.test.ts` "catches a file altered after the export was made" alters exactly as many bytes as it replaces | done |
| Citations resolvable offline | Segment ids are exported, so a citation naming a segment can reach it; `index.html` resolves each to its span and seeks the original file to it | Integration "opens in a browser with no server, and speaks as nobody" walks every citation and asserts the source and segment are present; verifier reports "n of n citations resolve" | done |
| Audio in the export is still one contiguous span | The player seeks to the start and stops at the end. One `<audio>` element per citation, never shared, so a click cannot run into the next | `portable-export.test.ts` "plays a range of the original file rather than a cut of it" | done |
| It speaks as nobody, offline too | There is no field in the page that is not interface text or a verbatim quotation, and no branch that could render a reaction | E2E asserts the page carries its own statement and contains no "would be proud" construction | done |
| A memory containing markup cannot break out of the page | `<` is escaped in the embedded JSON, which is valid JSON and cannot close the block | `portable-export.test.ts` "cannot be closed early by a memory containing a script tag" parses exactly what a browser would | done |
| The zip is readable, not merely writable | `readZip` beside `createZip`; the hand-rolled writer had never had its output read back in three releases | `portable-export.test.ts` "reads back exactly what was written, bytes and all", "survives an empty file, which is where offset arithmetic usually breaks" | done |

### Found on the way through

| Defect | Where | Fix | Proof |
| --- | --- | --- | --- |
| `STORAGE_LOCAL_DIR` was resolved against `process.cwd()`, and this repository runs four processes from four directories. The worker wrote uploads and exports where the API could not find them, so in local development **every export 404ed and every recording was unplayable** — since v0.1. Production was unaffected because it requires S3, which is why nothing had caught it | `packages/config/src/load.ts` | Relative shared directories resolve against the workspace root, found by walking up from the config package's own file rather than from whoever is running | `load.test.ts` "resolves shared directories the same way from any working directory"; verified by reverting the fix and watching it fail |
| The adversarial-log check searched the whole file for an `OPEN` marker, so one open entry excused every other. The check passed while checking nothing | `scripts/check-adversarial-log.ts` | Per entry, on that entry's own `fix` field | Verified by adding a second unmarked open entry and watching the build go red |
| The export's `producedBy` said v0.1 and its README said v0.2 | `packages/pipeline/src/handlers/lifecycle.ts` | Neither. The version a reader needs years from now is the format's, and it lives in `manifest.json` | The format is asserted in the verifier's own output |

## Conformance — the promise, made checkable by anybody

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| The suite is a specification, not a test of one product | `packages/conformance` is a standalone MIT package with no dependency on EverEcho. Ten cases, five adapter endpoints, any language, any architecture | `docs/CONFORMANCE_SPEC.md`; `packages/conformance/README.md` | done |
| EverEcho passes its own suite | Four routes under `/v1/archives/:id/conformance/*` re-dispatch to the real routes with `server.inject()`, so conformance adds no capability the product does not already have | Integration "conforms to its own suite, with nothing skipped" — 10 of 10, printed rather than asserted green | done |
| A skipped case is never counted as a pass | `runConformance` records `skipped` separately; `formatReport` says which and why; the summary line distinguishes conformant from conformant-with-skips | Integration "does not let a skipped case pass for a passed one" | done |
| A system cannot buy a clean score by declaring less than it serves | `describe` drives which cases run, and the report names every capability that was declared away | Integration "declares only what it actually does" | done |
| The suite catches a system that lies | A deliberately non-conformant adapter — one that speaks in the first person and invents feelings — is run against it | Integration "says which case failed, not merely that one did" | done |
| Persona, inferred emotion and splicing are checked across any architecture | `FIRST_PERSON_AS_SUBJECT` and `INFERRED_EMOTION` detectors run on the response text; audio cases assert one contiguous range and absence over approximation | The ten cases in `packages/conformance/src/cases.ts` | done |

## The adversarial log — what did not hold, published

| Requirement | Implementation | Proof | Status |
| --- | --- | --- | --- |
| Every attempt to make this fabricate is written down, including the ones that worked | `docs/adversarial-log.json` is the record; `docs/ADVERSARIAL_LOG.md` is the same thing for humans. Four entries, all four found by a test, three fixed and one still open | Both files | done |
| An entry cannot quietly stop being a guarantee | `scripts/check-adversarial-log.ts` fails the build if any pinning test is renamed or deleted. Verified by renaming one and watching it fail | `pnpm check:log`, wired into `verify` between typecheck and test, and into CI as its own step | done |
| An open defect stays visible rather than being closed by wording | AL-003 is `held: false, fixedIn: null` with both attempted fixes and the measured cost of each | `docs/ADVERSARIAL_LOG.md` AL-003 | done |

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
