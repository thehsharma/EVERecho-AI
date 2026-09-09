# Codex phase prompts

Paste one of these into ChatGPT Codex per task, in order. Each is
self-contained: it repeats the non-negotiables, names the files to create, and
states exactly what must pass before the phase is called complete.

| File | Phase |
| --- | --- |
| `PHASE-00.md` | Kickoff and inventory |
| `PHASE-01.md` | Foundation — workspace, config, contracts |
| `PHASE-02.md` | Database and isolation |
| `PHASE-03.md` | The consent engine |
| `PHASE-04.md` | Identity and the consent journey |
| `PHASE-05.md` | Capture and the pipeline |
| `PHASE-06.md` | The memory product |
| `PHASE-07.md` | Retrieval, Q&A and evaluations |
| `PHASE-08.md` | Sharing, lifecycle and admin |
| `PHASE-09.md` | The web application |
| `PHASE-10.md` | Real-time conversation |
| `PHASE-11.md` | The family growth loop |
| `PHASE-12.md` | Remembrance, pacing, portability, conformance |

`CODEX_MIGRATION_PROMPT.md` in the repository root is the full reference spec.
Every phase prompt cites sections of it by number.

## The rule that governs all of them

> Never mark something done because it works. Mark it done when something fails
> if it stops working.

If Codex cannot name the test, the phase is not done.

## Between phases

Ask Codex for the same three things every time:

1. The traceability rows it moved from `planned` to `done`, with the test name
   beside each.
2. The command output proving the suite passes.
3. Anything it implemented but could not execute — those go in the readiness
   document, in the adapter's own header, and in `.env.example`.
