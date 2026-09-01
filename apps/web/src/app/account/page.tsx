import Link from 'next/link';
import { Card, PageHeader } from '@/components/ui';
import { requireUser, productMeta } from '@/lib/server';

export const metadata = { title: 'Account' };

export default async function AccountPage() {
  const [me, meta] = await Promise.all([requireUser('/account'), productMeta()]);

  return (
    <div className="narrow stack-lg">
      <PageHeader title="Your account" />

      <Card>
        <dl style={{ margin: 0 }}>
          <div className="spread" style={{ borderBottom: '1px solid var(--line)', padding: '0.6rem 0' }}>
            <dt className="muted" style={{ margin: 0 }}>Name</dt>
            <dd style={{ margin: 0 }}>{me.user.displayName}</dd>
          </div>
          <div className="spread" style={{ borderBottom: '1px solid var(--line)', padding: '0.6rem 0' }}>
            <dt className="muted" style={{ margin: 0 }}>Email</dt>
            <dd style={{ margin: 0 }}>{me.user.email}</dd>
          </div>
          <div className="spread" style={{ padding: '0.6rem 0' }}>
            <dt className="muted" style={{ margin: 0 }}>Archives you can reach</dt>
            <dd style={{ margin: 0 }}>{me.archives.length}</dd>
          </div>
        </dl>
      </Card>

      <Card>
        <h2>Elsewhere</h2>
        <ul className="stack">
          <li><Link href="/account/security">Security and sessions</Link></li>
          {meta.features.billing ? <li><Link href="/account/billing">Billing and reservations</Link></li> : null}
          {me.user.isPlatformAdmin ? <li><Link href="/admin">Support tools</Link></li> : null}
          <li><Link href="/support">Support</Link></li>
        </ul>
      </Card>
    </div>
  );
}
