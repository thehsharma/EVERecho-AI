import Link from 'next/link';
import { ApproximateDate, Card, Empty, Notice, PageHeader, ProvenanceTag } from '@/components/ui';
import { ReviewButtons } from '@/components/review';
import { serverFetch } from '@/lib/server';
import type { Archive, Contradiction, Memory } from '@everecho/contracts';

export const metadata = { title: 'Stories' };

export default async function MemoriesPage({
  params,
  searchParams,
}: {
  params: Promise<{ archiveId: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { archiveId } = await params;
  const { status } = await searchParams;

  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);
  const canReview = archive.viewerCapabilities.includes('memory.review');
  const view = canReview ? (status ?? 'candidate') : 'approved';

  const [{ memories, candidateCount }, contradictions] = await Promise.all([
    serverFetch<{ memories: Memory[]; candidateCount: number }>(
      `/v1/archives/${archiveId}/memories?status=${view}`,
    ),
    canReview
      ? serverFetch<{ contradictions: Contradiction[] }>(
          `/v1/archives/${archiveId}/contradictions`,
        ).catch(() => ({ contradictions: [] as Contradiction[] }))
      : Promise.resolve({ contradictions: [] as Contradiction[] }),
  ]);

  const open = contradictions.contradictions.filter((c) => c.status === 'open');

  return (
    <div className="stack-lg">
      <PageHeader
        title={canReview ? 'Your stories' : 'Stories'}
        lede={
          canReview
            ? 'Nothing becomes part of the archive, searchable or answerable until you approve it.'
            : `What ${archive.subjectDisplayName} has approved for you to read.`
        }
      />

      {canReview ? (
        <nav className="row" aria-label="Filter stories">
          <Link
            href={`/archives/${archiveId}/memories?status=candidate`}
            className="btn"
            aria-current={view === 'candidate' ? 'page' : undefined}
          >
            Waiting for you ({candidateCount})
          </Link>
          <Link
            href={`/archives/${archiveId}/memories?status=approved`}
            className="btn"
            aria-current={view === 'approved' ? 'page' : undefined}
          >
            Approved
          </Link>
        </nav>
      ) : null}

      {open.length > 0 ? (
        <Notice tone="warn" title={`${open.length} thing(s) do not add up`}>
          <ul className="stack" style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {open.slice(0, 3).map((contradiction) => (
              <li key={contradiction.id}>
                <span>“{contradiction.claimAText}”</span>
                <br />
                <span className="muted">against</span>
                <br />
                <span>“{contradiction.claimBText}”</span>
              </li>
            ))}
          </ul>
          <p className="small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
            We have not chosen between them. An answer that touches this will say the recordings
            disagree and cite both.
          </p>
        </Notice>
      ) : null}

      {memories.length === 0 ? (
        <Empty title={view === 'candidate' ? 'Nothing waiting for you' : 'No approved stories yet'}>
          <p style={{ marginBottom: 0 }}>
            {view === 'candidate'
              ? 'New drafts appear here after a recording or document has been processed.'
              : 'Approved stories will appear here.'}
          </p>
        </Empty>
      ) : (
        <ul className="list-plain">
          {memories.map((memory) => (
            <li key={memory.id}>
              <Card>
                <div className="spread">
                  <h2 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>
                    <Link href={`/archives/${archiveId}/memories/${memory.id}`}>
                      {memory.title}
                    </Link>
                  </h2>
                  <span className="muted small">
                    <ApproximateDate value={memory.occurredAt} />
                  </span>
                </div>

                <p>{memory.body}</p>

                <div className="spread">
                  <ProvenanceTag
                    status={memory.status}
                    aiAssisted={memory.origin === 'upload_extraction'}
                    corrected={memory.wasCorrected}
                  />
                  {canReview && memory.status === 'candidate' ? (
                    <ReviewButtons archiveId={archiveId} memoryId={memory.id} />
                  ) : null}
                </div>

                {memory.claims.length > 0 ? (
                  <p className="small muted" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                    {memory.claims.length} claim(s), each linked to the exact words in the source.{' '}
                    <Link href={`/archives/${archiveId}/memories/${memory.id}`}>Check them</Link>
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
