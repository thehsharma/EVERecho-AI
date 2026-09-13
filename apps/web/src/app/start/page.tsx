import Link from 'next/link';
import { requireUser } from '@/lib/server';
import { Card, PageHeader } from '@/components/ui';

export const metadata = { title: 'Your family memory guide' };
export default async function StartPage() {
  const me = await requireUser('/start');
  return (
    <div className="stack-lg">
      <PageHeader
        title="Make room for the stories that matter"
        lede="Start with one person and one memory. Build a private family archive at your own pace."
      />
      <Card>
        <h2>1. Create your family archive</h2>
        <p>
          Invite the person whose stories you want to preserve. They decide what can be recorded and
          shared.
        </p>
        <Link href="/archives/new">Create an archive</Link>
      </Card>
      <Card>
        <h2>2. Record, review, and share</h2>
        <p>
          Use guided interviews, upload original recordings and photos, then review memories before
          sharing them.
        </p>
        {me.archives.length ? (
          <ul>
            {me.archives.map((a) => (
              <li key={a.archiveId}>
                <Link href={`/archives/${a.archiveId}`}>{a.name}</Link> — open your archive to
                record stories, manage invitations, and review permissions.
              </li>
            ))}
          </ul>
        ) : (
          <p>Your archives will appear here once you create one or accept an invitation.</p>
        )}
      </Card>
      <Card>
        <h2>3. Explore memories with sources</h2>
        <p>
          Ask questions in your archive and follow the citations back to the original material.
          Unknown answers stay unknown.
        </p>
        <Link href="/archives">Open your archives</Link>
      </Card>
      <Card>
        <h2>4. Try an imagined conversation</h2>
        <p>
          The separate memorial studio uses the notes and personality you supply. Every AI reply is
          labeled as a simulation. Save and export your profile there.
        </p>
        <Link href="/memorial">Open memorial studio</Link>
      </Card>
      <Card>
        <h2>Your family stays in control</h2>
        <p>
          Archive settings include member access, consent, exports, and deletion. Paying for an
          archive does not give someone access to its memories.
        </p>
        <div className="memorial-actions">
          <Link href="/trust">Understand consent</Link> ·{' '}
          <Link href="/account/plan">Family subscription</Link> ·{' '}
          <Link href="/account/billing">Reservations</Link> ·{' '}
          <Link href="/account/security">Account security</Link>
        </div>
      </Card>
    </div>
  );
}
