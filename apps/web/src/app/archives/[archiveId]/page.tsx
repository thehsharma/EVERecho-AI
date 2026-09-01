import Link from 'next/link';
import { ButtonLink, Card, Empty, Notice, PageHeader, Tag } from '@/components/ui';
import { serverFetch } from '@/lib/server';
import type { Archive, ConsentPolicy, Memory, SourceAsset } from '@everecho/contracts';

async function safe<T>(path: string, fallback: T): Promise<T> {
  try {
    return await serverFetch<T>(path);
  } catch {
    // A section the caller may not reach simply does not appear.
    return fallback;
  }
}

export default async function ArchiveOverviewPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);
  const isStoryteller = archive.viewerRole === 'storyteller';

  const [consent, memories, sources] = await Promise.all([
    safe<{ policy: ConsentPolicy | null; teachBackPassed: boolean }>(
      `/v1/archives/${archiveId}/consent`,
      { policy: null, teachBackPassed: false },
    ),
    safe<{ memories: Memory[]; candidateCount: number }>(
      `/v1/archives/${archiveId}/memories?status=approved`,
      { memories: [], candidateCount: 0 },
    ),
    safe<{ sources: SourceAsset[] }>(`/v1/archives/${archiveId}/sources`, { sources: [] }),
  ]);

  const processing = sources.sources.filter(
    (s) => s.processing.stage !== 'ready' && s.processing.stage !== 'skipped' && s.status !== 'rejected',
  );
  const needsConsent = isStoryteller && !consent.policy;

  return (
    <div className="stack-lg">
      <PageHeader
        title={archive.name}
        lede={
          isStoryteller
            ? 'This archive is about you. Everything in it is your decision.'
            : `An archive about ${archive.subjectDisplayName}.`
        }
      />

      {needsConsent ? (
        <Notice tone="warn" title="Nothing is recorded yet">
          <p>
            Before anything can be recorded, please read the short explanation and set your own
            permissions. It takes a few minutes and you can change everything later.
          </p>
          <ButtonLink href={`/archives/${archiveId}/consent/teach-back`} variant="primary">
            Read it and decide
          </ButtonLink>
        </Notice>
      ) : null}

      {archive.status === 'awaiting_storyteller' && !isStoryteller ? (
        <Notice tone="info" title="Waiting for the storyteller">
          <p style={{ marginBottom: 0 }}>
            {archive.subjectDisplayName} has been invited and has not yet decided. Nothing has been
            recorded, and there is nothing for you to do but wait. Please do not chase them.
          </p>
        </Notice>
      ) : null}

      {archive.status === 'declined' ? (
        <Notice tone="warn" title="This invitation was declined">
          <p style={{ marginBottom: 0 }}>
            {archive.subjectDisplayName} chose not to take part. We have not been given a reason to
            pass on. Please respect that decision.
          </p>
        </Notice>
      ) : null}

      {processing.length > 0 ? (
        <Notice tone="info" title={`${processing.length} file(s) still being processed`}>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {processing.slice(0, 4).map((source) => (
              <li key={source.id}>
                {source.originalFilename} — <span className="muted">{source.processing.stage}</span>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="grid">
        <Card>
          <h2>Stories</h2>
          <p style={{ fontSize: '2rem', margin: 0, fontFamily: 'var(--font)' }}>
            {memories.memories.length}
          </p>
          <p className="muted small">approved and searchable</p>
          {isStoryteller && memories.candidateCount > 0 ? (
            <p style={{ marginBottom: 0 }}>
              <Link href={`/archives/${archiveId}/memories`}>
                {memories.candidateCount} waiting for you to review
              </Link>
            </p>
          ) : null}
        </Card>

        <Card>
          <h2>Recordings and documents</h2>
          <p style={{ fontSize: '2rem', margin: 0, fontFamily: 'var(--font)' }}>
            {sources.sources.length}
          </p>
          <p className="muted small">stored, with the originals untouched</p>
          {archive.viewerCapabilities.includes('source.upload') ? (
            <p style={{ marginBottom: 0 }}>
              <Link href={`/archives/${archiveId}/sources`}>Add something</Link>
            </p>
          ) : null}
        </Card>

        <Card>
          <h2>Permissions</h2>
          {consent.policy ? (
            <>
              <p style={{ margin: 0 }}>
                <Tag kind="approved">Version {consent.policy.version}</Tag>
              </p>
              <p className="muted small">
                Mode: {consent.policy.document.mode} ·{' '}
                {consent.policy.document.recipients.length} recipient grant(s)
              </p>
              {consent.policy.document.restrictedTopics.length > 0 ? (
                <p className="small" style={{ marginBottom: 0 }}>
                  Off-limits: {consent.policy.document.restrictedTopics.join(', ')}
                </p>
              ) : null}
            </>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>
              Not set yet. Nobody can see anything.
            </p>
          )}
        </Card>
      </div>

      {isStoryteller && consent.policy ? (
        <Card>
          <h2>What would you like to do?</h2>
          <div className="row">
            <ButtonLink href={`/archives/${archiveId}/interview`} variant="primary">
              Record a story
            </ButtonLink>
            <ButtonLink href={`/archives/${archiveId}/sources`}>Add a photograph or letter</ButtonLink>
            {memories.candidateCount > 0 ? (
              <ButtonLink href={`/archives/${archiveId}/memories`}>
                Review {memories.candidateCount} draft(s)
              </ButtonLink>
            ) : null}
          </div>
        </Card>
      ) : null}

      {!isStoryteller && memories.memories.length === 0 && archive.status === 'active' ? (
        <Empty title="Nothing has been shared with you yet">
          <p style={{ marginBottom: 0 }}>
            {archive.subjectDisplayName} decides what appears here, and when.
          </p>
        </Empty>
      ) : null}
    </div>
  );
}
