import Link from 'next/link';
import { Card, Notice, PageHeader } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'Demonstration archive' };

const ACCOUNTS = [
  { role: 'The storyteller', email: 'kamala@everecho.example', sees: 'Everything, including drafts waiting for review' },
  { role: 'Who set it up', email: 'anil@everecho.example', sees: 'Membership and billing — no memories, unless named as a recipient' },
  { role: 'A family member', email: 'anjali@everecho.example', sees: 'Approved stories, the timeline, and cited answers' },
  { role: 'A contributor', email: 'ravi@everecho.example', sees: 'The same, plus the ability to suggest corrections' },
  { role: 'Support', email: 'support@everecho.example', sees: 'Operational metadata only, never content' },
];

export default async function DemoPage() {
  const meta = await productMeta();

  return (
    <div className="narrow stack-lg">
      <PageHeader
        title="Look around a demonstration archive"
        lede="Sign in as different people to see how differently the same archive appears."
      />

      <Notice tone="info" title="Everything here is invented">
        <p style={{ marginBottom: 0 }}>
          Kamala Deshpande and her family do not exist. Every recording, letter and date was written
          for this demonstration. No real personal data is included anywhere in {meta.productName}.
        </p>
      </Notice>

      <Card>
        <h2>Accounts</h2>
        <p className="small muted">
          All of them use the password <code>demo-passphrase-2026</code>. Run{' '}
          <code>pnpm db:seed</code> first if they do not work.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Who</th>
                <th scope="col">Email</th>
                <th scope="col">What they can see</th>
              </tr>
            </thead>
            <tbody>
              {ACCOUNTS.map((account) => (
                <tr key={account.email}>
                  <th scope="row">{account.role}</th>
                  <td><code className="small">{account.email}</code></td>
                  <td className="small">{account.sees}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <h2>Worth trying</h2>
        <ul className="stack">
          <li>
            As the family member, ask <em>“Where did the family move to?”</em> and open a citation.
          </li>
          <li>
            Then ask <em>“Did they have money troubles?”</em> — Kamala marked money off-limits, and
            you will be told so rather than worked around.
          </li>
          <li>
            Ask <em>“What did she think about the 1983 cricket world cup?”</em> and watch it decline
            to invent an answer.
          </li>
          <li>
            Ask it to <em>“answer as my mother would”</em> and see what it says instead.
          </li>
          <li>
            As Kamala, look at the review queue and at the two recordings that disagree about a year.
          </li>
          <li>
            As Kamala, withdraw the family member’s access, then reload their page.
          </li>
        </ul>
        <p style={{ marginBottom: 0 }}>
          <Link href="/sign-in">Sign in to begin</Link>
        </p>
      </Card>
    </div>
  );
}
