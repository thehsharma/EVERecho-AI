import type { FamilyQuestion } from '@everecho/contracts';
import { QuestionInbox } from '@/components/question-inbox';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Questions for you' };

export default async function InboxPage({ params }: { params: Promise<{ archiveId: string }> }) {
  const { archiveId } = await params;
  const { questions } = await serverFetch<{ questions: FamilyQuestion[] }>(
    `/v1/archives/${archiveId}/family-questions`,
  );

  return (
    <div className="stack-lg">
      <PageHeader
        title="Questions for you"
        lede="What your family has asked. Yours to answer, to leave, or to say no to."
      />
      <QuestionInbox archiveId={archiveId} questions={questions} />
    </div>
  );
}
