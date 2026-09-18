import type { Archive, Memory, Entity, Relationship } from '@everecho/contracts';
import { serverFetch } from '@/lib/server';
import { ArchiveExplorer } from '@/components/archive-explorer';
import { PageHeader } from '@/components/ui';
export const metadata = { title: 'Explore family stories' };
export default async function Page({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const base = '/v1/archives/' + archiveId;
  const archive = await serverFetch<Archive>(base);
  const [stories, people] = await Promise.all([
    serverFetch<{ memories: Memory[] }>(base + '/memories?status=approved&limit=100'),
    archive.viewerCapabilities.includes('entity.read')
      ? serverFetch<{ entities: Entity[]; relationships: Relationship[] }>(base + '/people')
      : Promise.resolve({ entities: [], relationships: [] }),
  ]);
  return (
    <div className="stack">
      <PageHeader
        title="Explore your family stories"
        lede="Find connections, follow the evidence, and collect stories worth keeping."
      />
      <ArchiveExplorer
        archive={archive}
        memories={stories.memories}
        entities={people.entities}
        relationships={people.relationships}
      />
    </div>
  );
}
