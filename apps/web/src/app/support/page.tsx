import { Card, Notice } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'Support' };

export default async function SupportPage() {
  const meta = await productMeta();

  return (
    <div className="narrow stack-lg">
      <h1>Support</h1>

      {/*
        First on the page and anchored, because somebody arriving from the
        footer link followed the words "if you need help now" and should not
        have to read about data retention on the way.
      */}
      <Card id="help-now">
        <h2>If you or someone else is in danger</h2>
        <p>
          {meta.productName} is not a crisis service and cannot help in an emergency. If anyone is
          at risk right now, contact your local emergency services. In{' '}
          {meta.jurisdiction === 'IN'
            ? 'India, Tele-MANAS is 14416 and emergency services are 112'
            : 'your region, contact your local emergency number'}
          .
        </p>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Nothing you do here is watched for signs of distress. This link is on every page because
          it should be, not because of anything you said or typed.
        </p>
      </Card>

      <Card>
        <h2>Getting help</h2>
        <p>
          Write to <a href={`mailto:${meta.supportEmail}`}>{meta.supportEmail}</a>. Please do not
          include memories, transcripts or family details in an email — we do not need them, and an
          inbox is not the right place for them.
        </p>
        <p style={{ marginBottom: 0 }}>
          If you can, include the request ID shown on any error message. It lets us find what
          happened without looking at your archive.
        </p>
      </Card>

      <Notice tone="info" title="What support staff can and cannot see">
        <p>
          Support can see operational information — how many files an archive holds, whether
          processing failed, when something last happened. They cannot read memories, transcripts or
          filenames.
        </p>
        <p style={{ marginBottom: 0 }}>
          Reaching even that much for a specific archive requires a time-limited grant tied to a
          stated reason, and it is written into that archive’s own history, where the storyteller
          can see it.
        </p>
      </Notice>
    </div>
  );
}
