'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';

export function ReviewButtons({ archiveId, memoryId }: { archiveId: string; memoryId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(decision: 'approve' | 'reject') {
    setPending(decision);
    setError(null);
    try {
      await api.post(`/v1/archives/${archiveId}/memories/${memoryId}/review`, { decision });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="stack" style={{ margin: 0 }}>
      {error ? (
        <p className="small" role="alert" style={{ color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      ) : null}
      <div className="row">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void review('approve')}
          disabled={pending !== null}
        >
          {pending === 'approve' ? <span className="spinner-text">Approving</span> : 'This is right'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => void review('reject')}
          disabled={pending !== null}
        >
          {pending === 'reject' ? <span className="spinner-text">Removing</span> : 'Leave this out'}
        </button>
      </div>
    </div>
  );
}
