import Link from 'next/link';
import { Card, Notice } from '@/components/ui';
import { InvitationResponse } from '@/components/invitation-response';
import { API_URL } from '@/lib/api';
import { optionalUser, productMeta } from '@/lib/server';

export const metadata = { title: 'An invitation' };

interface Preview {
  invitationId: string;
  role: string;
  archiveName: string;
  subjectDisplayName: string;
  invitedByDisplayName: string;
  personalNote: string | null;
  expiresAt: string;
  productName: string;
  requiresTeachBack: boolean;
}

const CONSENT_POINTS = [
  'This archive is about you, and you are in charge of it.',
  'You choose what to record. Any question can be skipped.',
  'You choose who can see what — one person at a time, starting from nobody.',
  'Every AI-assisted answer shows the recording or document it came from.',
  'The AI will never copy your voice, appear as you, or invent things you did not say.',
  'You can change your mind, take access away, export everything, or delete it all.',
  'You can decline this invitation privately. We will not tell the person who invited you why.',
];

export default async function InvitationPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [meta, me] = await Promise.all([productMeta(), optionalUser()]);

  // Fetched without credentials: an invitation link must be readable before
  // signing in, and must disclose nothing about the archive's contents.
  const response = await fetch(`${API_URL}/v1/invitations/${encodeURIComponent(token)}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    return (
      <div className="narrow stack">
        <h1>This link is no longer valid</h1>
        <Notice tone="warn">
          <p style={{ marginBottom: 0 }}>
            Invitation links expire, and they stop working once they have been answered or
            withdrawn. If you think this is a mistake, ask the person who sent it to send another.
          </p>
        </Notice>
      </div>
    );
  }

  const invitation = (await response.json()) as Preview;
  const isStoryteller = invitation.role === 'storyteller';

  return (
    <div className="narrow stack-lg">
      <div>
        <h1>
          {invitation.invitedByDisplayName} has invited you
          {isStoryteller ? ' to record your stories' : ` to ${invitation.archiveName}`}
        </h1>
        <p className="muted">
          {isStoryteller
            ? 'Nothing has been recorded, and nothing happens unless you decide it should.'
            : `An archive about ${invitation.subjectDisplayName}.`}
        </p>
      </div>

      {invitation.personalNote ? (
        <Card>
          <h2 style={{ fontSize: '1rem' }}>They wrote:</h2>
          <blockquote className="quote">{invitation.personalNote}</blockquote>
        </Card>
      ) : null}

      {isStoryteller ? (
        <Card>
          <h2>Before you decide</h2>
          <ul className="stack" style={{ paddingLeft: '1.2rem' }}>
            {CONSENT_POINTS.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </Card>
      ) : (
        <Notice tone="info">
          <p style={{ marginBottom: 0 }}>
            {invitation.subjectDisplayName} decides what you can see, and can change or withdraw
            that at any time. What you can read here is their choice, not ours.
          </p>
        </Notice>
      )}

      {me ? (
        <Card>
          <InvitationResponse
            token={token}
            role={invitation.role}
            requiresTeachBack={invitation.requiresTeachBack}
          />
        </Card>
      ) : (
        <Notice tone="info" title="Sign in to answer">
          <p style={{ marginBottom: 0 }}>
            This invitation was sent to a particular email address. Please{' '}
            <Link href={`/sign-in?next=/invitations/${encodeURIComponent(token)}`}>sign in</Link> or{' '}
            <Link href={`/sign-up?next=/invitations/${encodeURIComponent(token)}`}>
              create an account
            </Link>{' '}
            with that address to answer it.
          </p>
        </Notice>
      )}

      <p className="small muted">
        This invitation expires on {new Date(invitation.expiresAt).toLocaleDateString()}. Read more
        about <Link href="/trust">how {meta.productName} handles consent</Link>.
      </p>
    </div>
  );
}
