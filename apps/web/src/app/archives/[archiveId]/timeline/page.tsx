import Link from 'next/link';
import {
  ApproximateDate,
  Card,
  Empty,
  EvidenceClassTag,
  Notice,
  PageHeader,
} from '@/components/ui';
import { serverFetch } from '@/lib/server';
import type { Timeline } from '@everecho/contracts';

export const metadata = { title: 'Timeline' };

export default async function TimelinePage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const { timeline } = await serverFetch<{ timeline: Timeline | null }>(
    `/v1/archives/${archiveId}/timeline`,
  );

  if (!timeline || (timeline.entries.length === 0 && timeline.undatedEntries.length === 0)) {
    return (
      <div className="stack-lg">
        <PageHeader title="Timeline" />
        <Empty title="There is nothing on the timeline yet">
          <p style={{ marginBottom: 0 }}>
            Stories appear here once they have been approved and have a date attached.
          </p>
        </Empty>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title="Timeline"
        lede={
          timeline.coverage.earliestYear
            ? `From ${timeline.coverage.earliestYear} to ${timeline.coverage.latestYear}.`
            : undefined
        }
      />

      {timeline.coverage.decadeGaps.length > 0 ? (
        <Notice tone="info" title="Decades with nothing in them">
          <p style={{ marginBottom: 0 }}>
            There is nothing recorded from the{' '}
            {timeline.coverage.decadeGaps.map((decade) => `${decade}s`).join(', ')}. We have left
            these blank rather than guessing — they might be worth asking about.
          </p>
        </Notice>
      ) : null}

      <ol className="list-plain">
        {timeline.entries.map((entry) => (
          <li key={entry.id}>
            <Card>
              <div className="spread">
                <h2 style={{ fontSize: '1.0625rem', marginBottom: '0.25rem' }}>
                  <Link href={`/archives/${archiveId}/memories/${entry.memoryId ?? entry.id}`}>
                    {entry.title}
                  </Link>
                </h2>
                <span className="muted small">
                  <ApproximateDate value={entry.date} />
                  {entry.placeName ? ` · ${entry.placeName}` : ''}
                </span>
              </div>
              <p style={{ marginBottom: '0.5rem' }}>{entry.summary}</p>
              <EvidenceClassTag evidenceClass={entry.evidenceClass} />
            </Card>
          </li>
        ))}
      </ol>

      {timeline.undatedEntries.length > 0 ? (
        <Card>
          <h2>Stories with no date yet</h2>
          <p className="muted small">
            These are not placed on the timeline because nobody said when they happened. Guessing a
            year would make the timeline look tidier and be less true.
          </p>
          <ul className="list-plain">
            {timeline.undatedEntries.map((entry) => (
              <li key={entry.id}>
                <Link href={`/archives/${archiveId}/memories/${entry.memoryId ?? entry.id}`}>
                  {entry.title}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
