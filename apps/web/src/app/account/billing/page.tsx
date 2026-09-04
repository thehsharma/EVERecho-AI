import { Card, Notice, PageHeader, Tag } from '@/components/ui';
import { BillingPanel } from '@/components/billing';
import { requireUser, serverFetch } from '@/lib/server';

export const metadata = { title: 'Billing' };

interface BillingSummary {
  provider: string;
  testMode: boolean;
  currency: 'INR' | 'USD';
  reservationAmountMinor: number;
  reservations: {
    id: string;
    status: string;
    currency: string;
    amountMinor: number;
    checkoutUrl: string | null;
    createdAt: string;
  }[];
}

function money(minor: number, currency: string): string {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).format(minor / 100);
}

export default async function BillingPage() {
  await requireUser('/account/billing');
  const billing = await serverFetch<BillingSummary>('/v1/billing');

  return (
    <div className="narrow stack-lg">
      <PageHeader title="Billing" lede="Reservations for the pilot." />

      {billing.testMode ? (
        <Notice tone="warn" title="Test mode">
          <p style={{ marginBottom: 0 }}>
            This installation uses the <code>{billing.provider}</code> billing adapter in test mode.
            No real money moves.
          </p>
        </Notice>
      ) : null}

      <Card>
        <h2>Reserve a place</h2>
        <p>
          {money(billing.reservationAmountMinor, billing.currency)}, refundable at any time without
          giving a reason. No card details reach us.
        </p>
        <BillingPanel currency={billing.currency} />
      </Card>

      {billing.reservations.length > 0 ? (
        <Card>
          <h2>Your reservations</h2>
          <ul className="list-plain">
            {billing.reservations.map((reservation) => (
              <li
                key={reservation.id}
                className="spread"
                style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.6rem' }}
              >
                <span>
                  {money(reservation.amountMinor, reservation.currency)}{' '}
                  <span className="small muted">
                    {new Date(reservation.createdAt).toLocaleDateString()}
                  </span>
                </span>
                <span className="row">
                  <Tag kind={reservation.status === 'paid' ? 'approved' : 'draft'}>
                    {reservation.status}
                  </Tag>
                  {reservation.status === 'pending' && reservation.checkoutUrl ? (
                    <a className="btn" href={reservation.checkoutUrl}>
                      Complete
                    </a>
                  ) : null}
                  {reservation.status === 'paid' ? (
                    <BillingPanel currency={billing.currency} refundId={reservation.id} />
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
