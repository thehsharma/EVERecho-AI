# Local family experience

Open /start, select an archive, and use Family guide. The guide links existing permissions, continuity, exports, and family contributions alongside the new capture and keepsake flows.

- Guided interviews support recording previews, optional browser transcription, upload retry, downloadable unsaved audio, bookmarked pause/resume, and explicit summary approval. Browser transcription is opt-in and may use the browser vendor's service. Unsaved recordings are lost if the tab closes; download first.
- Explore searches the first 100 approved stories and filters by recorded people. Choose up to 20 permitted stories for an offline HTML keepsake; browser Print can save PDF. Original recordings remain in the full archive export. Export rechecks current permissions, source exclusions, sensitivity, embargoes, and recipient topic restrictions.
- Memorial conversation purposes (remember, celebrate, reflect, listen) guide delivery. Explicit text cues can override the purpose; disabling adaptive delivery preserves the selected tone. These are creative instructions, not emotion detection or the person's actual feelings.
- Conversation measurements store counts, timing, delivery, and one feedback category, never reply text. The dashboard covers 30 days; old rows are pruned when that account next records a turn. Users can delete all their measurements. Timing covers the complete server response, not time to first audio.
- Account > Family plan supports a household of up to ten seats including pending invitations. Seven-day single-use codes are shared manually. Members consume the owner's current daily allowance; this does not grant access to their profiles, conversations, or archives. Joining/leaving does not change subscriptions. Revocation applies to subsequent requests; a request already reserved can finish.

## Configuration and limits

Apply database migrations 0023 and 0024 before restarting the API. These features remain local; no public deployment has been performed. Razorpay checkout still needs test credentials, a plan, and a working webhook configuration. Hosted memorial replies need funded Anthropic access and appropriate ElevenLabs permissions plus an authorized, verified voice. No provider call is required for local preview.

Voice remains turn-based using browser recognition and full-response playback. Streaming playback is deferred pending the outstanding approval for sending generated replies to ElevenLabs through that implementation. Speech Engine's hosted callback also requires a public HTTPS/WebSocket service; the user chose to keep this project local.

This implements product workflows, not a guarantee of demand, revenue, legal readiness, clinical benefit, or a valuation. Existing succession settings record wishes; they do not execute a legal estate transfer.

## Validation (2026-09-18)

- Full unit run: 434 passing tests; the additional purpose test passed in the subsequent eight-test emotional-delivery run (435 distinct unit tests). Bounded workers and a 30-second timeout were used after machine-load timeouts.
- Archive pipeline, interview/keepsake, household, and profile integration suites: 34 passed, followed by a three-test roadmap run including the additional source-exclusion test (35 distinct integration tests). These ran on a separate disposable database.
- ESLint, TypeScript, and staged whitespace checks passed. Local migrations were applied without resetting the existing archive. Browser checks covered the guide and searchable story explorer.
- Hosted speech, microphone hardware, Razorpay transactions, and public deployment were not exercised.
