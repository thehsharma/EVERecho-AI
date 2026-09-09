# Phase 00 — Kickoff and inventory

Paste this into Codex as the first task.

---

```text
You are continuing the EverEcho project inside this repository.

EverEcho is a consented family memory archive. A living person records their
own life story, reviews everything before it is kept, and decides exactly who
may see what. Family members can ask questions and get answers that cite the
recording or document they came from — or an honest refusal to answer.

It never pretends to be the person. That is not a feature that was cut; it is
the point of the product, and most of the code exists to make it structurally
impossible.

Read CODEX_MIGRATION_PROMPT.md in this repository in full before answering.

## This task, and only this task

1. INVENTORY. Report as a table: language, framework, package manager,
   database, test runner, existing HTTP routes, existing database tables,
   existing authentication, existing AI integration, and anything already
   present that overlaps with the specification. Name files.

2. DECIDE and state which of these you are doing:

   (a) PORT — the reference stack (TypeScript / Fastify 5 / Next.js 16 App
       Router / PostgreSQL 16 / Zod 4 / Vitest / Playwright) matches this
       repository or can be adopted here, so I will bring the reference
       implementation across module by module.

   (b) RE-IMPLEMENTATION — this repository uses a different stack, so I will
       rebuild the same behaviour idiomatically in it, preserving every
       invariant in §2 of CODEX_MIGRATION_PROMPT.md.

   Justify in three sentences. Do not change the existing stack unless a hard
   requirement in the specification cannot be met in it. If you choose (b),
   also name, for each of the eight invariants in §2, the mechanism you will
   use in this stack to enforce it — an invariant with only a comment behind
   it is a wish.

3. WRITE AND COMMIT two files:

   - docs/BUILD_PLAN.md
     The twelve phases from §13, each with: scope, the tables it adds, the
     routes it adds, the screens it adds, and its definition of done. Also a
     "Repository state at Phase 0" section recording what you actually found,
     with each finding labelled VERIFIED (you inspected or executed it),
     INFERENCE, ASSUMPTION (a reversible choice) or UNKNOWN (needs
     credentials, counsel or research). Do not label anything VERIFIED that
     you did not run.

   - docs/TRACEABILITY_MATRIX.md
     One row per requirement across §4 to §12, with columns:
     Requirement | Implementation | Proof (test name) | Status.
     Every row starts as `planned`. A row becomes `done` only when a named
     test exists and passes. Add the status legend: done / partial (works,
     with a stated limit) / interface only (complete and type-checked, never
     executed) / planned / gated.

4. STOP. Do not start Phase 1 in this task. Do not scaffold application code.

## Report back with

- The inventory table.
- The port/re-implementation decision and its justification.
- The number of traceability rows you created.
- Any conflict you found between this specification and something already in
  the repository. The repository is the authority on what exists; the
  specification is the authority on what should be built. Where they
  disagree, say so rather than silently picking one.
```
