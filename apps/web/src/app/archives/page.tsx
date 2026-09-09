import Link from 'next/link';
import { ButtonLink, Card, Empty, PageHeader, Tag } from '@/components/ui';
import { requireUser } from '@/lib/server';

export const metadata = { title: 'Your archives' };

const ROLE_LABEL: Record<string, string> = {
  storyteller: 'This archive is about you',
  buyer: 'You started this archive',
  family: 'Shared with you',
  contributor: 'You can add to this',
  steward: 'You help look after this',
};

const STATUS_LABEL: Record<string, string> = {
  draft: 'Not started',
  awaiting_storyteller: 'Waiting for the storyteller',
  declined: 'The invitation was declined',
  active: 'Active',
  frozen: 'Paused',
  export_only: 'Export only',
  deleting: 'Being deleted',
  deleted: 'Deleted',
};

export default async function ArchivesPage() {
  const me = await requireUser('/archives');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Your archives"
        lede="Only archives you have a relationship with appear here."
        actions={
          <ButtonLink href="/archives/new" variant="primary">
            Start an archive
          </ButtonLink>
        }
      />

      {me.archives.length === 0 ? (
        <Empty title="You do not have any archives yet">
          <p>
            You can start one for someone in your family, or wait for an invitation. Starting an
            archive does not record anything — the person it is about decides that.
          </p>
          <ButtonLink href="/archives/new" variant="primary">
            Start an archive
          </ButtonLink>
        </Empty>
      ) : (
        <ul className="list-plain">
          {me.archives.map((archive) => (
            <li key={archive.archiveId}>
              <Card>
                <div className="spread">
                  <div>
                    <h2 style={{ marginBottom: '0.25rem' }}>
                      <Link href={`/archives/${archive.archiveId}`}>{archive.name}</Link>
                    </h2>
                    <p className="muted small" style={{ marginBottom: 0 }}>
                      {ROLE_LABEL[archive.role] ?? archive.role}
                    </p>
                  </div>
                  <Tag kind={archive.status === 'active' ? 'approved' : 'draft'}>
                    {STATUS_LABEL[archive.status] ?? archive.status}
                  </Tag>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
