import type { AskedQuestion, Archive } from '@everecho/contracts';
import { QuestionComposer } from '@/components/question-composer';
import { PageHeader } from '@/components/ui';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Ask the storyteller' };

export default async function QuestionsPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const [archive, { questions }] = await Promise.all([
    serverFetch<Archive>(`/v1/archives/${archiveId}`),
    serverFetch<{ questions: AskedQuestion[] }>(`/v1/archives/${archiveId}/family-questions/asked`),
  ]);

  return (
    <div className="stack-lg">
      <PageHeader
        title="Ask the storyteller"
        lede="A question goes straight to them, privately. What they do with it is theirs to decide."
      />
      <QuestionComposer
        archiveId={archiveId}
        subjectName={archive.subjectDisplayName}
        questions={questions}
      />
    </div>
  );
}
