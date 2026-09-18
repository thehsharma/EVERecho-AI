import { requireUser } from '@/lib/server';
import { PageHeader } from '@/components/ui';
import { ConversationInsights } from '@/components/conversation-insights';
export const metadata = { title: 'Conversation measurements' };
export default async function Page() {
  await requireUser('/account/insights');
  return (
    <div className="stack">
      <PageHeader
        title="Your conversation measurements"
        lede="See response reliability, voice usage, and your feedback."
      />
      <ConversationInsights />
    </div>
  );
}
