'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Memory } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';

export function MemoryEditor({ archiveId, memory }: { archiveId: string; memory: Memory }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(memory.title);
  const [body, setBody] = useState(memory.body);
  const [year, setYear] = useState(memory.occurredAt?.value.slice(0, 4) ?? '');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api.patch(`/v1/archives/${archiveId}/memories/${memory.id}`, {
        title,
        body,
        ...(year ? { occurredAt: { value: year, precision: 'year' } } : {}),
        ...(reason ? { reason } : {}),
      });
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <div>
        <p style={{ fontFamily: 'var(--font)', fontSize: '1.0625rem' }}>{memory.body}</p>
        <button type="button" className="btn" onClick={() => setEditing(true)}>
          Correct this
        </button>
      </div>
    );
  }

  return (
    <div className="stack">
      {error ? <div className="notice notice-danger" role="alert">{error}</div> : null}
      <p className="hint">
        Your correction is kept alongside what was there before — nothing is quietly overwritten,
        and the original recording is never changed.
      </p>

      <div>
        <label htmlFor="memory-title">Title</label>
        <input id="memory-title" value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div>
        <label htmlFor="memory-body">What happened</label>
        <textarea
          id="memory-body"
          value={body}
          rows={8}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>
      <div>
        <label htmlFor="memory-year">Year (leave blank if you are not sure)</label>
        <input
          id="memory-year"
          value={year}
          inputMode="numeric"
          pattern="\d{4}"
          onChange={(event) => setYear(event.target.value)}
          style={{ maxWidth: '10rem' }}
        />
      </div>
      <div>
        <label htmlFor="memory-reason">Why the change? (optional)</label>
        <input id="memory-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={pending}>
          {pending ? <span className="spinner-text">Saving</span> : 'Save the correction'}
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
