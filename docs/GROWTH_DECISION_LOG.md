# EverEcho v0.3 — decision log

Each entry: what was decided, why, and what would reverse it.

---

## G-001 — A question answer becomes a real source, not a special case

**Decision.** When a storyteller answers a family question, the answer is
promoted to a `source_asset` (kind `text`, storage key `question/<responseId>`)
with a `transcript` and `transcript_segment`, exactly as a conversation is. The
candidate extracted from it is an ordinary `memory_candidate`.

**Why.** Retrieval, citation opening, export, deletion and the integrity
manifest already work on sources. A parallel "answers" path would need every
one of those re-implemented, and each re-implementation is a place a permission
check can be forgotten. The strongest argument is the failure mode: a family
member clicking a citation must land on the actual words, and there is only one
mechanism that does that.

**Reversal trigger.** If answers ever need a fundamentally different retrieval
treatment from recordings — different chunking, different ranking — the shared
representation stops paying for itself.

---

## G-002 — A restricted topic is refused at the question, not at the answer

**Decision.** `familyQuestion.create` refuses a question that matches the
archive's restricted topics, with a reason code the asker sees.

**Why.** The alternative is accepting the question, putting it in front of the
storyteller, and refusing to answer it. That makes the storyteller re-live the
decision they already made every time somebody asks, which is the opposite of
what a restricted topic is for. Refusing early also means restricted subject
matter never lands in a table the storyteller has to read.

**Cost, accepted.** The asker learns that the topic is restricted. That is
information, and it is the right information: it tells them not to ask again,
without revealing anything about what the archive contains.

**Reversal trigger.** If storytellers report wanting to see what was asked even
when they closed the subject.

---

## G-003 — The answer is the evidence; the AI is not in the loop

**Decision.** What the asker receives is the storyteller's own words, cited to
the answer source. No model composes the reply.

**Why.** A question to a person should be answered by that person. Running it
through composition would add a verification burden, a latency cost and an
abstention path to a flow that has none of those problems — and would replace a
P1 direct statement with a P3 synthesis of it, which is strictly worse
evidence.

The AI enters afterwards, once the answer is approved: from then on it is
retrievable evidence like anything else, and answers composed from it carry
claim-level citations back to the moment somebody asked.

**Reversal trigger.** None foreseen. If a storyteller wants help drafting, that
is a drafting tool with its own approval step, not this path.

---

## G-004 — Declining is private, and its reason is never sent

**Decision.** A storyteller may decline, defer, or answer privately. The asker
sees that the question was closed, and nothing else. `decline_reason` is
storyteller-only and never leaves the API.

**Why.** The v0.1 invitation flow already established this: a private decline
that leaks its reason is not private. A person must be able to say no to a
grandchild's question without explaining themselves to that grandchild.

---

## G-005 — Restricting an answer narrows; it never widens

**Decision.** A response's visibility can be narrower than the archive's
consent (the asker only, or a named subset) but never wider. The recipient
grant remains the ceiling, re-checked on every read.

**Why.** The same reasoning as capsules: a sharing surface that can widen the
consent attached to its underlying sources is a consent bypass with a friendly
name.

---

## G-006 — Funnel events carry counts, never content

**Decision.** Every new analytics event records opaque ids, numbers, booleans
and enums. No question text, no answer text, no titles, no names.

**Why.** The existing analytics schema already refuses strings by construction,
which is what makes this cheap to keep true. A funnel that needed content to be
useful would be a funnel worth losing.

---

## G-007 — An alternate account is added, never applied

**Decision.** Approving "I remember it differently" creates a second memory
beside the first, marked `contributor_proposed` at P3, with the proposal
promoted to a citable source and a `contradiction` linking the two claims, left
open. The storyteller's memory is not touched: same words, same version.

**Why.** Families disagree about the past. A product that resolves that
disagreement has decided who was right, and it has decided it in favour of
whoever submitted last. Keeping both is the only honest option, and the
contradiction is what makes the disagreement visible to a reader rather than
buried.

**Reversal trigger.** None foreseen. If storytellers ask to merge two accounts,
that is an editing action they take themselves, with both versions still in the
correction history.

---

## G-008 — A correction is not a contradiction

**Decision.** Approving a correction records the previous value and bumps the
version. It does *not* create a contradiction row.

**Why.** A fix is not a family dispute. Marking it as one would leave a
permanent "these two disagree" mark on a memory that was simply improved, and
would train storytellers to reject corrections to avoid the mark.

---

## G-009 — Contributing is a grant, not a role

**Decision.** Every action that puts material in front of the storyteller —
`correction.propose`, `contribution.create`, `contribution.edit` — is gated on
the recipient grant's `mayContribute`, not on the role table alone.

**Why.** Found by a test: `mayContribute` gated only `correction.propose`, so
the new contribution actions would have been permitted by role and would have
bypassed the storyteller's decision entirely. Being a family member is not the
same as being invited to add to somebody's life story, and the storyteller
decides which.

---

## G-010 — There is no capsule link, only a capsule

**Decision.** No token, no "anyone with the link", no public capsule. A capsule
is read by a named, authenticated recipient or it is not read. The schema
offers no way to ask for anything else.

**Why.** The brief permits "narrowly scoped expiring tokens only when
explicitly enabled". Every one of the failures this feature is meant to prevent
— a forwarded link, a replayed token, a link that outlives its revocation —
exists only because the token exists. Nothing in the product needs one today,
and adding the capability now would mean maintaining a defence against an
attack we could simply not have.

**Reversal trigger.** A real recipient who cannot be given an account —
somebody elderly without email, most likely. Then a token, scoped to one
capsule, single-use, short-lived, and audited on every redemption.

---

## G-011 — A refusal is written on a separate connection

**Decision.** When a capsule read is refused, the access event is written
through a fresh archive-scoped transaction, not the one about to roll back.

**Why.** Found by a test. The refusal was being recorded inside the
transaction that the refusal itself aborted, so it vanished — which would have
made "somebody tried to open this after I withdrew it" unanswerable. That is
the single question the access log exists to answer, and the bug would have
left it silently unanswerable rather than visibly broken.

---

## G-012 — The frontend offers only what the API reports

**Decision.** Every screen that renders a decision control — approve a
proposal, make a capsule, withdraw one — gates it on the capability the API
returned for this viewer, not on an assumption about their role.

**Why.** Found twice in one build: a contributor was shown "Accept this" on
their own suggestion, and a family member was shown "Make a capsule" for
somebody else's archive. Neither was an authorisation hole — the server refused
both — but a button that will be refused is a promise the product does not
keep, and a person who meets two of them stops believing the third.

---

## G-013 — A release is not a refund

**Decision.** When a storyteller declines a gifted archive, the buyer's deposit
moves to `released`, not `refunded`, with a reason code of
`storyteller_declined`.

**Why.** They are the same movement of money and completely different events. A
refund is something the buyer asked for; a release is what the product did
because the person it was bought for said no. Collapsing them would destroy the
only signal that says how often a gift is turned down — which is exactly the
number a founder needs before deciding whether gifting is a viable channel at
all.

The reason code is a code. The storyteller's own words about why they declined
never reach this row, because it is read by whoever is looking at the money.

---

## G-014 — The coverage radar has no score, and no column that could hold one

**Decision.** `memory_gap` records a kind, the exact words that produced it,
and a status. There is no completeness field, no percentage, no streak and no
count exposed anywhere in the contract, the API response, the screen or the
navigation. A browser test asserts the whole page carries no measure, and the
tests that check it live next to the ones that check the questions themselves.

**Why.** Every instinct in product design pulls towards a number here, and it
is the wrong number. "Your archive is 40% complete" tells somebody their life
is a form they are behind on, and the people using this are frequently elderly
and sometimes unwell. The absence has to be structural rather than a style
choice, because a percentage is one product review away from being added by
somebody who did not read this file.

The one place the words *score* and *complete* appear on the screen is the
sentence denying them, so the test forbids them on a question card rather than
on the page — a blunt string ban would have forbidden making the promise.

---

## G-015 — Detection reads sentences, never lives

**Decision.** `detectGaps` finds absences of detail in text the storyteller
already approved: an unnamed person, a date given as a feeling, a place called
"back there", a story referred to and not told. It never reports the absence of
a *subject*.

**Why.** "You have not talked about your father" is a claim about somebody's
life, assembled by software that has read a fraction of it. "You said 'he told
us to leave' and never said who" is a fact about a sentence, and the person can
see the sentence. The first is an inference the product has no standing to
make; the second is the product paying attention.

Two corrections came out of running it against real material rather than
fixtures. A bare pronoun in an approved memory is usually the subject herself
— "she taught for thirty-one years" — so a pronoun only becomes a question when
it acted on the narrator or the family. And a relation who is named in the same
breath is not unnamed: "My brother Ramesh taught me to ride a bicycle" was
producing "you mentioned 'my brother' — who was that?", which reads as the
software not having read the sentence. One of those is worse for trust than ten
questions never asked.

---

## G-016 — "Never" has to hold against the id, not only against the list

**Decision.** `never_ask` filters the list *and* refuses the answer endpoint:
answering a gap that was put away for good returns not-found, exactly as if it
had never existed.

**Why.** A dismissal that only hides a row is a filter, and a filter is
something the next feature routes around. Detection re-runs on every read, so
the insert is idempotent by `(kind, lower(reference))` and cannot resurrect
something already refused; the endpoint enforces the same rule so a stale
browser tab cannot either.

---

## G-017 — Answering a gap produces a source, never a memory

**Decision.** `POST …/gaps/:gapId/answer` promotes what the storyteller typed
to a real `source_asset` with a `transcript` and a `transcript_segment`, runs
extraction under the learning policy, and leaves every suggestion in the review
queue. `memory_candidate` gains a third origin column and the one-origin CHECK
widens to three rather than relaxing.

**Why.** A radar that can only be dismissed is a list of complaints. The
compounding loop is answer → source → candidate → the storyteller decides, and
it is the same loop the interview and the family question inbox already use, so
citation, export and deletion work on the result with no special cases. The
constraint widening matters: a candidate that claimed three origins at once
would have no coherent citation, and the database is where that is settled.

An integration test measures the memory count across the whole operation and
asserts it is unchanged — not "fewer new memories", none.
