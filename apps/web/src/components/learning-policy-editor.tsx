'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LearningPolicyDocument } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Notice } from './ui';

/**
 * What a conversation may become.
 *
 * Deliberately a separate screen from Permissions. Consent governs material
 * already given; this governs what talking produces. Written in the second
 * person, because these are the storyteller's decisions and nobody else's.
 */
export function LearningPolicyEditor({
  archiveId,
  initial,
  currentVersion,
}: {
  archiveId: string;
  initial: LearningPolicyDocument;
  currentVersion: number | null;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<LearningPolicyDocument>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [changes, setChanges] = useState<string[] | null>(null);

  const set = <K extends keyof LearningPolicyDocument>(
    key: K,
    value: LearningPolicyDocument[K],
  ) => {
    setDoc((current) => ({ ...current, [key]: value }));
    setChanges(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await api.send<{ changes: string[] }>(
        'PUT',
        `/v1/archives/${archiveId}/learning-policy`,
        { document: doc },
      );
      setChanges(result.changes);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'That could not be saved just now.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack-lg">
      <Card>
        <h2>What may be kept from a conversation</h2>
        <p className="muted">
          Talking to EverEcho creates words. These are your decisions about what happens to them.
        </p>

        <fieldset>
          <legend>The transcript</legend>
          {(
            [
              ['ephemeral', 'Keep nothing', 'Words appear as captions and are never written down.'],
              ['session', 'Only while we talk', 'The transcript is kept for this conversation.'],
              ['30_days', 'For thirty days', 'Long enough to come back and correct something.'],
              ['until_deleted', 'Until I delete it', 'Kept as part of the archive.'],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="transcriptRetention"
                checked={doc.transcriptRetention === value}
                onChange={() => set('transcriptRetention', value)}
              />
              <span>
                <strong>{label}</strong>
                <span className="muted"> {help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset>
          <legend>The recording itself</legend>
          {(
            [
              ['never', 'Never keep the audio', 'The default. Only the words are considered.'],
              ['session', 'Only while we talk', 'Discarded when the conversation ends.'],
              [
                'explicit_archive_source',
                'Keep it as part of my archive',
                'The recording becomes a source, with every protection an uploaded one has.',
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label key={value} className="choice">
              <input
                type="radio"
                name="audioRetention"
                checked={doc.audioRetention === value}
                onChange={() => set('audioRetention', value)}
              />
              <span>
                <strong>{label}</strong>
                <span className="muted"> {help}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Card>

      <Card>
        <h2>What may be suggested</h2>
        <label className="choice">
          <input
            type="checkbox"
            checked={doc.candidateExtraction}
            onChange={(event) => set('candidateExtraction', event.target.checked)}
          />
          <span>
            <strong>Suggest stories from what I say</strong>
            <span className="muted">
              {' '}
              Suggestions are never part of the archive until you approve them, one at a time.
            </span>
          </span>
        </label>

        <label className="choice">
          <input
            type="checkbox"
            checked={doc.correctionLearning}
            onChange={(event) => set('correctionLearning', event.target.checked)}
          />
          <span>
            <strong>Learn from my corrections</strong>
            <span className="muted"> A correction creates a new version; nothing is erased.</span>
          </span>
        </label>

        <h3>Remembering how you like to talk</h3>
        <p className="muted">
          Only interface preferences — language, captions, pace. Never anything about your life.
        </p>
        {(
          [
            ['ask_every_time', 'Ask me every time'],
            ['auto_save', 'Remember these without asking'],
            ['never', 'Never remember anything'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="choice">
            <input
              type="radio"
              name="lowRiskPreferenceMemory"
              checked={doc.lowRiskPreferenceMemory === value}
              onChange={() => set('lowRiskPreferenceMemory', value)}
            />
            <span>{label}</span>
          </label>
        ))}
      </Card>

      <Card>
        <h2>Who does the processing</h2>
        <label className="choice">
          <input
            type="radio"
            name="providerMode"
            checked={doc.providerProcessing.mode === 'local_only'}
            onChange={() =>
              set('providerProcessing', {
                ...doc.providerProcessing,
                mode: 'local_only',
                speechToText: false,
                speechSynthesis: false,
                composition: false,
                namedProviders: [],
              })
            }
          />
          <span>
            <strong>Nobody outside EverEcho</strong>
            <span className="muted"> Nothing you say leaves this system.</span>
          </span>
        </label>
        <label className="choice">
          <input
            type="radio"
            name="providerMode"
            checked={doc.providerProcessing.mode === 'named_providers'}
            onChange={() =>
              set('providerProcessing', { ...doc.providerProcessing, mode: 'named_providers' })
            }
          />
          <span>
            <strong>Named providers may help</strong>
            <span className="muted">
              {' '}
              Better transcription and a more natural voice, at the cost of a third party hearing
              this.
            </span>
          </span>
        </label>

        {doc.providerProcessing.mode === 'named_providers' ? (
          <div className="indent">
            {(
              [
                ['speechToText', 'Write down what I say'],
                ['speechSynthesis', 'Speak the replies aloud'],
                ['composition', 'Compose the replies'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="choice">
                <input
                  type="checkbox"
                  checked={doc.providerProcessing[key]}
                  onChange={(event) =>
                    set('providerProcessing', {
                      ...doc.providerProcessing,
                      [key]: event.target.checked,
                    })
                  }
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        ) : null}
      </Card>

      <Notice tone="info" title="Always true, whatever you choose">
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          <li>No provider is ever permitted to train a model on this conversation.</li>
          <li>Nothing learned here ever crosses into another family’s archive.</li>
          <li>Anything sensitive always waits for you, however these are set.</li>
          <li>Only what you approve is ever searchable by your family.</li>
          <li>Your voice is never synthesised. The assistant speaks in its own.</li>
        </ul>
      </Notice>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {changes ? (
        <Notice tone="ok" title="Saved">
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
            {changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </Notice>
      ) : null}

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save these choices'}
        </button>
        <span className="muted">
          {currentVersion === null
            ? 'Nothing is saved yet.'
            : `Saving writes version ${currentVersion + 1}. Nothing you chose before is erased.`}
        </span>
      </div>
    </div>
  );
}
