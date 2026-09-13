# Family product rollout

## Implemented in this iteration
- /start unifies archive creation, recorded interviews, review, invitations, cited answers, and control links.
- Memorial profiles save to the account; export notes, delete a saved copy, or save as a new profile.
- Owned voices can reconnect after reload and be revoked. Provider verification remains authoritative.
- Daily hosted-request caps are atomic and visible in the studio.
- Razorpay hosted family-plan checkout, status refresh, cycle-end cancellation request, signed webhooks,
  duplicate protection and expiring paid allowances are implemented. Credentials are not configured.

## Existing archive capabilities retained
Guided interviews, uploads, timeline, biography, source-linked answers, membership/invitations,
consent changes, export/deletion and privacy-limited analytics already exist. Their presence
does not mean every production/provider path was re-tested in this iteration.

## Still required before launch
- Full-duplex streaming voice via a publicly reachable authenticated Speech Engine service;
  the memorial studio still uses browser recognition, then reply generation, then playback.
- Anthropic credit balance and ElevenLabs voice permissions, plus an authorized recording.
- Razorpay test credentials, plan, public webhook URL, and an end-to-end payment/cancellation test.
- Shared household subscription allowances, production hosting, monitoring, retention and recovery drills.
- Recruiting families, interviewing customers, choosing prices and testing acquisition channels.

No claim is made that every roadmap item or a unicorn business is completed.
