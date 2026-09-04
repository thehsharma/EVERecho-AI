'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { RealtimeCitation, RealtimeSession } from '@everecho/contracts';
import { LiveSession, type LiveSnapshot } from '@/lib/realtime-client';
import { Card, EvidenceClassTag, Notice, Tag } from './ui';

/**
 * The live conversation screen.
 *
 * Three things are always on screen, whatever else is happening: what this is,
 * whether it is listening, and how to stop. Everything else can move; those
 * cannot.
 */

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
}

const STATE_LABEL: Record<string, string> = {
  CREATED: 'Getting ready',
  CONNECTING: 'Connecting',
  READY: 'Ready when you are',
  LISTENING: 'Listening',
  TRANSCRIBING: 'Writing that down',
  THINKING: 'Thinking',
  SPEAKING: 'Speaking',
  INTERRUPTED: 'Stopped',
  PAUSED: 'Paused',
  RECONNECTING: 'Reconnecting',
  ENDING: 'Finishing',
  ENDED: 'Ended',
  FAILED: 'Stopped because of a problem',
};

export function LiveConversation({
  session,
  subjectName,
  canReview,
}: {
  session: RealtimeSession;
  subjectName: string;
  canReview: boolean;
}) {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [typed, setTyped] = useState('');
  const [inspecting, setInspecting] = useState<RealtimeCitation | null>(null);
  const [captions, setCaptions] = useState(true);

  const liveRef = useRef<LiveSession | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const sidecarRef = useRef<string>('');
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Deferred by a tick, and cancelled if this mount is discarded.
    //
    // React re-runs effects on a remount, and in development it mounts,
    // unmounts and remounts immediately. Opening a socket synchronously means
    // opening one that is abandoned mid-handshake, leaving a half-registered
    // conversation on the server and a client waiting on a connection nobody
    // is listening to. Waiting a tick means a discarded mount never opens one
    // at all.
    let live: LiveSession | null = null;
    const timer = setTimeout(() => {
      live = new LiveSession({
        archiveId: session.archiveId,
        sessionId: session.id,
        onChange: (next) => setSnapshot({ ...next }),
        onNeedsSidecar: () => sidecarRef.current || null,
      });
      liveRef.current = live;
      void live.connect();
    }, 0);

    return () => {
      clearTimeout(timer);
      live?.close();
      liveRef.current = null;
    };
  }, [session.archiveId, session.id]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [snapshot?.turns.length, snapshot?.partial]);

  const state = snapshot?.state ?? session.state;
  const connection = snapshot?.connection ?? 'connecting';
  const speaking = state === 'SPEAKING' || state === 'THINKING';

  /**
   * The browser's own recogniser, running alongside the microphone.
   *
   * This deployment may have no speech recogniser of its own, and it will not
   * invent words. What the browser hears is real text from a real recogniser,
   * so it is sent alongside the audio rather than fabricated server-side.
   */
  const startBrowserRecognition = useCallback(() => {
    const globalWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = session.language === 'auto' ? 'en-IN' : session.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let text = '';
      for (let i = 0; i < event.results.length; i += 1) {
        text += `${event.results[i]?.[0]?.transcript ?? ''} `;
      }
      sidecarRef.current = text.trim();
    };
    recognition.onerror = () => undefined;
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      // Already running, or unsupported. Neither is worth interrupting for.
    }
  }, [session.language]);

  const start = useCallback(async () => {
    setMicError(null);
    try {
      await liveRef.current?.startListening();
      startBrowserRecognition();
      setListening(true);
    } catch (error) {
      setListening(false);
      setMicError(
        error instanceof DOMException && error.name === 'NotAllowedError'
          ? 'The microphone is blocked. You can type instead — everything works the same way.'
          : 'No microphone was available. You can type instead.',
      );
    }
  }, [startBrowserRecognition]);

  const stop = useCallback(() => {
    liveRef.current?.stopListening();
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const submitTyped = useCallback(() => {
    const text = typed.trim();
    if (!text) return;
    liveRef.current?.sendText(text);
    setTyped('');
  }, [typed]);

  const turns = snapshot?.turns ?? [];
  const allCitations = useMemo(
    () =>
      turns
        .filter((t) => t.speaker === 'assistant')
        .flatMap((t) => t.clauses.flatMap((c) => c.claim?.citations ?? [])),
    [turns],
  );

  if (snapshot?.fatal) {
    return (
      <Card>
        <Notice tone="danger" title="This conversation has stopped">
          <p>{snapshot.fatal.message}</p>
          <p style={{ marginBottom: 0 }}>
            Nothing from it was added to the archive without review.{' '}
            <Link href={`/archives/${session.archiveId}`}>Back to the archive</Link>
          </p>
        </Notice>
      </Card>
    );
  }

  return (
    <div className="stack-lg">
      {/* Identity, always. A person must be able to tell what they are talking to. */}
      <Notice tone="info" title="You are talking to EverEcho’s AI assistant">
        <p style={{ marginBottom: 0 }}>{session.assistantIdentity}</p>
      </Notice>

      <Card>
        <div className="live-status" role="status" aria-live="polite">
          <span className={`live-dot live-dot-${state.toLowerCase()}`} aria-hidden="true" />
          <strong>{STATE_LABEL[state] ?? state}</strong>
          <span className="muted">
            {connection === 'open'
              ? 'Connected'
              : connection === 'reconnecting'
                ? 'Reconnecting…'
                : connection === 'connecting'
                  ? 'Connecting…'
                  : 'Not connected'}
          </span>
          <span style={{ marginLeft: 'auto' }} className="row">
            {/* Whether anything is being kept, stated on the screen itself
                rather than buried in a settings page. */}
            <Tag kind={session.capabilities.mayStoreAudio ? 'warn' : 'ok'}>
              {session.capabilities.mayStoreAudio ? 'Recording is kept' : 'Recording is not kept'}
            </Tag>
            <Tag kind={session.capabilities.mayStoreTranscript ? 'info' : 'ok'}>
              {session.capabilities.mayStoreTranscript
                ? 'Transcript is kept'
                : 'Transcript is not kept'}
            </Tag>
            <Tag>
              {session.mode === 'interview' ? 'Recording your stories' : 'Asking the archive'}
            </Tag>
          </span>
        </div>

        {/* A calm visualiser, not a face. Never anything that could be mistaken
            for a person. Reduced motion turns the animation off entirely. */}
        <div
          className={`live-visualiser ${listening ? 'is-listening' : ''} ${speaking ? 'is-speaking' : ''}`}
          aria-hidden="true"
        >
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>

        <div className="row live-controls">
          {listening ? (
            <button type="button" className="btn" onClick={stop}>
              Stop listening
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void start()}
              disabled={state === 'ENDED' || state === 'PAUSED'}
            >
              Start speaking
            </button>
          )}

          <button
            type="button"
            className="btn"
            onClick={() => liveRef.current?.interrupt()}
            disabled={!speaking}
          >
            Interrupt
          </button>

          {state === 'PAUSED' ? (
            <button type="button" className="btn" onClick={() => liveRef.current?.resume()}>
              Resume
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => liveRef.current?.pause()}
              disabled={state === 'ENDED'}
            >
              Pause
            </button>
          )}

          <button
            type="button"
            className="btn"
            onClick={() => setCaptions((value) => !value)}
            aria-pressed={captions}
          >
            {captions ? 'Hide captions' : 'Show captions'}
          </button>

          {/* Always available, never asks why. */}
          <button
            type="button"
            className="btn btn-danger"
            style={{ marginLeft: 'auto' }}
            onClick={() => liveRef.current?.end()}
            disabled={state === 'ENDED'}
          >
            End
          </button>
        </div>

        {micError ? <Notice tone="warn">{micError}</Notice> : null}

        {snapshot?.gapDetected ? (
          <Notice tone="warn" title="Part of this conversation did not arrive">
            Some of what was said may be missing from the transcript below. It is safer to say so
            than to show a record with a silent hole in it.
          </Notice>
        ) : null}

        {(snapshot?.warnings ?? []).slice(-2).map((warning, index) => (
          <Notice key={`${warning.code}-${index}`} tone="warn">
            {warning.message}
          </Notice>
        ))}
      </Card>

      <div className="live-layout">
        <Card className="live-transcript">
          <h2>Transcript</h2>
          {turns.length === 0 && !snapshot?.partial ? (
            <p className="muted">
              {session.mode === 'interview'
                ? 'Start speaking, or type below. There is no hurry, and you can stop at any time.'
                : 'Ask a question about ' + subjectName + '.'}
            </p>
          ) : null}

          <ol className="turn-list">
            {turns.map((turn) => (
              <li key={`${turn.speaker}-${turn.index}`} className={`turn turn-${turn.speaker}`}>
                <div className="turn-speaker">
                  {turn.speaker === 'user' ? 'You' : 'EverEcho AI'}
                  {turn.cancelled ? <Tag kind="warn">interrupted</Tag> : null}
                  {turn.abstained ? <Tag>no answer given</Tag> : null}
                </div>

                {turn.speaker === 'assistant' && turn.clauses.length > 0 ? (
                  <div>
                    {turn.clauses.map((clause) => (
                      <p key={clause.clauseIndex} className="clause">
                        {clause.text}{' '}
                        {clause.claim ? (
                          <>
                            <EvidenceClassTag evidenceClass={clause.claim.evidenceClass} />
                            {clause.claim.citations.map((citation) => (
                              <button
                                key={citation.claimId}
                                type="button"
                                className="citation-chip"
                                onClick={() => setInspecting(citation)}
                              >
                                {citation.sourceFilename}
                              </button>
                            ))}
                            {clause.claim.contradictionIds.length > 0 ? (
                              <Tag kind="warn">the recordings disagree about this</Tag>
                            ) : null}
                          </>
                        ) : null}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p>{turn.text}</p>
                )}
              </li>
            ))}
          </ol>

          {captions && snapshot?.partial ? (
            <p className="caption-partial" aria-live="polite">
              {snapshot.partial}
              <span className="caption-cursor" aria-hidden="true" />
            </p>
          ) : null}

          <div ref={transcriptEndRef} />

          {/* Text and voice are the same conversation. Every voice action has a
              typed equivalent, so a microphone is never required. */}
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              submitTyped();
            }}
          >
            <label className="sr-only" htmlFor="typed-turn">
              Type instead of speaking
            </label>
            <input
              id="typed-turn"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={
                session.mode === 'interview' ? 'Type what you would like to say' : 'Type a question'
              }
              disabled={state === 'ENDED'}
            />
            <button type="submit" className="btn" disabled={!typed.trim() || state === 'ENDED'}>
              Send
            </button>
          </form>
        </Card>

        <Card className="citation-rail">
          <h2>Where this comes from</h2>
          {allCitations.length === 0 ? (
            <p className="muted">
              Sources appear here as they are used, before the sentence they support is finished.
            </p>
          ) : (
            <ul className="citation-list">
              {allCitations.map((citation, index) => (
                <li key={`${citation.claimId}-${index}`}>
                  <button
                    type="button"
                    className="btn btn-quiet small"
                    onClick={() => setInspecting(citation)}
                  >
                    {citation.sourceFilename}
                  </button>
                  <span className="muted"> · {citation.sourceKind}</span>
                </li>
              ))}
            </ul>
          )}

          {snapshot?.candidates.length ? (
            <>
              <h3>Suggested from this conversation</h3>
              <p className="muted">
                Nothing here is part of the archive yet. {canReview ? 'You' : 'The storyteller'}{' '}
                will decide.
              </p>
              <ul>
                {snapshot.candidates.map((candidate) => (
                  <li key={candidate.id}>{candidate.title}</li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      </div>

      {snapshot?.summary ? (
        <Card>
          <h2>What EverEcho heard</h2>
          <p>{snapshot.summary.headline}</p>
          {snapshot.summary.unresolvedReferences.length > 0 ? (
            <>
              <h3>Left unclear</h3>
              <ul>
                {snapshot.summary.unresolvedReferences.map((reference) => (
                  <li key={reference}>{reference}</li>
                ))}
              </ul>
            </>
          ) : null}
          {canReview ? (
            <Link className="btn btn-primary" href={`/archives/${session.archiveId}/learned`}>
              Review what was suggested
            </Link>
          ) : null}
        </Card>
      ) : null}

      {inspecting ? (
        <div className="drawer" role="dialog" aria-label="Source">
          <Card>
            <div className="row">
              <h2 style={{ margin: 0 }}>{inspecting.sourceFilename}</h2>
              <button
                type="button"
                className="btn"
                style={{ marginLeft: 'auto' }}
                onClick={() => setInspecting(null)}
              >
                Close
              </button>
            </div>
            <blockquote>{inspecting.quotedText}</blockquote>
            <p className="muted">
              {describeLocator(inspecting)} ·{' '}
              <Link href={`/archives/${session.archiveId}/memories/${inspecting.memoryId}`}>
                Open the story this came from
              </Link>
            </p>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function describeLocator(citation: RealtimeCitation): string {
  const locator = citation.locator;
  if (locator.kind === 'timestamp' && typeof locator.startMs === 'number') {
    const total = Math.floor(locator.startMs / 1000);
    return `at ${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }
  if (locator.kind === 'page' && typeof locator.page === 'number') return `page ${locator.page}`;
  if (locator.kind === 'transcript_segment') return 'from the transcript';
  return 'from this source';
}
