import { PageHeader } from '@/components/ui';
import { PreferenceManager } from '@/components/preference-manager';
import { requireUser } from '@/lib/server';

export const metadata = { title: 'What EverEcho remembers about you' };

export default async function PreferencesPage() {
  await requireUser('/account/preferences');

  return (
    <div className="narrow stack-lg">
      <PageHeader
        title="What EverEcho remembers about you"
        lede="How you like to use the software, and nothing else. You can remove any of it."
      />
      <PreferenceManager />
    </div>
  );
}
