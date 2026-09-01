'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';

/**
 * Accepting and declining are given equal visual weight on purpose. A decline
 * that looks like the small grey option is not really a choice.
 */
export function InvitationResponse({
  token,
  role,
  requiresTeachBack,
}: {
  token: string;
  role: string;
  requiresTeachBack: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [reason, setReason] = useState('');

  async function respond(decision: 'accept' | 'decline') {
    setPending(decision);
    setError(null);
    try {
      const result = await api.post<{ archiveId: string; nextStep: string }>(
        `/v1/invitations/${encodeURIComponent(token)}/respond`,
        { decision, ...(decision === 'decline' && reason ? { declineReason: reason } : {}) },
      );
      if (decision === 'decline') {
        setDeclined(true);
        setPending(null);
        return;
      }
      router.push(
        result.nextStep === 'teach_back'
          ? `/archives/${result.archiveId}/consent/teach-back`
          : `/archives/${result.archiveId}`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError
          ? caught.message
          : 'We could not reach the server. Please try again.',
      );
      setPending(null);
    }
  }

  if (declined) {
    return (
      <div className="notice notice-ok" role="status">
        <strong>That is completely fine.</strong>
        <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          We have let them know the invitation was not taken up. We have not passed on anything you
          wrote here, and nothing has been recorded. You can close this page.
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

      {declining ? (
        <div className="stack">
          <div>
            <label htmlFor="reason">Would you like to say why? (optional)</label>
            <p className="hint" id="reason-hint">
              This is kept for you only. The person who invited you will be told that the invitation
              was not taken up, and nothing more.
            </p>
            <textarea
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              aria-describedby="reason-hint"
              rows={3}
            />
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-lg"
              onClick={() => void respond('decline')}
              disabled={pending !== null}
            >
              {pending === 'decline' ? <span className="spinner-text">Sending</span> : 'Decline the invitation'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setDeclining(false)}>
              Go back
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => void respond('accept')}
            disabled={pending !== null}
          >
            {pending === 'accept' ? (
              <span className="spinner-text">Accepting</span>
            ) : requiresTeachBack ? (
              'Yes — show me how it works'
            ) : (
              'Accept the invitation'
            )}
          </button>
          <button type="button" className="btn btn-lg" onClick={() => setDeclining(true)}>
            No, thank you
          </button>
        </div>
      )}

      {role === 'storyteller' ? (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Accepting is not the same as agreeing to record anything. Next you will read a short
          explanation and set your own permissions, and you can stop at any point.
        </p>
      ) : null}
    </div>
  );
}
