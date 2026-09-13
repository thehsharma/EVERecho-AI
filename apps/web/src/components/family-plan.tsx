'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
type Summary = {
  configured: boolean;
  testMode: boolean;
  cycles: number;
  subscription: { status: string; checkoutUrl: string | null } | null;
  plan: { name: string; amount: number; currency: string; period: string; interval: number } | null;
};
export function FamilyPlan() {
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [ack, setAck] = useState(false);
  const [cancel, setCancel] = useState(false);
  useEffect(() => {
    let live = true;
    void api
      .get<Summary>('/v1/family-subscription')
      .then((r) => {
        if (live) setData(r);
      })
      .catch((e) => {
        if (live) setNotice(e instanceof Error ? e.message : 'Could not load the plan.');
      });
    return () => {
      live = false;
    };
  }, []);
  async function action(kind: 'checkout' | 'refresh' | 'cancel') {
    setBusy(true);
    setNotice('');
    try {
      const result = await api.post<{ checkoutUrl?: string }>(
        '/v1/family-subscription/' + kind,
        kind === 'refresh' ? undefined : { acknowledged: true },
      );
      if (result.checkoutUrl) {
        const url = new URL(result.checkoutUrl);
        if (url.protocol !== 'https:' || url.hostname !== 'rzp.io')
          throw new Error('Unexpected checkout destination.');
        window.location.assign(url.toString());
        return;
      }
      setData(await api.get<Summary>('/v1/family-subscription'));
      setNotice(
        kind === 'cancel'
          ? 'Cancellation requested for the end of the billing cycle. Confirm the effective date in Razorpay.'
          : 'Subscription status refreshed.',
      );
      setCancel(false);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'The request could not complete.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack-lg">
      <h1>Family plan</h1>
      <p>
        Payment details stay with Razorpay. A subscription does not change who may access family
        memories.
      </p>
      {data?.testMode && (
        <p>
          <strong>Test mode — this checkout is not live billing.</strong>
        </p>
      )}
      {data && !data.configured && (
        <p>
          Subscriptions are not open yet. Your existing archive and local memorial preview remain
          available.
        </p>
      )}
      {data?.plan && (
        <section className="card">
          <h2>{data.plan.name}</h2>
          <p>
            {new Intl.NumberFormat(undefined, {
              style: 'currency',
              currency: data.plan.currency,
            }).format(data.plan.amount / 100)}{' '}
            every {data.plan.interval} {data.plan.period} billing period(s), for {data.cycles}{' '}
            cycles. Review the final taxes and payment schedule in Razorpay.
          </p>
          <p>
            Includes a higher daily hosted memorial allowance for this account, while the
            subscription is active. Provider availability still applies.
          </p>
          <label>
            <input
              type="checkbox"
              checked={ack}
              disabled={busy}
              onChange={(e) => setAck(e.target.checked)}
            />{' '}
            I understand this is recurring billing and will review the terms before authorizing
            payment in Razorpay.
          </label>
          <p>
            <button
              type="button"
              disabled={busy || !ack || !data.configured}
              onClick={() => void action('checkout')}
            >
              Continue to Razorpay
            </button>
          </p>
        </section>
      )}
      {data?.subscription && (
        <section>
          <h2>Your subscription</h2>
          <p>Status: {data.subscription.status.replaceAll('_', ' ')}</p>
          <button type="button" disabled={busy} onClick={() => void action('refresh')}>
            Refresh payment status
          </button>{' '}
          <button type="button" disabled={busy} onClick={() => setCancel(true)}>
            Cancel subscription
          </button>
          {cancel && (
            <div>
              <p>
                Request cancellation at the end of the current billing cycle? This does not delete
                your memories or request a refund.
              </p>
              <button type="button" disabled={busy} onClick={() => void action('cancel')}>
                Confirm cancellation
              </button>{' '}
              <button type="button" onClick={() => setCancel(false)}>
                Keep subscription
              </button>
            </div>
          )}
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
