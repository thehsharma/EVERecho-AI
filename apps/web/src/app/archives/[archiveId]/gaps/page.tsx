import type { MemoryGap } from '@everecho/contracts';
import { GapRadar } from '@/components/gap-radar';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Say more' };

export default async function GapsPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const { gaps } = await serverFetch<{ gaps: MemoryGap[] }>(`/v1/archives/${archiveId}/gaps`);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Say more"
        // The lede does the same job as the component's notice, because a page
        // title alone next to a list of questions reads as a to-do list.
        lede="A few places where your own words mention something without explaining it. None of this is missing — it is only somewhere you could say more if you want to."
      />
      <GapRadar archiveId={archiveId} gaps={gaps} />
    </div>
  );
}
