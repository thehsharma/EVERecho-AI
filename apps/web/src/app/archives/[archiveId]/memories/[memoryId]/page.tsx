import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ApproximateDate,
  Card,
  EvidenceClassTag,
  PageHeader,
  ProvenanceTag,
} from '@/components/ui';
import { MemoryEditor } from '@/components/memory-editor';
import { ReviewButtons } from '@/components/review';
import { ApiRequestError } from '@/lib/api';
import { serverFetch } from '@/lib/server';
import type { Archive, Memory } from '@everecho/contracts';

export const metadata = { title: 'A story' };

export default async function MemoryPage({
  params,
}: {
  params: Promise<{ archiveId: string; memoryId: string }>;
}) {
  const { archiveId, memoryId } = await params;

  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);
  let memory: Memory;
  try {
    memory = (
      await serverFetch<{ memory: Memory }>(`/v1/archives/${archiveId}/memories/${memoryId}`)
    ).memory;
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) notFound();
    throw error;
  }

  const canEdit = archive.viewerCapabilities.includes('memory.update');

  return (
    <div className="stack-lg">
      <PageHeader
        title={memory.title}
        lede={memory.occurredAt ? undefined : 'No date recorded — we have not guessed one.'}
        actions={
          memory.status === 'candidate' && archive.viewerCapabilities.includes('memory.review') ? (
            <ReviewButtons archiveId={archiveId} memoryId={memory.id} />
          ) : undefined
        }
      />

      <p className="row" style={{ gap: '0.5rem' }}>
        <ProvenanceTag
          status={memory.status}
          aiAssisted={memory.origin === 'upload_extraction'}
          corrected={memory.wasCorrected}
        />
        <span className="muted small">
          <ApproximateDate value={memory.occurredAt} />
          {memory.placeName ? ` · ${memory.placeName}` : ''}
        </span>
      </p>

      {canEdit ? (
        <Card>
          <MemoryEditor archiveId={archiveId} memory={memory} />
        </Card>
      ) : (
        <Card>
          <p style={{ fontFamily: 'var(--font)', fontSize: '1.0625rem', marginBottom: 0 }}>
            {memory.body}
          </p>
        </Card>
      )}

      <Card>
        <h2>Where this comes from</h2>
        <p className="muted small">
          Each claim below is linked to the exact words in the recording or document it came from.
          Nothing here was added.
        </p>
        <ul className="list-plain">
          {memory.claims.map((claim) => (
            <li
              key={claim.id}
              style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.75rem' }}
            >
              <p style={{ marginBottom: '0.35rem' }}>{claim.text}</p>
              <p className="row small" style={{ gap: '0.35rem' }}>
                <EvidenceClassTag evidenceClass={claim.evidenceClass} />
              </p>
              {claim.evidence.map((evidence) => (
                <div key={evidence.id} style={{ marginTop: '0.5rem' }}>
                  <blockquote className="quote">“{evidence.quotedText}”</blockquote>
                  <p className="small muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                    {evidence.sourceFilename} ({evidence.sourceKind}) · extracted by{' '}
                    {evidence.extractionMethod} using {evidence.modelVersion}, prompt{' '}
                    {evidence.promptVersion}
                  </p>
                </div>
              ))}
            </li>
          ))}
        </ul>
        {memory.claims.length === 0 ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            This story has no separate claims recorded.
          </p>
        ) : null}
      </Card>

      <p className="small">
        <Link href={`/archives/${archiveId}/memories`}>Back to all stories</Link>
      </p>
    </div>
  );
}
