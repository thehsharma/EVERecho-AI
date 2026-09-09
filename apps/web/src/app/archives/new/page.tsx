import { Card, Notice } from '@/components/ui';
import { NewArchiveForm } from '@/components/new-archive-form';
import { requireUser } from '@/lib/server';

export const metadata = { title: 'Start an archive' };

export default async function NewArchivePage() {
  await requireUser('/archives/new');

  return (
    <div className="narrow stack">
      <h1>Start an archive</h1>
      <p className="muted">
        This creates an empty, private archive and nothing else. The person it is about will be
        asked whether they want it, and they decide everything from there.
      </p>

      <Notice tone="info" title="Before you invite someone">
        <p style={{ marginBottom: 0 }}>
          Please talk to them first. An invitation that arrives out of nowhere, about their own
          mortality, is not a kind way to raise this.
        </p>
      </Notice>

      <Card>
        <NewArchiveForm />
      </Card>
    </div>
  );
}
