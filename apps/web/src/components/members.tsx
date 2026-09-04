'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';

export function InviteForm({
  archiveId,
  defaultRole,
  allowStoryteller,
}: {
  archiveId: string;
  defaultRole: string;
  allowStoryteller: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSent(null);
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;

    try {
      await api.post(`/v1/archives/${archiveId}/invitations`, {
        email: String(form.get('email') ?? ''),
        displayName: String(form.get('displayName') ?? ''),
        role: String(form.get('role') ?? 'family'),
        personalNote: String(form.get('note') ?? '') || undefined,
        expiresInDays: 14,
      });
      setSent(String(form.get('displayName') ?? ''));
      formElement.reset();
      setPending(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'We could not send that invitation.',
      );
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="stack" noValidate>
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      {sent ? (
        <div className="notice notice-ok" role="status">
          An invitation has been sent to {sent}. It is their decision, and they can decline
          privately.
        </div>
      ) : null}

      <div>
        <label htmlFor="displayName">Their name</label>
        <input id="displayName" name="displayName" required />
      </div>
      <div>
        <label htmlFor="email">Their email address</label>
        <input id="email" name="email" type="email" required />
      </div>
      <div>
        <label htmlFor="role">What can they do?</label>
        <select id="role" name="role" defaultValue={defaultRole}>
          {allowStoryteller ? (
            <option value="storyteller">This archive is about them</option>
          ) : null}
          <option value="family">Read what I share with them</option>
          <option value="contributor">Suggest photographs and corrections</option>
          <option value="steward">Help look after this practically</option>
        </select>
      </div>
      <div>
        <label htmlFor="note">A short note (optional)</label>
        <p className="hint" id="note-hint">
          Shown to them with the invitation. Please keep it warm and unhurried — an invitation that
          reads as pressure is worse than none.
        </p>
        <textarea id="note" name="note" rows={3} maxLength={1000} aria-describedby="note-hint" />
      </div>

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? <span className="spinner-text">Sending</span> : 'Send invitation'}
      </button>
    </form>
  );
}

export function MemberActions({
  archiveId,
  membershipId,
  name,
}: {
  archiveId: string;
  membershipId: string;
  name: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setPending(true);
    setError(null);
    try {
      await api.patch(`/v1/archives/${archiveId}/members/${membershipId}`, { status: 'revoked' });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
      setPending(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="btn" onClick={() => setConfirming(true)}>
        Withdraw access
      </button>
    );
  }

  return (
    <div className="stack" style={{ maxWidth: '22rem' }}>
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      <p className="small" style={{ marginBottom: 0 }}>
        Withdraw {name}’s access? They will stop being able to read anything immediately, and any
        links they hold will stop working.
      </p>
      <div className="row">
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => void revoke()}
          disabled={pending}
        >
          {pending ? <span className="spinner-text">Withdrawing</span> : 'Yes, withdraw it'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
