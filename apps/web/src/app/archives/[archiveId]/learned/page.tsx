import type { MemoryCandidate } from '@everecho/contracts';
import { CandidateReview } from '@/components/candidate-review';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'What EverEcho learned' };

export default async function LearnedPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const { candidates } = await serverFetch<{ candidates: MemoryCandidate[] }>(
    `/v1/archives/${archiveId}/memory-candidates`,
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title="What EverEcho learned"
        lede="Suggestions from your conversations, each one showing the words it came from. Nothing here is part of the archive until you say so."
      />
      <CandidateReview archiveId={archiveId} candidates={candidates} />
    </div>
  );
}
