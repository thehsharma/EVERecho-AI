import { Card, Empty, Notice, PageHeader, Tag } from '@/components/ui';
import { serverFetch } from '@/lib/server';
import type { AuditEvent } from '@everecho/contracts';

export const metadata = { title: 'Activity' };

const ACTION_LABEL: Record<string, string> = {
  'archive.read': 'Opened the archive',
  'memory.read': 'Read stories',
  'question.ask': 'Asked a question',
  'source.download': 'Downloaded a file',
  'export.create': 'Requested an export',
  'consent.update': 'Changed permissions',
  'membership.revoke': 'Withdrew someone’s access',
  'invitation.create': 'Sent an invitation',
  'invitation.respond': 'Answered an invitation',
  'admin.breakglass.request': 'Support requested temporary access',
  'archive.deleted': 'The archive was deleted',
};

const REASON_LABEL: Record<string, string> = {
  restricted_topic: 'refused — an off-limits topic',
  membership_revoked: 'refused — their access had been withdrawn',
  recipient_not_permitted: 'refused — not shared with them',
  sensitivity_above_grant: 'refused — more private than their access allows',
  consent_mode_insufficient: 'refused — not permitted by the current consent',
  not_a_member: 'refused — no access to this archive',
  capability_prohibited_in_v0_1: 'refused — a capability this product does not have',
};

export default async function AuditPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const { events } = await serverFetch<{ events: AuditEvent[] }>(
    `/v1/archives/${archiveId}/audit?limit=150`,
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title="Activity"
        lede="Everything that happened in this archive, including everything that was refused."
      />

      <Notice tone="info">
        <p style={{ marginBottom: 0 }}>
          Refusals are recorded as well as successes. Being able to see that someone was turned away
          is half of trusting that the permissions work.
        </p>
      </Notice>

      {events.length === 0 ? (
        <Empty title="Nothing recorded yet" />
      ) : (
        <Card>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Who</th>
                  <th scope="col">What</th>
                  <th scope="col">Outcome</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="small">
                      <time dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleString()}
                      </time>
                    </td>
                    <td>{event.actorDisplayName}</td>
                    <td>{ACTION_LABEL[event.action] ?? event.action}</td>
                    <td>
                      {event.outcome === 'deny' ? (
                        <Tag kind="danger">
                          {event.reasonCode ? (REASON_LABEL[event.reasonCode] ?? 'refused') : 'refused'}
                        </Tag>
                      ) : (
                        <Tag kind="approved">allowed</Tag>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
