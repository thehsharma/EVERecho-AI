'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';

interface Question {
  id: string;
  prompt: string;
  options: { id: string; label: string }[];
}

/**
 * Teach-back, not a quiz.
 *
 * A wrong answer returns the explanation for it and invites another attempt.
 * Nobody is locked out; the point is that the storyteller ends up actually
 * understanding what they are agreeing to.
 */
export function TeachBack({ archiveId, questions }: { archiveId: string; questions: Question[] }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [teaching, setTeaching] = useState<{ questionId: string; explanation: string }[]>([]);
  const [attempt, setAttempt] = useState(0);

  const unanswered = questions.filter((q) => !answers[q.id]);

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{
        result: { passed: boolean; attempt: number };
        teaching: { questionId: string; explanation: string }[];
      }>(`/v1/archives/${archiveId}/consent/teach-back`, {
        answers: Object.entries(answers).map(([questionId, optionId]) => ({
          questionId,
          optionId,
        })),
      });

      if (result.result.passed) {
        router.push(`/archives/${archiveId}/consent?first=1`);
        router.refresh();
        return;
      }
      setTeaching(result.teaching);
      setAttempt(result.result.attempt);
      setPending(false);
      // Move focus to the explanation so a screen reader announces it.
      document.getElementById('teach-back-feedback')?.focus();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'We could not reach the server. Please try again.',
      );
      setPending(false);
    }
  }

  const wrong = new Set(teaching.map((t) => t.questionId));

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}

      {teaching.length > 0 ? (
        <div className="notice notice-warn" id="teach-back-feedback" tabIndex={-1} role="status">
          <strong>Not quite — here is how it actually works</strong>
          <ul className="stack" style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {teaching.map((item) => (
              <li key={item.questionId}>{item.explanation}</li>
            ))}
          </ul>
          <p className="small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            Attempt {attempt}. Have another go — there is no penalty for getting it wrong.
          </p>
        </div>
      ) : null}

      {questions.map((question, index) => (
        <fieldset
          key={question.id}
          style={wrong.has(question.id) ? { borderColor: 'var(--warn)' } : undefined}
        >
          <legend>
            {index + 1}. {question.prompt}
          </legend>
          {question.options.map((option) => {
            const id = `${question.id}-${option.id}`;
            return (
              <div className="choice" key={option.id}>
                <input
                  type="radio"
                  id={id}
                  name={question.id}
                  value={option.id}
                  checked={answers[question.id] === option.id}
                  onChange={() => setAnswers((prev) => ({ ...prev, [question.id]: option.id }))}
                />
                <label htmlFor={id}>{option.label}</label>
              </div>
            );
          })}
        </fieldset>
      ))}

      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={() => void submit()}
          disabled={pending || unanswered.length > 0}
        >
          {pending ? <span className="spinner-text">Checking</span> : 'Continue'}
        </button>
        {unanswered.length > 0 ? (
          <p className="small muted" style={{ margin: 0 }} role="status">
            {unanswered.length} question{unanswered.length === 1 ? '' : 's'} left to answer.
          </p>
        ) : null}
      </div>
    </div>
  );
}
