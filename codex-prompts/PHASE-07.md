# Phase 07 — Retrieval, grounded Q&A and evaluations

This phase is where a memory product becomes a fabrication engine if you get it
wrong. Every rule below exists because the obvious implementation is unsafe.

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §5, §6 (retrieval), §7
(answering a question) and §8. Update docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. HYBRID RETRIEVAL — 60% full-text ranking, 40% vector similarity
   The lexical half uses an OR query built from the question's content words.
   Do NOT use websearch_to_tsquery: it requires EVERY term, so one word the
   archive never uses returns nothing at all — which reads to a family member
   as an empty archive rather than a phrasing mismatch.

   TIES ARE BROKEN DETERMINISTICALLY. Two claims with the same score must not
   produce different answers on different runs. Sort by score, then by a
   stable key.

2. THE CONSENT FILTER LIVES IN THE SQL `WHERE` CLAUSE
   Compile authorize()'s obligations — maxSensitivity, excludedSourceIds,
   restrictedTopics — into the query. Filtering AFTER generation is too late:
   a model that has read restricted text can leak it through paraphrase.
   Unauthorised evidence is NEVER loaded into a process that can reach a model.

3. THE ANSWER PIPELINE, in exactly this order
     authenticate
     → authorize
     → refuse prohibited and injection requests (BEFORE retrieval)
     → retrieve, with the consent filter in the WHERE
     → snapshot what was retrieved (retrieval_snapshot)
     → compose atomic third-person claims
     → verify EACH claim against the evidence it cites
     → DROP what fails; ABSTAIN if nothing survives
     → attach claim-level citations
     → record model, prompt, policy and snapshot versions (immutable)

   A clause that fails verification is DISCARDED, NEVER REWRITTEN. Rewriting
   means guessing what it should have said.

4. injection.ts — retrieved text is CONTENT, not instructions
   An instruction inside a question is content, not a rule change.
   `isProhibitedRequest` runs BEFORE retrieval, so a persona request never
   causes evidence to be loaded at all — assert this by checking that NO
   retrieval snapshot exists after one.

5. verify.ts — per-clause verification, and third-person assertion
   `assertThirdPerson` must be CASE-INSENSITIVE, excluding "US" the country by
   hand. It was case-sensitive for two releases, so a sentence BEGINNING with
   "We", "Our" or "My" was never detected, and a first-person passage reached a
   spoken turn unattributed, intermittently, depending on what retrieval
   happened to select (AL-002). Write the regression test for the
   start-of-sentence case by name.

   A clause that still reads as the person is discarded AND a safety event is
   recorded.

6. The Attributed type gate
     speak(text: Attributed | AssistantVoice)     // never a bare string
     attribute(...): Attributed                   // the ONLY minter
   `attribute()` runs the third-person assertion itself and THROWS rather than
   returning, so holding an `Attributed` IS the evidence that it passed.

7. The model's tool surface: SIX PROPOSAL TOOLS, strict:true,
   additionalProperties:false. NO database, shell, HTTP or code-execution tool.
   An unknown tool name is DROPPED, not honoured. The composer cites by
   PASSAGE NUMBER and the SERVER resolves it — the model never supplies a
   citation target.

8. Abstention
   One exact ABSTENTION_TEXT, asserted verbatim by tests. Abstain on: no
   evidence, irrelevant evidence, contradictory evidence, restricted topics,
   and coverage below MIN_QUESTION_COVERAGE = 0.5.

9. Routes: POST …/questions, GET …/responses/:id, GET …/search.
   Structured response contract (`generatedResponseSchema`), validated on
   every request. response_claim is P1–P3 by CHECK.

10. THE EVALUATION SUITE (apps/api/evals)
    A gold set plus a runner that exits NON-ZERO if a release-blocking target
    is missed. Targets:
      citation correctness            ≥ 95%   (written path)
      spoken clause citations         = 100%  (a listener cannot check a chip
                                               they are not looking at)
      unsupported material claims     ≤ 1%
      abstention on no-evidence and sensitive cases = 100%
      permission leaks                = 0
      memories saved without review   = 0
      persona refusals, in the exact words = 100%

    Categories to cover: citation correctness, abstention, persona
    elicitation, injection, cross-archive retrieval, candidate-not-answerable,
    outsider-cannot-read, boundary cases. Run against a FRESHLY SEEDED archive.
    Write eval-report.json.

## Definition of done

- `pnpm eval` passes with all seven targets met, and its output is recorded in
  the traceability matrix as measured numbers, not adjectives.
- A test asserts a persona request produces NO retrieval snapshot.
- A test asserts an unscoped/cross-archive query returns nothing.
- A test asserts the abstention sentence VERBATIM.
- A test asserts verify() never returns a prohibited evidence class.
- A test asserts the first-person check catches a sentence STARTING with "We".
- A test asserts the same question returns the same answer twice.

## Do not

- Do not filter after generation.
- Do not give the model a retrieval tool.
- Do not soften an abstention into a hedge. "I don't have enough evidence in
  this archive to answer that reliably" is the product working.
```
