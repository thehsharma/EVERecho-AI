import type { ClientEvent, RealtimeState, ServerEvent } from '@everecho/contracts';
import { acceptsAudio, isSpeakingOrThinking, type AudioFrame } from '@everecho/realtime';
import { authorize, type Actor, type Decision, type Obligations } from '@everecho/consent';
import {
  attachSession,
  findArchive,
  findCurrentLearningPolicy,
  findCurrentPolicy,
  findMembership,
  findSession,
  hasActiveDisputeHold,
  nextSequence,
  recordAuditEvent,
  recordEvent,
  recordUsage,
  toConsentPolicy,
  toLearningPolicy,
  type RealtimeSessionRow,
} from '@everecho/db';
import type { AppContext } from '../context';
import {
  applyTransition,
  closeUserTurn,
  openAssistantTurn,
  openUserTurn,
  type StreamingProviders,
} from './engine';
import { CancellationToken, runAssistantTurn } from './orchestrator';
import { extractCandidates, storeCandidates } from './candidates';
import { summariseSession } from './summary';
import { toTurnView } from './views';

/**
 * Drives one live conversation.
 *
 * Transport-independent on purpose: it consumes typed client events and emits
 * typed server events, so the WebSocket layer is a thin adapter and the whole
 * conversation — including barge-in, reconnection and revocation — is testable
 * without a socket or a microphone.
 *
 * The server is the sole authority on state. A client may request a transition
 * and may render one; it can never assign one.
 */
export class SessionDriver {
  private state: RealtimeState;
  private audioOffsetMs = 0;
  private currentUserTurn: { id: string; idx: number } | null = null;
  private partialText = '';
  private silenceMs = 0;
  private turnToken: CancellationToken | null = null;
  private sttStream: Awaited<ReturnType<StreamingProviders['stt']['open']>> | null = null;
  private sttPump: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly deps: {
      ctx: AppContext;
      providers: StreamingProviders;
      session: RealtimeSessionRow;
      userId: string;
      /** The transcript the browser's own recogniser produced, if any. */
      sidecarText?: string | null;
      emit: (event: ServerEvent) => Promise<void>;
      now?: () => number;
    },
  ) {
    this.state = deps.session.state;
  }

  get currentState(): RealtimeState {
    return this.state;
  }

  private get clock(): () => number {
    return this.deps.now ?? (() => Date.now());
  }

  /**
   * Re-reads consent and the learning policy from the database.
   *
   * Called before retrieval, before model context assembly, before synthesis,
   * before persistence and before post-session extraction — not once at connect
   * time. Sessions are long; a storyteller who revokes mid-sentence must be
   * obeyed mid-sentence, and that is impossible if the session captured its
   * permission when the socket opened.
   */
  private async authorizeNow(action: Parameters<typeof authorize>[0]['action']): Promise<Decision> {
    const { ctx, session, userId, providers } = this.deps;
    return ctx.db.withArchiveScope(session.archive_id, async (tx) => {
      const archive = await findArchive(tx, session.archive_id);
      if (!archive) {
        return {
          effect: 'DENY',
          reasonCode: 'archive_deleted',
          policyVersion: 'unknown',
          explanation: 'This archive is no longer available.',
        } satisfies Decision;
      }
      const membership = await findMembership(tx, session.archive_id, userId);
      const policyRow = await findCurrentPolicy(tx, session.archive_id);
      const learningRow = await findCurrentLearningPolicy(tx, session.archive_id);
      const disputeHoldActive = await hasActiveDisputeHold(tx, session.archive_id);

      const actor: Actor = {
        userId,
        isPlatformAdmin: false,
        membership: membership
          ? {
              role: membership.role,
              status: membership.status,
              grantedAt: membership.granted_at?.toISOString() ?? null,
              expiresAt: membership.expires_at?.toISOString() ?? null,
            }
          : null,
      };

      return authorize({
        actor,
        action,
        resource: { type: 'realtime_session', archiveId: session.archive_id, id: session.id },
        subject: {
          archiveId: archive.id,
          archiveStatus: archive.status,
          storytellerUserId: archive.storyteller_user_id,
          lifeState: archive.life_state,
          policy: policyRow ? toConsentPolicy(policyRow) : null,
          learningPolicy: learningRow ? toLearningPolicy(learningRow) : null,
          disputeHoldActive,
        },
        context: {
          now: new Date(),
          policyEngineVersion: ctx.branding.policyEngineVersion,
          usesProvider:
            providers.stt.capabilities.sendsDataOffHost ||
            providers.llm.capabilities.sendsDataOffHost ||
            providers.tts.capabilities.sendsDataOffHost,
        },
      });
    });
  }

  private async emitState(reason: string | null = null): Promise<void> {
    const seq = await this.allocateSequence();
    await this.deps.emit({ type: 'session.state', seq, state: this.state, reason });
  }

  private async allocateSequence(): Promise<number> {
    const { ctx, session } = this.deps;
    return ctx.db.withArchiveScope(session.archive_id, (tx) =>
      nextSequence(tx, session.archive_id, session.id),
    );
  }

  private async move(
    trigger: Parameters<typeof applyTransition>[2],
    options: { endedReason?: string; clientEventId?: string | null } = {},
  ): Promise<boolean> {
    const { ctx, session } = this.deps;
    try {
      const result = await ctx.db.withArchiveScope(session.archive_id, async (tx) => {
        const fresh = await findSession(tx, session.archive_id, session.id);
        if (!fresh) return null;
        return applyTransition(tx, fresh, trigger, options);
      });
      if (!result) return false;
      this.state = result.to;
      await this.emitState(options.endedReason ?? null);
      return true;
    } catch (error) {
      const seq = await this.allocateSequence();
      await this.deps.emit({
        type: 'warning',
        seq,
        code:
          (error as { details?: { reasonCode?: string } })?.details?.reasonCode ??
          'transition_refused',
        message: (error as Error).message,
      });

      // A refused transition must never leave a client with no idea where the
      // conversation is. Two connections racing to advance one session is
      // ordinary — a reconnect, a second tab — and the loser still has to be
      // told the truth, or it sits showing "getting ready" forever while the
      // session is live.
      await this.resync();
      return false;
    }
  }

  /**
   * Brings a newly attached connection into sync with the session.
   *
   * A connection is not always the first one: a client may reconnect after a
   * dropped socket, or open a second one. The session already has a state in
   * that case, and driving it back through CREATED would be refused — leaving
   * the live connection stuck while a dead one held the real state.
   *
   * So: advance a fresh session, resume a reconnecting one, and otherwise
   * simply report where the conversation actually is.
   */
  /** Re-reads the session and tells this connection where it actually is. */
  private async resync(): Promise<void> {
    const { ctx, session } = this.deps;
    const fresh = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      findSession(tx, session.archive_id, session.id),
    );
    if (!fresh || fresh.state === this.state) return;
    this.state = fresh.state;
    await this.emitState('resynced');
  }

  /**
   * Brings a newly attached connection into sync with the session.
   *
   * One atomic statement rather than a sequence of guarded transitions: a
   * client may be the first connection, a reconnect after a dropped socket, or
   * a second tab, and every one of those means "attach me to this
   * conversation". Racing them against each other left the loser showing
   * "getting ready" while the session was already live.
   */
  async connect(): Promise<void> {
    const { ctx, session } = this.deps;
    const attached = await ctx.db.withArchiveScope(session.archive_id, async (tx) => {
      const row = await attachSession(tx, session.archive_id, session.id);
      if (!row) return null;
      const seq = await nextSequence(tx, session.archive_id, session.id);
      await recordEvent(tx, {
        archiveId: session.archive_id,
        sessionId: session.id,
        seq,
        direction: 'server',
        type: 'session.state',
        toState: row.state,
        reasonCode: 'attached',
      });
      return row;
    });

    if (!attached) {
      const seq = await this.allocateSequence();
      await this.deps.emit({
        type: 'error',
        seq,
        code: 'realtime_session_not_live',
        message: 'This conversation has already ended.',
        fatal: true,
      });
      this.closed = true;
      return;
    }

    this.state = attached.state;
    await this.emitState('attached');
  }

  /**
   * Handles one client event.
   *
   * Every event is recorded with its `clientEventId` under a unique index, so
   * a duplicate delivery is a no-op rather than a second turn.
   */
  async handle(event: ClientEvent): Promise<void> {
    if (this.closed) return;
    const { ctx, session } = this.deps;

    const isNew = await ctx.db.withArchiveScope(session.archive_id, async (tx) => {
      const seq = await nextSequence(tx, session.archive_id, session.id);
      return recordEvent(tx, {
        archiveId: session.archive_id,
        sessionId: session.id,
        seq,
        direction: 'client',
        type: event.type,
        clientEventId: event.clientEventId,
      });
    });
    if (!isNew) return;

    switch (event.type) {
      case 'session.hello':
        await this.connect();
        return;

      case 'audio.chunk':
        await this.onAudio(event);
        return;

      case 'user.speech.started':
        await this.onSpeechStarted();
        return;

      case 'user.speech.ended':
        await this.onSpeechEnded();
        return;

      case 'user.turn.commit':
        await this.onTurnCommit(event.text ?? null);
        return;

      case 'user.interrupt':
        await this.onInterrupt();
        return;

      case 'session.pause':
        await this.move('PAUSE');
        return;

      case 'session.resume':
        await this.move('RESUME');
        return;

      case 'session.end':
        await this.end(event.reason ?? 'user_ended');
        return;

      case 'client.ack':
        return;
    }
  }

  /**
   * Buffers one audio frame.
   *
   * A frame arriving while the assistant is speaking is not part of a turn — it
   * is a barge-in, handled by the interrupt path. Buffering it as speech is how
   * two voices end up overlapping.
   */
  private async onAudio(event: Extract<ClientEvent, { type: 'audio.chunk' }>): Promise<void> {
    const audio = Buffer.from(event.audio, 'base64');
    const frame: AudioFrame = {
      data: new Uint8Array(audio),
      sampleRate: event.sampleRate,
      seq: event.seq,
      offsetMs: this.audioOffsetMs,
    };

    if (isSpeakingOrThinking(this.state)) {
      const events = this.deps.providers.vad.push(frame);
      if (events.some((e) => e.type === 'speech_start')) await this.onInterrupt();
      return;
    }

    if (!acceptsAudio(this.state)) return;

    const samples = Math.floor(frame.data.byteLength / 2);
    const frameMs = Math.round((samples / frame.sampleRate) * 1000);
    this.audioOffsetMs += frameMs;

    const vadEvents = this.deps.providers.vad.push(frame);
    for (const vadEvent of vadEvents) {
      if (vadEvent.type === 'speech_start') {
        this.silenceMs = 0;
        await this.onSpeechStarted();
      } else if (vadEvent.type === 'speech_end') {
        await this.onSpeechEnded();
      } else if (vadEvent.type === 'silence') {
        this.silenceMs = vadEvent.durationMs;
      }
    }

    if (this.sttStream) {
      await this.sttStream.push({
        audio: frame.data,
        sampleRate: frame.sampleRate,
        offsetMs: frame.offsetMs,
      });
      await recordUsageSeconds(this.deps, frameMs / 1000);
    }

    // A pause is not an ending: an older person recalling a date may stop for
    // several seconds and continue. Cutting in there is the most damaging thing
    // an interviewer can do, human or otherwise.
    if (this.state === 'LISTENING' && this.silenceMs > 0) {
      const decision = this.deps.providers.turnDetector.shouldEndTurn({
        silenceMs: this.silenceMs,
        transcriptSoFar: this.partialText,
        mode: this.deps.session.mode,
      });
      if (decision.endTurn) await this.onSpeechEnded();
    }
  }

  private async onSpeechStarted(): Promise<void> {
    if (this.state === 'LISTENING') return;
    if (isSpeakingOrThinking(this.state)) {
      await this.onInterrupt();
      return;
    }
    if (!(await this.move('SPEECH_STARTED'))) return;

    const { ctx, session, providers } = this.deps;
    this.currentUserTurn = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      openUserTurn(tx, session),
    );
    this.partialText = '';

    this.sttStream = await providers.stt.open({
      sessionId: session.id,
      language: session.language,
      sampleRate: 16000,
      sidecarText: this.deps.sidecarText,
    });
    this.sttPump = this.pumpTranscripts();
  }

  private async pumpTranscripts(): Promise<void> {
    const stream = this.sttStream;
    if (!stream) return;
    for await (const event of stream.events()) {
      if (this.closed) return;
      if (event.type === 'partial') {
        this.partialText = event.text;
        const seq = await this.allocateSequence();
        await this.deps.emit({
          type: 'transcript.partial',
          seq,
          turnIndex: this.currentUserTurn?.idx ?? 0,
          text: event.text,
          language: event.language,
        });
      } else if (event.type === 'final') {
        this.partialText = event.text;
      } else if (event.type === 'error') {
        const seq = await this.allocateSequence();
        // Reported plainly rather than papered over: a deployment with no
        // recogniser must say so, not invent words.
        await this.deps.emit({ type: 'warning', seq, code: event.code, message: event.message });
      }
    }
  }

  private async onSpeechEnded(): Promise<void> {
    if (this.state !== 'LISTENING') return;
    if (!(await this.move('SPEECH_ENDED'))) return;
    if (this.sttStream) {
      await this.sttStream.flush();
      await this.sttPump;
      await this.sttStream.close();
      this.sttStream = null;
    }
    await this.onTurnCommit(null);
  }

  /**
   * Commits the user's turn and runs the assistant's.
   *
   * `text` is present for typed input and absent when the turn came from
   * speech. Text and voice are the same conversation: switching between them
   * must never require a new session.
   */
  private async onTurnCommit(text: string | null): Promise<void> {
    const { ctx, session, providers } = this.deps;

    if (this.state === 'READY' && text !== null) {
      if (!(await this.move('TURN_COMMITTED'))) return;
      this.currentUserTurn = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
        openUserTurn(tx, session),
      );
    }

    const finalText = (text ?? this.partialText).trim();
    const turn = this.currentUserTurn;
    if (!turn || finalText.length === 0) {
      // Nothing was said. Return to listening rather than answering silence.
      if (this.state === 'TRANSCRIBING') await this.move('SPEECH_STARTED');
      return;
    }

    // Re-checked here, not at connect time.
    const decision = await this.authorizeNow(
      session.mode === 'interview' ? 'realtime.session.retrieve' : 'realtime.session.generate',
    );
    if (decision.effect === 'DENY') {
      await this.denyAndEnd(decision);
      return;
    }

    await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      closeUserTurn(tx, session, {
        turnId: turn.id,
        text: finalText,
        language: session.language === 'auto' ? null : session.language,
      }),
    );

    const seq = await this.allocateSequence();
    await this.deps.emit({
      type: 'transcript.final',
      seq,
      turnId: turn.id,
      turnIndex: turn.idx,
      text: finalText,
      language: session.language === 'auto' ? null : session.language,
    });

    if (this.state === 'TRANSCRIBING' && !(await this.move('TURN_COMMITTED'))) return;

    const thinkingSeq = await this.allocateSequence();
    await this.deps.emit({ type: 'assistant.thinking', seq: thinkingSeq });

    const token = new CancellationToken();
    this.turnToken = token;

    const assistantTurn = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      openAssistantTurn(tx, session),
    );

    const archive = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      findArchive(tx, session.archive_id),
    );

    let spokeAnything = false;

    const outcome = await ctx.db.withArchiveScope(session.archive_id, async (tx) =>
      runAssistantTurn(
        {
          ctx,
          tx,
          llm: providers.llm,
          tts: providers.tts,
          session,
          obligations: decision.obligations satisfies Obligations,
          policyVersion: decision.policyVersion,
          subjectName: archive?.subject_display_name ?? 'the storyteller',
          token,
          now: this.clock,
          emit: async ({ clause }) => {
            if (!spokeAnything) {
              spokeAnything = true;
              await this.move('SPEECH_SYNTHESIS_STARTED');
            }
            const textSeq = await this.allocateSequence();
            await this.deps.emit({
              type: 'assistant.text.delta',
              seq: textSeq,
              turnIndex: assistantTurn.idx,
              clauseIndex: clause.clauseIndex,
              text: clause.text,
            });
            const citeSeq = await this.allocateSequence();
            await this.deps.emit({
              type: 'assistant.citation',
              seq: citeSeq,
              turnIndex: assistantTurn.idx,
              clauseIndex: clause.clauseIndex,
              claim: clause.claim,
            });
            for (const chunk of clause.audio) {
              if (token.isCancelled) break;
              const audioSeq = await this.allocateSequence();
              await this.deps.emit({
                type: 'assistant.audio.chunk',
                seq: audioSeq,
                turnIndex: assistantTurn.idx,
                clauseIndex: clause.clauseIndex,
                audio: Buffer.from(chunk.data).toString('base64'),
                sampleRate: chunk.sampleRate,
                durationMs: chunk.durationMs,
              });
            }
          },
        },
        {
          userTurn: finalText,
          assistantTurnId: assistantTurn.id,
          turnIndex: assistantTurn.idx,
        },
      ),
    );

    this.turnToken = null;

    if (outcome.cancelled) {
      const cancelSeq = await this.allocateSequence();
      await this.deps.emit({
        type: 'assistant.turn.cancelled',
        seq: cancelSeq,
        turnIndex: assistantTurn.idx,
        spokenClauseCount: outcome.clauses.length,
      });
    } else {
      const doneSeq = await this.allocateSequence();
      await this.deps.emit({
        type: 'assistant.turn.complete',
        seq: doneSeq,
        turn: toTurnView(outcome.turn),
      });
    }

    // Candidate extraction, on the user's final turn, after the answer.
    await this.extractFrom({ turnId: turn.id, text: finalText });

    if (this.state === 'SPEAKING' || this.state === 'THINKING' || this.state === 'INTERRUPTED') {
      await this.move('ASSISTANT_TURN_COMPLETE');
    }
    this.currentUserTurn = null;
    this.partialText = '';
    this.silenceMs = 0;
    this.deps.providers.vad.reset();
    this.deps.providers.turnDetector.reset();
  }

  /**
   * Barge-in.
   *
   * Cancels model generation, speech synthesis and any queued audio at once.
   * The interrupted assistant turn is marked cancelled, which — by a database
   * constraint — also makes it not final, so it can never become evidence.
   */
  private async onInterrupt(): Promise<void> {
    if (!isSpeakingOrThinking(this.state)) return;
    this.turnToken?.cancel('user_interrupted');
    await this.move('INTERRUPT');
  }

  private async extractFrom(input: { turnId: string; text: string }): Promise<void> {
    const { ctx, session } = this.deps;

    // Re-checked immediately before writing, not inherited from the turn that
    // has just finished: consent may have narrowed while the answer was spoken.
    const decision = await this.authorizeNow('learning.candidate.create');
    if (decision.effect === 'DENY') return;

    const candidates = extractCandidates({
      text: input.text,
      allowedCategories: decision.obligations.learning.allowedCandidateCategories,
    });
    if (candidates.length === 0) return;

    const stored = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      storeCandidates(tx, {
        archiveId: session.archive_id,
        sessionId: session.id,
        turnId: input.turnId,
        candidates,
        obligations: decision.obligations.learning,
        learningPolicyId: session.learning_policy_id,
        consentPolicyVersion: decision.policyVersion,
      }),
    );

    for (const candidate of stored) {
      const seq = await this.allocateSequence();
      await this.deps.emit({
        type: 'learning.candidate',
        seq,
        candidateId: candidate.id,
        kind: candidate.kind,
        title: candidate.title,
        requiresStorytellerReview: candidate.requiresReview,
      });
    }
  }

  private async denyAndEnd(decision: Extract<Decision, { effect: 'DENY' }>): Promise<void> {
    const { ctx, session, userId } = this.deps;
    // Written on the pool rather than in a transaction that is about to end:
    // a refusal nobody can audit is not a refusal.
    await recordAuditEvent(ctx.db, {
      archiveId: session.archive_id,
      actorUserId: userId,
      action: 'realtime.session.generate',
      resourceType: 'realtime_session',
      resourceId: session.id,
      outcome: 'deny',
      reasonCode: decision.reasonCode,
      policyVersion: decision.policyVersion,
    });

    const seq = await this.allocateSequence();
    await this.deps.emit({
      type: 'error',
      seq,
      code: decision.reasonCode,
      message: decision.explanation,
      fatal: true,
    });
    await this.end('consent_changed');
  }

  /** Ends the session, cancelling anything in flight first. */
  async end(reason: string): Promise<void> {
    if (this.closed) return;
    this.turnToken?.cancel(reason);
    if (this.sttStream) {
      await this.sttStream.cancel(reason);
      this.sttStream = null;
    }

    await this.move('END', { endedReason: reason });
    await this.move('ENDED', { endedReason: reason });
    this.closed = true;

    const { ctx, session } = this.deps;
    const summary = await ctx.db.withArchiveScope(session.archive_id, (tx) =>
      summariseSession(tx, { archiveId: session.archive_id, sessionId: session.id }),
    );
    if (summary) {
      const seq = await this.allocateSequence();
      await this.deps.emit({ type: 'learning.summary', seq, summary });
    }
  }

  /**
   * Applies a policy change to a live session.
   *
   * Called when consent or the learning policy changes while somebody is
   * mid-conversation. A narrowing ends the session rather than silently
   * continuing under permissions the storyteller has just withdrawn.
   */
  async onPolicyChanged(): Promise<void> {
    const decision = await this.authorizeNow(
      this.deps.session.mode === 'interview'
        ? 'realtime.session.retrieve'
        : 'realtime.session.generate',
    );

    if (decision.effect === 'DENY') {
      await this.denyAndEnd(decision);
      return;
    }

    const learning = decision.obligations.learning;
    const seq = await this.allocateSequence();
    await this.deps.emit({
      type: 'policy.changed',
      seq,
      capabilities: {
        mayStoreTranscript: learning.mayStoreTranscript,
        mayStoreAudio: learning.mayStoreAudio,
        mayExtractCandidates: learning.mayExtractCandidates,
        mayUseProviderSpeechToText: learning.mayUseProviderSpeechToText,
        mayUseProviderSpeechSynthesis: learning.mayUseProviderSpeechSynthesis,
        mayUseProviderComposition: learning.mayUseProviderComposition,
        mayAutoSavePreferences: learning.mayAutoSavePreferences,
      },
      narrowed: true,
    });
  }
}

async function recordUsageSeconds(
  deps: { ctx: AppContext; session: RealtimeSessionRow },
  seconds: number,
): Promise<void> {
  await deps.ctx.db.withArchiveScope(deps.session.archive_id, (tx) =>
    recordUsage(tx, {
      archiveId: deps.session.archive_id,
      sessionId: deps.session.id,
      sttSeconds: seconds,
    }),
  );
}
