import { ButtonLink, Card, Notice } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'Pilot' };

export default async function PricingPage() {
  const meta = await productMeta();

  return (
    <div className="narrow stack-lg">
      <div>
        <h1>The pilot</h1>
        <p className="muted">
          {meta.productName} v0.1 is a validation-stage product. We are working with a small number
          of families and being honest about what that means.
        </p>
      </div>

      <Card>
        <h2>What a reservation is</h2>
        <p>
          A refundable deposit that puts you in the queue and helps us judge how many families we
          can actually support well. It is not a subscription and it is not a purchase.
        </p>
        <p>
          You can ask for it back at any time, for any reason or none. We do not ask why, and there
          is no conversation to get through first.
        </p>
        <p style={{ marginBottom: 0 }}>
          No card details ever reach us — payment is handled by a provider, and we store only their
          reference.
        </p>
      </Card>

      <Notice tone="warn" title="Be clear-eyed about the stage we are at">
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          <li>Recording and reviewing takes a storyteller real time and real energy.</li>
          <li>Some of the work behind each archive is still done by hand.</li>
          <li>Features will change, and some will be removed.</li>
          <li>
            If a person does not want this, it does not happen. Buying a place in the pilot does not
            change that.
          </li>
        </ul>
      </Notice>

      <div className="row">
        <ButtonLink href="/sign-up" variant="primary" size="lg">
          Apply for the pilot
        </ButtonLink>
        <ButtonLink href="/trust" size="lg">
          Read how consent works first
        </ButtonLink>
      </div>
    </div>
  );
}
