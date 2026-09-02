import type { ContributorProposal } from '@everecho/contracts';
import { ContributionComposer } from '@/components/contribution-composer';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Add what you know' };

export default async function ContributePage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const { proposals } = await serverFetch<{ proposals: ContributorProposal[] }>(
    `/v1/archives/${archiveId}/contributions`,
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title="Add what you know"
        lede="Photographs, dates, people, corrections — or a different recollection. All of it is a suggestion the storyteller decides on."
      />
      <ContributionComposer archiveId={archiveId} proposals={proposals} />
    </div>
  );
}
