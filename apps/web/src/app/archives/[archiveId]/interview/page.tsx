import { Notice, PageHeader } from '@/components/ui';
import { InterviewPanel } from '@/components/interview-panel';
import { serverFetch } from '@/lib/server';
import type { Archive } from '@everecho/contracts';

export const metadata = { title: 'Guided interview' };

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);

  return (
    <div className="stack-lg" style={{ maxWidth: '46rem' }}>
      <PageHeader
        title="Tell me a story"
        lede="One question at a time, at whatever pace suits you."
      />

      <Notice tone="info" title="You are in charge of this">
        <p style={{ marginBottom: 0 }}>
          Skip anything you would rather not answer. Stop whenever you like — everything you have
          said is saved, and you can come back another day. Nothing you say here becomes part of the
          archive until you have read it back and approved it.
        </p>
      </Notice>

      <InterviewPanel archiveId={archiveId} subjectName={archive.subjectDisplayName} />
    </div>
  );
}
