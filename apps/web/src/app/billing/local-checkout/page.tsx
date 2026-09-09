import { Suspense } from 'react';
import { Card, Notice } from '@/components/ui';
import { LocalCheckout } from '@/components/local-checkout';

export const metadata = { title: 'Test checkout' };

/**
 * Stands in for a payment provider's hosted page in development. It posts the
 * same signed webhook a real provider would, so signature verification and
 * idempotent replay handling are exercised rather than bypassed.
 */
export default function LocalCheckoutPage() {
  return (
    <div className="narrow stack">
      <h1>Test checkout</h1>
      <Notice tone="warn" title="This is not a real payment page">
        <p style={{ marginBottom: 0 }}>
          No money moves. This page exists so the reservation flow, the webhook signature check and
          the replay handling can be exercised end to end without a payment provider.
        </p>
      </Notice>
      <Card>
        <Suspense fallback={<p className="spinner-text">Loading</p>}>
          <LocalCheckout />
        </Suspense>
      </Card>
    </div>
  );
}
