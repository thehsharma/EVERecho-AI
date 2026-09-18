import Link from 'next/link';
import { requireUser } from '@/lib/server';
import { Card, PageHeader } from '@/components/ui';
export const metadata = { title: 'Your family memory guide' };
export default async function Page() {
  const me = await requireUser('/start');
  return (
    <div className="stack-lg">
      <PageHeader
        title="Keep a story worth passing on"
        lede="Begin with one willing storyteller. Record, review, and make something your family can keep."
      />
      <div className="grid">
        <Card>
          <h2>Start a family-history gift</h2>
          <p>
            Create a private archive for a parent or relative. They choose whether to participate
            and what to share. You can make a personalized keepsake from approved stories.
          </p>
          <Link href="/archives/new">Set up an archive</Link>
        </Card>
        <Card>
          <h2>Capture → review → explore</h2>
          <p>
            Record one answer, listen back, approve the summary, and review the resulting draft
            stories. Then find connections and choose stories for a keepsake.
          </p>
          <Link href="/archives">Open your archives</Link>
        </Card>
      </div>
      {me.archives.map((a) => (
        <Card key={a.archiveId}>
          <h2>{a.name}</h2>
          <p>
            Your role: {a.role.replaceAll('_', ' ')}. Available steps follow the storyteller’s
            permissions.
          </p>
          <Link href={'/archives/' + a.archiveId + '/guide'}>Open this family’s guide</Link>
        </Card>
      ))}
      <Card>
        <h2>Optional memorial conversation</h2>
        <p>
          Choose whether to remember, reflect, celebrate, or simply be heard. The studio uses only
          the notes you supply and labels its replies as AI simulation.
        </p>
        <div className="row">
          <Link href="/memorial">Open memorial studio</Link>
          <Link href="/account/insights">Your conversation measurements</Link>
        </div>
      </Card>
      <Card>
        <h2>Your family stays in control</h2>
        <p>
          Share an allowance without sharing private material. Export original files and review
          continuity choices from each archive.
        </p>
        <div className="row">
          <Link href="/account/plan">Household & subscription</Link>
          <Link href="/trust">Consent and privacy</Link>
          <Link href="/account/security">Account security</Link>
        </div>
      </Card>
    </div>
  );
}
