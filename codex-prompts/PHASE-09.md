# Phase 09 — The web application

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §12 (Web — 45 routes) and
the emotional-safety rules in §2. Update docs/TRACEABILITY_MATRIX.md as you go.

## Build all 45 routes

Public: / · /how-it-works · /trust · /pricing · /sign-in · /sign-up ·
/support · /demo · /invitations/[token] · /billing/local-checkout

Account: /account · /account/billing · /account/preferences ·
/account/security · /admin

Archives: /archives · /archives/new

Archive (under /archives/[archiveId]): overview · ask · audit · biography ·
capsules · capsules/[capsuleId] · consent · consent/history ·
consent/teach-back · contribute · delete · export · gaps · inbox · interview ·
learned · learning · listen · members · memories · memories/[memoryId] ·
people · proposals · questions · remembrance · sources · succession · talk ·
talk/[sessionId] · timeline

(Screens for features not yet built land in their own phase — build the shell
and the states now, wire them as their phase completes.)

## The rules the frontend must obey

1. ROUTE PROTECTION HAPPENS BEFORE RENDER, server-side. Not in a useEffect,
   not behind a spinner.

2. THE FRONTEND NEVER DECIDES ACCESS. The navigation and every action button
   are built from CAPABILITIES THE API REPORTS. If the API does not report the
   capability, the control is not rendered. A contributor is never offered a
   decision on their own proposal because the API never says they may make one.

3. EVERY SCREEN RENDERS FOUR STATES: loading, empty, error, permission-denied.
   The permission-denied state uses the specific deny reason, not "forbidden".

4. WCAG 2.2 AA, ZERO VIOLATIONS, scanned by axe on TWO VIEWPORTS (desktop and
   tablet) — including states reached only after interaction: a form opened, a
   conversation mid-turn, an answer present.

5. Generated content is ALWAYS identified as AI-assisted. Drafts are marked as
   drafts. Provenance tags distinguish original / transcription / correction /
   corroboration / synthesis / uncertainty / contradiction.

6. NO ENGAGEMENT MECHANICS ANYWHERE. No streaks, no counts, no percentages, no
   completeness score, no progress bar over somebody's life, no guilt
   reminders, no nudges to come back. A test should scan whole pages for any
   measure and fail if it finds one.

7. PAUSE AND EXIT ARE AVAILABLE EVERYWHERE. Skip, pause, "prefer not to
   answer", end — always at the same visual weight as continuing, never behind
   a confirmation, never harder to reach than the thing they stop.

8. "If you need help now" is a FOOTER LINK ON EVERY PAGE, at the same weight
   as its neighbours, pointing at an anchored card that is FIRST on the support
   page. It is UNCONDITIONAL and NEVER MODAL — it is never triggered by what
   somebody said, because deciding that a person needs it would require reading
   their state, which does not happen. Say so on the support page in as many
   words.

9. Demo mode (/demo): five synthetic accounts, one password, each seeing a
   different slice — storyteller (everything, including drafts), buyer
   (membership and billing, NO memories), family (approved stories, timeline,
   cited answers), contributor (plus suggesting corrections), support
   (operational metadata only, never content). The walkthrough must show the
   REFUSALS, not a happy path around them.

## Definition of done

- Playwright suite on two viewports covering: the storyteller journey, a
  family member's journey, revocation, an abstention, opening a citation, and
  the review queue.
- accessibility.spec.ts: every public page and every archive screen scanned
  with axe, ZERO violations, plus interaction states.
- Named E2E tests including: "the storyteller is in control", "drafts marked
  as drafts", "opening a source shows the words it came from", "reaches help
  from any screen, without anything having read the person".
- A test that scans a whole page and fails on any score, percentage, streak or
  completeness verdict.

## Do not

- Do not render an action the API did not authorise, even greyed out with a
  tooltip. The presence of the control is the promise.
- Do not put crisis resources in a modal. An interruption that must be
  dismissed makes stopping feel like the thing being refused.
- Do not add a "your archive is 62% complete" anything.
```
