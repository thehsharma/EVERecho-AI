import type { ReactNode } from 'react';
import Link from 'next/link';

export function Card({ children, ...rest }: { children: ReactNode; className?: string }) {
  return <section className={`card ${rest.className ?? ''}`}>{children}</section>;
}

export function Notice({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'ok' | 'warn' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  return (
    /* role="status" so assistive technology announces it without stealing focus. */
    <div className={`notice notice-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {title ? <strong>{title}</strong> : null}
      {title ? <div style={{ height: '0.35rem' }} /> : null}
      {children}
    </div>
  );
}

export function Tag({ kind, children }: { kind?: string; children: ReactNode }) {
  return <span className={`tag ${kind ? `tag-${kind}` : ''}`}>{children}</span>;
}

/**
 * Says plainly where a piece of text came from. Draft, AI-assisted, corrected
 * and approved must never look the same — a reader has to be able to tell what
 * the storyteller actually said from what a machine arranged.
 */
export function ProvenanceTag({
  status,
  aiAssisted,
  corrected,
}: {
  status?: string;
  aiAssisted?: boolean;
  corrected?: boolean;
}) {
  return (
    <span className="row" style={{ gap: '0.35rem' }}>
      {status === 'approved' ? <Tag kind="approved">Approved by the storyteller</Tag> : null}
      {status === 'candidate' ? <Tag kind="draft">Draft — not yet reviewed</Tag> : null}
      {status === 'rejected' ? <Tag kind="danger">Not included</Tag> : null}
      {aiAssisted ? <Tag kind="ai">AI-assisted</Tag> : null}
      {corrected ? <Tag kind="corrected">Corrected</Tag> : null}
    </span>
  );
}

export function EvidenceClassTag({ evidenceClass }: { evidenceClass: string }) {
  const label: Record<string, string> = {
    P0_ORIGINAL_SOURCE: 'Original recording',
    P1_DIRECT_STATEMENT: 'Said directly',
    P2_CORROBORATED_FACT: 'Two sources agree',
    P3_SUPPORTED_SYNTHESIS: 'Drawn from the sources',
  };
  return <Tag>{label[evidenceClass] ?? evidenceClass}</Tag>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--ink)' }}>{title}</p>
      {children ? <div className="small" style={{ marginTop: '0.5rem' }}>{children}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  lede,
  actions,
}: {
  title: string;
  lede?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="spread" style={{ marginBottom: '1.5rem' }}>
      <div>
        <h1 style={{ marginBottom: lede ? '0.25rem' : 0 }}>{title}</h1>
        {lede ? <p className="muted" style={{ marginBottom: 0 }}>{lede}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </header>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'default',
  size,
}: {
  href: string;
  children: ReactNode;
  variant?: 'default' | 'primary' | 'danger' | 'quiet';
  size?: 'lg';
}) {
  const classes = ['btn'];
  if (variant !== 'default') classes.push(`btn-${variant}`);
  if (size === 'lg') classes.push('btn-lg');
  return (
    <Link href={href} className={classes.join(' ')}>
      {children}
    </Link>
  );
}

export function DefinitionRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="spread" style={{ borderBottom: '1px solid var(--line)', padding: '0.6rem 0' }}>
      <dt className="muted" style={{ margin: 0 }}>
        {term}
      </dt>
      <dd style={{ margin: 0, textAlign: 'right', fontWeight: 500 }}>{children}</dd>
    </div>
  );
}

/** A date a storyteller may only half-remember, rendered at its real precision. */
export function ApproximateDate({
  value,
}: {
  value: { value: string; precision: string } | null;
}) {
  if (!value) return <span className="muted">No date recorded</span>;
  if (value.precision === 'decade') return <span>The {value.value}s</span>;
  if (value.precision === 'year') return <span>{value.value.slice(0, 4)}</span>;
  return <span>{value.value}</span>;
}
