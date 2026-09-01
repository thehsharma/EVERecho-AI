import { notFound } from 'next/navigation';
import { Card, Empty, Notice, PageHeader, Tag } from '@/components/ui';
import { requireUser, serverFetch } from '@/lib/server';
import type { Incident } from '@everecho/contracts';

export const metadata = { title: 'Support tools' };

interface WorkerStatus {
  queueDepth: number;
  running: number;
  failedLastHour: number;
  deadLettered: number;
  oldestQueuedAgeSeconds: number | null;
  byType: { type: string; queued: number; failed: number }[];
}

export default async function AdminPage() {
  const me = await requireUser('/admin');
  // Not a redirect: an account without support access should not learn that
  // this page exists at all.
  if (!me.user.isPlatformAdmin) notFound();

  const [incidents, worker] = await Promise.all([
    serverFetch<{ incidents: Incident[] }>('/v1/admin/incidents?status=open'),
    serverFetch<WorkerStatus>('/v1/operations/worker'),
  ]);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Support tools"
        lede="Operational information only. There is no route here that shows anyone's memories."
      />

      <Notice tone="warn" title="What you can and cannot reach">
        <p style={{ marginBottom: 0 }}>
          Reaching even operational detail about a specific archive requires a time-limited grant
          tied to a stated reason, and it is written into that archive’s own history where the
          storyteller can see it. There is no way to browse customer content.
        </p>
      </Notice>

      <Card>
        <h2>Background processing</h2>
        <div className="grid">
          <div>
            <p className="muted small" style={{ marginBottom: 0 }}>Queued</p>
            <p style={{ fontSize: '1.75rem', margin: 0, fontFamily: 'var(--font)' }}>{worker.queueDepth}</p>
          </div>
          <div>
            <p className="muted small" style={{ marginBottom: 0 }}>Running</p>
            <p style={{ fontSize: '1.75rem', margin: 0, fontFamily: 'var(--font)' }}>{worker.running}</p>
          </div>
          <div>
            <p className="muted small" style={{ marginBottom: 0 }}>Gave up</p>
            <p style={{ fontSize: '1.75rem', margin: 0, fontFamily: 'var(--font)' }}>{worker.deadLettered}</p>
          </div>
          <div>
            <p className="muted small" style={{ marginBottom: 0 }}>Oldest waiting</p>
            <p style={{ fontSize: '1.75rem', margin: 0, fontFamily: 'var(--font)' }}>
              {worker.oldestQueuedAgeSeconds === null ? '—' : `${worker.oldestQueuedAgeSeconds}s`}
            </p>
          </div>
        </div>
        {worker.byType.length > 0 ? (
          <div className="table-scroll" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">Queued</th>
                  <th scope="col">Failed</th>
                </tr>
              </thead>
              <tbody>
                {worker.byType.map((row) => (
                  <tr key={row.type}>
                    <th scope="row">{row.type}</th>
                    <td>{row.queued}</td>
                    <td>{row.failed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2>Open incidents</h2>
        {incidents.incidents.length === 0 ? (
          <Empty title="Nothing open" />
        ) : (
          <ul className="list-plain">
            {incidents.incidents.map((incident) => (
              <li key={incident.id} className="spread" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.6rem' }}>
                <div>
                  <strong>{incident.summary}</strong>
                  <div className="small muted">
                    {incident.archiveRef ? `${incident.archiveRef} · ` : ''}
                    {new Date(incident.createdAt).toLocaleString()}
                  </div>
                </div>
                <span className="row">
                  <Tag>{incident.kind}</Tag>
                  <Tag kind={incident.severity === 'critical' || incident.severity === 'high' ? 'danger' : 'draft'}>
                    {incident.severity}
                  </Tag>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
