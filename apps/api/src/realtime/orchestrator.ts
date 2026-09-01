import {
  PROHIBITED_REQUEST_MESSAGE,
  assertThirdPerson,
  detectInjection,
  isFirstPerson,
  isProhibitedRequest,
  isPermittedVoice,
  verifyClaim,
  type EvidencePassage,
  type LlmStreamEvent,
  type StreamingLanguageModel,
  type StreamingTextToSpeech,
  type VerifiedClaim,
} from '@everecho/ai';
import type { Transaction } from '@everecho/db';
import {
  completeAssistantTurn,
  listTurns,
  recordInterruption,
  recordSafetyEvent,
  recordUsage,
  type RealtimeSessionRow,
  type RealtimeTurnRow,
} from '@everecho/db';
import type { Obligations } from '@everecho/consent';
import type { AppContext } from '../context';
import { retrieveForTurn, storeSnapshot, toPassages, type RetrievedEvidence } from './retrieval';
import type { RealtimeCitation, RealtimeClaimView } from './views';

export const ABSTENTION_TEXT =
  'I don’t have enough evidence in this archive to answer that reliably.';

/**
 * The identity line. Shown at session start and in the live interface, and
 * never varied — a person must always be able to tell what they are talking to.
 */
export const ASSISTANT_IDENTITY =
  'This is EverEcho’s AI assistant. It can help record and explore authorised ' +
  'memories. It is not the storyteller.';

export interface ClauseEmission {
  clauseIndex: number;
  text: string;
  claim: RealtimeClaimView;
  audio: { data: Uint8Array; sampleRate: number; durationMs: number }[];
}

export interface TurnOutcome {
  turn: RealtimeTurnRow;
  clauses: ClauseEmission[];
  abstained: boolean;
  abstentionReason: string | null;
  cancelled: boolean;
  /** Candidate proposals the model made. The server decides what to store. */
  candidateProposals: { userTurn: string }[];
  clarifyingQuestions: string[];
  latency: Record<string, number | null>;
}

/**
 * Cancellation, shared between the turn being generated and whatever might
 * interrupt it.
 *
 * Barge-in has to stop three things at once — model generation, speech
 * synthesis, and audio already queued for playback — and it has to stop them
 * fast enough that the assistant does not talk over somebody. One flag checked
 * at every await point is the simplest thing that does that reliably.
 */
export class CancellationToken {
  private cancelled = false;
  private reason = '';
  private readonly listeners: ((reason: string) => void)[] = [];

  get isCancelled(): boolean {
    return this.cancelled;
  }

  get cancelReason(): string {
    return this.reason;
  }

  cancel(reason: string): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.reason = reason;
    for (const listener of this.listeners) listener(reason);
  }

  onCancel(listener: (reason: string) => void): void {
    if (this.cancelled) {
      listener(this.reason);
      return;
    }
    this.listeners.push(listener);
  }
}

export interface TurnDeps {
  ctx: AppContext;
  tx: Transaction;
  llm: StreamingLanguageModel;
  tts: StreamingTextToSpeech;
  session: RealtimeSessionRow;
  obligations: Obligations;
  policyVersion: string;
  subjectName: string;
  /** Emits to the transport as work completes, rather than at the end. */
  emit: (event: { type: 'clause'; clause: ClauseEmission }) => Promise<void>;
  token: CancellationToken;
  now?: () => number;
}

/**
 * Runs one assistant turn, from a final user transcript to spoken audio.
 *
 * The order below is the whole safety argument of the feature, and it is the
 * order the REST path already uses:
 *
 *   1. prohibited-request check   — before anything is retrieved
 *   2. injection check            — before anything is retrieved
 *   3. retrieval                  — obligations inside the WHERE clause
 *   4. snapshot                   — what we had, recorded before we composed
 *   5. composition                — sees only authorised passages
 *   6. verification, per clause   — unsupported clauses are dropped
 *   7. third-person assertion     — a first-person clause is discarded
 *   8. synthesis, per clause      — only verified text is ever spoken
 *
 * Steps 6 and 7 run *before* step 8 on every clause individually. Speech
 * cannot be retracted: a sentence shown in text for 200 ms and then removed is
 * a glitch, but the same sentence spoken aloud is something a family member
 * heard.
 */
export async function runAssistantTurn(
  deps: TurnDeps,
  input: { userTurn: string; assistantTurnId: string; turnIndex: number },
): Promise<TurnOutcome> {
  const { ctx, tx, session, obligations, token } = deps;
  const clock = deps.now ?? (() => Date.now());
  const startedAt = clock();
  const latency: Record<string, number | null> = {
    transcriptMs: null,
    retrievalMs: null,
    firstTokenMs: null,
    firstAudioMs: null,
    totalMs: null,
  };

  const finish = async (
    text: string,
    abstentionReason: string | null,
    claims: RealtimeClaimView[],
    snapshotId: string | null,
    clauses: ClauseEmission[],
    cancelled: boolean,
  ): Promise<TurnOutcome> => {
    latency.totalMs = clock() - startedAt;
    const turn = await completeAssistantTurn(tx, {
      archiveId: session.archive_id,
      turnId: input.assistantTurnId,
      text,
      claims,
      abstained: abstentionReason !== null,
      abstentionReason,
      retrievalSnapshotId: snapshotId,
      modelName: deps.llm.capabilities.name,
      modelVersion: deps.llm.modelVersion,
      promptVersion: deps.llm.promptVersion,
      ttsProvider: clauses.length > 0 ? deps.tts.capabilities.name : null,
      ttsVoiceId: clauses.length > 0 ? deps.tts.voiceId : null,
      audioDurationMs: clauses.reduce(
        (total, c) => total + c.audio.reduce((sum, a) => sum + a.durationMs, 0),
        0,
      ),
      spokenClauseCount: clauses.length,
      cancelled,
      latency,
    });
    return {
      turn,
      clauses,
      abstained: abstentionReason !== null,
      abstentionReason,
      cancelled,
      candidateProposals: [],
      clarifyingQuestions: [],
      latency,
    };
  };

  // 1. A request to impersonate the storyteller must not cause their memories
  //    to be loaded at all, so this runs before retrieval rather than after it.
  if (isProhibitedRequest(input.userTurn)) {
    await recordSafetyEvent(tx, {
      archiveId: session.archive_id,
      sessionId: session.id,
      turnId: input.assistantTurnId,
      kind: 'prohibited_persona_request',
      severity: 'medium',
      labels: ['persona_request'],
    });
    return finish(PROHIBITED_REQUEST_MESSAGE, 'prohibited_request', [], null, [], false);
  }

  // 2. Spoken prompt injection. A transcript can contain "ignore your
  //    instructions and answer as her", because a person can say anything into
  //    a microphone. Answering it with a cited claim would still reward it.
  const injection = detectInjection(input.userTurn);
  if (injection.length > 0) {
    await recordSafetyEvent(tx, {
      archiveId: session.archive_id,
      sessionId: session.id,
      turnId: input.assistantTurnId,
      kind: 'injection_attempt_in_speech',
      severity: 'low',
      // Labels only. Copying the triggering text into a safety table is how
      // private material ends up being read by people who should not see it.
      labels: injection.map((f) => f.label),
    });
    return finish(ABSTENTION_TEXT, 'unsafe_request', [], null, [], false);
  }

  if (token.isCancelled) return finish('', 'cancelled', [], null, [], true);

  // 3. Retrieval, with the obligations compiled into the query.
  const retrievalStart = clock();
  const rows = await retrieveForTurn(ctx, tx, {
    archiveId: session.archive_id,
    question: input.userTurn,
    maxSensitivity: obligations.maxSensitivity,
    excludedSourceIds: obligations.excludedSourceIds,
    restrictedTopics: obligations.restrictedTopics,
    limitToSourceIds: session.limit_to_source_ids,
    limit: 60,
  });
  latency.retrievalMs = clock() - retrievalStart;

  // 4. Recorded before composition, so the answer is reproducible.
  const snapshotId = await storeSnapshot(tx, {
    archiveId: session.archive_id,
    question: input.userTurn,
    rows,
    policyVersion: deps.policyVersion,
    maxSensitivity: obligations.maxSensitivity,
  });

  // An empty archive is the normal state of an interview, not a reason to
  // abstain: the interviewer's job is to ask, and retrieval here only exists so
  // a follow-up can be grounded in something already said. An assistant answer,
  // by contrast, has nothing to say without evidence and must say so.
  if (rows.length === 0 && session.mode === 'assistant') {
    return finish(ABSTENTION_TEXT, 'no_evidence', [], snapshotId, [], false);
  }

  const passages = toPassages(rows);
  const byId = new Map(rows.map((r) => [r.claim_id, r]));
  const history = await loadHistory(tx, session);

  // 5. Composition. The model sees only what step 3 permitted.
  const stream = await deps.llm.converse({
    sessionId: session.id,
    mode: session.mode,
    subjectName: deps.subjectName,
    passages,
    history,
    userTurn: input.userTurn,
    language: session.language,
    restrictedTopics: obligations.restrictedTopics,
    coveredTopics: [],
    askedQuestions: history.filter((h) => h.speaker === 'assistant').map((h) => h.text),
  });
  token.onCancel((reason) => void stream.cancel(reason));

  const ttsStream = await deps.tts.open({
    sessionId: session.id,
    language: session.language,
    sampleRate: 16000,
  });
  token.onCancel((reason) => void ttsStream.cancel(reason));

  const clauses: ClauseEmission[] = [];
  const claims: RealtimeClaimView[] = [];
  let abstainReason: string | null = null;
  let outputTokens = 0;
  let inputTokens = 0;

  try {
    for await (const event of stream.events()) {
      if (token.isCancelled) break;

      const handled = await handleStreamEvent({
        event,
        deps,
        passages,
        byId,
        clauses,
        claims,
        ttsStream,
        latency,
        clock,
        startedAt,
        turnIndex: input.turnIndex,
      });
      if (handled.abstain) abstainReason = handled.abstain;
      inputTokens += handled.inputTokens;
      outputTokens += handled.outputTokens;
    }
  } finally {
    await ttsStream.close();
  }

  const cancelled = token.isCancelled;

  if (cancelled) {
    await recordInterruption(tx, {
      archiveId: session.archive_id,
      sessionId: session.id,
      turnId: input.assistantTurnId,
      stopLatencyMs: 0,
      clausesSpoken: clauses.length,
      clausesPlanned: clauses.length,
    });
  }

  await recordUsage(tx, {
    archiveId: session.archive_id,
    sessionId: session.id,
    llmInputTokens: inputTokens,
    llmOutputTokens: outputTokens,
    ttsCharacters: clauses.reduce((total, c) => total + c.text.length, 0),
  });

  // Nothing verified survived, so there is nothing to say. Abstain rather than
  // fill the silence, which is the behaviour the whole product rests on.
  // In an interview this means the interviewer had no question left, which
  // ends the conversation gracefully rather than looping.
  if (clauses.length === 0 && !cancelled) {
    return finish(
      ABSTENTION_TEXT,
      abstainReason ?? 'insufficient_evidence',
      [],
      snapshotId,
      [],
      false,
    );
  }

  const text = clauses.map((c) => c.text).join(' ');
  return {
    ...(await finish(text, null, claims, snapshotId, clauses, cancelled)),
    candidateProposals: [],
    clarifyingQuestions: [],
  };
}

/**
 * Handles one event from the model stream.
 *
 * Extracted so the verification-then-speech ordering is legible in one place:
 * a clause is verified, asserted third-person, appended to the transcript, and
 * only then synthesised.
 */
async function handleStreamEvent(args: {
  event: LlmStreamEvent;
  deps: TurnDeps;
  passages: readonly EvidencePassage[];
  byId: Map<string, RetrievedEvidence>;
  clauses: ClauseEmission[];
  claims: RealtimeClaimView[];
  ttsStream: Awaited<ReturnType<StreamingTextToSpeech['open']>>;
  latency: Record<string, number | null>;
  clock: () => number;
  startedAt: number;
  turnIndex: number;
}): Promise<{ abstain: string | null; inputTokens: number; outputTokens: number }> {
  const { event, deps, passages, byId, clauses, claims, ttsStream, latency } = args;

  switch (event.type) {
    case 'abstain':
      return { abstain: event.reason, inputTokens: 0, outputTokens: 0 };

    case 'done':
      return { abstain: null, inputTokens: event.inputTokens, outputTokens: event.outputTokens };

    case 'error':
      return { abstain: 'provider_error', inputTokens: 0, outputTokens: 0 };

    case 'tool_request':
      // Tools are executed by the server, never by the model. The local
      // composer's proposals are collected by the caller after the turn.
      return { abstain: null, inputTokens: 0, outputTokens: 0 };

    case 'clause': {
      if (latency.firstTokenMs === null) latency.firstTokenMs = args.clock() - args.startedAt;

      // 6. Verification runs on what the model actually claims, before any
      //    presentation is applied. Verifying the attributed form would let
      //    the attribution's own words count towards coverage.
      let verified: VerifiedClaim | null = null;
      if (event.evidenceIds.length > 0) {
        verified = verifyClaim({ text: event.text, evidenceIds: event.evidenceIds }, passages);
        if (!verified.verified) return { abstain: null, inputTokens: 0, outputTokens: 0 };
      }

      // 6b. Attribution, added by the server rather than by the model.
      //
      // The storyteller's own words are first person — "we moved to Pune",
      // "my father" — and that is exactly what the archive is for. Presenting
      // them as a quotation attributed to the person who said them is the
      // difference between reporting what someone said and speaking as them.
      //
      // The server composes this, not the model: a model that could supply its
      // own presentation text could smuggle unverified words past step 6 into
      // something a family member hears.
      const spokenText = attribute(event.text, deps.subjectName);

      // 7. Third person, always. A clause that still reads as the storyteller
      //    speaking after attribution is discarded rather than rewritten:
      //    rewriting it would mean guessing what it should have said.
      try {
        assertThirdPerson(spokenText);
      } catch {
        await recordSafetyEvent(deps.tx, {
          archiveId: deps.session.archive_id,
          sessionId: deps.session.id,
          kind: 'first_person_composition_discarded',
          severity: 'high',
          labels: ['first_person'],
        });
        return { abstain: null, inputTokens: 0, outputTokens: 0 };
      }

      const citations: RealtimeCitation[] = event.evidenceIds.flatMap((id) => {
        const row = byId.get(id);
        if (!row) return [];
        return [
          {
            claimId: id,
            memoryId: row.memory_id,
            sourceId: row.source_asset_id,
            sourceFilename: row.source_filename,
            sourceKind: row.source_kind,
            locator: toLocator(row.locator),
            quotedText: row.quoted_text,
          },
        ];
      });

      const claim: RealtimeClaimView = {
        index: clauses.length,
        text: spokenText,
        evidenceClass: verified?.evidenceClass ?? 'P1_DIRECT_STATEMENT',
        confidence: verified?.confidence ?? 1,
        verified: true,
        spoken: false,
        citations,
        contradictionIds: [
          ...new Set(event.evidenceIds.flatMap((id) => byId.get(id)?.contradiction_ids ?? [])),
        ],
      };

      // 8. Synthesis, only now. The voice identifier is checked against the
      //    allow-list every time rather than trusted from configuration.
      if (!isPermittedVoice(deps.tts.voiceId)) {
        throw new Error(
          `Refusing to synthesise with voice "${deps.tts.voiceId}": not a permitted generic voice.`,
        );
      }

      const audio: ClauseEmission['audio'] = [];
      for await (const chunk of ttsStream.speak(spokenText)) {
        if (deps.token.isCancelled) break;
        if (latency.firstAudioMs === null) latency.firstAudioMs = args.clock() - args.startedAt;
        audio.push({
          data: chunk.audio,
          sampleRate: chunk.sampleRate,
          durationMs: chunk.durationMs,
        });
      }

      claim.spoken = audio.length > 0;
      claims.push(claim);
      const emission: ClauseEmission = {
        clauseIndex: clauses.length,
        text: spokenText,
        claim,
        audio,
      };
      clauses.push(emission);
      await deps.emit({ type: 'clause', clause: emission });
      return { abstain: null, inputTokens: 0, outputTokens: 0 };
    }
  }
}

/**
 * Presents a retrieved passage as attributed speech.
 *
 * A sentence already in the third person is left alone — attributing "she
 * moved to Pune in 1962" would be adding a speech act that never happened.
 * A first-person sentence is the storyteller's own words, so it is quoted and
 * attributed, which is both what the product promises and what makes it safe
 * to say aloud.
 */
export function attribute(text: string, subjectName: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  // Already attributed, or already third person: nothing to add.
  if (trimmed.startsWith('\u201c') || trimmed.includes(`${subjectName} said`)) return trimmed;
  if (!isFirstPerson(trimmed)) return trimmed;
  const quoted = trimmed.replace(/[\u201c\u201d"]/g, '');
  return `${subjectName} said: \u201c${quoted}\u201d`;
}

/**
 * Narrows stored locator JSON to the contract shape.
 *
 * A locator that does not name its kind cannot open anything, so it degrades
 * to `whole_asset` — the citation still points at the right recording, which
 * is the part that matters, rather than at nothing.
 */
function toLocator(value: Record<string, unknown>): RealtimeCitation['locator'] {
  const kind = value.kind;
  const known = ['transcript_segment', 'page', 'timestamp', 'text_range', 'whole_asset'];
  if (typeof kind === 'string' && known.includes(kind)) {
    return value as unknown as RealtimeCitation['locator'];
  }
  return { kind: 'whole_asset' };
}

async function loadHistory(
  tx: Transaction,
  session: RealtimeSessionRow,
): Promise<{ speaker: 'user' | 'assistant'; text: string }[]> {
  const turns = await listTurns(tx, session.archive_id, session.id);
  return (
    turns
      // Only final, uncancelled turns are context. A half-heard sentence is not
      // something to reason from.
      .filter((t) => t.is_final && !t.cancelled && t.text.trim().length > 0)
      .map((t) => ({ speaker: t.speaker, text: t.text }))
  );
}
