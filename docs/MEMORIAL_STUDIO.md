# Memorial studio (local experiment)

Open `/memorial` after signing in. This is a separate, explicitly disclosed AI
simulation, introduced at the repository owner's request. It does not change
the archive's consent engine, original recordings, sourced feelings, or retrieval.
The supplied notes and dialogue are held in the current browser tab, not saved
as archive facts. Reloading clears them.

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
A signed, account-bound voice token lasts 24 hours in this tab. A voice requiring
provider verification is not enabled. This initial version has no reconnect flow
for a previously created voice; do not repeatedly create duplicates after refresh.

## Limits and validation

This is a local prototype and is blocked in production. Voice turns use browser
recognition, then reply generation, then speech playback; this is not a streaming
full-duplex call. Stop aborts the client request and stops input/playback; already
submitted provider processing may finish remotely. Emotional style is simulated;
there is no claim that software recreates a person's consciousness or real feelings.

Hosted generation/voice quality cannot be verified without configured providers,
authorized samples and user testing. Prompt grounding is not a factual-verification
guarantee. Do not treat generated dialogue as evidence about the deceased person.
Production requires a consent/revocation model, persistent voice ownership and
deletion lifecycle, provider retention review, cost controls and voice verification
reconnection before release.

Unit coverage exercises authentication, disclosure/authorization requirements,
no-cloud behavior, absent providers, production gating, voice ownership and
verification, and sanitized provider failures. Tests mock providers and do not
validate the quality or latency of real hosted services.
