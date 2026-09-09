import Link from 'next/link';
import { Card, Empty, PageHeader, Tag } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Who has opened it' };

interface AccessEvent {
  id: string;
  action: 'opened' | 'refused' | 'downloaded';
  displayName: string;
  reasonCode: string | null;
  at: string;
}

/**
 * The access history for one capsule.
 *
 * Refusals are shown as prominently as opens. "Somebody tried to read this
 * after you withdrew it" is the thing a storyteller most needs to be able to
 * see, and a log of successes only would never show it.
 */
export default async function CapsuleAccessPage({
  params,
}: {
  params: Promise<{ archiveId: string; capsuleId: string }>;
}) {
  const { archiveId, capsuleId } = await params;
  const { events } = await serverFetch<{ events: AccessEvent[] }>(
    `/v1/archives/${archiveId}/capsules/${capsuleId}/access`,
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title="Who has opened it"
        lede="Every time this was opened, and every time somebody was turned away."
      />
      <Link href={`/archives/${archiveId}/capsules`}>← All capsules</Link>

      {events.length === 0 ? (
        <Empty title="Nobody has opened it yet">
          Opens and refusals both appear here as they happen.
        </Empty>
      ) : (
        <Card>
          <ul className="stack">
            {events.map((event) => (
              <li key={event.id} className="row">
                <Tag kind={event.action === 'refused' ? 'warn' : 'ok'}>{event.action}</Tag>
                <strong>{event.displayName}</strong>
                <span className="muted">{new Date(event.at).toLocaleString('en-GB')}</span>
                {event.reasonCode ? (
                  <span className="muted">{describe(event.reasonCode)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Reason codes, in words. The log stores codes; people read sentences. */
function describe(code: string): string {
  switch (code) {
    case 'capsule_not_yours':
      return 'it was not shared with them';
    case 'capsule_revoked':
      return 'after you withdrew it';
    case 'capsule_embargoed':
      return 'before it was open';
    case 'capsule_expired':
      return 'after it closed';
    default:
      return code;
  }
}
