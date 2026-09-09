import { TERMINAL_STATES, type RealtimeState } from '@everecho/contracts';

/**
 * Everything that can move a session.
 *
 * Named after what happened rather than what state to enter, because the
 * machine — not the caller — decides where an event leads. A client that could
 * name its destination state would be a permission system anyone can edit in a
 * debugger.
 */
export type RealtimeTrigger =
  | 'CONNECT'
  | 'CONNECTED'
  | 'SPEECH_STARTED'
  | 'SPEECH_ENDED'
  | 'TURN_COMMITTED'
  | 'RETRIEVAL_DONE'
  | 'SPEECH_SYNTHESIS_STARTED'
  | 'ASSISTANT_TURN_COMPLETE'
  | 'INTERRUPT'
  | 'PAUSE'
  | 'RESUME'
  | 'CONNECTION_LOST'
  | 'RECONNECTED'
  | 'END'
  | 'ENDED'
  | 'CONSENT_REVOKED'
  | 'FAIL';

/** Why a transition was refused. A closed set, so the UI can explain precisely. */
export type TransitionRefusal =
  | 'illegal_transition'
  | 'session_terminal'
  | 'not_connected'
  | 'nothing_to_interrupt'
  | 'already_paused'
  | 'not_paused';

export type TransitionResult =
  | { ok: true; from: RealtimeState; to: RealtimeState; trigger: RealtimeTrigger }
  | { ok: false; from: RealtimeState; trigger: RealtimeTrigger; reasonCode: TransitionRefusal };

function isTerminal(state: RealtimeState): boolean {
  return (TERMINAL_STATES as readonly RealtimeState[]).includes(state);
}

/**
 * The legal graph, written out in full rather than derived.
 *
 * Exhaustive by construction: `Record<RealtimeState, ...>` means a new state
 * cannot be added without deciding what may happen from it. Anything absent
 * is illegal, which is the property that matters — a transition table with a
 * default branch is a transition table that permits what nobody considered.
 */
const TRANSITIONS: Record<RealtimeState, Partial<Record<RealtimeTrigger, RealtimeState>>> = {
  CREATED: {
    CONNECT: 'CONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  CONNECTING: {
    CONNECTED: 'READY',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  READY: {
    SPEECH_STARTED: 'LISTENING',
    // A typed turn skips listening entirely: text and voice are the same
    // conversation, and switching between them must not need a new session.
    TURN_COMMITTED: 'TRANSCRIBING',
    PAUSE: 'PAUSED',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  LISTENING: {
    SPEECH_ENDED: 'TRANSCRIBING',
    // Silence, or the user changing their mind mid-sentence.
    TURN_COMMITTED: 'TRANSCRIBING',
    PAUSE: 'PAUSED',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  TRANSCRIBING: {
    TURN_COMMITTED: 'THINKING',
    // The user resumed speaking before the transcript settled.
    SPEECH_STARTED: 'LISTENING',
    PAUSE: 'PAUSED',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  THINKING: {
    SPEECH_SYNTHESIS_STARTED: 'SPEAKING',
    // An abstention has nothing to speak, so it returns straight to READY.
    ASSISTANT_TURN_COMPLETE: 'READY',
    INTERRUPT: 'INTERRUPTED',
    SPEECH_STARTED: 'INTERRUPTED',
    PAUSE: 'PAUSED',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  SPEAKING: {
    ASSISTANT_TURN_COMPLETE: 'READY',
    INTERRUPT: 'INTERRUPTED',
    // Barge-in: the user speaking over the assistant is an interruption, not a
    // new turn. Treating it as a turn is how two voices end up overlapping.
    SPEECH_STARTED: 'INTERRUPTED',
    PAUSE: 'PAUSED',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  INTERRUPTED: {
    // The interruption is resolved once the cancelled turn is recorded.
    ASSISTANT_TURN_COMPLETE: 'READY',
    SPEECH_STARTED: 'LISTENING',
    PAUSE: 'PAUSED',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  PAUSED: {
    RESUME: 'READY',
    CONNECTION_LOST: 'RECONNECTING',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  RECONNECTING: {
    RECONNECTED: 'READY',
    END: 'ENDING',
    FAIL: 'FAILED',
    CONSENT_REVOKED: 'ENDING',
  },
  ENDING: {
    ENDED: 'ENDED',
    FAIL: 'FAILED',
  },
  ENDED: {},
  FAILED: {},
};

/**
 * Pure. No I/O, no clock, no database — the whole graph is exercisable in unit
 * tests, and a caller cannot transition against stale state without saying so.
 */
export function transition(from: RealtimeState, trigger: RealtimeTrigger): TransitionResult {
  if (isTerminal(from)) {
    return { ok: false, from, trigger, reasonCode: 'session_terminal' };
  }

  const to = TRANSITIONS[from][trigger];
  if (to === undefined) {
    return { ok: false, from, trigger, reasonCode: refusalFor(from, trigger) };
  }
  return { ok: true, from, to, trigger };
}

/** A more specific refusal where one exists, so the UI can say something useful. */
function refusalFor(from: RealtimeState, trigger: RealtimeTrigger): TransitionRefusal {
  if (trigger === 'INTERRUPT') return 'nothing_to_interrupt';
  if (trigger === 'PAUSE' && from === 'PAUSED') return 'already_paused';
  if (trigger === 'RESUME' && from !== 'PAUSED') return 'not_paused';
  if (
    (trigger === 'SPEECH_STARTED' || trigger === 'SPEECH_ENDED') &&
    (from === 'CREATED' || from === 'CONNECTING')
  ) {
    return 'not_connected';
  }
  return 'illegal_transition';
}

/** Whether audio may be accepted right now. Checked before a frame is buffered. */
export function acceptsAudio(state: RealtimeState): boolean {
  return state === 'READY' || state === 'LISTENING' || state === 'TRANSCRIBING';
}

/** Whether an assistant turn is in flight and therefore cancellable. */
export function isSpeakingOrThinking(state: RealtimeState): boolean {
  return state === 'THINKING' || state === 'SPEAKING';
}

export function isLive(state: RealtimeState): boolean {
  return !isTerminal(state);
}

/** Every state reachable from `from` in one step. Used by tests and by the UI. */
export function legalTriggers(from: RealtimeState): RealtimeTrigger[] {
  return Object.keys(TRANSITIONS[from]) as RealtimeTrigger[];
}
