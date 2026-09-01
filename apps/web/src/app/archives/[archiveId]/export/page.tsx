import { Card, Notice, PageHeader, Tag } from '@/components/ui';
import { ExportButton } from '@/components/lifecycle';
import { serverFetch } from '@/lib/server';
import type { Archive, ExportJob } from '@everecho/contracts';

export const metadata = { title: 'Export everything' };

export default async function ExportPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const [archive, { exports }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ exports: ExportJob[] }>(`/v1/archives/${archiveId}/exports`),
  ]);
  const canExport = archive.viewerCapabilities.includes('export.create');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Export everything"
        lede="A complete copy, in formats that open without us."
      />

      <Card>
        <h2>What you get</h2>
        <ul className="stack">
          <li>Every original file, exactly as it was uploaded.</li>
          <li>The transcripts, including any corrections made by hand.</li>
          <li>Every story card and every claim, with the exact source passage behind each one.</li>
          <li>The permission history and every version of consent.</li>
          <li>A checksum for every file, so you can prove nothing has been altered.</li>
          <li>A plain-language README explaining the layout.</li>
        </ul>
        {canExport ? <ExportButton archiveId={archiveId} /> : (
          <p className="muted" style={{ marginBottom: 0 }}>
            The storyteller has not given you permission to export from this archive.
          </p>
        )}
      </Card>

      {exports.length > 0 ? (
        <Card>
          <h2>Your exports</h2>
          <ul className="list-plain">
            {exports.map((job) => (
              <li key={job.id} className="spread" style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.75rem' }}>
                <div>
                  <Tag kind={job.status === 'ready' ? 'approved' : 'draft'}>{job.status}</Tag>{' '}
                  <span className="small muted">
                    {new Date(job.createdAt).toLocaleString()}
                    {job.manifest
                      ? ` · ${job.manifest.sourceCount} files, ${job.manifest.memoryCount} stories, ${job.manifest.claimCount} claims`
                      : ''}
                  </span>
                  {job.checksum ? (
                    <div className="small muted">
                      <code>sha256:{job.checksum.value.slice(0, 16)}…</code>
                    </div>
                  ) : null}
                </div>
                {job.status === 'ready' && job.downloadUrl ? (
                  <a className="btn btn-primary" href={job.downloadUrl} download>
                    Download
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Notice tone="info">
        <p style={{ marginBottom: 0 }}>
          Download links expire after a short time. Ask for a fresh export whenever you need one —
          there is no limit, and you never need a reason.
        </p>
      </Notice>
    </div>
  );
}
