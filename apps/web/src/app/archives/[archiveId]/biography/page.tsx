import { Card, Empty, Notice, PageHeader, Tag } from '@/components/ui';
import { BiographyActions, BiographySection } from '@/components/biography';
import { serverFetch } from '@/lib/server';
import type { Archive, Biography } from '@everecho/contracts';

export const metadata = { title: 'Biography' };

export default async function BiographyPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const [archive, { biography }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ biography: Biography | null }>(`/v1/archives/${archiveId}/biography`),
  ]);

  const canGenerate = archive.viewerCapabilities.includes('biography.generate');
  const canEdit = archive.viewerCapabilities.includes('biography.update');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Biography"
        lede={`A short life of ${archive.subjectDisplayName}, drafted from approved stories.`}
        actions={canGenerate ? <BiographyActions archiveId={archiveId} hasDraft={Boolean(biography)} /> : undefined}
      />

      <Notice tone="info" title="This is AI-assisted, and it is a draft">
        <p style={{ marginBottom: 0 }}>
          Every sentence is assembled from stories {archive.subjectDisplayName} approved, written in
          the third person. It is not their voice and does not claim to be. Nothing here was
          invented — where the archive is silent, the draft is silent too.
        </p>
      </Notice>

      {!biography ? (
        <Empty title="No draft yet">
          <p style={{ marginBottom: 0 }}>
            {canGenerate
              ? 'Approve a few stories, then draft a biography from them.'
              : 'A draft will appear here once one has been written.'}
          </p>
        </Empty>
      ) : (
        <>
          <p className="row small muted">
            <Tag kind="ai">AI-assisted</Tag>
            <Tag>{biography.wordCount} words</Tag>
            <Tag>{biography.status === 'edited' ? 'Edited by the storyteller' : 'Draft'}</Tag>
            <span>
              Composed by {biography.modelVersion} using prompt {biography.promptVersion}, under
              consent {biography.policyVersion}.
            </span>
          </p>

          {biography.sections.map((section) => (
            <Card key={section.id}>
              <BiographySection
                archiveId={archiveId}
                section={section}
                canEdit={canEdit}
              />
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
