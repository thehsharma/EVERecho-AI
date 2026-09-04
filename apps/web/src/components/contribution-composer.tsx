'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ContributorProposal, ProposalKind } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice, Tag } from './ui';

/**
 * Adding to somebody else's archive.
 *
 * The screen's job is to make one thing unmistakable before anybody types:
 * nothing here changes the archive. It is a suggestion, the storyteller
 * decides, and what they already said is never replaced. That is stated once
 * at the top and again on the kind that most needs it — "I remember it
 * differently", which is the one a person reaches for when they think somebody
 * is wrong.
 */
const KINDS: { value: ProposalKind; label: string; help: string }[] = [
  { value: 'note', label: 'Something I know', help: 'Context, a detail, a story you remember.' },
  { value: 'media', label: 'A photograph or document', help: 'Upload it first, then describe it.' },
  { value: 'date', label: 'When something happened', help: 'A date or an approximate one.' },
  { value: 'place', label: 'Where something happened', help: 'A house, a town, a street.' },
  { value: 'person', label: 'Somebody who was there', help: 'A name and how they fit in.' },
  {
    value: 'relationship',
    label: 'How two people are connected',
    help: 'Cousin, neighbour, colleague.',
  },
  {
    value: 'correction',
    label: 'A detail that looks wrong',
    help: 'The storyteller sees both versions and decides. The original is kept either way.',
  },
  {
    value: 'alternate_account',
    label: 'I remember it differently',
    help: 'Nothing is replaced. Your account is added beside theirs, and both are kept.',
  },
];

export function ContributionComposer({
  archiveId,
  proposals,
}: {
  archiveId: string;
  proposals: ContributorProposal[];
}) {
  const router = useRouter();
  const [kind, setKind] = useState<ProposalKind>('note');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [firstHand, setFirstHand] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const needsTarget = kind === 'correction' || kind === 'alternate_account';
  const selected = KINDS.find((k) => k.value === kind)!;

  const propose = async () => {
    setSending(true);
    setError(null);
    try {
      await api.send('POST', `/v1/archives/${archiveId}/contributions`, {
        kind,
        title: title.trim(),
        body: body.trim(),
        evidence: note.trim() ? [{ firstHand, note: note.trim() }] : [{ firstHand }],
      });
      setTitle('');
      setBody('');
      setNote('');
      setSent(true);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiRequestError ? caught.message : 'That could not be sent just now.',
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="stack-lg">
      <Notice tone="info" title="Nothing here changes the archive">
        <p style={{ marginBottom: 0 }}>
          Everything you add is a suggestion. The storyteller sees it, decides on it, and what they
          have already said is never replaced by it.
        </p>
      </Notice>

      {error ? <Notice tone="danger">{error}</Notice> : null}
      {sent && !error ? <Notice tone="ok">Sent for them to look at.</Notice> : null}

      <Card>
        <label htmlFor="kind">
          <strong>What would you like to add?</strong>
        </label>
        <select
          id="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as ProposalKind)}
        >
          {KINDS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="muted">{selected.help}</p>

        {needsTarget ? (
          <Notice tone="info">
            <p style={{ marginBottom: 0 }}>
              To point this at a particular story, open it from{' '}
              <a href={`/archives/${archiveId}/memories`}>the stories list</a> and add it from
              there. Sent from here it arrives as general context instead.
            </p>
          </Notice>
        ) : null}

        <label htmlFor="proposal-title">A short name for it</label>
        <input
          id="proposal-title"
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />

        <label htmlFor="proposal-body">What you want to say</label>
        <textarea
          id="proposal-body"
          rows={5}
          maxLength={10000}
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />

        <fieldset>
          <legend>How do you know this?</legend>
          <label>
            <input type="radio" checked={firstHand} onChange={() => setFirstHand(true)} /> I was
            there, or I saw it myself
          </label>
          <label>
            <input type="radio" checked={!firstHand} onChange={() => setFirstHand(false)} />{' '}
            Somebody told me
          </label>
          <p className="muted">
            {/* The distinction is unrecoverable once the person who could
                settle it is gone, so it is asked for now rather than inferred. */}
            Both are useful. Keeping them apart is what stops second-hand stories becoming
            first-hand ones later.
          </p>
        </fieldset>

        <label htmlFor="proposal-note">Anything that would help them judge it (optional)</label>
        <textarea
          id="proposal-note"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />

        <div className="row">
          <button
            type="button"
            className="btn btn-primary"
            disabled={sending || title.trim().length === 0 || body.trim().length === 0}
            onClick={() => void propose()}
          >
            {sending ? 'Sending…' : 'Send this suggestion'}
          </button>
        </div>
      </Card>

      <h2>What you have suggested</h2>
      {proposals.length === 0 ? (
        <Empty title="Nothing yet">
          Anything you suggest appears here, with what the storyteller decided.
        </Empty>
      ) : (
        <div className="stack">
          {proposals.map((proposal) => (
            <Card key={proposal.id}>
              <h3 style={{ marginTop: 0 }}>{proposal.title}</h3>
              <div className="row">
                <Tag>{KINDS.find((k) => k.value === proposal.kind)?.label ?? proposal.kind}</Tag>
                <Tag kind={proposal.status === 'approved' ? 'ok' : undefined}>
                  {proposal.status}
                </Tag>
              </div>
              <p>{proposal.body}</p>
              {proposal.reviewNote ? (
                <p className="muted">They said: {proposal.reviewNote}</p>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
