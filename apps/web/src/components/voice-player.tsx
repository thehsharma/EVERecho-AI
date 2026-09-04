'use client';

import { useEffect, useRef, useState } from 'react';
import type { VoiceAnswer } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Notice } from './ui';

/**
 * Hearing the actual recording.
 *
 * Two things carry the whole design.
 *
 * The archive's own voice and theirs are never allowed to look alike. What the
 * archive says is rendered as interface text, in the interface's own type, and
 * labelled. What they said is rendered as a quotation, in their own words, with
 * the recording beside it. A bereaved person should never have to work out who
 * is talking.
 *
 * And playback is a range of the original file. The browser seeks to the start
 * and stops at the end; nothing is cut, joined or re-encoded anywhere. The
 * bytes are the ones that came off the recorder.
 */
export function VoicePlayer({
  archiveId,
  subjectName,
}: {
  archiveId: string;
  subjectName: string;
}) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<VoiceAnswer | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await api.send<{ answer: VoiceAnswer }>(
        'POST',
        `/v1/archives/${archiveId}/voice/ask`,
        { question: question.trim() },
      );
      setAnswer(result.answer);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Card>
        <label htmlFor="voice-question">What would you like to hear them talk about?</label>
        <textarea
          id="voice-question"
          rows={2}
          maxLength={2000}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && question.trim()) {
              void ask();
            }
          }}
        />
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={pending || question.trim().length === 0}
            onClick={() => void ask()}
          >
            Find it
          </button>
        </div>
        <p className="muted">
          {/* Said before anybody asks, so nobody is surprised by a refusal. */}
          This plays what {subjectName} actually recorded. It will not read anything aloud in their
          voice, and it will not guess what they might have said.
        </p>
      </Card>

      {answer ? <Answer answer={answer} subjectName={subjectName} /> : null}
    </div>
  );
}

function Answer({ answer, subjectName }: { answer: VoiceAnswer; subjectName: string }) {
  return (
    <div className="stack">
      {/*
        The archive speaking. role="status" so a screen reader announces it,
        and visibly the interface's own voice — never styled as a quotation,
        because a quotation is what their words look like.
      */}
      <div className="notice notice-info" role="status">
        <strong className="small">The archive</strong>
        <div style={{ height: '0.35rem' }} />
        <p style={{ marginBottom: 0 }}>{answer.spokenByArchive}</p>
      </div>

      {answer.quotedText ? (
        <Card>
          <p className="small muted" style={{ marginTop: 0 }}>
            {subjectName}, in their own words
          </p>
          <blockquote style={{ marginBottom: 0 }}>{answer.quotedText}</blockquote>
        </Card>
      ) : null}

      {answer.clip ? <Clip clip={answer.clip} subjectName={subjectName} /> : null}
    </div>
  );
}

function Clip({
  clip,
  subjectName,
}: {
  clip: NonNullable<VoiceAnswer['clip']>;
  subjectName: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  // The range is enforced here rather than by cutting the file: seek to the
  // start, stop at the end, leave the bytes alone.
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    const onTime = () => {
      if (element.currentTime * 1000 >= clip.endMs) {
        element.pause();
        setPlaying(false);
      }
    };
    element.addEventListener('timeupdate', onTime);
    return () => element.removeEventListener('timeupdate', onTime);
  }, [clip.endMs]);

  const play = () => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = clip.startMs / 1000;
    void element.play();
    setPlaying(true);
  };

  const seconds = Math.round((clip.endMs - clip.startMs) / 1000);

  return (
    <Card>
      <p className="small muted" style={{ marginTop: 0 }}>
        {subjectName}, in their own recording
      </p>

      <blockquote>{clip.text}</blockquote>

      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            if (playing) {
              audio.current?.pause();
              setPlaying(false);
            } else {
              play();
            }
          }}
        >
          {playing ? 'Pause' : 'Play their voice'}
        </button>
        <span className="muted small">{seconds} seconds</span>
      </div>

      {/*
        The whole original file. The range above decides what is heard; nothing
        server-side ever cuts or joins audio, which is why there is no code path
        here that could produce a sentence they did not say.
      */}
      <audio
        ref={audio}
        src={clip.audioUrl}
        preload="metadata"
        onEnded={() => setPlaying(false)}
        aria-label={`Recording of ${subjectName}`}
      />

      {clip.before.length > 0 || clip.after.length > 0 ? (
        <details>
          <summary>What they were talking about</summary>
          {clip.before.map((line, i) => (
            <p key={`b${i}`} className="muted">
              {line}
            </p>
          ))}
          <p>
            <strong>{clip.text}</strong>
          </p>
          {clip.after.map((line, i) => (
            <p key={`a${i}`} className="muted">
              {line}
            </p>
          ))}
        </details>
      ) : null}

      <p className="muted small" style={{ marginBottom: 0 }}>
        From {clip.sourceLabel}
        {clip.addedOn ? `, added ${new Date(clip.addedOn).toLocaleDateString()}` : ''}. The audio is
        the original file, unedited.
      </p>
    </Card>
  );
}
