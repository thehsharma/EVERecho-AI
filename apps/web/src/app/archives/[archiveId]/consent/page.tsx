import { Card, Notice, PageHeader } from '@/components/ui';
import { ConsentEditor } from '@/components/consent-editor';
import { serverFetch } from '@/lib/server';
import type { Archive, ConsentPolicy, SourceAsset } from '@everecho/contracts';

export const metadata = { title: 'Permissions' };

export default async function ConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ archiveId: string }>;
  searchParams: Promise<{ first?: string }>;
}) {
  const { archiveId } = await params;
  const { first } = await searchParams;

  const [archive, consent] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{
      policy: ConsentPolicy | null;
      defaultDocument: unknown;
      teachBackPassed: boolean;
    }>(`/v1/archives/${archiveId}/consent`),
  ]);
  const canEdit = archive.viewerCapabilities.includes('consent.update');

  let sources: SourceAsset[] = [];
  try {
    sources = (await serverFetch<{ sources: SourceAsset[] }>(`/v1/archives/${archiveId}/sources`))
      .sources;
  } catch {
    sources = [];
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Permissions"
        lede={
          canEdit
            ? 'You decide all of this, and you can change any of it whenever you like.'
            : `What ${archive.subjectDisplayName} has permitted. Only they can change it.`
        }
      />

      {first ? (
        <Notice tone="ok" title="You are all set to choose">
          <p style={{ marginBottom: 0 }}>
            Everything starts switched off. Turn on only what you are comfortable with — you can add
            more later, or take it away again.
          </p>
        </Notice>
      ) : null}

      {!canEdit ? (
        <Notice tone="info">
          <p style={{ marginBottom: 0 }}>
            These are {archive.subjectDisplayName}’s choices about their own memories. Nobody else
            can change them, including whoever set up or paid for this archive.
          </p>
        </Notice>
      ) : null}

      {canEdit ? (
        <ConsentEditor
          archiveId={archiveId}
          policy={consent.policy}
          defaultDocument={consent.defaultDocument as never}
          sources={sources.map((s) => ({ id: s.id, filename: s.originalFilename, kind: s.kind }))}
        />
      ) : consent.policy ? (
        <Card>
          <dl style={{ margin: 0 }}>
            <div
              className="spread"
              style={{ borderBottom: '1px solid var(--line)', padding: '0.6rem 0' }}
            >
              <dt className="muted" style={{ margin: 0 }}>
                What is allowed
              </dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>{consent.policy.document.mode}</dd>
            </div>
            <div
              className="spread"
              style={{ borderBottom: '1px solid var(--line)', padding: '0.6rem 0' }}
            >
              <dt className="muted" style={{ margin: 0 }}>
                Off-limits topics
              </dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>
                {consent.policy.document.restrictedTopics.length > 0
                  ? consent.policy.document.restrictedTopics.join(', ')
                  : 'None'}
              </dd>
            </div>
            <div className="spread" style={{ padding: '0.6rem 0' }}>
              <dt className="muted" style={{ margin: 0 }}>
                Synthetic voice or likeness
              </dt>
              <dd style={{ margin: 0, fontWeight: 500 }}>Never — prohibited by the product</dd>
            </div>
          </dl>
        </Card>
      ) : (
        <Notice tone="warn">
          <p style={{ marginBottom: 0 }}>
            {archive.subjectDisplayName} has not set any permissions yet, so nothing is visible to
            anyone.
          </p>
        </Notice>
      )}
    </div>
  );
}
