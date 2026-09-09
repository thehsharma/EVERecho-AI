import Link from 'next/link';
import { ButtonLink, Card, Notice } from '@/components/ui';
import { optionalUser, productMeta } from '@/lib/server';

export default async function LandingPage() {
  const [meta, me] = await Promise.all([productMeta(), optionalUser()]);

  return (
    <div className="stack-lg">
      <section className="narrow" style={{ paddingTop: '1rem' }}>
        <h1>Keep their stories, in their own words.</h1>
        <p style={{ fontSize: '1.1875rem' }}>
          {meta.productName} turns a consenting living person’s recorded stories and chosen
          photographs into a private family timeline, a short biography and an archive you can
          actually search — where every AI-assisted answer shows you the recording it came from.
        </p>
        <div className="row" style={{ marginTop: '1.5rem' }}>
          {me ? (
            <ButtonLink href="/archives" variant="primary" size="lg">
              Go to your archives
            </ButtonLink>
          ) : (
            <ButtonLink href="/sign-up" variant="primary" size="lg">
              Start a private archive
            </ButtonLink>
          )}
          <ButtonLink href="/how-it-works" size="lg">
            See how it works
          </ButtonLink>
        </div>
      </section>

      {/*
        Stated on the first screen, not buried in a policy. Someone arriving here
        after a diagnosis needs to know within ten seconds what this is not.
      */}
      <section className="narrow">
        <Notice tone="info" title="What this is not">
          <p style={{ marginBottom: 0 }}>
            {meta.productName} does not clone anyone’s voice, generate a likeness, or answer as the
            person. It will not pretend to be them after they die, and it will not invent a memory
            to fill a gap. When there is no evidence for an answer, it says so.
          </p>
        </Notice>
      </section>

      <section className="grid">
        <Card>
          <h2>They stay in charge</h2>
          <p>
            The person whose life it is decides everything: what is recorded, what is skipped, who
            can see it, and whether any of it continues to exist. Buying an archive for someone does
            not give you authority over it.
          </p>
        </Card>
        <Card>
          <h2>Every answer shows its source</h2>
          <p>
            Ask a question and you get the passage it came from — the moment in the recording, the
            page of the letter. You can open it and read the original for yourself.
          </p>
        </Card>
        <Card>
          <h2>It admits what it does not know</h2>
          <p>
            No evidence, no answer. Gaps are shown as gaps, and two recordings that disagree are
            shown as disagreeing rather than quietly reconciled.
          </p>
        </Card>
      </section>

      <section className="narrow card">
        <h2>How it usually goes</h2>
        <ol className="stack">
          <li>Someone in the family starts an archive and invites the person it is about.</li>
          <li>
            That person reads what it involves, answers a few questions about how it works, and
            decides for themselves. They can decline privately.
          </li>
          <li>They record stories at their own pace, one gentle question at a time.</li>
          <li>They review everything before any of it becomes part of the archive.</li>
          <li>They choose who else may read it, and can change their mind later.</li>
        </ol>
        <p style={{ marginBottom: 0 }}>
          <Link href="/how-it-works">The longer version</Link>
          {meta.features.demoMode ? (
            <>
              {' · '}
              <Link href="/demo">Look around a demonstration archive</Link>
            </>
          ) : null}
        </p>
      </section>
    </div>
  );
}
