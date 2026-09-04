import { Card, Empty, Notice, PageHeader, Tag } from '@/components/ui';
import { UploadCentre } from '@/components/upload-centre';
import { serverFetch } from '@/lib/server';
import type { Archive, SourceAsset } from '@everecho/contracts';

export const metadata = { title: 'Recordings and documents' };

const STAGE_LABEL: Record<string, string> = {
  queued: 'Waiting to be checked',
  scanning: 'Being checked for anything harmful',
  transcribing: 'Being read',
  extracting: 'Drafting story cards',
  ready: 'Ready',
  failed: 'Something went wrong',
  skipped: 'Left as it is',
};

export default async function SourcesPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const [archive, { sources }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ sources: SourceAsset[] }>(`/v1/archives/${archiveId}/sources`),
  ]);
  const canUpload = archive.viewerCapabilities.includes('source.upload');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Recordings and documents"
        lede="Photographs, letters, certificates, recordings — whatever helps tell the story."
      />

      {canUpload ? (
        <Card>
          <h2>Add something</h2>
          <UploadCentre archiveId={archiveId} />
        </Card>
      ) : null}

      {sources.length === 0 ? (
        <Empty title="Nothing added yet">
          <p style={{ marginBottom: 0 }}>
            {canUpload
              ? 'Photographs and letters often bring back more than a question can.'
              : 'Material will appear here once it has been added and shared.'}
          </p>
        </Empty>
      ) : (
        <Card>
          <div className="table-scroll">
            <table>
              <caption>
                Originals are kept exactly as they arrived and are never edited. A checksum is
                recorded for each so you can prove it later.
              </caption>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Kind</th>
                  <th scope="col">State</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id}>
                    <th scope="row">
                      {source.originalFilename}
                      {source.processing.detail ? (
                        <div className="small muted">{source.processing.detail}</div>
                      ) : null}
                    </th>
                    <td>{source.kind}</td>
                    <td>
                      {source.status === 'rejected' ? (
                        <Tag kind="danger">Not accepted</Tag>
                      ) : (
                        <Tag kind={source.processing.stage === 'ready' ? 'approved' : 'draft'}>
                          {STAGE_LABEL[source.processing.stage] ?? source.processing.stage}
                        </Tag>
                      )}
                    </td>
                    <td className="small">{new Date(source.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Notice tone="info" title="What happens to something you add">
        <p style={{ marginBottom: 0 }}>
          It is stored privately and checked before anything reads it. If you permitted it, the
          words are transcribed or the document is read, and short story cards are drafted for you
          to review. Nothing is shared with anyone until you approve it.
        </p>
      </Notice>
    </div>
  );
}
