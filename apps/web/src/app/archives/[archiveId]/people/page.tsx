import { Card, Empty, PageHeader, Tag } from '@/components/ui';
import { serverFetch } from '@/lib/server';
import type { Entity, Relationship } from '@everecho/contracts';

export const metadata = { title: 'People' };

export default async function PeoplePage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const { entities, relationships } = await serverFetch<{
    entities: Entity[];
    relationships: Relationship[];
  }>(`/v1/archives/${archiveId}/people`);

  return (
    <div className="stack-lg">
      <PageHeader
        title="People, places and things"
        lede="Names that came up in the stories. Nothing here was looked up anywhere else."
      />

      {entities.length === 0 ? (
        <Empty title="No names picked up yet">
          <p style={{ marginBottom: 0 }}>These appear as stories are recorded and approved.</p>
        </Empty>
      ) : (
        <Card>
          <ul className="list-plain">
            {entities.map((entity) => (
              <li
                key={entity.id}
                className="spread"
                style={{ borderBottom: '1px solid var(--line)', paddingBottom: '0.6rem' }}
              >
                <div>
                  <strong>{entity.name}</strong>{' '}
                  {entity.status === 'candidate' ? <Tag kind="draft">Not yet confirmed</Tag> : null}
                  {entity.aliases.length > 0 ? (
                    <div className="small muted">also called {entity.aliases.join(', ')}</div>
                  ) : null}
                </div>
                <span className="muted small">
                  in {entity.mentionCount} {entity.mentionCount === 1 ? 'story' : 'stories'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {relationships.length > 0 ? (
        <Card>
          <h2>How they are connected</h2>
          <ul className="list-plain">
            {relationships.map((relationship) => (
              <li key={relationship.id}>
                {relationship.fromEntityName} <span className="muted">— {relationship.kind} —</span>{' '}
                {relationship.toEntityName}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
