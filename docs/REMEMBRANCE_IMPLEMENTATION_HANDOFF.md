# EverEcho v0.4 — implementation handoff

For whoever continues this, including a future session of this one.

## Where the build is

**Phase 0 complete.** Baseline verified by execution: 480 unit and
integration tests, 48/48 evaluations with all six release-blocking metrics
met, `pnpm verify` clean, 16 migrations, 107 OpenAPI routes. Planning
documents written.

Slices 1 to 6: **not started.** `REMEMBRANCE_TRACEABILITY_MATRIX.md` is the
live status.

## The one thing to understand before changing anything

Customer-facing audio is bytes from a file the storyteller recorded. Nothing
in this release generates speech in their voice, and nothing assembles a clip
from more than one contiguous span of one recording.

If you find yourself adding a text-to-speech call, or joining two ranges to
make an answer flow better, stop. Both produce a sentence the person never
said, and the second one does it without a single fabricated word.

## How to continue

```
Read all applicable repository instructions and
docs/REMEMBRANCE_IMPLEMENTATION_HANDOFF.md.
Verify the current Git state and the last recorded test results.
Continue from the first unfinished traceability item.
Do not redo completed work, do not overwrite unrelated changes,
and do not stop after planning.
```

## Run it

```bash
service postgresql start
pnpm install && pnpm db:migrate && pnpm db:seed
pnpm dev
pnpm verify
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium pnpm test:e2e
```
