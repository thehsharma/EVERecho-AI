# Phase 04 — Identity and the consent journey

```text
Continue EverEcho. Read CODEX_MIGRATION_PROMPT.md §3 (request flow), §4 and
§12 (auth, archive, invitation and consent routes). Update
docs/TRACEABILITY_MATRIX.md as you go.

## Build

1. withArchiveAccess() — THE ONLY WAY to reach archive content
   It is the only function that returns an archive-scoped database
   transaction, and it does exactly five things, in order:
     1. open an archive-scoped transaction (sets the RLS scope)
     2. load actor and subject from the database
     3. call authorize() — pure, no I/O
     4. record the decision, allow or deny
     5. run the handler

   DENY RECORDS ARE WRITTEN ON A SEPARATE CONNECTION. The request transaction
   is about to roll back, and a refusal that vanishes with it is a refusal
   nobody can audit. This was a real bug once already.

   RLS behind it is defence in depth of a DIFFERENT KIND: one is application
   logic that can have bugs, the other is the database refusing.

2. Authentication
   scrypt (Node built-in), not argon2 (D-005). Session cookie plus CSRF.
   Session listing and revoke-all. Rate limiting per account where known,
   per address otherwise — and get the address keying right, it was a real bug.
   Security headers and CSP via helmet. Parameterised SQL throughout.

   Routes: sign-up, sign-in, sign-out, /v1/me, /v1/me/sessions,
   /v1/me/sessions/revoke-all, /v1/me/password.

   NOT BUILT in the reference and honest about it: password reset, MFA
   enrolment. If you build password reset, follow the invitation-token
   pattern: random token, store only its hash, short expiry, single use, and
   revoke every session on completion.

3. Archives and membership
   POST/GET /v1/archives, GET /v1/archives/:id, members list, member PATCH.
   Archive creation requires `subjectIsAdult`. An account is NOT a person:
   app_user and person are separate, and archive.buyer_user_id must be allowed
   to differ from archive.storyteller_user_id.

4. Invitations, and the separation that matters
   POST/GET invitations, revoke, GET /v1/invitations/:token,
   POST /v1/invitations/:token/respond.

   - The storyteller receives the invitation INDEPENDENTLY of the buyer.
   - Accepting an invitation is NOT consenting. They are different routes and
     different records.
   - A storyteller may DECLINE PRIVATELY: `decline_reason` is never sent to
     the inviter, never selected by an inviter-facing query, and never leaves
     the API.
   - An invitation opened by someone it was not addressed to is refused.

5. The consent journey routes
   GET /v1/consent/teach-back, POST …/consent/teach-back,
   GET/PUT …/consent, GET …/consent/history,
   GET/PUT …/succession.
   The archive ACTIVATES only once consent is granted — not when the buyer
   pays, not when the invitation is accepted.

6. Revocation
   PATCH …/members/:membershipId clears caches; RLS and grants are
   re-evaluated per request with NO cached grant.

## Definition of done — the consent-journey integration suite

Named tests, against a real database:
- "activates the archive once consent is granted"
- "teaches rather than blocks" (a wrong teach-back answer explains)
- "keeps every consent version"
- "refuses an invitation opened by someone it was not addressed to"
- "cannot withdraw anyone's access" (the buyer)
- asserts the deny reason `buyer_cannot_consent_for_storyteller` specifically
- asserts a private decline: the reason appears NOWHERE in any
  inviter-facing payload
- asserts a deny record EXISTS after a refused request whose transaction
  rolled back

## Do not

- Do not let a handler open its own database transaction. If it can, the gate
  is optional, and an optional gate is not a gate.
- Do not make the buyer an owner because they paid.
- Do not return "forbidden". Return the specific deny reason.
```
