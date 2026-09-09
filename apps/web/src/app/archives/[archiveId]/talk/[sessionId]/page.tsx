import Link from 'next/link';
import type { Archive, RealtimeSession } from '@everecho/contracts';
import { LiveConversation } from '@/components/live-conversation';
import { Notice, PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Live conversation' };

export default async function LiveSessionPage({
  params,
}: {
  params: Promise<{ archiveId: string; sessionId: string }>;
}) {
  const { archiveId, sessionId } = await params;
  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);
  const { session } = await serverFetch<{ session: RealtimeSession }>(
    `/v1/archives/${archiveId}/realtime-sessions/${sessionId}`,
  );

  if (session.endedAt) {
    return (
      <div className="stack-lg">
        <PageHeader title="This conversation has ended" />
        <Notice tone="info">
          <p style={{ marginBottom: 0 }}>
            Nothing from it was added to the archive without review.{' '}
            <Link href={`/archives/${archiveId}/learned`}>See what was suggested</Link>, or{' '}
            <Link href={`/archives/${archiveId}/talk`}>start another conversation</Link>.
          </p>
        </Notice>
      </div>
    );
  }

  return (
    <div className="stack-lg">
      <PageHeader
        title={
          session.mode === 'interview'
            ? 'Telling your stories'
            : `Asking about ${archive.subjectDisplayName}`
        }
        lede="You can interrupt, pause or stop whenever you like."
      />
      <LiveConversation
        session={session}
        subjectName={archive.subjectDisplayName}
        canReview={archive.viewerCapabilities.includes('learning.candidate.approve')}
      />
    </div>
  );
}
