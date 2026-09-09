import type { Archive, Memory, StoryCapsule } from '@everecho/contracts';
import { CapsuleManager } from '@/components/capsule-manager';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Capsules' };

export default async function CapsulesPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const [archive, { capsules }, { memories }, { members }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ capsules: StoryCapsule[] }>(`/v1/archives/${archiveId}/capsules`),
    serverFetch<{ memories: Memory[] }>(`/v1/archives/${archiveId}/memories?status=approved`),
    serverFetch<{ members: { userId: string; displayName: string; role: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    ),
  ]);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Capsules"
        lede="A few stories, for a few people, for as long as you choose."
      />
      <CapsuleManager
        archiveId={archiveId}
        canCreate={archive.viewerCapabilities.includes('capsule.create')}
        capsules={capsules}
        memories={memories.map((m) => ({ id: m.id, title: m.title }))}
        // The storyteller is not a recipient of their own capsule.
        recipients={members
          .filter((m) => m.role !== 'storyteller')
          .map((m) => ({ userId: m.userId, displayName: m.displayName }))}
      />
    </div>
  );
}
