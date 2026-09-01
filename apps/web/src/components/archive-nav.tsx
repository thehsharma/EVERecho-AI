'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Archive } from '@everecho/contracts';

interface Item {
  href: string;
  label: string;
  /** Shown only when the caller's role includes this capability. */
  requires?: string;
}

interface Group {
  heading: string;
  items: Item[];
}

/**
 * The navigation is built from the capabilities the API reported for this
 * caller, so people are not shown doors that will not open. It is a courtesy,
 * not a control: every route re-checks server-side regardless.
 */
function groupsFor(): Group[] {
  return [
    {
      heading: 'The archive',
      items: [
        { href: '', label: 'Overview' },
        { href: '/timeline', label: 'Timeline', requires: 'timeline.read' },
        { href: '/biography', label: 'Biography', requires: 'biography.read' },
        { href: '/people', label: 'People', requires: 'entity.read' },
        { href: '/ask', label: 'Ask a question', requires: 'question.ask' },
        { href: '/talk', label: 'Talk out loud', requires: 'realtime.session.read' },
      ],
    },
    {
      heading: 'Recording',
      items: [
        { href: '/interview', label: 'Guided interview', requires: 'interview.start' },
        { href: '/sources', label: 'Uploads', requires: 'source.read' },
        { href: '/memories', label: 'Review stories', requires: 'memory.read' },
        {
          href: '/learned',
          label: 'What was learned',
          requires: 'learning.candidate.read',
        },
      ],
    },
    {
      heading: 'Control',
      items: [
        { href: '/consent', label: 'Permissions', requires: 'consent.read' },
        {
          href: '/learning',
          label: 'Talking & learning',
          requires: 'learning.policy.read',
        },
        { href: '/members', label: 'People with access', requires: 'membership.read' },
        { href: '/consent/history', label: 'Consent history', requires: 'consent.history.read' },
        { href: '/audit', label: 'Activity', requires: 'audit.read' },
        { href: '/succession', label: 'Continuity', requires: 'succession.read' },
      ],
    },
    {
      heading: 'Your data',
      items: [
        { href: '/export', label: 'Export everything', requires: 'export.read' },
        { href: '/delete', label: 'Delete', requires: 'deletion.read' },
      ],
    },
  ];
}

export function ArchiveNav({ archive }: { archive: Archive }) {
  const pathname = usePathname();
  const base = `/archives/${archive.id}`;
  const can = (capability?: string) =>
    !capability || archive.viewerCapabilities.includes(capability);

  return (
    <nav className="archive-nav" aria-label="Archive sections">
      <p className="small muted" style={{ marginBottom: '0.5rem' }}>
        {archive.subjectDisplayName}
      </p>
      {groupsFor().map((group) => {
        const items = group.items.filter((item) => can(item.requires));
        if (items.length === 0) return null;
        return (
          <div key={group.heading}>
            <h2>{group.heading}</h2>
            <ul>
              {items.map((item) => {
                const href = `${base}${item.href}`;
                const active = pathname === href;
                return (
                  <li key={href}>
                    <Link href={href} aria-current={active ? 'page' : undefined}>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
