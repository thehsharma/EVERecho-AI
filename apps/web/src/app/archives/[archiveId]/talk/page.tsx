import Link from 'next/link';
import type { Archive, LearningPolicy, LearningPolicyDocument } from '@everecho/contracts';
import { Card, Notice, PageHeader } from '@/components/ui';
import { StartConversation } from '@/components/start-conversation';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Talk' };

/**
 * The setup screen, before anything is listening.
 *
 * Deliberately a separate step from the conversation itself: a person should
 * know what is about to be kept before a microphone is on, not discover it
 * afterwards.
 */
export default async function TalkPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);

  let policy: LearningPolicy | null = null;
  let defaultDocument: LearningPolicyDocument | null = null;
  try {
    const response = await serverFetch<{
      policy: LearningPolicy | null;
      defaultDocument: LearningPolicyDocument;
    }>(`/v1/archives/${archiveId}/learning-policy`);
    policy = response.policy;
    defaultDocument = response.defaultDocument;
  } catch {
    // A reader who cannot see the policy can still hold a conversation; the
    // server decides what it may do.
  }

  const canInterview = archive.viewerCapabilities.includes('realtime.interview.start');
  const canAssist = archive.viewerCapabilities.includes('realtime.assistant.start');

  return (
    <div className="stack-lg">
      <PageHeader
        title="Talk with EverEcho"
        lede="Speak naturally, or type. You can interrupt, pause or stop at any moment, and you never have to say why."
      />

      <Notice tone="info" title="You are talking to an AI assistant">
        <p style={{ marginBottom: 0 }}>
          This is EverEcho’s AI assistant. It can help record and explore authorised memories. It is
          not {archive.subjectDisplayName}, it does not use their voice, and it will not answer as
          them.
        </p>
      </Notice>

      {policy === null && canInterview ? (
        <Notice tone="warn" title="One decision first">
          <p>
            Before any conversation happens, {archive.subjectDisplayName} needs to say what talking
            may be used for — whether the words are kept, and whether stories may be suggested.
          </p>
          <Link className="btn btn-primary" href={`/archives/${archiveId}/learning`}>
            Decide what a conversation may be used for
          </Link>
        </Notice>
      ) : null}

      {policy ? (
        <Card>
          <h2>What this conversation will do</h2>
          <ul>
            <li>
              {policy.document.transcriptRetention === 'ephemeral'
                ? 'The words are shown as captions and never written down.'
                : policy.document.transcriptRetention === 'session'
                  ? 'The transcript is kept for this conversation only.'
                  : policy.document.transcriptRetention === '30_days'
                    ? 'The transcript is kept for thirty days.'
                    : 'The transcript is kept until it is deleted.'}
            </li>
            <li>
              {policy.document.audioRetention === 'never'
                ? 'The recording itself is not kept.'
                : policy.document.audioRetention === 'session'
                  ? 'The recording is discarded when the conversation ends.'
                  : 'The recording is kept as part of the archive.'}
            </li>
            <li>
              {policy.document.candidateExtraction
                ? 'Stories may be suggested afterwards, and nothing is added without review.'
                : 'No stories will be suggested.'}
            </li>
            <li>
              {policy.document.providerProcessing.mode === 'local_only'
                ? 'Nothing said here leaves EverEcho.'
                : 'Named providers may help with transcription or speech.'}
            </li>
          </ul>
          <Link className="btn btn-quiet small" href={`/archives/${archiveId}/learning`}>
            Change any of this
          </Link>
        </Card>
      ) : null}

      <StartConversation
        archiveId={archiveId}
        subjectName={archive.subjectDisplayName}
        canInterview={canInterview}
        canAssist={canAssist}
        ready={policy !== null || defaultDocument === null}
      />
    </div>
  );
}
