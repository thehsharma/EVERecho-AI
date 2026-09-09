import { Card, PageHeader } from '@/components/ui';
import { SecurityPanel } from '@/components/security';
import { requireUser, serverFetch } from '@/lib/server';

export const metadata = { title: 'Security' };

interface SessionSummary {
  id: string;
  createdAt: string;
  expiresAt: string;
  current: boolean;
  userAgentFamily: string;
}

export default async function SecurityPage() {
  await requireUser('/account/security');
  const { sessions } = await serverFetch<{ sessions: SessionSummary[] }>('/v1/me/sessions');

  return (
    <div className="narrow stack-lg">
      <PageHeader title="Security" />

      <Card>
        <h2>Where you are signed in</h2>
        <ul className="list-plain">
          {sessions.map((session) => (
            <li key={session.id} className="spread">
              <span>
                {session.userAgentFamily}
                {session.current ? ' — this device' : ''}
              </span>
              <span className="small muted">
                since {new Date(session.createdAt).toLocaleDateString()}
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">
          We record only a broad browser family and a hashed address — enough to spot something
          wrong, not enough to follow you around.
        </p>
      </Card>

      <SecurityPanel />
    </div>
  );
}
