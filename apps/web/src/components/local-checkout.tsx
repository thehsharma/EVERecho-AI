'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { API_URL, api, ApiRequestError } from '@/lib/api';

export function LocalCheckout() {
  const params = useSearchParams();
  const providerRef = params.get('ref') ?? '';
  const returnUrl = params.get('return') ?? '/account/billing';
  const amount = params.get('amount') ?? '0';
  const currency = params.get('currency') ?? 'INR';

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function complete(outcome: 'paid' | 'failed') {
    setPending(true);
    setError(null);
    try {
      // The API signs the payload exactly as a provider would, then we deliver
      // it to the webhook endpoint — signature check and all.
      const signed = await api.post<{ signature: string; payload: string }>(
        '/v1/billing/local-checkout/complete',
        { providerRef, outcome },
      );
      const response = await fetch(`${API_URL}/v1/webhooks/billing`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature': signed.signature },
        body: signed.payload,
      });
      if (!response.ok) throw new Error('The webhook was rejected.');
      window.location.href = returnUrl;
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError || caught instanceof Error
          ? caught.message
          : 'That did not work.',
      );
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {error ? <div className="notice notice-danger" role="alert">{error}</div> : null}
      <p>
        Reservation <code>{providerRef}</code> for {Number(amount) / 100} {currency}.
      </p>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void complete('paid')} disabled={pending}>
          Simulate a successful payment
        </button>
        <button type="button" className="btn" onClick={() => void complete('failed')} disabled={pending}>
          Simulate a failure
        </button>
      </div>
    </div>
  );
}
