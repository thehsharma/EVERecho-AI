'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemoryCandidate } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { ApproximateDate, Card, EvidenceClassTag, Empty, Notice, Tag } from './ui';

/**
 * What EverEcho learned — and what it is waiting to be told about.
 *
 * Every item here is a proposal carrying the exact words it came from. The
 * decision is one at a time and always the storyteller's: there is no
 * "approve everything" button, because approving forty suggestions in one
 * click is not review.
 */
export function CandidateReview({
  archiveId,
  candidates,
}: {
  archiveId: string;
  candidates: MemoryCandidate[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string }>({ title: '', body: '' });

  const act = async (
    candidateId: string,
    action: 'approve' | 'reject',
    body: Record<string, unknown>,
  ) => {
    setPending(candidateId);
    setError(null);
    try {
      await api.send(
        'POST',
        `/v1/archives/${archiveId}/memory-candidates/${candidateId}/${action}`,
        body,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work just now.');
    } finally {
      setPending(null);
    }
  };

  const saveEdit = async (candidateId: string) => {
    setPending(candidateId);
    setError(null);
    try {
      await api.send('PATCH', `/v1/archives/${archiveId}/memory-candidates/${candidateId}`, draft);
      setEditing(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(null);
    }
  };

  const memories = candidates.filter((c) => c.kind !== 'unresolved_reference');
  const unresolved = candidates.filter((c) => c.kind === 'unresolved_reference');

  if (candidates.length === 0) {
    return (
      <Empty title="Nothing is waiting for you">
        Suggestions appear here after a conversation. Nothing reaches your family until you have
        decided on it.
      </Empty>
    );
  }

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Notice tone="info" title="None of this is in your archive yet">
        Each suggestion shows exactly what you said that produced it. Anything you reject is never
        retried.
      </Notice>

      {memories.map((candidate) => (
        <Card key={candidate.id}>
          {editing === candidate.id ? (
            <div className="stack">
              <label htmlFor={`title-${candidate.id}`}>Title</label>
              <input
                id={`title-${candidate.id}`}
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
              <label htmlFor={`body-${candidate.id}`}>What it says</label>
              <textarea
                id={`body-${candidate.id}`}
                rows={5}
                value={draft.body}
                onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              />
              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void saveEdit(candidate.id)}
                  disabled={pending === candidate.id}
                >
                  Save changes
                </button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>{candidate.title}</h3>
              <div className="row">
                <EvidenceClassTag evidenceClass={candidate.evidenceClass} />
                {candidate.sensitivity !== 'normal' ? (
                  <Tag kind="warn">{candidate.sensitivity}</Tag>
                ) : null}
                {candidate.duplicateOfMemoryId ? <Tag>you have already told this one</Tag> : null}
                {candidate.contradictsMemoryIds.length > 0 ? (
                  <Tag kind="warn">this disagrees with something else in the archive</Tag>
                ) : null}
                {candidate.occurredOn ? (
                  <Tag>
                    <ApproximateDate value={candidate.occurredOn} />
                  </Tag>
                ) : null}
              </div>

              <p>{candidate.body}</p>

              <h4>What you actually said</h4>
              {candidate.evidence.map((item) => (
                <blockquote key={item.id}>
                  {item.quotedText}
                  {!item.firstHand ? (
                    <footer className="muted">
                      {/* Reported speech is not first-hand testimony, and the
                          difference is unrecoverable once it is lost. */}
                      You were telling us what someone else said.
                    </footer>
                  ) : null}
                </blockquote>
              ))}

              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void act(candidate.id, 'approve', { keepPrivate: false })}
                  disabled={pending === candidate.id}
                >
                  Add this to the archive
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void act(candidate.id, 'approve', { keepPrivate: true })}
                  disabled={pending === candidate.id}
                >
                  Keep, but private to me
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setEditing(candidate.id);
                    setDraft({ title: candidate.title, body: candidate.body });
                  }}
                >
                  Edit first
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => void act(candidate.id, 'reject', {})}
                  disabled={pending === candidate.id}
                >
                  No, drop this
                </button>
              </div>
            </>
          )}
        </Card>
      ))}

      {unresolved.length > 0 ? (
        <Card>
          <h2>Left unclear</h2>
          <p className="muted">
            The conversation mentioned these without naming who or when. They are not memories —
            they are good things to ask about next time.
          </p>
          <ul>
            {unresolved.map((item) => (
              <li key={item.id}>
                {item.title.replace(/^Unresolved:\s*/, '')}
                <button
                  type="button"
                  className="btn btn-quiet small"
                  style={{ marginLeft: '0.5rem' }}
                  onClick={() => void act(item.id, 'reject', {})}
                >
                  dismiss
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
