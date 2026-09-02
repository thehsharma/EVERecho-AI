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
