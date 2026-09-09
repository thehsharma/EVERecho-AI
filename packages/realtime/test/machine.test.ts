import { describe, expect, it } from 'vitest';
import { realtimeStateSchema, type RealtimeState } from '@everecho/contracts';
import {
  acceptsAudio,
  isLive,
  isSpeakingOrThinking,
  legalTriggers,
  transition,
  type RealtimeTrigger,
} from '../src/machine';

const ALL_STATES = realtimeStateSchema.options as readonly RealtimeState[];

const ALL_TRIGGERS: readonly RealtimeTrigger[] = [
  'CONNECT',
  'CONNECTED',
  'SPEECH_STARTED',
  'SPEECH_ENDED',
  'TURN_COMMITTED',
  'RETRIEVAL_DONE',
  'SPEECH_SYNTHESIS_STARTED',
  'ASSISTANT_TURN_COMPLETE',
  'INTERRUPT',
  'PAUSE',
  'RESUME',
  'CONNECTION_LOST',
  'RECONNECTED',
  'END',
  'ENDED',
  'CONSENT_REVOKED',
  'FAIL',
];

describe('session state machine', () => {
  it('walks a complete voice turn', () => {
    let state: RealtimeState = 'CREATED';
    const path: [RealtimeTrigger, RealtimeState][] = [
      ['CONNECT', 'CONNECTING'],
      ['CONNECTED', 'READY'],
      ['SPEECH_STARTED', 'LISTENING'],
      ['SPEECH_ENDED', 'TRANSCRIBING'],
      ['TURN_COMMITTED', 'THINKING'],
      ['SPEECH_SYNTHESIS_STARTED', 'SPEAKING'],
      ['ASSISTANT_TURN_COMPLETE', 'READY'],
      ['END', 'ENDING'],
      ['ENDED', 'ENDED'],
    ];
    for (const [trigger, expected] of path) {
      const result = transition(state, trigger);
      expect(result, `${state} --${trigger}-->`).toMatchObject({ ok: true, to: expected });
      if (result.ok) state = result.to;
    }
    expect(state).toBe('ENDED');
  });

  it('lets a typed turn skip listening entirely', () => {
    // Text and voice are the same conversation; switching must not need a new
    // session.
    const result = transition('READY', 'TURN_COMMITTED');
    expect(result).toMatchObject({ ok: true, to: 'TRANSCRIBING' });
  });

  it('treats the user speaking over the assistant as an interruption, not a turn', () => {
    expect(transition('SPEAKING', 'SPEECH_STARTED')).toMatchObject({
      ok: true,
      to: 'INTERRUPTED',
    });
    expect(transition('THINKING', 'SPEECH_STARTED')).toMatchObject({
      ok: true,
      to: 'INTERRUPTED',
    });
  });

  it('returns to READY after an abstention, which has nothing to speak', () => {
    expect(transition('THINKING', 'ASSISTANT_TURN_COMPLETE')).toMatchObject({
      ok: true,
      to: 'READY',
    });
  });

  it('refuses every trigger from a terminal state, with a named reason', () => {
    for (const terminal of ['ENDED', 'FAILED'] as const) {
      for (const trigger of ALL_TRIGGERS) {
        expect(transition(terminal, trigger)).toEqual({
          ok: false,
          from: terminal,
          trigger,
          reasonCode: 'session_terminal',
        });
      }
    }
  });

  it('names why an interrupt was refused when nothing is in flight', () => {
    expect(transition('READY', 'INTERRUPT')).toMatchObject({
      ok: false,
      reasonCode: 'nothing_to_interrupt',
    });
    expect(transition('LISTENING', 'INTERRUPT')).toMatchObject({
      ok: false,
      reasonCode: 'nothing_to_interrupt',
    });
  });

  it('names pause and resume refusals precisely', () => {
    expect(transition('PAUSED', 'PAUSE')).toMatchObject({
      ok: false,
      reasonCode: 'already_paused',
    });
    expect(transition('READY', 'RESUME')).toMatchObject({ ok: false, reasonCode: 'not_paused' });
    expect(transition('PAUSED', 'RESUME')).toMatchObject({ ok: true, to: 'READY' });
  });

  it('refuses audio events before the transport is connected', () => {
    expect(transition('CREATED', 'SPEECH_STARTED')).toMatchObject({
      ok: false,
      reasonCode: 'not_connected',
    });
    expect(transition('CONNECTING', 'SPEECH_ENDED')).toMatchObject({
      ok: false,
      reasonCode: 'not_connected',
    });
  });

  it('lets consent revocation end a session from any live state', () => {
    for (const state of ALL_STATES) {
      if (state === 'ENDED' || state === 'FAILED' || state === 'ENDING') continue;
      const result = transition(state, 'CONSENT_REVOKED');
      expect(result, `revocation from ${state}`).toMatchObject({ ok: true, to: 'ENDING' });
    }
  });

  it('lets any live state fail', () => {
    for (const state of ALL_STATES) {
      if (state === 'ENDED' || state === 'FAILED') continue;
      expect(transition(state, 'FAIL'), `fail from ${state}`).toMatchObject({
        ok: true,
        to: 'FAILED',
      });
    }
  });

  it('has no transition that lands outside the declared state set', () => {
    for (const state of ALL_STATES) {
      for (const trigger of ALL_TRIGGERS) {
        const result = transition(state, trigger);
        if (result.ok) expect(ALL_STATES).toContain(result.to);
      }
    }
  });

  it('reaches every state from CREATED', () => {
    // A state nothing can reach is a state nobody tested.
    const seen = new Set<RealtimeState>(['CREATED']);
    const queue: RealtimeState[] = ['CREATED'];
    while (queue.length > 0) {
      const current = queue.shift() as RealtimeState;
      for (const trigger of legalTriggers(current)) {
        const result = transition(current, trigger);
        if (result.ok && !seen.has(result.to)) {
          seen.add(result.to);
          queue.push(result.to);
        }
      }
    }
    expect([...seen].sort()).toEqual([...ALL_STATES].sort());
  });

  it('accepts audio only where a user could actually be speaking', () => {
    const accepting = ALL_STATES.filter(acceptsAudio);
    expect(accepting.sort()).toEqual(['LISTENING', 'READY', 'TRANSCRIBING']);
    // Notably not SPEAKING: a frame arriving then is an interruption, handled
    // by the barge-in path rather than buffered as part of a turn.
    expect(acceptsAudio('SPEAKING')).toBe(false);
    expect(acceptsAudio('PAUSED')).toBe(false);
    expect(acceptsAudio('ENDED')).toBe(false);
  });

  it('identifies cancellable states', () => {
    expect(ALL_STATES.filter(isSpeakingOrThinking).sort()).toEqual(['SPEAKING', 'THINKING']);
  });

  it('treats only ENDED and FAILED as not live', () => {
    expect(ALL_STATES.filter((s) => !isLive(s)).sort()).toEqual(['ENDED', 'FAILED']);
  });

  it('cannot leave ENDING except to ENDED or FAILED', () => {
    const reachable = legalTriggers('ENDING')
      .map((t) => transition('ENDING', t))
      .flatMap((r) => (r.ok ? [r.to] : []));
    expect([...new Set(reachable)].sort()).toEqual(['ENDED', 'FAILED']);
  });
});
