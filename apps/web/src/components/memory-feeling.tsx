'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { MemoryFeeling } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Notice } from './ui';

/**
 * How they felt about it.
 *
 * The blank box is deliberate and was the hardest decision on this screen.
 * Every instinct says to offer chips — happy, proud, sad, relieved — because a
 * blank box is harder to start. But a fixed vocabulary is the product deciding
 * what a person is allowed to have felt about their own life, and the answers
 * that matter here are never one of six words. "Relieved, mostly, and then
 * guilty about being relieved" is not on anybody's list of moods.
 *
 * The other decision worth stating: private is offered at the same weight as
 * shared, at the moment of writing. "I will tell you what happened but not
 * what it did to me" is an ordinary thing to want and it has to be sayable in
 * the same breath as saying the thing.
 */
export function MemoryFeelingEditor({
  archiveId,
  memoryId,
  feeling,
  canWrite,
  subjectName,
}: {
  archiveId: string;
  memoryId: string;
  feeling: MemoryFeeling | null;
  /** Only the person whose memory it is. The server refuses anybody else. */
  canWrite: boolean;
  subjectName: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(feeling?.body ?? '');
  const [shared, setShared] = useState(feeling?.shared ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setPending(true);
    setError(null);
    try {
      await api.send('PUT', `/v1/archives/${archiveId}/memories/${memoryId}/feeling`, {
        body: body.trim(),
        shared,
      });
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    setPending(true);
    try {
      await api.send('DELETE', `/v1/archives/${archiveId}/memories/${memoryId}/feeling`, undefined);
      setBody('');
      setEditing(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  // ---------------------------------------------------------------------
  // What the family sees. Attributed, and never presented as a finding.
  // ---------------------------------------------------------------------
  if (!canWrite) {
    if (!feeling) return null;
    return (
      <Card>
        <p className="small muted" style={{ marginTop: 0 }}>
          How {subjectName} felt about this, in their own words
        </p>
        <blockquote style={{ marginBottom: 0 }}>{feeling.body}</blockquote>
      </Card>
    );
  }

  return (
    <Card>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {editing ? (
        <div className="stack">
          <label htmlFor={`feeling-${memoryId}`}>How do you feel about this now?</label>
          <textarea
            id={`feeling-${memoryId}`}
            rows={4}
            maxLength={4000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
          <p className="muted">
            {/* No chips, and the reason is worth saying out loud. */}
            In whatever words fit. Nobody will summarise it, shorten it or decide what it means.
          </p>

          <fieldset>
            <legend>Who is this for?</legend>
            <label>
              <input type="radio" checked={shared} onChange={() => setShared(true)} /> The people
              who can already see this story
            </label>
            <label>
              <input type="radio" checked={!shared} onChange={() => setShared(false)} /> Just me
            </label>
          </fieldset>

          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={pending || body.trim().length === 0}
              onClick={() => void save()}
            >
              Save this
            </button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
            {feeling ? (
              <button
                type="button"
                className="btn btn-quiet"
                disabled={pending}
                onClick={() => void remove()}
              >
                Remove it
              </button>
            ) : null}
          </div>
        </div>
      ) : feeling ? (
        <>
          <p className="small muted" style={{ marginTop: 0 }}>
            How you felt about this{feeling.shared ? '' : ' — kept to yourself'}
          </p>
          <blockquote>{feeling.body}</blockquote>
          <div className="row">
            <button type="button" className="btn btn-quiet small" onClick={() => setEditing(true)}>
              Change this
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            This story says what happened. It says nothing about how it felt, and only you can.
          </p>
          <button type="button" className="btn" onClick={() => setEditing(true)}>
            Say how you felt
          </button>
        </>
      )}
    </Card>
  );
}
