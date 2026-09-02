'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { FamilyQuestion } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * The storyteller's inbox.
 *
 * The design problem here is not showing questions; it is making "no" as easy
 * as "yes". A person who feels obliged to answer everything will either stop
 * opening the inbox or answer things they did not want to. So decline and
 * "not now" sit next to send, at the same size, with no warning copy and no
 * confirmation step, and the reason box says plainly that it stays private.
 */
export function QuestionInbox({
  archiveId,
  questions,
}: {
  archiveId: string;
  questions: FamilyQuestion[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [visibility, setVisibility] = useState<'asker_only' | 'all_authorised' | 'private'>(
    'asker_only',
  );
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const respond = async (questionId: string, payload: Record<string, unknown>) => {
    setPending(questionId);
    setError(null);
    try {
      await api.send(
        'POST',
        `/v1/archives/${archiveId}/family-questions/${questionId}/respond`,
        payload,
      );
      setOpenId(null);
      setAnswer('');
      setReason('');
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(null);
    }
  };

  const waiting = questions.filter((q) => q.status === 'pending');
  const decided = questions.filter((q) => q.status !== 'pending');

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Notice tone="info" title="These are yours to answer or not">
        <p style={{ marginBottom: 0 }}>
          Nobody else can see this list. Answering adds nothing to your archive on its own — you
          will be shown what it suggests, and you decide on each one. Leaving a question, or
          declining it, tells the person only that it is closed.
        </p>
      </Notice>

      <h2>Waiting for you</h2>
      {waiting.length === 0 ? (
        <Empty title="Nothing is waiting">
          Questions from the people you have given access to will appear here.
        </Empty>
      ) : (
        <div className="stack">
          {waiting.map((question) => (
            <Card key={question.id}>
              <p style={{ marginTop: 0 }}>
                <strong>{question.body}</strong>
              </p>
              <p className="muted">
                Asked by {question.askedByDisplayName}
                {question.topic ? ` · about ${question.topic}` : ''}
              </p>

              {openId === question.id ? (
                <div className="stack">
                  <label htmlFor={`answer-${question.id}`}>Your answer</label>
                  <textarea
                    id={`answer-${question.id}`}
                    rows={6}
                    maxLength={20000}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />

                  <fieldset>
                    <legend>Who should see this?</legend>
                    <label>
                      <input
                        type="radio"
                        name={`visibility-${question.id}`}
                        checked={visibility === 'asker_only'}
                        onChange={() => setVisibility('asker_only')}
                      />{' '}
                      Just {question.askedByDisplayName}, who asked
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`visibility-${question.id}`}
                        checked={visibility === 'all_authorised'}
                        onChange={() => setVisibility('all_authorised')}
                      />{' '}
                      Everyone you have already given access to
                    </label>
                    <label>
                      <input
                        type="radio"
                        name={`visibility-${question.id}`}
                        checked={visibility === 'private'}
                        onChange={() => setVisibility('private')}
                      />{' '}
                      Keep it for yourself — they will see only that it is closed
                    </label>
                  </fieldset>

                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending === question.id || answer.trim().length === 0}
                      onClick={() =>
                        void respond(question.id, { kind: 'answer', body: answer, visibility })
                      }
                    >
                      Send this answer
                    </button>
                    <button type="button" className="btn" onClick={() => setOpenId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="stack">
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setOpenId(question.id);
                        setAnswer('');
                        setVisibility('asker_only');
                      }}
                    >
                      Answer this
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending === question.id}
                      onClick={() => void respond(question.id, { kind: 'defer' })}
                    >
                      Not now
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending === question.id}
                      onClick={() =>
                        void respond(question.id, {
                          kind: 'decline',
                          ...(reason.trim() ? { reason: reason.trim() } : {}),
                        })
                      }
                    >
                      I would rather not
                    </button>
                  </div>
                  <details>
                    <summary>Add a private note about why (optional)</summary>
                    <label htmlFor={`reason-${question.id}`} className="muted">
                      Only you will ever see this. It is never sent to {question.askedByDisplayName}
                      .
                    </label>
                    <textarea
                      id={`reason-${question.id}`}
                      rows={2}
                      maxLength={2000}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  </details>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <h2>Already decided</h2>
      {decided.length === 0 ? (
        <Empty title="Nothing decided yet">
          Questions you have answered or closed will move here.
        </Empty>
      ) : (
        <div className="stack">
          {decided.map((question) => (
            <Card key={question.id}>
              <p style={{ marginTop: 0 }}>{question.body}</p>
              <div className="row">
                <Tag kind={question.status === 'answered' ? 'ok' : undefined}>
                  {question.status}
                </Tag>
                <span className="muted">from {question.askedByDisplayName}</span>
                {question.response && question.response.pendingCandidateCount > 0 ? (
                  <Link className="btn btn-quiet small" href={`/archives/${archiveId}/learned`}>
                    {question.response.pendingCandidateCount} suggestion
                    {question.response.pendingCandidateCount === 1 ? '' : 's'} to review
                  </Link>
                ) : null}
              </div>
              {question.response?.body ? <blockquote>{question.response.body}</blockquote> : null}
              {question.declineReason ? (
                <p className="muted">
                  {/* Storyteller-only. It reaches this screen and no other. */}
                  Your private note: {question.declineReason}
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
