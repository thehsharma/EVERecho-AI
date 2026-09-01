'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { InterviewSession } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { Card, Notice } from './ui';

type Mode = 'text' | 'audio';
type Recording =
  'idle' | 'requesting' | 'recording' | 'stopped' | 'uploading' | 'denied' | 'unsupported';

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
}

export function InterviewPanel({
  archiveId,
  subjectName,
}: {
  archiveId: string;
  subjectName: string;
}) {
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [mode, setMode] = useState<Mode>('text');
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState<Recording>('idle');
  const [liveTranscript, setLiveTranscript] = useState('');
  const [progress, setProgress] = useState(0);
  const [finished, setFinished] = useState<InterviewSession | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    return () => {
      // Leaving the page must not leave the microphone running.
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.stop();
    };
  }, []);

  async function start(chosen: Mode) {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{ session: InterviewSession }>(
        `/v1/archives/${archiveId}/interviews`,
        { mode: chosen },
      );
      setMode(chosen);
      setSession(result.session);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'We could not start a session.',
      );
    } finally {
      setPending(false);
    }
  }

  async function submit(
    action: 'answer' | 'skip' | 'prefer_not_to_answer' | 'pause',
    sourceAssetId?: string,
  ) {
    if (!session?.currentPrompt) return;
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{ session: InterviewSession }>(
        `/v1/archives/${archiveId}/interviews/${session.id}/answer`,
        {
          promptId: session.currentPrompt.id,
          action,
          ...(action === 'answer' && answer.trim() ? { responseText: answer.trim() } : {}),
          ...(sourceAssetId ? { sourceAssetId } : {}),
        },
      );
      setSession(result.session);
      setAnswer('');
      setLiveTranscript('');
      setRecording('idle');
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'That did not save. Your words are still here — try again.',
      );
    } finally {
      setPending(false);
    }
  }

  async function finish() {
    if (!session) return;
    setPending(true);
    try {
      const result = await api.post<{ session: InterviewSession }>(
        `/v1/archives/${archiveId}/interviews/${session.id}/finish`,
      );
      setFinished(result.session);
      setSession(null);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'We could not finish the session.',
      );
    } finally {
      setPending(false);
    }
  }

  async function beginRecording() {
    if (typeof MediaRecorder === 'undefined') {
      setRecording('unsupported');
      return;
    }
    setRecording('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => setRecording('stopped');
      recorder.start(1000);
      recorderRef.current = recorder;
      setRecording('recording');
      startLiveTranscription();
    } catch {
      // Denied, or no microphone. Neither is a failure the storyteller caused.
      setRecording('denied');
    }
  }

  function startLiveTranscription() {
    const globalWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition = globalWindow.SpeechRecognition ?? globalWindow.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = 'en-GB';
    recognition.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) text += `${result[0]?.transcript ?? ''} `;
      }
      if (text.trim()) setLiveTranscript((prev) => `${prev} ${text.trim()}`.trim());
    };
    recognition.onerror = () => undefined;
    recognition.start();
    recognitionRef.current = recognition;
  }

  function stopRecording() {
    recorderRef.current?.stop();
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recognitionRef.current?.stop();
  }

  async function uploadRecording() {
    setRecording('uploading');
    setError(null);
    try {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
      const { sourceId } = await uploadFile(archiveId, blob, {
        filename: `interview-${new Date().toISOString().slice(0, 19)}.webm`,
        mimeType: 'audio/webm',
        kind: 'audio',
        sidecarText: liveTranscript || undefined,
        durationMs: Date.now() - startedAtRef.current,
        onProgress: (p) => setProgress(p.percent),
      });
      await submit('answer', sourceId);
      chunksRef.current = [];
      setProgress(0);
    } catch (caught) {
      // The recording is still in memory; the storyteller can retry.
      setError(
        caught instanceof Error
          ? `${caught.message} Your recording has not been lost — you can try sending it again.`
          : 'The upload failed. Your recording has not been lost.',
      );
      setRecording('stopped');
    }
  }

  if (finished) {
    return (
      <Card>
        <h2>Thank you</h2>
        <p>
          Here is what we heard, in your own words. Read it over — you decide whether any of it
          becomes part of the archive.
        </p>
        <blockquote className="quote" style={{ whiteSpace: 'pre-wrap' }}>
          {finished.summaryText}
        </blockquote>
        <p style={{ marginBottom: 0 }}>
          <Link href={`/archives/${archiveId}/memories`}>Review the stories from this session</Link>
        </p>
      </Card>
    );
  }

  if (!session) {
    return (
      <Card>
        <h2>How would you like to answer?</h2>
        <p className="muted">Either is fine, and you can change your mind later.</p>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void start('audio')}
            disabled={pending}
          >
            Speak out loud
          </button>
          <button
            type="button"
            className="btn btn-lg"
            onClick={() => void start('text')}
            disabled={pending}
          >
            Type instead
          </button>
        </div>
        {error ? (
          <p className="notice notice-danger" role="alert" style={{ marginTop: '1rem' }}>
            {error}
          </p>
        ) : null}
      </Card>
    );
  }

  if (session.safetyNotice?.shown) {
    return (
      <div className="notice notice-danger" role="alert">
        <h2 style={{ marginTop: 0 }}>Let us stop here for a moment</h2>
        <p>{session.safetyNotice.message}</p>
        <ul className="stack" style={{ paddingLeft: '1.2rem' }}>
          {session.safetyNotice.resources.map((resource) => (
            <li key={resource.contact}>
              <strong>{resource.label}</strong> — {resource.contact}
            </li>
          ))}
        </ul>
        <p style={{ marginBottom: 0 }}>
          Your archive is saved and will wait for you. There is nothing you need to do here now.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}

      <Card>
        <p className="small muted" style={{ marginBottom: '0.5rem' }}>
          Question {(session.currentPrompt?.index ?? 0) + 1} · {session.promptsAnswered} answered,{' '}
          {session.promptsSkipped} skipped
        </p>
        {/* Announced when the question changes, without moving focus. */}
        <h2 aria-live="polite" style={{ fontFamily: 'var(--font)' }}>
          {session.currentPrompt?.questionText ?? 'That is everything for now.'}
        </h2>
        {session.currentPrompt?.sensitivityNotice ? (
          <p className="muted small">{session.currentPrompt.sensitivityNotice}</p>
        ) : null}

        {mode === 'text' ? (
          <div className="stack">
            <div>
              <label htmlFor="answer" className="visually-hidden">
                Your answer
              </label>
              <textarea
                id="answer"
                value={answer}
                rows={7}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder="Take your time…"
              />
            </div>
            <div className="row">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={() => void submit('answer')}
                disabled={pending || !answer.trim()}
              >
                {pending ? <span className="spinner-text">Saving</span> : 'Save and go on'}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void submit('skip')}
                disabled={pending}
              >
                Skip this one
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void submit('prefer_not_to_answer')}
                disabled={pending}
              >
                I would rather not
              </button>
            </div>
          </div>
        ) : (
          <div className="stack">
            {recording === 'denied' ? (
              <Notice tone="warn" title="We cannot reach your microphone">
                <p style={{ marginBottom: 0 }}>
                  Your browser has not given permission, or there is no microphone. You can allow it
                  in your browser settings, or type your answer instead — both work equally well.
                </p>
              </Notice>
            ) : null}
            {recording === 'unsupported' ? (
              <Notice tone="warn" title="This browser cannot record audio">
                <p style={{ marginBottom: 0 }}>Please type your answer instead.</p>
              </Notice>
            ) : null}

            {recording === 'recording' ? (
              <div className="notice notice-ok" role="status">
                <strong>Recording. Take your time.</strong>
                {liveTranscript ? (
                  <p className="small" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                    {liveTranscript}
                  </p>
                ) : null}
              </div>
            ) : null}

            {recording === 'uploading' ? (
              <div>
                <p className="small muted">Sending your recording… {progress}%</p>
                <div className="progress">
                  <span style={{ width: `${progress}%` }} />
                </div>
              </div>
            ) : null}

            <div className="row">
              {recording === 'idle' || recording === 'denied' || recording === 'unsupported' ? (
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={() => void beginRecording()}
                >
                  Start recording
                </button>
              ) : null}
              {recording === 'recording' ? (
                <button type="button" className="btn btn-lg" onClick={stopRecording}>
                  Stop
                </button>
              ) : null}
              {recording === 'stopped' ? (
                <>
                  <button
                    type="button"
                    className="btn btn-primary btn-lg"
                    onClick={() => void uploadRecording()}
                    disabled={pending}
                  >
                    Save this answer
                  </button>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      chunksRef.current = [];
                      setLiveTranscript('');
                      setRecording('idle');
                    }}
                  >
                    Record it again
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="btn"
                onClick={() => void submit('skip')}
                disabled={pending}
              >
                Skip this one
              </button>
            </div>

            <details>
              <summary>Type this answer instead</summary>
              <div className="stack" style={{ marginTop: '0.75rem' }}>
                <textarea
                  aria-label="Type your answer"
                  value={answer}
                  rows={5}
                  onChange={(event) => setAnswer(event.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => void submit('answer')}
                  disabled={pending || !answer.trim()}
                >
                  Save what I typed
                </button>
              </div>
            </details>
          </div>
        )}
      </Card>

      <div className="row">
        <button
          type="button"
          className="btn btn-quiet"
          onClick={() => void submit('pause')}
          disabled={pending}
        >
          Pause and come back later
        </button>
        <button type="button" className="btn" onClick={() => void finish()} disabled={pending}>
          Finish this session
        </button>
      </div>

      <p className="small muted">
        Everything {subjectName === 'you' ? 'you say' : 'said here'} stays a draft until reviewed.
      </p>
    </div>
  );
}
