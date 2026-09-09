# Phase 03 — The consent engine

This is the phase the whole product depends on. Do not rush it.

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §4 in full. Update
docs/TRACEABILITY_MATRIX.md as you go.

## Build packages/consent

1. authorize(actor, action, resource, subject, context)
   PURE. No I/O, no clock, no database, no randomness. Everything it needs
   arrives as an argument. Returns either
     { allow: true, obligations: { maxSensitivity, excludedSourceIds,
       restrictedTopics, … } }
   or
     { allow: false, reason: DenyReason }
   from the closed set in §4.

   Order matters. Check buyer-cannot-consent-for-storyteller BEFORE the role
   table, so the reason is specific — `buyer_cannot_consent_for_storyteller`,
   not `role_not_permitted`. A precise refusal is the difference between a
   frontend that can say "your access ended on 3 March" and one that says
   "forbidden".

2. The role/action matrix (ROLE_ACTIONS) for six roles that are NOT a ladder:
   storyteller, buyer, family, contributor, steward, support_admin.
   - storyteller: final authority; ACTION_REQUIREMENTS.storytellerOnly
   - buyer: cannot consent for the storyteller, does not become owner by
     paying, lacks membership.revoke and archive.delete, holds NO content
     rights
   - family: only what was explicitly granted
   - contributor: proposes, never overwrites — and contributing is a GRANT
     (`mayContribute` on the recipient entry), not a role
   - steward: seven actions, no content
   - support_admin: NO standing content access — returns
     `admin_scope_metadata_only`; break-glass required and audited

3. The policy compiler
   Takes a consent policy document (§4), canonically serialises it, SHA-256
   hashes it, versions it. Refuses `perform` mode. FORCES voiceAndLikeness
   fields false regardless of input. Records consentCopyVersion,
   legalCopyVersion, policyEngineVersion.

   Changing consent SUPERSEDES rather than overwrites. An
   `UPDATE consent_policy SET document = …` is always a bug — "what had they
   agreed to in March?" must always be answerable.

4. Mode is a CEILING; every processing activity is granted INDEPENDENTLY.
   A storyteller can enable composed answers while still refusing OCR — their
   documents simply go unprocessed. Do NOT derive activities from the mode:
   that collapses exactly the granularity consent needs.

5. Obligations compile into SQL
   maxSensitivity, excludedSourceIds and restrictedTopics must be expressible
   as a WHERE clause, so "what may this person see" is answered by the query
   rather than by a filter afterwards. Provide the compiler function here;
   retrieval will use it in Phase 07.

6. Teach-back (packages/consent/src/teachback.ts)
   Multiple-choice questions that make the storyteller explain the arrangement
   back. An incorrect answer produces an EXPLANATION, not a score — it teaches
   rather than blocks. Store every answer, the policy version, the hash, the
   actor and the context.

7. Dispute hold: freezes distribution WITHOUT deleting sources.
   Succession: recorded, never executed. No inactivity code path exists — do
   not write one, not even disabled.

## Definition of done

- A test asserts authorize() is a PURE FUNCTION OF ITS INPUTS: same arguments,
  same result, no I/O.
- Every role × every action is covered by a test.
- Named tests exist for at least: "the buyer cannot consent for the
  storyteller", "the steward is not the owner", "administrators have no path
  to memories", "refuses a contribution from a family member", "per-source and
  per-topic control", "recipient grants".
- A test asserts a granted synthetic voice is refused by the compiler.
- A test asserts consent mode `perform` is refused by the compiler.
- A test asserts a policy change writes a NEW version and supersedes the old,
  and that the old document is still readable.
- Deny reasons are asserted to be CODES, never prose and never the
  storyteller's words.

## Do not

- Do not let authorize() read the database "just for membership". Load the
  actor and subject first, pass them in.
- Do not add a role above storyteller. There is no such thing here.
- Do not cache an authorisation decision across requests.
```
