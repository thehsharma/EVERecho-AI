'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiRequestError } from '@/lib/api';
import { Tag } from './ui';

export function BiographyActions({
  archiveId,
  hasDraft,
}: {
  archiveId: string;
  hasDraft: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [queued, setQueued] = useState(false);

  async function generate() {
    setPending(true);
    try {
      await api.post(`/v1/archives/${archiveId}/biography/generate`);
      setQueued(true);
    } finally {
      setPending(false);
      // Drafting runs in the background; a refresh a moment later shows it.
      setTimeout(() => router.refresh(), 1500);
    }
  }

  return (
    <div className="row">
      <button type="button" className="btn" onClick={() => void generate()} disabled={pending}>
        {pending ? (
          <span className="spinner-text">Starting</span>
        ) : hasDraft ? (
          'Draft it again'
        ) : (
          'Draft a biography'
        )}
      </button>
      {queued ? (
        <span className="small muted" role="status">
          Drafting — this page will update shortly.
        </span>
      ) : null}
    </div>
  );
}

export function BiographySection({
  archiveId,
  section,
  canEdit,
}: {
  archiveId: string;
  section: { id: string; heading: string; text: string; sourceIds: string[]; edited: boolean };
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(section.text);
  const [heading, setHeading] = useState(section.heading);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setPending(true);
    setError(null);
    try {
      await api.patch(`/v1/archives/${archiveId}/biography/sections/${section.id}`, {
        heading,
        text,
      });
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(false);
    }
  }

  if (editing) {
    return (
      <div className="stack">
        {error ? (
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        ) : null}
        <div>
          <label htmlFor={`heading-${section.id}`}>Heading</label>
          <input
            id={`heading-${section.id}`}
            value={heading}
            onChange={(event) => setHeading(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={`text-${section.id}`}>Your words</label>
          <p className="hint">
            Rewrite this however you like. What you write replaces the draft and is marked as yours.
          </p>
          <textarea
            id={`text-${section.id}`}
            value={text}
            rows={8}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={pending}
          >
            {pending ? <span className="spinner-text">Saving</span> : 'Save'}
          </button>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              setText(section.text);
              setHeading(section.heading);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="spread">
        <h2 style={{ marginBottom: '0.5rem' }}>{section.heading}</h2>
        <span className="row" style={{ gap: '0.35rem' }}>
          {section.edited ? (
            <Tag kind="corrected">In the storyteller’s words</Tag>
          ) : (
            <Tag kind="ai">AI-assisted draft</Tag>
          )}
          {canEdit ? (
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(true)}>
              Edit
            </button>
          ) : null}
        </span>
      </div>
      <p style={{ fontFamily: 'var(--font)', fontSize: '1.0625rem' }}>{section.text}</p>
      {section.sourceIds.length > 0 ? (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Drawn from {section.sourceIds.length} recording(s) or document(s).{' '}
          <Link href={`/archives/${archiveId}/sources`}>See the sources</Link>
        </p>
      ) : null}
    </div>
  );
}
