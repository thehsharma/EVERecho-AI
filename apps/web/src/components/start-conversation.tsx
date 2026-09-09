'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RealtimeLanguage, RealtimeSession } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Notice } from './ui';

/**
 * Choosing a mode, a language, and whether to use a microphone at all.
 *
 * Text-only is a first-class choice, not a fallback: some people cannot use a
 * microphone, some are in a room where they cannot speak freely, and some
 * simply do not want to.
 */
export function StartConversation({
  archiveId,
  subjectName,
  canInterview,
  canAssist,
  ready,
}: {
  archiveId: string;
  subjectName: string;
  canInterview: boolean;
  canAssist: boolean;
  ready: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<'interview' | 'assistant'>(
    canInterview ? 'interview' : 'assistant',
  );
  const [language, setLanguage] = useState<RealtimeLanguage>('auto');
  const [textOnly, setTextOnly] = useState(false);
  const [micState, setMicState] = useState<'unknown' | 'ok' | 'blocked' | 'missing'>('unknown');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const testMicrophone = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicState('missing');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const track of stream.getTracks()) track.stop();
      setMicState('ok');
    } catch {
      setMicState('blocked');
    }
  };

  const start = async () => {
    setStarting(true);
    setError(null);
    try {
      const result = await api.send<{ session: RealtimeSession }>(
        'POST',
        `/v1/archives/${archiveId}/realtime-sessions`,
        { mode, language, textOnly },
      );
      router.push(`/archives/${archiveId}/talk/${result.session.id}`);
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'This conversation could not be started just now.',
      );
      setStarting(false);
    }
  };

  if (!canInterview && !canAssist) {
    return (
      <Notice tone="info" title="Conversation is not available to you here">
        {subjectName} has not enabled this for your access.
      </Notice>
    );
  }

  return (
    <Card>
      <h2>Start a conversation</h2>

      <fieldset>
        <legend>What kind</legend>
        {canInterview ? (
          <label className="choice">
            <input
              type="radio"
              name="mode"
              checked={mode === 'interview'}
              onChange={() => setMode('interview')}
            />
            <span>
              <strong>Tell my stories</strong>
              <span className="muted">
                {' '}
                EverEcho asks one gentle question at a time and writes down what you say. You decide
                afterwards what is kept.
              </span>
            </span>
          </label>
        ) : null}
        {canAssist ? (
          <label className="choice">
            <input
              type="radio"
              name="mode"
              checked={mode === 'assistant'}
              onChange={() => setMode('assistant')}
            />
            <span>
              <strong>Ask about {subjectName}</strong>
              <span className="muted">
                {' '}
                Answers come only from what they actually said, with the source shown for each part.
              </span>
            </span>
          </label>
        ) : null}
      </fieldset>

      <fieldset>
        <legend>Language</legend>
        <p className="muted">
          You can move between languages mid-sentence. The transcript keeps whichever you used.
        </p>
        {(
          [
            ['auto', 'Work it out as I speak'],
            ['en', 'English'],
            ['hi', 'हिन्दी'],
            ['hi-Latn', 'Hinglish, written in English letters'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="language"
              checked={language === value}
              onChange={() => setLanguage(value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Microphone</legend>
        <label className="choice">
          <input
            type="checkbox"
            checked={textOnly}
            onChange={(event) => setTextOnly(event.target.checked)}
          />
          <span>
            <strong>I would rather type</strong>
            <span className="muted">
              {' '}
              Everything works the same way. Nothing is lost by not speaking.
            </span>
          </span>
        </label>

        {!textOnly ? (
          <div className="row">
            <button type="button" className="btn" onClick={() => void testMicrophone()}>
              Test my microphone
            </button>
            {micState === 'ok' ? <span className="muted">Working.</span> : null}
            {micState === 'blocked' ? (
              <span className="muted">
                Blocked by the browser. You can allow it in the address bar, or type instead.
              </span>
            ) : null}
            {micState === 'missing' ? (
              <span className="muted">
                This browser has no microphone support. Typing works exactly the same.
              </span>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      {error ? <Notice tone="danger">{error}</Notice> : null}

      <button
        type="button"
        className="btn btn-primary btn-lg"
        onClick={() => void start()}
        disabled={starting || !ready}
      >
        {starting ? 'Starting…' : 'Begin'}
      </button>
      {!ready ? (
        <p className="muted">
          A decision about what a conversation may be used for is needed before this can start.
        </p>
      ) : null}
    </Card>
  );
}
