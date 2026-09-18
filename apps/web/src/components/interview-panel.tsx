'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { InterviewSession } from '@everecho/contracts';
import { api } from '@/lib/api';
import { uploadFile } from '@/lib/upload';
import { Card } from './ui';

type Phase = 'idle' | 'requesting' | 'recording' | 'stopped' | 'uploading';
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult:
    | ((e: {
        resultIndex: number;
        results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>;
      }) => void)
    | null;
  onerror: (() => void) | null;
}
export function InterviewPanel({
  archiveId,
  subjectName,
  resumeSessionId,
}: {
  archiveId: string;
  subjectName: string;
  resumeSessionId?: string;
}) {
  const base = '/v1/archives/' + archiveId + '/interviews';
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [pending, setPending] = useState(false);
  const [loadingSession, setLoadingSession] = useState(Boolean(resumeSessionId));
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [language, setLanguage] = useState('en-IN');
  const [transcribe, setTranscribe] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const chunks = useRef<Blob[]>([]);
  const blob = useRef<Blob | null>(null);
  const source = useRef<string | undefined>(undefined);
  const started = useRef(0);
  const alive = useRef(true);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked =
    loadingSession ||
    pending ||
    phase === 'requesting' ||
    phase === 'recording' ||
    phase === 'uploading';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      recognition.current?.stop();
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  useEffect(() => {
    if (!resumeSessionId) return;
    let current = true;
    void api
      .get<{ session: InterviewSession }>(base + '/' + resumeSessionId)
      .then((r) => {
        if (current) {
          setSession(r.session);
          setSummary(r.session.summaryText ?? '');
        }
      })
      .catch(() => {
        if (current) setError('The saved interview could not be opened.');
      })
      .finally(() => {
        if (current) setLoadingSession(false);
      });
    return () => {
      current = false;
    };
  }, [base, resumeSessionId]);
  function clearRecording() {
    chunks.current = [];
    blob.current = null;
    source.current = undefined;
    setPreview(null);
    setTranscript('');
    setDuration(0);
    setPhase('idle');
  }
  async function action(path: string, body?: unknown) {
    setPending(true);
    setError('');
    try {
      const r = await api.post<{ session: InterviewSession }>(path, body);
      if (alive.current) {
        setSession(r.session);
        setSummary(r.session.summaryText ?? '');
      }
      return true;
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : 'That did not save. Please try again.');
      return false;
    } finally {
      if (alive.current) setPending(false);
    }
  }
  async function submit(
    choice: 'answer' | 'skip' | 'prefer_not_to_answer' | 'pause',
    sourceId?: string,
  ) {
    if (!session?.currentPrompt) return false;
    const saved = await action(base + '/' + session.id + '/answer', {
      promptId: session.currentPrompt.id,
      action: choice,
      ...(choice === 'answer' && answer.trim() ? { responseText: answer.trim() } : {}),
      ...(sourceId ? { sourceAssetId: sourceId } : {}),
    });
    if (saved && choice !== 'pause') {
      setAnswer('');
      clearRecording();
    }
    return saved;
  }
  function stopRecording() {
    if (recordingTimer.current) clearTimeout(recordingTimer.current);
    recognition.current?.stop();
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }
  async function beginRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Recording is unavailable in this browser. You can type instead.');
      return;
    }
    setPhase('requesting');
    setError('');
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      clearRecording();
      const r = new MediaRecorder(stream);
      recorder.current = r;
      started.current = Date.now();
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      r.onstop = () => {
        stream?.getTracks().forEach((t) => t.stop());
        if (!alive.current) return;
        const recording = new Blob(chunks.current, { type: r.mimeType || 'audio/webm' });
        blob.current = recording;
        setDuration(Date.now() - started.current);
        setPreview(URL.createObjectURL(recording));
        setPhase('stopped');
      };
      r.start(1000);
      setPhase('recording');
      recordingTimer.current = setTimeout(stopRecording, 10 * 60 * 1000);
      if (transcribe) {
        const w = window as unknown as {
          SpeechRecognition?: new () => Recognition;
          webkitSpeechRecognition?: new () => Recognition;
        };
        const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
        if (C) {
          const rec = new C();
          recognition.current = rec;
          rec.lang = language;
          rec.continuous = true;
          rec.interimResults = false;
          rec.onresult = (e) => {
            let text = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
              const result = e.results[i];
              if (result?.isFinal) text += (result[0]?.transcript ?? '') + ' ';
            }
            if (alive.current) setTranscript((t) => (t + ' ' + text).trim());
          };
          rec.onerror = () => {};
          try {
            rec.start();
          } catch {
            /* Original recording remains available. */
          }
        }
      }
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      setPhase('idle');
      setError('Could not start the microphone. Allow access or type your story.');
    }
  }
  async function saveRecording() {
    if (!blob.current?.size) {
      setError('No audio was captured. Please record again.');
      return;
    }
    setPhase('uploading');
    setError('');
    try {
      if (!source.current) {
        const mime = blob.current.type.split(';')[0] || 'audio/webm';
        const r = await uploadFile(archiveId, blob.current, {
          filename:
            'interview-' +
            new Date(started.current).toISOString().replace(/[:.]/g, '-') +
            (mime.includes('mp4') ? '.m4a' : '.webm'),
          mimeType: mime,
          kind: 'audio',
          durationMs: duration,
          sidecarText: transcript.trim() || undefined,
          onProgress: (p) => setProgress(p.percent),
          idempotencyKey: 'interview-recording-' + session?.id + '-' + started.current,
        });
        source.current = r.sourceId;
      }
      if (!(await submit('answer', source.current))) setPhase('stopped');
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : 'Upload failed.') +
          ' Your recording is still in this tab. Retry or download it.',
      );
      setPhase('stopped');
    }
  }
  const feedback = error ? (
    <p className="notice notice-danger" role="alert">
      {error}
    </p>
  ) : null;
  if (!session)
    return (
      <Card>
        <h2>Keep one story today</h2>
        <p>
          Choose a way to answer. You can skip any question and decide what to share after
          reviewing.
        </p>
        <label htmlFor="interview-language">Spoken language</label>
        <select
          id="interview-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          <option value="en-IN">English</option>
          <option value="hi-IN">Hindi / Hinglish</option>
        </select>
        <p>
          <label>
            <input
              type="checkbox"
              checked={transcribe}
              onChange={(e) => setTranscribe(e.target.checked)}
            />{' '}
            Optional browser transcription. Your browser’s speech service may process audio
            remotely.
          </label>
        </p>
        <div className="row">
          <button
            className="btn btn-primary btn-lg"
            disabled={locked}
            onClick={() => void action(base, { mode: 'audio' })}
          >
            Record my first story
          </button>
          <button
            className="btn btn-lg"
            disabled={locked}
            onClick={() => void action(base, { mode: 'text' })}
          >
            Type instead
          </button>
        </div>
        {feedback}
      </Card>
    );
  if (session.safetyNotice?.shown)
    return (
      <Card>
        <h2>Let us pause</h2>
        <p>{session.safetyNotice.message}</p>
        {session.safetyNotice.resources.map((r) => (
          <p key={r.contact}>
            {r.label}: {r.contact}
          </p>
        ))}
      </Card>
    );
  if (session.status === 'completed')
    return (
      <Card>
        <h2>Review your session</h2>
        <label htmlFor="session-summary">Your summary</label>
        <textarea
          id="session-summary"
          rows={7}
          maxLength={20000}
          disabled={pending || session.summaryApproved}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <p className="small muted">
          Approving prepares draft cards from your original typed answers. Review those cards before
          sharing. Original audio is processed separately; a summary does not replace it.
        </p>
        {session.summaryApproved ? (
          <p role="status">Summary approved. Review your draft stories next.</p>
        ) : (
          <button
            className="btn btn-primary"
            disabled={pending}
            onClick={() =>
              void action(base + '/' + session.id + '/approve-summary', { summaryText: summary })
            }
          >
            Approve summary and prepare story cards
          </button>
        )}
        <p>
          <Link href={'/archives/' + archiveId + '/memories'}>Review stories</Link>
        </p>
        {feedback}
      </Card>
    );
  if (session.status === 'paused')
    return (
      <Card>
        <h2>Your interview is paused</h2>
        <p>Saved answers are kept. Resume when you are ready.</p>
        <button
          className="btn btn-primary"
          disabled={pending}
          onClick={() => void action(base + '/' + session.id + '/resume')}
        >
          Resume interview
        </button>
        <p>
          <Link href={'/archives/' + archiveId + '/interview?session=' + session.id}>
            Bookmark this interview
          </Link>
        </p>
        {feedback}
      </Card>
    );
  return (
    <div className="stack">
      {feedback}
      <Card>
        <p className="small muted">
          {session.promptsAnswered} answered · {session.promptsSkipped} skipped
        </p>
        <h2 aria-live="polite">{session.currentPrompt?.questionText ?? 'You can finish here.'}</h2>
        {session.currentPrompt?.sensitivityNotice && (
          <p>{session.currentPrompt.sensitivityNotice}</p>
        )}
        {session.mode === 'audio' && (
          <div className="stack">
            {phase === 'idle' && (
              <button
                className="btn btn-primary btn-lg"
                disabled={locked}
                onClick={() => void beginRecording()}
              >
                Start recording
              </button>
            )}
            {phase === 'requesting' && <p role="status">Waiting for microphone permission…</p>}
            {phase === 'recording' && (
              <>
                <p role="status">Recording. Up to ten minutes per answer.</p>
                <button className="btn btn-lg" onClick={stopRecording}>
                  Stop recording
                </button>
              </>
            )}
            {phase === 'uploading' && <p role="status">Sending your recording… {progress}%</p>}
            {phase === 'stopped' && preview && (
              <>
                <p>Recorded {Math.round(duration / 1000)} seconds. Listen before saving.</p>
                <audio controls src={preview} aria-label="Review your recording" />
                <label htmlFor="recording-transcript">
                  Optional transcript — correct any mistakes
                </label>
                <textarea
                  id="recording-transcript"
                  disabled={Boolean(source.current)}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={3}
                  maxLength={20000}
                />
                <p className="small muted">
                  Unsaved audio stays in this tab. Download it before leaving if you want to keep a
                  copy.
                </p>
                <a
                  href={preview}
                  download={'my-story' + (blob.current?.type.includes('mp4') ? '.m4a' : '.webm')}
                >
                  Download recording
                </a>
                <div className="row">
                  <button
                    className="btn btn-primary"
                    disabled={locked}
                    onClick={() => void saveRecording()}
                  >
                    Save this recording
                  </button>
                  <button className="btn" disabled={locked} onClick={clearRecording}>
                    Record again
                  </button>
                </div>
              </>
            )}
          </div>
        )}
        <label htmlFor="interview-answer">
          {session.mode === 'audio' ? 'Or type your answer' : 'Your answer'}
        </label>
        <textarea
          id="interview-answer"
          rows={6}
          maxLength={20000}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          disabled={locked}
        />
        <div className="row">
          <button
            className="btn btn-primary"
            disabled={locked || !answer.trim() || phase === 'stopped'}
            onClick={() => void submit('answer')}
          >
            Save typed answer
          </button>
          <button
            className="btn"
            disabled={locked || phase === 'stopped'}
            onClick={() => void submit('skip')}
          >
            Skip this question
          </button>
          <button
            className="btn"
            disabled={locked || phase === 'stopped'}
            onClick={() => void submit('prefer_not_to_answer')}
          >
            I would rather not answer
          </button>
        </div>
      </Card>
      <div className="row">
        <button
          className="btn"
          disabled={locked || phase === 'stopped'}
          onClick={() => void submit('pause')}
        >
          Pause interview
        </button>
        <button
          className="btn"
          disabled={locked || phase === 'stopped'}
          onClick={() => void action(base + '/' + session.id + '/finish')}
        >
          Finish and review
        </button>
      </div>
      <p className="small muted">
        Everything {subjectName === 'you' ? 'you say' : 'said here'} stays a draft until reviewed.
        Discard or save a recording before moving on.
      </p>
      <Link href={'/archives/' + archiveId + '/interview?session=' + session.id}>
        Bookmark this interview
      </Link>
    </div>
  );
}
