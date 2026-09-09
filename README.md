# EVERecho-AI

## Migrating the EverEcho build to ChatGPT Codex

The working implementation lives on branch
[`claude/everecho-v0-1-build-awtih5`](../../tree/claude/everecho-v0-1-build-awtih5)
— four releases (v0.1 – v0.5), ~500 files, 78 database tables, 107 API routes,
45 web screens, 480 unit and integration tests, 153 browser tests and 48 AI
evaluation cases.

This branch carries the prompts for rebuilding all of it in another project
with Codex:

| File | What it is |
| --- | --- |
| [`CODEX_MIGRATION_PROMPT.md`](CODEX_MIGRATION_PROMPT.md) | The complete specification and the kickoff prompt. Start here |
| [`codex-prompts/`](codex-prompts/) | Thirteen phase prompts — one Codex task each, in order |

The reference branch also contains `EverEcho_Complete_Architecture.md`: every
source file reproduced byte for byte, for a direct port.
