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
