'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { RemembranceDirective } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * What should happen after.
 *
 * The design problem is that this screen asks somebody to think about their
 * own death, and most products handle that by being either cheerfully evasive
 * or funereal. Both are wrong. The tone here is administrative on purpose: it
 * is a form about permissions, the way a will is a form about property, and
 * treating it as ordinary is what makes it possible to fill in.
 *
 * Two things are deliberately unbalanced in the other direction from usual.
 * Refusing is the same size as permitting, in the same place, with no warning
 * copy attached to it — a person sealing one topic is not doing something
 * regrettable. And the default question is asked first and cannot be skipped,
 * because everything else is read against it.
 */
export function RemembranceDirectiveEditor({
  archiveId,
  directive,
  memories,
  people,
}: {
  archiveId: string;
  directive: RemembranceDirective | null;
  memories: { id: string; title: string }[];
  people: { userId: string; displayName: string }[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState(directive?.note ?? '');
  const [adding, setAdding] = useState(false);

  const [effect, setEffect] = useState<'permit' | 'withhold'>('withhold');
  const [scope, setScope] = useState<'archive' | 'topic' | 'memory'>('topic');
  const [topic, setTopic] = useState('');
  const [memoryId, setMemoryId] = useState('');
  const [audience, setAudience] = useState('');
  const [notBefore, setNotBefore] = useState('');
  const [allowAudio, setAllowAudio] = useState(true);

  const editable = directive?.editable ?? true;

  const run = async (fn: () => Promise<unknown>) => {
    setPending(true);
    setError(null);
    try {
      await fn();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(false);
    }
  };

  const setDefault = (defaultEffect: 'permit' | 'withhold') =>
    run(() =>
      api.send('PUT', `/v1/archives/${archiveId}/remembrance`, {
        defaultEffect,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    );

  const addClause = () =>
    run(async () => {
      await api.send('POST', `/v1/archives/${archiveId}/remembrance/clauses`, {
        effect,
        scope,
        ...(scope === 'topic' ? { topic: topic.trim() } : {}),
        ...(scope === 'memory' ? { memoryId } : {}),
        ...(audience ? { audienceUserId: audience } : {}),
        ...(effect === 'permit' && notBefore
          ? { notBefore: new Date(notBefore).toISOString() }
          : {}),
        allowAudio,
      });
      setAdding(false);
      setTopic('');
      setNotBefore('');
    });

  // ---------------------------------------------------------------------
  // Activated: nobody may change it, and the screen says why rather than
  // simply disabling everything and leaving people to guess.
  // ---------------------------------------------------------------------
  if (directive?.status === 'activated') {
    return (
      <div className="stack-lg">
        <Notice tone="info" title="This is settled">
          <p style={{ marginBottom: 0 }}>
            These were their decisions, recorded while they were able to make them. Nobody can
            change them now — not the family, and not us.
          </p>
        </Notice>
        {directive.note ? <blockquote>{directive.note}</blockquote> : null}
        <ClauseList directive={directive} editable={false} archiveId={archiveId} />
      </div>
    );
  }

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Notice tone="info" title="Nothing here happens while you are alive">
        <p style={{ marginBottom: 0 }}>
          This is only about afterwards. You can change any of it, as many times as you like, for as
          long as you live. It takes effect only when someone shows us a death certificate, and we
          record who did that and when.
        </p>
      </Notice>

      <Card>
        <h2 style={{ marginTop: 0 }}>First, the one question we cannot answer for you</h2>
        <p>
          When you are gone and someone asks for something you never mentioned either way — what
          should happen?
        </p>
        <div className="row">
          <button
            type="button"
            className={`btn ${directive?.defaultEffect === 'permit' ? 'btn-primary' : ''}`}
            disabled={pending || !editable}
            onClick={() => void setDefault('permit')}
          >
            Let them have it
          </button>
          <button
            type="button"
            className={`btn ${directive?.defaultEffect === 'withhold' ? 'btn-primary' : ''}`}
            disabled={pending || !editable}
            onClick={() => void setDefault('withhold')}
          >
            Keep it closed
          </button>
        </div>
        <p className="muted">
          {/* Stated at the point of the decision, because it is the decision
              everything else is read against. */}
          There is no right answer and we will not choose one for you. Whichever you pick, anything
          you say below overrides it.
        </p>

        <label htmlFor="directive-note">Anything you want them to know about why (optional)</label>
        <textarea
          id="directive-note"
          rows={3}
          maxLength={4000}
          value={note}
          disabled={!editable}
          onChange={(event) => setNote(event.target.value)}
        />
        {directive ? (
          <div className="row">
            <button
              type="button"
              className="btn"
              disabled={pending || !editable}
              onClick={() => void setDefault(directive.defaultEffect)}
            >
              Save this note
            </button>
          </div>
        ) : null}
      </Card>

      {directive ? (
        <>
          <h2>The particular things</h2>

          {adding ? (
            <Card>
              <fieldset>
                <legend>Is this something you want them to have, or not?</legend>
                <label>
                  <input
                    type="radio"
                    name="effect"
                    checked={effect === 'permit'}
                    onChange={() => setEffect('permit')}
                  />{' '}
                  They may have it
                </label>
                <label>
                  <input
                    type="radio"
                    name="effect"
                    checked={effect === 'withhold'}
                    onChange={() => setEffect('withhold')}
                  />{' '}
                  Keep this closed
                </label>
              </fieldset>

              <fieldset>
                <legend>What is it about?</legend>
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'topic'}
                    onChange={() => setScope('topic')}
                  />{' '}
                  A subject
                </label>
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'memory'}
                    onChange={() => setScope('memory')}
                  />{' '}
                  One story
                </label>
                <label>
                  <input
                    type="radio"
                    name="scope"
                    checked={scope === 'archive'}
                    onChange={() => setScope('archive')}
                  />{' '}
                  Everything
                </label>
              </fieldset>

              {scope === 'topic' ? (
                <>
                  <label htmlFor="clause-topic">Which subject?</label>
                  <input
                    id="clause-topic"
                    maxLength={120}
                    value={topic}
                    placeholder="money, illness, my first marriage"
                    onChange={(event) => setTopic(event.target.value)}
                  />
                </>
              ) : null}

              {scope === 'memory' ? (
                <>
                  <label htmlFor="clause-memory">Which story?</label>
                  <select
                    id="clause-memory"
                    value={memoryId}
                    onChange={(event) => setMemoryId(event.target.value)}
                  >
                    <option value="">Choose one</option>
                    {memories.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}

              <label htmlFor="clause-audience">Who does this apply to?</label>
              <select
                id="clause-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
              >
                <option value="">Everyone you have given access to</option>
                {people.map((p) => (
                  <option key={p.userId} value={p.userId}>
                    Only {p.displayName}
                  </option>
                ))}
              </select>

              {effect === 'permit' ? (
                <>
                  <label htmlFor="clause-not-before">Not before (optional)</label>
                  <input
                    id="clause-not-before"
                    type="datetime-local"
                    value={notBefore}
                    onChange={(event) => setNotBefore(event.target.value)}
                  />

                  <label>
                    <input
                      type="checkbox"
                      checked={allowAudio}
                      onChange={(event) => setAllowAudio(event.target.checked)}
                    />{' '}
                    They may hear the recording, not only read the words
                  </label>
                  <p className="muted">
                    {/* Two decisions, and people make them differently. */}
                    Some people are happy to be quoted and would rather their voice was not played.
                    That is a separate choice and this is where you make it.
                  </p>
                </>
              ) : (
                <p className="muted">
                  {/* Mirrors the CHECK constraint, in the words of what it means. */}
                  Keeping something closed has no end date. It stays closed.
                </p>
              )}

              <div className="row">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={
                    pending ||
                    (scope === 'topic' && topic.trim().length === 0) ||
                    (scope === 'memory' && memoryId.length === 0)
                  }
                  onClick={() => void addClause()}
                >
                  Add this
                </button>
                <button type="button" className="btn" onClick={() => setAdding(false)}>
                  Cancel
                </button>
              </div>
            </Card>
          ) : editable ? (
            <div className="row">
              <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
                Add something specific
              </button>
            </div>
          ) : null}

          <ClauseList directive={directive} editable={editable} archiveId={archiveId} />

          {directive.status === 'draft' ? (
            <Card>
              <h3 style={{ marginTop: 0 }}>When you are ready</h3>
              <p>
                Confirming records that you read this back and meant it. It does not lock anything —
                you can still change every part of it for as long as you live.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending}
                onClick={() =>
                  void run(() =>
                    api.send('POST', `/v1/archives/${archiveId}/remembrance/affirm`, {}),
                  )
                }
              >
                Yes, this is what I want
              </button>
            </Card>
          ) : (
            <Notice tone="ok" title="Confirmed">
              <p style={{ marginBottom: 0 }}>
                You confirmed this on{' '}
                {directive.affirmedAt
                  ? new Date(directive.affirmedAt).toLocaleDateString()
                  : 'a previous visit'}
                . You can still change any of it.
              </p>
            </Notice>
          )}
        </>
      ) : null}
    </div>
  );
}

function ClauseList({
  directive,
  editable,
  archiveId,
}: {
  directive: RemembranceDirective;
  editable: boolean;
  archiveId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const remove = async (clauseId: string) => {
    setPending(clauseId);
    try {
      await api.send(
        'DELETE',
        `/v1/archives/${archiveId}/remembrance/clauses/${clauseId}`,
        undefined,
      );
      router.refresh();
    } finally {
      setPending(null);
    }
  };

  if (directive.clauses.length === 0) {
    return (
      <Empty title="Nothing specific yet">
        Everything follows what you chose above. Add something here when you want one subject, one
        story or one person treated differently.
      </Empty>
    );
  }

  return (
    <div className="stack">
      {directive.clauses.map((clause) => (
        <Card key={clause.id}>
          <div className="row">
            <Tag kind={clause.effect === 'withhold' ? 'warn' : 'ok'}>
              {clause.effect === 'withhold' ? 'kept closed' : 'they may have it'}
            </Tag>
            <span>
              {clause.scope === 'archive' ? 'Everything' : null}
              {clause.scope === 'topic' ? `About “${clause.topic}”` : null}
              {clause.scope === 'memory' ? 'One story' : null}
              {clause.scope === 'source' ? 'One recording' : null}
            </span>
            <Tag>
              {clause.audienceDisplayName ? `for ${clause.audienceDisplayName}` : 'for all'}
            </Tag>
            {clause.notBefore ? (
              <Tag>not before {new Date(clause.notBefore).toLocaleDateString()}</Tag>
            ) : null}
            {clause.effect === 'permit' && !clause.allowAudio ? (
              <Tag kind="warn">words only, no recording</Tag>
            ) : null}
          </div>
          {editable ? (
            <div className="row">
              <button
                type="button"
                className="btn btn-quiet small"
                disabled={pending === clause.id}
                onClick={() => void remove(clause.id)}
              >
                Take this back
              </button>
            </div>
          ) : null}
        </Card>
      ))}
    </div>
  );
}
