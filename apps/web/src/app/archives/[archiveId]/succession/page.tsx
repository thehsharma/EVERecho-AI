import { Card, Notice, PageHeader } from '@/components/ui';
import { SuccessionForm } from '@/components/succession';
import { serverFetch } from '@/lib/server';
import type { Archive, SuccessionDirective } from '@everecho/contracts';

export const metadata = { title: 'Continuity' };

export default async function SuccessionPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const [archive, { directive }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ directive: SuccessionDirective | null }>(`/v1/archives/${archiveId}/succession`),
  ]);
  const canEdit = archive.viewerCapabilities.includes('succession.update');

  return (
    <div className="stack-lg" style={{ maxWidth: '46rem' }}>
      <PageHeader title="Continuity" lede="What you would like to happen to this archive later." />

      <Notice tone="warn" title="This records your wishes. It does not act on them.">
        <p>
          Nothing here transitions the archive automatically. In particular, nothing happens because
          you stopped signing in — an archive is never handed on because someone went quiet.
        </p>
        <p style={{ marginBottom: 0 }}>
          Acting on a directive would require evidence, a manual review, a cooling-off period, a way
          to pause it if the family disputes it, and the agreement of whoever is named. That work is
          not built, and it is not enabled. Treat this as a note of intent alongside your actual
          will, not as a substitute for one.
        </p>
      </Notice>

      {canEdit ? (
        <SuccessionForm archiveId={archiveId} directive={directive} />
      ) : (
        <Card>
          {directive ? (
            <>
              <p>
                <strong>Named to help:</strong> {directive.stewardEmail ?? 'nobody named'}
              </p>
              <p style={{ marginBottom: 0 }}>
                {directive.instructions ?? 'No instructions recorded.'}
              </p>
            </>
          ) : (
            <p className="muted" style={{ marginBottom: 0 }}>
              {archive.subjectDisplayName} has not recorded anything here.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
