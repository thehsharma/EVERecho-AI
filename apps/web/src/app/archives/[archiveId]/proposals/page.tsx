import type { Archive, ContributorProposal } from '@everecho/contracts';
import { ProposalReview } from '@/components/proposal-review';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'What your family suggested' };

export default async function ProposalsPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const [archive, { proposals }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ proposals: ContributorProposal[] }>(`/v1/archives/${archiveId}/contributions`),
  ]);

  // Reported by the API, not inferred from the role here. Every decision is
  // re-checked server-side regardless; this only decides what to offer.
  const canReview = archive.viewerCapabilities.includes('contribution.approve');

  return (
    <div className="stack-lg">
      <PageHeader
        title={canReview ? 'What your family suggested' : 'Suggestions you have sent'}
        lede={
          canReview
            ? 'Each one shows how the person knows it, and what your archive says now.'
            : 'What you have offered, and what has been decided so far.'
        }
      />
      <ProposalReview archiveId={archiveId} proposals={proposals} canReview={canReview} />
    </div>
  );
}
