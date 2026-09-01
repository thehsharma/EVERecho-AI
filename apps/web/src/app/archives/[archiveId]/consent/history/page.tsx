import { Card, Empty, PageHeader, Tag } from '@/components/ui';
import { serverFetch } from '@/lib/server';
import type { ConsentPolicy } from '@everecho/contracts';

export const metadata = { title: 'Consent history' };

const ACTION_LABEL: Record<string, string> = {
  granted: 'Permissions set for the first time',
  updated: 'Permissions changed',
  revoked: 'Permissions withdrawn',
  declined: 'Invitation declined',
  teachback_passed: 'Answered the questions about how this works',
  teachback_failed: 'Answered the questions — some were wrong, and were explained',
};

export default async function ConsentHistoryPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const history = await serverFetch<{
    versions: ConsentPolicy[];
    records: { id: string; action: string; summary: string | null; createdAt: string }[];
  }>(`/v1/archives/${archiveId}/consent/history`);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Consent history"
        lede="Every version is kept. Nothing is overwritten, so what was agreed on any given day is still answerable."
      />

      {history.records.length === 0 ? (
        <Empty title="Nothing recorded yet" />
      ) : (
        <Card>
          <ol className="list-plain" style={{ gap: '1rem' }}>
            {history.records.map((record) => (
              <li key={record.id} style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.75rem' }}>
                <div className="spread">
                  <strong>{ACTION_LABEL[record.action] ?? record.action}</strong>
                  <span className="muted small">
                    <time dateTime={record.createdAt}>
                      {new Date(record.createdAt).toLocaleString()}
                    </time>
                  </span>
                </div>
                {record.summary ? <p className="small" style={{ marginBottom: 0 }}>{record.summary}</p> : null}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <Card>
        <h2>Versions</h2>
        <div className="table-scroll">
          <table>
            <caption>
              Each version is hashed, so a stored policy can be shown not to have been altered.
            </caption>
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">Mode</th>
                <th scope="col">In force</th>
                <th scope="col">Fingerprint</th>
              </tr>
            </thead>
            <tbody>
              {history.versions.map((version) => (
                <tr key={version.id}>
                  <th scope="row">
                    {version.version}{' '}
                    {version.supersededAt === null ? <Tag kind="approved">Current</Tag> : null}
                  </th>
                  <td>{version.document.mode}</td>
                  <td className="small">
                    {new Date(version.effectiveFrom).toLocaleDateString()}
                    {version.supersededAt
                      ? ` — ${new Date(version.supersededAt).toLocaleDateString()}`
                      : ' — now'}
                  </td>
                  <td className="small muted">
                    <code>{version.policyHash.slice(0, 12)}…</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
