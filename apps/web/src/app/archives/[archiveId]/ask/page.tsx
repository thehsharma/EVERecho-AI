import { Notice, PageHeader } from '@/components/ui';
import { AskPanel } from '@/components/ask-panel';
import { serverFetch } from '@/lib/server';
import type { Archive } from '@everecho/contracts';

export const metadata = { title: 'Ask a question' };

export default async function AskPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);

  return (
    <div className="stack-lg">
      <PageHeader
        title={`Ask about ${archive.subjectDisplayName}`}
        lede="Answers come only from what they actually said, and every part shows you where it came from."
      />

      <Notice tone="info" title="What this can and cannot do">
        <p style={{ marginBottom: 0 }}>
          This searches {archive.subjectDisplayName}’s own recordings and documents and tells you
          what they said. It will not answer as them, guess what they might have thought, or fill in
          a gap. When the archive does not support an answer, it says so.
        </p>
      </Notice>

      <AskPanel archiveId={archiveId} subjectName={archive.subjectDisplayName} />
    </div>
  );
}
