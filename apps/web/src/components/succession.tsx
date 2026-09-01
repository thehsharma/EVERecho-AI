'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SuccessionDirective } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card } from './ui';

export function SuccessionForm({
  archiveId,
  directive,
}: {
  archiveId: string;
  directive: SuccessionDirective | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setSaved(false);
    const form = new FormData(event.currentTarget);

    try {
      await api.put(`/v1/archives/${archiveId}/succession`, {
        stewardEmail: String(form.get('stewardEmail') ?? '') || null,
        instructions: String(form.get('instructions') ?? '') || null,
        coolingPeriodDays: Number(form.get('coolingPeriodDays') ?? 30),
      });
      setSaved(true);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <form onSubmit={onSubmit} className="stack" noValidate>
        {error ? <div className="notice notice-danger" role="alert">{error}</div> : null}
        {saved ? (
          <div className="notice notice-ok" role="status">
            Recorded. Nothing will act on it — it is a note of your wishes.
          </div>
        ) : null}

        <div>
          <label htmlFor="stewardEmail">Who should we talk to? (optional)</label>
          <p className="hint" id="steward-hint">
            Naming someone here does not make them your executor and does not give them access.
          </p>
          <input
            id="stewardEmail"
            name="stewardEmail"
            type="email"
            defaultValue={directive?.stewardEmail ?? ''}
            aria-describedby="steward-hint"
          />
        </div>

        <div>
          <label htmlFor="instructions">What would you like to happen? (optional)</label>
          <textarea
            id="instructions"
            name="instructions"
            rows={5}
            defaultValue={directive?.instructions ?? ''}
          />
        </div>

        <div>
          <label htmlFor="coolingPeriodDays">
            How long should anyone wait before acting on this?
          </label>
          <input
            id="coolingPeriodDays"
            name="coolingPeriodDays"
            type="number"
            min={7}
            max={365}
            defaultValue={directive?.coolingPeriodDays ?? 30}
            style={{ maxWidth: '10rem' }}
          />
          <p className="hint">Days. Nothing is automatic regardless.</p>
        </div>

        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? <span className="spinner-text">Saving</span> : 'Record my wishes'}
        </button>
      </form>
    </Card>
  );
}
