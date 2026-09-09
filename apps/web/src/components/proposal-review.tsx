'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContributorProposal } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * Reviewing what the family has suggested.
 *
 * The design problem is the disagreement. When somebody says "I remember it
 * differently", the screen must not make accepting it feel like admitting you
 * were wrong — because accepting it does not overwrite anything, and a
 * storyteller who believes it does will reject things that should be kept.
 * So the consequence is stated on the button's own card, in the words of what
 * actually happens.
 */
export function ProposalReview({
  archiveId,
  proposals,
  canReview,
}: {
  archiveId: string;
  proposals: ContributorProposal[];
  /**
   * Whether this viewer may actually decide.
   *
   * The API refuses a decision from anyone else regardless — the frontend
   * never decides access — but offering a button that will be refused is a
   * broken promise, and a contributor seeing "Accept this" on their own
   * suggestion is the worst version of it.
   */
  canReview: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = async (id: string, action: 'approve' | 'reject') => {
    setPending(id);
    setError(null);
    try {
      await api.send('POST', `/v1/archives/${archiveId}/contributions/${id}/${action}`, {
        ...(notes[id]?.trim() ? { note: notes[id]!.trim() } : {}),
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(null);
    }
  };

  const waiting = proposals.filter((p) => p.status === 'pending');
  const decided = proposals.filter((p) => p.status !== 'pending');

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Notice
        tone="info"
        title={canReview ? 'Nothing here has changed your archive' : 'Waiting on the storyteller'}
      >
        <p style={{ marginBottom: 0 }}>
          {canReview
            ? 'These are suggestions from people you gave permission to contribute. Accepting a ' +
              'correction keeps what you said before. Accepting a different recollection adds it ' +
              'beside yours — it never replaces it.'
            : 'These are the suggestions you have sent. Only the storyteller can decide on them.'}
        </p>
      </Notice>

      <h2>{canReview ? 'Waiting for you' : 'Waiting on them'}</h2>
      {waiting.length === 0 ? (
        <Empty title="Nothing is waiting">
          {canReview
            ? 'Suggestions from your family will appear here.'
            : 'Anything you send appears here until they decide.'}
        </Empty>
      ) : (
        <div className="stack">
          {waiting.map((proposal) => (
            <Card key={proposal.id}>
              <h3 style={{ marginTop: 0 }}>{proposal.title}</h3>
              <div className="row">
                <Tag>{proposal.kind.replace(/_/g, ' ')}</Tag>
                <span className="muted">from {proposal.proposedByDisplayName}</span>
                {proposal.contradictsMemoryIds.length > 0 ? (
                  <Tag kind="warn">this disagrees with something you said</Tag>
                ) : null}
              </div>

              <p>{proposal.body}</p>

              {proposal.targetSummary ? (
                <>
                  <h4>What your archive says now</h4>
                  <blockquote>{proposal.targetSummary}</blockquote>
                </>
              ) : null}

              {proposal.evidence.length > 0 ? (
                <>
                  <h4>How they know</h4>
                  {proposal.evidence.map((item) => (
                    <p key={item.id} className="muted">
                      {item.firstHand ? 'They were there.' : 'Somebody told them.'}
                      {item.note ? ` ${item.note}` : ''}
                    </p>
                  ))}
                </>
              ) : null}

              {proposal.kind === 'correction' ? (
                <Notice tone="info">
                  <p style={{ marginBottom: 0 }}>
                    Accepting this changes the wording and keeps the original, with a record of who
                    changed it and when.
                  </p>
                </Notice>
              ) : null}
              {proposal.kind === 'alternate_account' ? (
                <Notice tone="info">
                  <p style={{ marginBottom: 0 }}>
                    Accepting this adds their account beside yours and links the two. Nothing you
                    said is changed or removed.
                  </p>
                </Notice>
              ) : null}

              {canReview ? (
                <>
                  <label htmlFor={`note-${proposal.id}`}>
                    A note about your decision (optional)
                  </label>
                  <input
                    id={`note-${proposal.id}`}
                    maxLength={2000}
                    value={notes[proposal.id] ?? ''}
                    onChange={(event) => setNotes({ ...notes, [proposal.id]: event.target.value })}
                  />

                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending === proposal.id}
                      onClick={() => void decide(proposal.id, 'approve')}
                    >
                      Accept this
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={pending === proposal.id}
                      onClick={() => void decide(proposal.id, 'reject')}
                    >
                      No, leave it as it is
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Waiting for the storyteller to decide.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}

      <h2>Already decided</h2>
      {decided.length === 0 ? (
        <Empty title="Nothing decided yet">
          Suggestions you have accepted or declined move here.
        </Empty>
      ) : (
        <div className="stack">
          {decided.map((proposal) => (
            <Card key={proposal.id}>
              <p style={{ marginTop: 0 }}>
                <strong>{proposal.title}</strong>
              </p>
              <div className="row">
                <Tag kind={proposal.status === 'approved' ? 'ok' : undefined}>
                  {proposal.status}
                </Tag>
                <span className="muted">from {proposal.proposedByDisplayName}</span>
              </div>
              {proposal.reviewNote ? (
                <p className="muted">Your note: {proposal.reviewNote}</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
