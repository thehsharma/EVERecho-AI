import { Card, Notice } from '@/components/ui';
import { productMeta } from '@/lib/server';

export const metadata = { title: 'How it works' };

export default async function HowItWorksPage() {
  const meta = await productMeta();

  return (
    <div className="narrow stack-lg">
      <div>
        <h1>How it works</h1>
        <p className="muted">
          Written plainly, because the people who need to understand this are not engineers.
        </p>
      </div>

      <Card>
        <h2>Recording</h2>
        <p>
          An interviewer asks one question at a time, starting with easy ones. Any question can be
          skipped, paused, or answered with “I would rather not.” Nothing is written down as fact
          until the storyteller has read it back and approved it.
        </p>
        <p style={{ marginBottom: 0 }}>
          Stories can be spoken into the browser, typed, or added later as photographs, letters and
          documents.
        </p>
      </Card>

      <Card>
        <h2>What happens to a recording</h2>
        <ol className="stack">
          <li>It is stored privately and left exactly as it arrived. The original is never edited.</li>
          <li>It is checked for anything harmful before anything else reads it.</li>
          <li>
            If the storyteller permitted it, the words are transcribed and the transcript can be
            corrected by hand. The machine version is kept alongside the correction, not replaced.
          </li>
          <li>
            Short story cards are drafted from what was said. Each one records the exact passage it
            came from.
          </li>
          <li>The storyteller reviews each card and approves, edits or rejects it.</li>
          <li>Only approved cards can be searched or used in an answer.</li>
        </ol>
      </Card>

      <Card>
        <h2>Asking questions</h2>
        <p>
          A family member with permission can ask about the storyteller. The answer is written in
          the third person and every claim in it carries a citation you can open.
        </p>
        <p>
          If the archive does not support an answer, the system says{' '}
          <em>“I don’t have enough evidence in this archive to answer that reliably.”</em> It will
          not reason its way to something plausible.
        </p>
        <p style={{ marginBottom: 0 }}>
          If two recordings disagree, the answer says so and cites both.
        </p>
      </Card>

      <Notice tone="warn" title="What the AI will not do">
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          <li>It will not speak in the storyteller’s voice, or as them.</li>
          <li>It will not generate a face, an avatar or a video of them.</li>
          <li>It will not guess what they “would have said”.</li>
          <li>It will not continue as them after they die.</li>
        </ul>
      </Notice>

      <Card>
        <h2>Where the work is done</h2>
        <p>
          This installation composes answers with{' '}
          <strong>
            {meta.providers.compositionIsExtractive
              ? 'a local composer that can only select and quote from what is already in the archive'
              : `an external provider (${meta.providers.composition})`}
          </strong>
          . Transcription uses {meta.providers.transcription}, and document reading uses{' '}
          {meta.providers.ocr}.
        </p>
        <p style={{ marginBottom: 0 }}>
          Whichever provider is configured, it is never permitted to train a model on private memory
          data, and the storyteller consents to provider processing separately from consenting to
          the processing itself.
        </p>
      </Card>
    </div>
  );
}
