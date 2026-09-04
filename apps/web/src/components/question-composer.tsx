'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { AskedQuestion } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * Asking the storyteller something, and seeing what came back.
 *
 * The two things a person needs to understand before they type are on the
 * screen before the box: the storyteller decides what happens to this, and
 * they may decide nothing. Somebody who asks a hard question and hears
 * nothing should not be left wondering whether the software ate it.
 */
export function QuestionComposer({
  archiveId,
  subjectName,
  questions,
}: {
  archiveId: string;
  subjectName: string;
  questions: AskedQuestion[];
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const ask = async () => {
    if (body.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      await api.send('POST', `/v1/archives/${archiveId}/family-questions`, { body: body.trim() });
      setBody('');
      setSent(true);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'That could not be sent just now.',
      );
    } finally {
      setSending(false);
    }
  };

  const withdraw = async (id: string) => {
    try {
      await api.send('POST', `/v1/archives/${archiveId}/family-questions/${id}/withdraw`, {});
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That could not be undone.');
    }
  };

  return (
    <div className="stack-lg">
      <Notice tone="info" title={`${subjectName} decides what happens to this`}>
        <p style={{ marginBottom: 0 }}>
          Your question goes only to {subjectName}. Nobody else in the family can see it. They can
          answer it, keep the answer between the two of you, or leave it — and if they leave it, you
          will not be told why.
        </p>
      </Notice>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {sent && !error ? <Notice tone="ok">Sent. It is in their own time now.</Notice> : null}

      <Card>
        <label htmlFor="question-body">
          <strong>What would you like to ask?</strong>
        </label>
        <p className="muted" id="question-help">
          One question at a time works best. Specific questions are easier to answer than large ones
          — “what did the kitchen smell like” gets further than “tell me about your childhood”.
        </p>
        <textarea
          id="question-body"
          aria-describedby="question-help"
          rows={4}
          maxLength={2000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder="What did the house in Pune look like?"
        />
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void ask()}
            disabled={sending || body.trim().length === 0}
          >
            {sending ? 'Sending…' : 'Send this question'}
          </button>
          <span className="muted">{body.length} / 2000</span>
        </div>
      </Card>

      <h2>Questions you have asked</h2>
      {questions.length === 0 ? (
        <Empty title="You have not asked anything yet">
          Anything you ask will appear here, with the answer if one comes.
        </Empty>
      ) : (
        <div className="stack">
          {questions.map((question) => (
            <Card key={question.id}>
              <p style={{ marginTop: 0 }}>
                <strong>{question.body}</strong>
              </p>
              <div className="row">
                <StatusTag status={question.status} />
                {question.status === 'pending' ? (
                  <button
                    type="button"
                    className="btn btn-quiet small"
                    onClick={() => void withdraw(question.id)}
                  >
                    Take it back
                  </button>
                ) : null}
              </div>

              {question.answer ? (
                <div className="stack" style={{ marginTop: '0.75rem' }}>
                  <blockquote>{question.answer.body}</blockquote>
                  {/* The answer is a source like any other, so it can be
                      opened, cited, exported and deleted the same way. */}
                  <a className="citation-chip" href={`/archives/${archiveId}/sources`}>
                    {question.answer.sourceLabel}
                  </a>
                </div>
              ) : question.status === 'declined' || question.status === 'deferred' ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  {subjectName} has closed this one. That is theirs to decide, and there is no
                  reason attached to it.
                </p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusTag({ status }: { status: AskedQuestion['status'] }) {
  // A private answer and a decline look identical here, on purpose: to the
  // person who asked, they are the same thing.
  switch (status) {
    case 'pending':
      return <Tag>waiting</Tag>;
    case 'answered':
      return <Tag kind="ok">answered</Tag>;
    case 'withdrawn':
      return <Tag>you took this back</Tag>;
    default:
      return <Tag>closed</Tag>;
  }
}
