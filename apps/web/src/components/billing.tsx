'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiRequestError } from '@/lib/api';

export function BillingPanel({
  currency,
  refundId,
}: {
  currency: 'INR' | 'USD';
  refundId?: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reserve() {
    setPending(true);
    setError(null);
    try {
      const result = await api.post<{ reservation: { checkoutUrl: string | null } }>(
        '/v1/billing/reservations',
        { currency, idempotencyKey: `reserve-${Date.now()}` },
      );
      if (result.reservation.checkoutUrl) {
        window.location.href = result.reservation.checkoutUrl;
        return;
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
      setPending(false);
    }
  }

  async function refund() {
    setPending(true);
    setError(null);
    try {
      await api.post(`/v1/billing/reservations/${refundId}/refund`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
    } finally {
      setPending(false);
    }
  }

  if (refundId) {
    return (
      <button type="button" className="btn" onClick={() => void refund()} disabled={pending}>
        {pending ? <span className="spinner-text">Refunding</span> : 'Refund'}
      </button>
    );
  }

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void reserve()}
        disabled={pending}
      >
        {pending ? <span className="spinner-text">Starting</span> : 'Reserve a place'}
      </button>
    </div>
  );
}
