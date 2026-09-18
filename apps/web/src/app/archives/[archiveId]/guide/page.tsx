import Link from 'next/link';
import { serverFetch } from '@/lib/server';
import type { Archive, Memory } from '@everecho/contracts';
import { PageHeader, Card } from '@/components/ui';
export const metadata = { title: 'Family memory guide' };
export default async function Page({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const archive = await serverFetch<Archive>('/v1/archives/' + archiveId);
  const can = (c: string) => archive.viewerCapabilities.includes(c);
  const base = '/archives/' + archiveId;
  const stories = can('memory.read')
    ? await serverFetch<{ memories: Memory[]; candidateCount: number }>(
        '/v1/archives/' + archiveId + '/memories?limit=100',
      )
    : null;
  const steps: [string, string, string, string, string][] = [
    [
      'interview.start',
      'Record a first story',
      'One question at a time. Listen back, correct an optional transcript, and save when ready.',
      '/interview',
      'Start recording',
    ],
    [
      'memory.read',
      'Review before sharing',
      'Approve stories individually. Keep original accounts separate from generated dialogue.',
      '/memories',
      'Review stories',
    ],
    [
      'memory.read',
      'Explore and make a keepsake',
      'Search approved stories by person or place. Choose a collection to download if you have export permission.',
      '/explore',
      'Explore stories',
    ],
    [
      'familyQuestion.create',
      'Ask a relative to tell you more',
      'Send a question through the archive. The storyteller chooses when and whether to answer.',
      '/questions',
      'Write a question',
    ],
    [
      'contribution.create',
      'Add your account',
      'Suggest a memory or correction for review. Your contribution does not overwrite someone else’s account.',
      '/contribute',
      'Suggest a contribution',
    ],
    [
      'membership.read',
      'Review family access',
      'Choose who participates without giving the payer automatic access to stories.',
      '/members',
      'Review members',
    ],
    [
      'export.read',
      'Keep an independent backup',
      'Export originals, transcripts, and provenance. Keep the downloaded copy somewhere private and verify the export manifest.',
      '/export',
      'Open exports',
    ],
    [
      'succession.read',
      'Record continuity wishes',
      'Review the existing continuity controls and their stated limits. These settings do not replace legal documents.',
      '/succession',
      'Review continuity',
    ],
    [
      'remembrance.read',
      'Choose what happens afterward',
      'Review the storyteller’s after-death preferences. Simulation remains a separate, optional local experiment.',
      '/remembrance',
      'Review preferences',
    ],
    [
      'deletion.read',
      'Manage removal',
      'Review what deletion covers and track its completion.',
      '/delete',
      'Manage deletion',
    ],
  ];
  return (
    <div className="stack-lg">
      <PageHeader
        title={archive.subjectDisplayName + ' — your family guide'}
        lede="A practical path from the first recording to a collection you can keep."
      />
      {stories && (
        <Card>
          <h2>Your story collection</h2>
          <p>
            {stories.memories.length === 100 ? '100+' : stories.memories.length} approved stories
            loaded
            {archive.viewerRole === 'storyteller'
              ? ' · ' + stories.candidateCount + ' drafts awaiting review'
              : ''}
            .
          </p>
          <p className="small muted">
            These are archive counts, not a score or a deadline. Every family can take its own pace.
          </p>
        </Card>
      )}
      {steps
        .filter(([cap]) => can(cap!))
        .map(([cap, title, description, path, label]) => (
          <Card key={cap + path}>
            <h2>{title}</h2>
            <p>{description}</p>
            <Link href={base + path}>{label}</Link>
          </Card>
        ))}
      <Card>
        <h2>Need to change permissions?</h2>
        <p>
          The guide only shows actions available to your role. The storyteller’s consent is checked
          again whenever you open or change material.
        </p>
        <Link href={base}>Return to archive overview</Link>
      </Card>
    </div>
  );
}
