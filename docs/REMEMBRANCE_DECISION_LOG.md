# EverEcho v0.4 — decision log

Each entry records a decision and the reason somebody will need in a year.
Decisions taken before any code was written are marked as such, so that a
later reader can tell a plan from a finding.

---

## R-001 — Retrieved, never generated

**Decision.** Customer-facing audio is bytes from a file the storyteller
recorded. There is no code path from a language model to a customer's
speakers, and none will be added.

**Why.** Every competitor in this category will answer the moment of loss
with a synthetic voice saying something the person never said. It demos
beautifully and it is a forgery. The first time one of them is caught selling
a fabricated deathbed sentiment, the backlash takes the whole category with
it — and the only product left standing is the one that can prove it never
did that.

So the constraint is not defensive. It is the differentiator, and it has to
be structural, because a rule that lives in a policy document is one product
review away from being overridden by somebody who did not read it.

**Taken before implementation.**

---

## R-002 — A clip is one contiguous span

**Decision.** A returned clip is a single unbroken range of one recording.
Never two ranges joined, never a sentence trimmed to fit an answer better.

**Why.** Splicing is how a true recording becomes a false statement without
a single fabricated word. "I never wanted to leave" and "the house in Pune"
are both things she said; joined, they are something she did not say. The
edit is the lie, and no amount of citation makes it honest.

The cost is real and accepted: sometimes the honest clip is forty seconds
when a fifteen-second one would have landed better.

**Taken before implementation.**

---

## R-003 — Withholding is a first-class answer

**Decision.** The ante-mortem directive can refuse as easily as it permits.
"Not this. Not her. Not yet." is stored as its own kind of statement, not as
the absence of a grant.

**Why.** A directive that only records permissions treats silence as consent,
and after death nobody can correct the record. A person who wanted one topic
sealed and everything else open must be able to say exactly that, once, in a
way that survives them.

**Taken before implementation.**

---

## R-004 — Death is established by a person, never inferred

**Decision.** Activation is manual, requires documentary evidence, and is
executed by a named human whose name is written into the audit trail. No
inactivity timer, no engagement-based inference, no heuristic.

**Why.** The failure mode is not theoretical: a storyteller in hospital for
six weeks, or one who simply stops using software, would trigger any timer
you could write. Releasing somebody's private archive to their family while
they are alive is unrecoverable, and there is no apology that fixes it.

The existing `succession_never_auto_executes` CHECK constraint already makes
automatic transition impossible. This release does not weaken it.

**Taken before implementation.**

---

## R-005 — The refusal is one text, and it is asserted

**Decision.** `PERSONA_REFUSAL` lives in one module. The written path, the
spoken path and memorial mode all use it, an integration test compares against
the exported constant rather than a copy, and a release-blocking evaluation
checks the exact wording on every persona case.

**Why.** There were two copies of it — one for the written and spoken paths,
one written fresh for memorial mode — and they had already begun to differ. Two
copies of the most important sentence in the product is how the same grieving
person gets told two different things depending on which screen they happened
to be on.

Asserting the wording rather than the outcome is deliberate. A refusal that
still refuses but has been quietly reworded into policy language is a
regression that no behavioural test would catch.

---

## R-006 — A refusal keeps the question underneath it

**Decision.** A persona request is refused, and the subject inside it is not
thrown away. "Pretend to be my mother and tell me about the move" is refused as
a persona request, and the archive still goes and finds what she said about the
move.

**Why.** Discarding the whole sentence discards the question with it, and makes
somebody retype it at the worst possible moment. The refusal does not soften:
the reply is still in the archive's own voice and still says plainly that it
will not imagine anything. It just arrives with something in its hands.

The residue is checked before it is used, so stripping cannot become a way
around the refusal.

---

## R-007 — The first-person guard was case-sensitive for two releases

**Decision.** `isFirstPerson` matches case-insensitively, with "US" the country
excluded by hand.

**Why.** Found by an evaluation, not by reading the code. The pattern listed
`I` in capitals and everything else in lower case, so a sentence *beginning*
with "We" or "Our" or "My" — which is how most first-person sentences begin —
went straight through. `assertThirdPerson` is the technical expression of "the
assistant never speaks as the storyteller", and for two releases it would have
allowed "We moved to Pune in 1962" to be spoken unattributed.

It surfaced intermittently because it depended on which memory retrieval
happened to choose, which is exactly the kind of failure that gets dismissed as
flaky. It was not flaky. It was real, and the evaluation was right three times
before anybody looked.

---

## R-008 — Telling them something returns a fact, not a reaction

**Decision.** When somebody shares news with the archive, it works out what the
news is *about* and plays a moment from the storyteller's own life on the same
subject. It never composes a response.

**Why.** This is the single most requested thing in the category and the
easiest to build badly. "She would have been so proud" is a sentence attributed
to a person who cannot say it, however kindly it is meant, and the fact that
grief makes somebody want to hear it is exactly why the product must not supply
it.

The honest version turns out to be better. You tell her you got the job; she
tells you about her first class, fifty-three children and one blackboard, in
1971, in her own voice. Nobody wrote that for the occasion. She just said it,
and it happens to be the truest available answer.

Two constraints make this safe rather than merely well-intentioned. The rule
table maps news to *subjects* — work, marriage, a child — and has no column
that could hold a sentiment, because the archive has no standing to decide
whether somebody's news is happy. And a moment must touch at least two of the
subject's words before it is offered: something arbitrary in her voice is worse
than silence, because the voice makes anything sound like a reply.

When there is nothing, the copy says so without implying indifference: "it
doesn't mean it wouldn't have mattered to them — only that it isn't in what
they recorded."

---

## R-009 — One component renders everything that comes back

**Decision.** `ArchiveReply` renders both modes. There is no branch anywhere in
it that could produce warmth, pride or presence.

**Why.** The two started as separate components with identical bodies, which is
a place for two renderings of the same thing to drift — and the thing that
would have drifted is the one that matters: that the archive's voice and the
storyteller's are never allowed to look alike. Merging them also removes the
obvious future edit, which is somebody adding a kind sentence to the "tell"
branch only.

---

## R-010 — Emotion is stated, never detected

**Decision.** `memory_feeling` holds what the storyteller said about their own
feelings, written by them. There is no sentiment analysis in this codebase, no
emotion detection from audio, and no path that writes a feeling except the
person writing it themselves.

**Why.** This was asked for repeatedly as "add the emotions", and there are two
products behind that request. One infers from a recording that somebody sounded
sad and writes it into their archive. The other lets the person say how they
felt. The first is a fabrication that happens to be about feelings rather than
facts, which does not make it a smaller one — it puts a claim about somebody's
inner life into their mouth, and after they die there is nobody to correct it.

The gap it fills is real and was the largest one in the product: the archive
kept what happened and nothing about what it was like, which is most of what
anybody actually wants from a life story.

---

## R-011 — A blank box, and no list of moods

**Decision.** Free text. No enum of permitted emotions, no chips, no scale.

**Why.** Every instinct says to offer chips, because a blank box is harder to
start. But a fixed vocabulary is the product deciding what a person is allowed
to have felt about their own life, and the answers that matter here are never
one of six words. *"Relieved, mostly, and then guilty about being relieved"* is
not on anybody's list of moods, and it is the kind of sentence this feature
exists for.

The screen says so where the person can read it: nobody will summarise it,
shorten it, or decide what it means.

---

## R-012 — Private is said in the same breath as saying the thing

**Decision.** `shared` is chosen per note, at the moment of writing, and a note
kept private is reported to everybody else as absent rather than as withheld.

**Why.** "I will tell you what happened but not what it did to me" is an
ordinary and reasonable thing to want, and it has to be sayable at the moment
of writing rather than in a settings screen somewhere else.

Reporting it as absent rather than withheld matters more than it looks. Telling
the family that a feeling exists which they may not see invites precisely the
speculation the person was avoiding when they kept it to themselves.

---

## R-013 — A symbol brand was not enough; a private field is

**Decision.** `OriginalAudio` is a class with a native private field and a
private constructor, not an interface with a `unique symbol` brand.

**Why.** The symbol brand was written first and looked right. A test caught
that it was not: **object spread preserves a symbol brand at the type level**,
so `{ ...clip, endMs: other.endMs }` — taking one moment and extending its end
to reach another, which is exactly the splice this exists to prevent — still
typechecked.

A native private field makes the type nominal. A spread of one produces a
plain object that is not assignable back, and the compiler says so:
`TS2739: missing the following properties from type 'OriginalAudio':
#unaltered`.

The finding matters more than the fix. The first design was reasoned about
carefully and was wrong, and nothing but a test that tried the actual attack
would have shown it. Every guarantee in this file deserves the same treatment:
write the attack, not the argument.

---

## R-014 — The brand carries the proof rather than sitting beside it

**Decision.** `attribute()` runs `assertThirdPerson` itself and throws instead
of returning. Holding an `Attributed` value is the evidence that the assertion
passed.

**Why.** The check used to run at the call site, one line after the value was
produced. That works until somebody produces a presented string somewhere else,
or reorders the two lines, and then a value exists that looks checked and is
not. Moving the assertion inside the only minter removes the gap entirely: the
type and the proof cannot drift apart because they are the same event.
