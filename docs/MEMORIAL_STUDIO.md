# Memorial studio (local experiment)

Open `/memorial` after signing in. This is a separate, explicitly disclosed AI
simulation, introduced at the repository owner's request. It does not change
the archive's consent engine, original recordings, sourced feelings, or retrieval.
Profiles can be saved privately to the signed-in account, exported as JSON, or deleted.
Unsaved edits and conversation stay in the current tab. Nothing becomes archive evidence.

## What works without credentials

- Name, relationship, personality, remembered events, expressions, English/Hindi,
  and a creative delivery style.
- A clearly labeled local preview that matches questions to supplied notes.
- Turn-based microphone input and device-voice playback in browsers supporting
  Web Speech. The user must enable it; the browser may use a remote speech service.
- Typed conversation, stop controls, error messages and session cleanup.

The preview is not an open-ended language model and a device voice is not a clone.

## Hosted conversation and authorized voice recreation

Set these **server-only** variables in the ignored repository `.env` and restart
the API. Do not put keys in browser code or chat:

```dotenv
MEMORIAL_LLM_API_KEY=
MEMORIAL_LLM_MODEL=claude-sonnet-4-6
MEMORIAL_ELEVENLABS_API_KEY=
```

The conversation uses the [Anthropic Messages API](https://platform.claude.com/docs/en/api/http/messages/create).
Voice creation uses [ElevenLabs IVC](https://elevenlabs.io/docs/api-reference/voices/ivc/create)
and playback uses its [speech endpoint](https://elevenlabs.io/docs/api-reference/text-to-speech/convert).
Provider charges and eligibility requirements apply. Only notes explicitly supplied
to this studio are sent, after cloud processing is enabled. Original archive
content is never automatically sent.

Choose an authorized single-speaker MP3/WAV/M4A/WebM recording under 1 MB and
confirm authorization and provider upload. Selecting a file alone does not upload
it. The provider retains the created voice; manage/delete it in ElevenLabs.
Created voice IDs are saved to the account. Reconnect an existing voice from the studio
after refresh; the server checks ownership and provider verification before issuing a
24-hour token. Revocation disables future EverEcho requests, including old tokens.
An already submitted request may finish. Revoke does not delete the provider copy;
manage or delete that separately in ElevenLabs. Profiles and voices are separate records.

## Limits and validation

This is a local prototype and is blocked in production. Voice turns use browser
recognition, then reply generation, then speech playback; this is not a streaming
full-duplex call. Stop aborts the client request and stops input/playback; already
submitted provider processing may finish remotely. Emotional style is simulated;
there is no claim that software recreates a person's consciousness or real feelings.

Hosted generation/voice quality cannot be verified without configured providers,
authorized samples and user testing. Prompt grounding is not a factual-verification
guarantee. Do not treat generated dialogue as evidence about the deceased person.
Production still requires hosted voice transport, provider retention review, operational monitoring,
and an end-to-end billing and voice pilot before release.

Unit coverage exercises authentication, disclosure/authorization requirements,
no-cloud behavior, absent providers, production gating, voice ownership and
verification, and sanitized provider failures. Tests mock providers and do not
validate the quality or latency of real hosted services.

## Saved profiles and limits

Run database migrations through 0022. Profile, voice, and usage tables enforce account-scoped row-level security.
An account can save up to 20 profiles. MEMORIAL_DAILY_TURN_LIMIT defaults to 50 hosted requests per UTC day;
MEMORIAL_FAMILY_DAILY_TURN_LIMIT defaults to 200 for an active, unexpired Razorpay subscription.
Reservation is atomic before provider work. Failed requests count because provider work may have occurred.
Local previews do not use the allowance. These are usage caps, not exact cost or voice-minute accounting.
