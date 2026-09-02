'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Memory, StoryCapsule } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * Making and withdrawing capsules.
 *
 * The screen's promise is the one people find hardest to believe about
 * sharing: this can be taken back. So withdrawing is a single button on the
 * capsule itself, not buried in a settings page, and the copy says what
 * withdrawing actually does — including the one thing it cannot undo, which is
 * a copy somebody already downloaded.
 */
export function CapsuleManager({
  archiveId,
  capsules,
  memories,
  recipients,
  canCreate,
}: {
  archiveId: string;
  capsules: StoryCapsule[];
  memories: Pick<Memory, 'id' | 'title'>[];
  recipients: { userId: string; displayName: string }[];
  /**
   * Whether this viewer may make one, as reported by the API.
   *
   * The server refuses regardless — the frontend never decides access — but
   * offering a button that will be refused is a broken promise, and a family
   * member being shown "Make a capsule" for somebody else's archive is the
   * worst version of it.
   */
  canCreate: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [embargo, setEmbargo] = useState('');
  const [expires, setExpires] = useState('');
  const [allowDownload, setAllowDownload] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (list: string[], value: string, set: (next: string[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const create = async () => {
    setPending(true);
    setError(null);
    try {
      await api.send('POST', `/v1/archives/${archiveId}/capsules`, {
        title: title.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
        memoryIds: chosen,
        recipientUserIds: people,
        ...(embargo ? { embargoUntil: new Date(embargo).toISOString() } : {}),
        ...(expires ? { expiresAt: new Date(expires).toISOString() } : {}),
        allowDownload,
      });
      setOpen(false);
      setTitle('');
      setNote('');
      setChosen([]);
      setPeople([]);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That could not be made.');
    } finally {
      setPending(false);
    }
  };

  const revoke = async (id: string) => {
    setPending(true);
    try {
      await api.send('POST', `/v1/archives/${archiveId}/capsules/${id}/revoke`, {});
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That could not be withdrawn.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Notice tone="info" title="A capsule never shares more than your permissions allow">
        <p style={{ marginBottom: 0 }}>
          {canCreate
            ? 'Only people you have already given access to, only stories you have approved, and ' +
              'only for as long as you want. Withdrawing one stops it immediately — the only ' +
              'thing it cannot undo is a copy somebody already downloaded, which is why ' +
              'downloading is off unless you turn it on.'
            : 'Each one holds stories chosen for you. The storyteller can withdraw any of them at ' +
              'any time.'}
        </p>
      </Notice>

      {open ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>A new capsule</h2>

          <label htmlFor="capsule-title">What to call it</label>
          <input
            id="capsule-title"
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label htmlFor="capsule-note">A note to go with it (optional)</label>
          <textarea
            id="capsule-note"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />

          <fieldset>
            <legend>Which stories?</legend>
            {memories.length === 0 ? (
              <p className="muted">You have no approved stories yet.</p>
            ) : (
              memories.map((memory) => (
                <label key={memory.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(memory.id)}
                    onChange={() => toggle(chosen, memory.id, setChosen)}
                  />{' '}
                  {memory.title}
                </label>
              ))
            )}
          </fieldset>

          <fieldset>
            <legend>Who is it for?</legend>
            {recipients.length === 0 ? (
              <p className="muted">Nobody has access to this archive yet.</p>
            ) : (
              recipients.map((person) => (
                <label key={person.userId}>
                  <input
                    type="checkbox"
                    checked={people.includes(person.userId)}
                    onChange={() => toggle(people, person.userId, setPeople)}
                  />{' '}
                  {person.displayName}
                </label>
              ))
            )}
          </fieldset>

          <label htmlFor="capsule-embargo">Not before (optional)</label>
          <input
            id="capsule-embargo"
            type="datetime-local"
            value={embargo}
            onChange={(event) => setEmbargo(event.target.value)}
          />

          <label htmlFor="capsule-expires">Closes on (optional)</label>
          <input
            id="capsule-expires"
            type="datetime-local"
            value={expires}
            onChange={(event) => setExpires(event.target.value)}
          />

          <label>
            <input
              type="checkbox"
              checked={allowDownload}
              onChange={(event) => setAllowDownload(event.target.checked)}
            />{' '}
            Let them keep a copy
          </label>
          <p className="muted">
            {/* Stated at the point of the decision, not in a help page. */}A copy stays with them
            even if you withdraw the capsule later.
          </p>

          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={
                pending || title.trim().length === 0 || chosen.length === 0 || people.length === 0
              }
              onClick={() => void create()}
            >
              Make this capsule
            </button>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Card>
      ) : canCreate ? (
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
            Make a capsule
          </button>
        </div>
      ) : null}

      <h2>{canCreate ? 'Your capsules' : 'Capsules for you'}</h2>
      {capsules.length === 0 ? (
        <Empty title={canCreate ? 'You have not made one yet' : 'Nothing has been shared with you'}>
          A capsule is a few stories, for a few people, for as long as you choose.
        </Empty>
      ) : (
        <div className="stack">
          {capsules.map((capsule) => (
            <Card key={capsule.id}>
              <h3 style={{ marginTop: 0 }}>{capsule.title}</h3>
              <div className="row">
                <Tag kind={capsule.status === 'active' ? 'ok' : 'warn'}>{capsule.status}</Tag>
                <Tag>
                  {capsule.itemCount} {capsule.itemCount === 1 ? 'story' : 'stories'}
                </Tag>
                <Tag>for {capsule.recipients.map((r) => r.displayName).join(', ') || 'nobody'}</Tag>
                {capsule.embargoUntil ? <Tag>opens later</Tag> : null}
                {capsule.expiresAt ? <Tag>closes</Tag> : null}
                {capsule.allowDownload ? <Tag kind="warn">copies allowed</Tag> : null}
              </div>
              <div className="row">
                {canCreate ? (
                  <Link
                    className="btn btn-quiet small"
                    href={`/archives/${archiveId}/capsules/${capsule.id}`}
                  >
                    Who has opened it
                  </Link>
                ) : (
                  <Link
                    className="btn btn-quiet small"
                    href={`/archives/${archiveId}/capsules/${capsule.id}/open`}
                  >
                    Open it
                  </Link>
                )}
                {canCreate && capsule.status === 'active' ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    disabled={pending}
                    onClick={() => void revoke(capsule.id)}
                  >
                    Withdraw this
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
