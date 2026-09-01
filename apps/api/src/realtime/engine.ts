import {
  LocalStreamingLanguageModel,
  LocalStreamingSpeechToText,
  LocalStreamingTextToSpeech,
  isPermittedVoice,
  type StreamingLanguageModel,
  type StreamingSpeechToText,
  type StreamingTextToSpeech,
} from '@everecho/ai';
import { LocalTurnDetector, LocalVoiceActivityDetector, transition } from '@everecho/realtime';
import type { RealtimeTrigger } from '@everecho/realtime';
import type { RealtimeState } from '@everecho/contracts';
import {
  finaliseUserTurn,
  insertTurn,
  nextSequence,
  nextTurnIndex,
  recordEvent,
  updateSessionState,
  type RealtimeSessionRow,
  type Transaction,
} from '@everecho/db';
import { conflict } from '../errors';
import type { AppContext } from '../context';

/**
 * The streaming providers, assembled once.
 *
 * All three are local by default. A deployment that has enabled a hosted
 * provider gets it here, and `usesProvider` on the authorisation call becomes
 * true — which is what makes the consent provider gates apply only when a
 * third party is genuinely involved.
 */
export interface StreamingProviders {
  stt: StreamingSpeechToText;
  llm: StreamingLanguageModel;
  tts: StreamingTextToSpeech;
  vad: LocalVoiceActivityDetector;
  turnDetector: LocalTurnDetector;
}

export function createStreamingProviders(ctx: AppContext): StreamingProviders {
  const providers: StreamingProviders = {
    stt: new LocalStreamingSpeechToText(),
    llm: new LocalStreamingLanguageModel(),
    tts: new LocalStreamingTextToSpeech(),
    vad: new LocalVoiceActivityDetector(),
    turnDetector: new LocalTurnDetector(),
  };

  // Checked at assembly rather than at first use: a deployment configured with
  // a cloned voice must fail to start, not fail on somebody's first question.
  if (!isPermittedVoice(providers.tts.voiceId)) {
    throw new Error(
      `Configured speech voice "${providers.tts.voiceId}" is not a permitted generic voice. ` +
        'EverEcho never synthesises a person’s voice.',
    );
  }
  void ctx;
  return providers;
}

/** Whether any of the configured providers sends material off the host. */
export function usesExternalProvider(providers: StreamingProviders): boolean {
  return (
    providers.stt.capabilities.sendsDataOffHost ||
    providers.llm.capabilities.sendsDataOffHost ||
    providers.tts.capabilities.sendsDataOffHost
  );
}

/**
 * Applies a state transition, in the database, with the pure machine deciding.
 *
 * The guard on `expectedState` makes concurrent transitions safe without a
 * lock: two racing writers cannot both believe they moved the session out of
 * SPEAKING. A refused transition is reported with its reason code rather than
 * silently ignored, because a client that thinks it paused a session that is
 * still listening will keep sending audio.
 */
export async function applyTransition(
  tx: Transaction,
  session: RealtimeSessionRow,
  trigger: RealtimeTrigger,
  options: { endedReason?: string; clientEventId?: string | null } = {},
): Promise<{ session: RealtimeSessionRow; from: RealtimeState; to: RealtimeState }> {
  const decision = transition(session.state, trigger);
  if (!decision.ok) {
    throw conflict(
      `This conversation cannot ${trigger.toLowerCase().replace(/_/g, ' ')} right now.`,
      decision.reasonCode,
    );
  }

  const updated = await updateSessionState(tx, {
    archiveId: session.archive_id,
    sessionId: session.id,
    expectedState: decision.from,
    nextState: decision.to,
    endedReason: options.endedReason ?? null,
  });

  if (!updated) {
    // Someone else moved it first. Reported rather than retried: the caller
    // knows what it was trying to do and we do not.
    throw conflict(
      'This conversation changed while you were speaking. Reload to see where it is.',
      'session_state_moved',
    );
  }

  const seq = await nextSequence(tx, session.archive_id, session.id);
  await recordEvent(tx, {
    archiveId: session.archive_id,
    sessionId: session.id,
    seq,
    direction: 'server',
    type: 'session.state',
    clientEventId: options.clientEventId ?? null,
    fromState: decision.from,
    toState: decision.to,
    reasonCode: options.endedReason ?? null,
  });

  return { session: updated, from: decision.from, to: decision.to };
}

/**
 * Records a client event exactly once.
 *
 * Returns false when this event was already applied, which is what makes
 * duplicate delivery a no-op rather than a second turn. Idempotency lives in a
 * unique index rather than in memory, so it survives a reconnect to a
 * different instance.
 */
export async function acceptClientEvent(
  tx: Transaction,
  session: RealtimeSessionRow,
  input: { type: string; clientEventId: string; metadata?: Record<string, unknown> },
): Promise<boolean> {
  const seq = await nextSequence(tx, session.archive_id, session.id);
  return recordEvent(tx, {
    archiveId: session.archive_id,
    sessionId: session.id,
    seq,
    direction: 'client',
    type: input.type,
    clientEventId: input.clientEventId,
    metadata: input.metadata,
  });
}

/** Opens a user turn. Not final until the speaker has actually finished. */
export async function openUserTurn(
  tx: Transaction,
  session: RealtimeSessionRow,
): Promise<{ id: string; idx: number }> {
  const idx = await nextTurnIndex(tx, session.archive_id, session.id);
  const row = await insertTurn(tx, {
    archiveId: session.archive_id,
    sessionId: session.id,
    idx,
    speaker: 'user',
    text: '',
    isFinal: false,
  });
  return { id: row.id, idx: row.idx };
}

export async function closeUserTurn(
  tx: Transaction,
  session: RealtimeSessionRow,
  input: { turnId: string; text: string; language: string | null },
): Promise<void> {
  await finaliseUserTurn(tx, session.archive_id, input.turnId, input.text, input.language);
}

export async function openAssistantTurn(
  tx: Transaction,
  session: RealtimeSessionRow,
): Promise<{ id: string; idx: number }> {
  const idx = await nextTurnIndex(tx, session.archive_id, session.id);
  const row = await insertTurn(tx, {
    archiveId: session.archive_id,
    sessionId: session.id,
    idx,
    speaker: 'assistant',
    text: '',
    isFinal: false,
  });
  return { id: row.id, idx: row.idx };
}
