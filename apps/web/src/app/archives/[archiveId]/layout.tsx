import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiRequestError } from '@/lib/api';
import { requireUser, serverFetch } from '@/lib/server';
import type { Archive } from '@everecho/contracts';
import { ArchiveNav } from '@/components/archive-nav';

export default async function ArchiveLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  await requireUser(`/archives/${archiveId}`);

  let archive: Archive;
  try {
    archive = await serverFetch<Archive>(`/v1/archives/${archiveId}`);
  } catch (error) {
    // The API reports an archive the caller has no relationship with as
    // missing, and so does this page — a "forbidden" screen would confirm the
    // archive exists to anyone who guessed the URL.
    if (error instanceof ApiRequestError && (error.status === 404 || error.status === 403)) {
      notFound();
    }
    throw error;
  }

  return (
    <div className="stack">
      <nav aria-label="Breadcrumb" className="small">
        <Link href="/archives">Your archives</Link> <span aria-hidden="true">›</span>{' '}
        <span>{archive.name}</span>
      </nav>

      <div className="archive-layout">
        <ArchiveNav archive={archive} />
        <div>{children}</div>
      </div>
    </div>
  );
}
