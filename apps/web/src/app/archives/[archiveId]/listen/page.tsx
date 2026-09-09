import type { Archive } from '@everecho/contracts';
import { VoicePlayer } from '@/components/voice-player';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Listen' };

export default async function ListenPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Listen"
        lede={`Their own voice, from their own recordings. Nothing here is generated, and nothing is edited.`}
      />
      <VoicePlayer archiveId={archiveId} subjectName={archive.subjectDisplayName} />
    </div>
  );
}
