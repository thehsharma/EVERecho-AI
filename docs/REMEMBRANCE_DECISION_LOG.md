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
