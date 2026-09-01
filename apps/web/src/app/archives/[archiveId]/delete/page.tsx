import { Card, Notice, PageHeader } from '@/components/ui';
import { DeletionPanel } from '@/components/lifecycle';
import { serverFetch } from '@/lib/server';
import type { Archive, DeletionRequest } from '@everecho/contracts';

export const metadata = { title: 'Delete' };

export default async function DeletePage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const [archive, { deletionRequests }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ deletionRequests: DeletionRequest[] }>(
      `/v1/archives/${archiveId}/deletion-requests`,
    ),
  ]);
  const canDelete = archive.viewerCapabilities.includes('archive.delete');

  return (
    <div className="stack-lg" style={{ maxWidth: '46rem' }}>
      <PageHeader title="Delete this archive" />

      <Notice tone="danger" title="This cannot be undone">
        <p>
          Deleting removes the stories, the search indexes, the stored files, the transcripts and
          every answer that was ever generated. It cannot be recovered afterwards, by you or by us.
        </p>
        <p style={{ marginBottom: 0 }}>
          One thing is kept on purpose: a record that the deletion happened, with no contents.
          Proving that we deleted something requires that the record of it survives.
        </p>
      </Notice>

      <Card>
        <h2>Before you do</h2>
        <p style={{ marginBottom: 0 }}>
          Consider exporting a copy first. It takes a moment and gives you everything in files that
          open without us — you can delete the archive and still keep the stories.
        </p>
      </Card>

      {canDelete ? (
        <DeletionPanel
          archiveId={archiveId}
          archiveName={archive.name}
          requests={deletionRequests}
        />
      ) : (
        <Notice tone="info">
          <p style={{ marginBottom: 0 }}>
            Only {archive.subjectDisplayName} can delete this archive. That is not something the
            person who set it up or paid for it can do.
          </p>
        </Notice>
      )}
    </div>
  );
}
