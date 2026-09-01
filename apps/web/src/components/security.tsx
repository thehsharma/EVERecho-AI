'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';
import { Card } from './ui';

export function SecurityPanel() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);
    const form = new FormData(event.currentTarget);
    const formElement = event.currentTarget;

    try {
      const result = await api.post<{ otherSessionsRevoked: number }>('/v1/me/password', {
        currentPassword: String(form.get('currentPassword') ?? ''),
        newPassword: String(form.get('newPassword') ?? ''),
      });
      setDone(
        result.otherSessionsRevoked > 0
          ? `Password changed, and ${result.otherSessionsRevoked} other session(s) were signed out.`
          : 'Password changed.',
      );
      formElement.reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
    } finally {
      setPending(false);
    }
  }

  async function signOutEverywhere() {
    setPending(true);
    try {
      await api.post('/v1/me/sessions/revoke-all');
      router.push('/sign-in');
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <Card>
        <h2>Change your password</h2>
        <form onSubmit={changePassword} className="stack" noValidate>
          {error ? <div className="notice notice-danger" role="alert">{error}</div> : null}
          {done ? <div className="notice notice-ok" role="status">{done}</div> : null}

          <div>
            <label htmlFor="currentPassword">Current password</label>
            <input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </div>
          <div>
            <label htmlFor="newPassword">New password</label>
            <p className="hint" id="new-hint">
              At least 12 characters. Changing it signs out every other device, because a password
              change is often a response to something going wrong.
            </p>
            <input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              aria-describedby="new-hint"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? <span className="spinner-text">Saving</span> : 'Change password'}
          </button>
        </form>
      </Card>

      <Card>
        <h2>Sign out everywhere</h2>
        <p>Ends every session, including this one.</p>
        <button type="button" className="btn" onClick={() => void signOutEverywhere()} disabled={pending}>
          Sign out of all devices
        </button>
      </Card>
    </div>
  );
}
