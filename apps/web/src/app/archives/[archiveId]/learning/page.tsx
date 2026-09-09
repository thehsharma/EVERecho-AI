import type { LearningPolicy, LearningPolicyDocument } from '@everecho/contracts';
import { LearningPolicyEditor } from '@/components/learning-policy-editor';
import { Notice, PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'What talking may be used for' };

export default async function LearningPolicyPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const { policy, defaultDocument } = await serverFetch<{
    policy: LearningPolicy | null;
    defaultDocument: LearningPolicyDocument;
  }>(`/v1/archives/${archiveId}/learning-policy`);

  return (
    <div className="stack-lg">
      <PageHeader
        title="What talking may be used for"
        lede="Separate from your permissions, which cover what you have already given us. This covers what a conversation turns into."
      />

      <Notice tone="info" title="Your permissions still come first">
        <p style={{ marginBottom: 0 }}>
          Nothing here can widen what you have already allowed. If you have not permitted something
          on the Permissions screen, switching it on here does nothing.
        </p>
      </Notice>

      <LearningPolicyEditor
        archiveId={archiveId}
        initial={policy?.document ?? defaultDocument}
        currentVersion={policy?.version ?? null}
      />
    </div>
  );
}
