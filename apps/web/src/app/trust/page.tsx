import Link from 'next/link';
import { Card, Notice } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'Trust, consent and provenance' };

export default async function TrustPage() {
  const meta = await productMeta();

  return (
    <div className="narrow stack-lg">
      <div>
        <h1>Trust, consent and provenance</h1>
        <p className="muted">What we do with a person’s memories, and what we will not do.</p>
      </div>

      <Card>
        <h2>Consent is not a checkbox</h2>
        <p>
          Before anything is recorded, the storyteller answers a short set of questions in their own
          words about what this is and what it is not. It is not a test to be passed quickly — it is
          how we find out whether they actually understand what they are agreeing to.
        </p>
        <p>Their consent covers each of these separately, and each can be withdrawn:</p>
        <ul>
          <li>which kinds of material may be held at all</li>
          <li>whether recordings may be transcribed, and documents read</li>
          <li>whether the archive may be indexed for search</li>
          <li>whether text may be composed from it</li>
          <li>whether an external provider may process any of it, and for how long</li>
          <li>who may see what, at what level of privacy, and for how long</li>
          <li>which topics are off-limits entirely</li>
          <li>whether specific recordings are excluded from processing</li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          Every change writes a new version. Nothing is overwritten, so “what had they agreed to in
          March?” is always answerable.
        </p>
      </Card>

      <Card>
        <h2>Where an answer comes from</h2>
        <p>
          Every claim carries a class that says how well supported it is, and nothing weaker than
          these three ever reaches a reader:
        </p>
        <ul>
          <li>
            <strong>Said directly</strong> — the storyteller said this, in these words.
          </li>
          <li>
            <strong>Two sources agree</strong> — two independent recordings or documents say it.
          </li>
          <li>
            <strong>Drawn from the sources</strong> — a restatement that stays inside what the
            evidence supports.
          </li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          A model’s guess is never shown to a family member, and simulated speech is not a thing
          this product can produce.
        </p>
      </Card>

      <Notice tone="danger" title="Permanently out of scope">
        <p>
          Voice cloning, face cloning, avatars, lip-synced video, first-person chat as the person,
          and any continuation of them after death are prohibited in {meta.productName} v0.1. They
          are refused by configuration, by the consent engine, by the database and by the code that
          composes answers — not by policy alone.
        </p>
        <p style={{ marginBottom: 0 }}>
          An archive is also never handed on automatically because someone stopped logging in.
        </p>
      </Notice>

      <Card>
        <h2>Leaving</h2>
        <p>
          The storyteller can export everything at any time — the original files, the transcripts,
          the story cards, the evidence behind each one, the permission history, and a checksum for
          every file. It is a plain .zip that opens without us.
        </p>
        <p style={{ marginBottom: 0 }}>
          They can also delete the archive. Deletion removes the records, the search indexes, the
          stored files and the generated answers. One thing is deliberately kept: an entry recording
          that the deletion happened, because proving it happened requires that.
        </p>
      </Card>

      <p className="small muted">
        Legal wording is version {meta.legalCopyVersion} and is a draft pending review by qualified
        counsel in India, the EU, the UK and the US. Technical safeguards described here are not a
        legal certification. Questions: <Link href="/support">support</Link>.
      </p>
    </div>
  );
}
