import type { Archive, Memory, RemembranceDirective } from '@everecho/contracts';
import { RemembranceDirectiveEditor } from '@/components/remembrance-directive';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'After' };

export default async function RemembrancePage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const [archive, { directive }, { memories }, { members }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ directive: RemembranceDirective | null }>(
      `/v1/archives/${archiveId}/remembrance`,
    ),
    serverFetch<{ memories: Memory[] }>(`/v1/archives/${archiveId}/memories?status=approved`),
    serverFetch<{ members: { userId: string; displayName: string; role: string }[] }>(
      `/v1/archives/${archiveId}/members`,
    ),
  ]);

  const isStoryteller = archive.viewerRole === 'storyteller';

  return (
    <div className="stack-lg">
      <PageHeader
        title="After"
        lede={
          isStoryteller
            ? 'What your family may hear once you are gone, and what stays with you. None of it changes anything now.'
            : `What ${archive.subjectDisplayName} decided about what happens afterwards.`
        }
      />
      <RemembranceDirectiveEditor
        archiveId={archiveId}
        directive={directive}
        memories={memories.map((m) => ({ id: m.id, title: m.title }))}
        // The storyteller is not an audience for their own directive.
        people={members
          .filter((m) => m.role !== 'storyteller')
          .map((m) => ({ userId: m.userId, displayName: m.displayName }))}
      />
    </div>
  );
}
