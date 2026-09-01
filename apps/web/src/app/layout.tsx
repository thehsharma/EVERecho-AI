import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { optionalUser, productMeta } from '@/lib/server';

export async function generateMetadata(): Promise<Metadata> {
  const meta = await productMeta();
  return {
    title: { default: meta.productName, template: `%s · ${meta.productName}` },
    description:
      'A private, consent-first archive for a living person’s stories, where every AI-assisted answer shows its sources.',
    // The archive is private. Nothing here should ever be indexed.
    robots: { index: false, follow: false },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [meta, me] = await Promise.all([productMeta(), optionalUser()]);

  return (
    <html lang="en">
      <body>
        <div className="shell">
          <a className="skip-link" href="#main">
            Skip to the main content
          </a>
          <header className="site-header">
            <div className="container">
              <Link href="/" className="brand">
                {meta.productName}
              </Link>
              <nav className="site-nav" aria-label="Main">
                <Link href="/how-it-works">How it works</Link>
                <Link href="/trust">Trust &amp; consent</Link>
                {meta.features.billing ? <Link href="/pricing">Pilot</Link> : null}
                {me ? (
                  <>
                    <Link href="/archives">Your archives</Link>
                    <Link href="/account">Account</Link>
                  </>
                ) : (
                  <>
                    <Link href="/sign-in">Sign in</Link>
                    <Link href="/sign-up">Create an account</Link>
                  </>
                )}
              </nav>
            </div>
          </header>

          <main id="main">
            <div className="container">{children}</div>
          </main>

          <footer className="site-footer">
            <div className="container stack">
              <p style={{ marginBottom: 0 }}>
                {meta.productName} v0.1 — a working name pending trademark clearance. Data region:{' '}
                {meta.dataRegion}. Legal copy version: {meta.legalCopyVersion} (draft, pending review
                by qualified counsel).
              </p>
              <p className="small" style={{ marginBottom: 0 }}>
                {meta.productName} preserves what a living person actually said. It does not
                recreate anyone’s voice, likeness or personality, and it will not answer as them.{' '}
                <Link href="/trust">How consent works</Link> · <Link href="/support">Support</Link>
              </p>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
