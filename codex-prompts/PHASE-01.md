# Phase 01 — Foundation: workspace, config, contracts

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §2, §3, §4 and §14-A, and
docs/BUILD_PLAN.md. Update docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. WORKSPACE
   A pnpm 10 workspace over `apps/*` and `packages/*`, Node 22+, TypeScript
   consumed as source with no build step, so `tsc --noEmit` typechecks the
   whole graph at once. Create: apps/api, apps/web, apps/worker,
   packages/{config,contracts,consent,ai,realtime,adapters,db,pipeline}.
   Root scripts exactly as §3 lists them, including `verify`:
     format:check && lint && typecheck && check:log && test && eval

2. packages/config — every environment variable declared and validated ONCE
   Zod schema over the full list in §14-A. Requirements, each with a test:
   - Production REFUSES TO START on development defaults. The error names
     every problem at once, not the first one.
   - FEATURE_PERFORM_MODE=true and FEATURE_SUCCESSION_EXECUTION=true FAIL
     VALIDATION in every environment, including development.
   - AI_PROVIDER_NO_TRAINING is refused BY NAME if set false — a request to
     permit training must produce an error that says so, not a generic schema
     error that explains nothing.
   - AUTH_DRIVER=local and STORAGE_DRIVER=local are refused in production.
   - PRODUCT_NAME / PRODUCT_CODENAME are read from config everywhere. Nothing
     hard-codes the product name: renaming is a settings change, not a
     find-and-replace.
   Also write .env.example documenting every variable with safe development
   defaults, and a comment per section saying what the local driver does and
   does not do.

3. packages/contracts — the single source of truth for the API
   Zod schemas for every entity in §6, plus:
   - The CLOSED action vocabulary from §4, as a z.enum. `authorize()` will
     switch exhaustively over it, so adding a capability without deciding who
     may use it must be a COMPILE ERROR.
   - The CLOSED deny-reason set from §4.
   - The resource-type enum.
   - The enums in §4: role, consentMode (with `perform` present so every
     switch must refuse it), processingActivity, dataCategory, sensitivity,
     lifeState, membershipStatus, invitationStatus, evidenceClass (P0–P5).
   - PROHIBITED_ACTIONS and PROHIBITED_CONSENT_MODES as exported constants.
   - An analytics props schema that admits NUMBERS, BOOLEANS and a
     three-value severity enum ONLY. A string must be impossible to pass by
     construction — this is what keeps "no memory text in analytics" true.

4. OpenAPI emitted from the same schemas that validate at runtime
   (`z.toJSONSchema()`), so documentation cannot drift from behaviour.
   Script: `pnpm openapi` → docs/openapi.json.

5. Tooling: ESLint 9.x (NOT 10.x — see D-015), Prettier, Vitest with separate
   `unit` and `integration` projects, Playwright config for two viewports
   (desktop and tablet), a CI workflow running the whole `verify` gate plus
   dependency and secret scanning.

## Definition of done

- `pnpm verify` runs end to end (tests may be near-empty; the gate must work).
- A test asserts production config refuses each development default, and names
  each problem.
- A test asserts FEATURE_PERFORM_MODE=true fails validation.
- A test asserts noModelTraining:false is refused by name.
- A test asserts the analytics props schema rejects a string.
- Traceability rows for §4's enums, the action vocabulary and the deny-reason
  set move to `done` with those test names beside them.

## Do not

- Do not add an ORM. Migrations are hand-written SQL (D-003).
- Do not put the durable job queue in Redis. It goes in PostgreSQL so that
  enqueueing is transactional with the domain change that caused it (D-004).
- Do not create a `perform` code path "for later". Its only job is to be
  refused.
```
