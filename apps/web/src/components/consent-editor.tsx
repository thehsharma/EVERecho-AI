'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ConsentPolicy, ConsentPolicyDocument } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';

const MODES = [
  {
    value: 'preserve',
    title: 'Keep it safe, and nothing else',
    detail: 'Recordings and files are stored privately. Nothing is transcribed, read or searched.',
  },
  {
    value: 'organise',
    title: 'Also write down what I said',
    detail:
      'Recordings are transcribed and documents read, so you can correct them and build story cards.',
  },
  {
    value: 'explore',
    title: 'Also let people search it',
    detail: 'People you allow can search the archive and see a timeline of what you told us.',
  },
  {
    value: 'compose',
    title: 'Also let it answer questions and draft a biography',
    detail: 'Answers are written in the third person and always show the recording they came from.',
  },
] as const;

const ACTIVITIES = [
  { value: 'transcription', label: 'Write down what I said in recordings' },
  { value: 'ocr', label: 'Read the text in documents and letters' },
  { value: 'embedding', label: 'Index my stories so they can be searched' },
  { value: 'generation', label: 'Compose answers and biography drafts' },
  { value: 'provider_processing', label: 'Let an outside provider do that processing' },
  { value: 'contribution', label: 'Let people I choose suggest corrections and photographs' },
] as const;

const RECIPIENT_ROLES = [
  { value: 'family', label: 'Family members I invite' },
  { value: 'contributor', label: 'People helping me add material' },
  { value: 'buyer', label: 'The person who set up this archive' },
  { value: 'steward', label: 'Whoever helps look after this practically' },
] as const;

export function ConsentEditor({
  archiveId,
  policy,
  defaultDocument,
  sources,
}: {
  archiveId: string;
  policy: ConsentPolicy | null;
  defaultDocument: ConsentPolicyDocument;
  sources: { id: string; filename: string; kind: string }[];
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<ConsentPolicyDocument>(policy?.document ?? defaultDocument);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [saved, setSaved] = useState<string[] | null>(null);
  const [topicDraft, setTopicDraft] = useState('');

  const update = (patch: Partial<ConsentPolicyDocument>) => {
    setDoc((prev) => ({ ...prev, ...patch }));
    setSaved(null);
  };

  const toggleActivity = (activity: string, on: boolean) =>
    update({
      activities: on
        ? ([...new Set([...doc.activities, activity])] as ConsentPolicyDocument['activities'])
        : (doc.activities.filter((a) => a !== activity) as ConsentPolicyDocument['activities']),
    });

  const toggleRecipient = (role: string, on: boolean) =>
    update({
      recipients: on
        ? [
            ...doc.recipients,
            {
              role: role as ConsentPolicyDocument['recipients'][number]['role'],
              maxSensitivity: 'normal',
              lifeStates: ['living'],
              mayExport: false,
              mayContribute: role === 'contributor',
            },
          ]
        : doc.recipients.filter((r) => r.role !== role),
    });

  const toggleExcluded = (sourceId: string, excluded: boolean) =>
    update({
      excludedSourceIds: excluded
        ? [...new Set([...doc.excludedSourceIds, sourceId])]
        : doc.excludedSourceIds.filter((id) => id !== sourceId),
    });

  async function save() {
    setPending(true);
    setError(null);
    setIssues([]);
    try {
      const result = await api.put<{ changes: string[]; cancelledJobs: number }>(
        `/v1/archives/${archiveId}/consent`,
        {
          document: {
            ...doc,
            // Provider flags follow the activities; the server clamps them too.
            providerProcessing: {
              ...doc.providerProcessing,
              transcription:
                doc.activities.includes('transcription') &&
                doc.activities.includes('provider_processing'),
              ocr: doc.activities.includes('ocr') && doc.activities.includes('provider_processing'),
              embedding:
                doc.activities.includes('embedding') &&
                doc.activities.includes('provider_processing'),
              generation:
                doc.activities.includes('generation') &&
                doc.activities.includes('provider_processing'),
              noModelTraining: true,
            },
            voiceAndLikeness: {
              syntheticVoice: false,
              syntheticLikeness: false,
              personaSimulation: false,
            },
          },
        },
      );
      setSaved(result.changes);
      setPending(false);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setError(caught.message);
        setIssues((caught.fieldErrors ?? []).map((f) => f.message));
      } else {
        setError('We could not reach the server. Nothing was changed.');
      }
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice-danger" role="alert">
          <strong>{error}</strong>
          {issues.length > 0 ? (
            <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {saved ? (
        <div className="notice notice-ok" role="status">
          <strong>Saved</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
            {saved.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset>
        <legend>How much may be done with your stories?</legend>
        {MODES.map((mode) => (
          <div className="choice" key={mode.value}>
            <input
              type="radio"
              id={`mode-${mode.value}`}
              name="mode"
              checked={doc.mode === mode.value}
              onChange={() => update({ mode: mode.value })}
            />
            <label htmlFor={`mode-${mode.value}`}>
              <strong>{mode.title}</strong>
              <br />
              <span className="muted small">{mode.detail}</span>
            </label>
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>What specifically may happen?</legend>
        <p className="hint">
          Each of these is a separate decision. You can allow answers to be composed while still
          refusing to have your documents read, for instance.
        </p>
        {ACTIVITIES.map((activity) => (
          <div className="choice" key={activity.value}>
            <input
              type="checkbox"
              id={`activity-${activity.value}`}
              checked={doc.activities.includes(activity.value)}
              onChange={(event) => toggleActivity(activity.value, event.target.checked)}
            />
            <label htmlFor={`activity-${activity.value}`}>{activity.label}</label>
          </div>
        ))}
      </fieldset>

      <fieldset>
        <legend>Who may see it?</legend>
        <p className="hint">
          Nobody, until you say so here. Removing someone takes effect at once.
        </p>
        {RECIPIENT_ROLES.map((role) => {
          const grant = doc.recipients.find((r) => r.role === role.value);
          return (
            <div key={role.value}>
              <div className="choice">
                <input
                  type="checkbox"
                  id={`recipient-${role.value}`}
                  checked={Boolean(grant)}
                  onChange={(event) => toggleRecipient(role.value, event.target.checked)}
                />
                <label htmlFor={`recipient-${role.value}`}>{role.label}</label>
              </div>
              {grant ? (
                <div className="choice" style={{ marginLeft: '2rem' }}>
                  <input
                    type="checkbox"
                    id={`export-${role.value}`}
                    checked={grant.mayExport}
                    onChange={(event) =>
                      update({
                        recipients: doc.recipients.map((r) =>
                          r.role === role.value ? { ...r, mayExport: event.target.checked } : r,
                        ),
                      })
                    }
                  />
                  <label htmlFor={`export-${role.value}`} className="small">
                    …and may download a copy of everything
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>Topics that are off-limits</legend>
        <p className="hint">
          Anything touching these is kept out of search and out of answers. The system will say it
          cannot answer rather than working around your restriction. You can always see them
          yourself.
        </p>
        {doc.restrictedTopics.length > 0 ? (
          <ul className="row" style={{ listStyle: 'none', padding: 0, marginBottom: '0.75rem' }}>
            {doc.restrictedTopics.map((topic) => (
              <li key={topic}>
                <button
                  type="button"
                  className="tag"
                  onClick={() =>
                    update({ restrictedTopics: doc.restrictedTopics.filter((t) => t !== topic) })
                  }
                >
                  {topic}
                  <span aria-hidden="true">×</span>
                  <span className="visually-hidden">Remove {topic}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="row">
          <input
            type="text"
            aria-label="Add an off-limits topic"
            value={topicDraft}
            placeholder="money, illness…"
            onChange={(event) => setTopicDraft(event.target.value)}
            style={{ maxWidth: '20rem' }}
          />
          <button
            type="button"
            className="btn"
            onClick={() => {
              const topic = topicDraft.trim();
              if (!topic) return;
              update({ restrictedTopics: [...new Set([...doc.restrictedTopics, topic])] });
              setTopicDraft('');
            }}
          >
            Add topic
          </button>
        </div>
      </fieldset>

      {sources.length > 0 ? (
        <fieldset>
          <legend>Recordings and files to leave alone</legend>
          <p className="hint">
            Excluded material is stored but never transcribed, indexed, shared or used in an answer.
            You can still see it yourself.
          </p>
          {sources.map((source) => (
            <div className="choice" key={source.id}>
              <input
                type="checkbox"
                id={`exclude-${source.id}`}
                checked={doc.excludedSourceIds.includes(source.id)}
                onChange={(event) => toggleExcluded(source.id, event.target.checked)}
              />
              <label htmlFor={`exclude-${source.id}`}>
                {source.filename} <span className="muted small">({source.kind})</span>
              </label>
            </div>
          ))}
        </fieldset>
      ) : null}

      <div className="notice notice-info">
        <strong>Always true, whatever you choose</strong>
        <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem' }}>
          <li>Your voice and likeness are never synthesised. This cannot be switched on.</li>
          <li>No provider is ever permitted to train a model on your memories.</li>
          <li>You can always export everything, and you can always delete it.</li>
        </ul>
      </div>

      <div className="row">
        <button
          type="button"
          className="btn btn-primary btn-lg"
          onClick={() => void save()}
          disabled={pending}
        >
          {pending ? <span className="spinner-text">Saving</span> : 'Save these permissions'}
        </button>
        <p className="small muted" style={{ margin: 0 }}>
          Saving writes a new version. Nothing you agreed to before is erased.
        </p>
      </div>
    </div>
  );
}
