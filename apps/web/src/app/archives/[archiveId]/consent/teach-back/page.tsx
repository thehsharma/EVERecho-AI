import { Card } from '@/components/ui';
import { TeachBack } from '@/components/teach-back';
import { serverFetch } from '@/lib/server';

export const metadata = { title: 'Before you decide' };

interface TeachBackData {
  explanation: { heading: string; points: string[] };
  consentCopyVersion: string;
  questions: { id: string; prompt: string; options: { id: string; label: string }[] }[];
}

export default async function TeachBackPage({
  params,
}: {
  params: Promise<{ archiveId: string }>;
}) {
  const { archiveId } = await params;
  const data = await serverFetch<TeachBackData>('/v1/consent/teach-back');

  return (
    <div className="stack-lg" style={{ maxWidth: '46rem' }}>
      <div>
        <h1>{data.explanation.heading}</h1>
        <p className="muted">
          Please read this, then answer a few short questions. There is no time limit and no way to
          fail — if an answer is wrong we will explain it and you can try again.
        </p>
      </div>

      <Card>
        <ul className="stack" style={{ paddingLeft: '1.2rem' }}>
          {data.explanation.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </Card>

      <TeachBack archiveId={archiveId} questions={data.questions} />
    </div>
  );
}
