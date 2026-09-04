'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { MemoryGap } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Empty, Notice } from './ui';

/**
 * Things you might like to say more about.
 *
 * The hard part of this screen is not the list; it is not becoming a progress
 * bar. Every instinct in product design pulls towards a number here — items
 * remaining, a percentage, a streak — and every one of those turns somebody's
 * life into a form they are behind on. So there is no count, no total, no
 * "3 of 12", and the list is capped at a handful because a wall of questions
 * is a score by another name.
 *
 * "Not now" and "Never ask again" sit beside answering at the same weight,
 * with no confirmation step and no persuasion, because a no that costs more
 * than a yes is not really offered.
 */

/** How many to put in front of somebody at once. */
const SHOWN = 3;

export function GapRadar({ archiveId, gaps }: { archiveId: string; gaps: MemoryGap[] }) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ candidateCount: number } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const dismiss = async (gapId: string, decision: 'snooze' | 'never') => {
    setPending(gapId);
    setError(null);
    try {
      await api.send('POST', `/v1/archives/${archiveId}/gaps/${gapId}/dismiss`, {
        decision,
        ...(decision === 'snooze' ? { snoozeDays: 30 } : {}),
      });
      setOpenId(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(null);
    }
  };

  const submit = async (gapId: string) => {
    setPending(gapId);
    setError(null);
    try {
      const result = await api.send<{ candidateCount: number }>(
        'POST',
        `/v1/archives/${archiveId}/gaps/${gapId}/answer`,
        { body: answer },
      );
      setOpenId(null);
      setAnswer('');
      setSaved({ candidateCount: result.candidateCount });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not save.');
    } finally {
      setPending(null);
    }
  };

  const visible = showAll ? gaps : gaps.slice(0, SHOWN);

  return (
    <div className="stack-lg">
      {error ? <Notice tone="danger">{error}</Notice> : null}

      {saved ? (
        <Notice tone="ok" title="Saved as a source in your archive">
          <p style={{ marginBottom: 0 }}>
            {saved.candidateCount > 0 ? (
              <>
                It suggested {saved.candidateCount}{' '}
                {saved.candidateCount === 1 ? 'thing' : 'things'} to add.{' '}
                <Link href={`/archives/${archiveId}/learned`}>
                  Nothing is kept until you say so
                </Link>
                .
              </>
            ) : (
              'Your words are kept as you wrote them. Nothing was added to your archive.'
            )}
          </p>
        </Notice>
      ) : null}

      <Notice tone="info" title="This is not a checklist">
        <p style={{ marginBottom: 0 }}>
          Each of these is somewhere your own words mention something without explaining it. There
          is no score here, nothing is missing, and an archive with none of these answered is not
          worse than one with all of them. Say more if you feel like it. Put anything away for good
          and it will not come back.
        </p>
      </Notice>

      {gaps.length === 0 ? (
        <Empty title="Nothing to ask you about">
          When your stories mention somebody or somewhere without saying who or where, the question
          will appear here.
        </Empty>
      ) : (
        <div className="stack">
          {visible.map((gap) => (
            <Card key={gap.id}>
              <h2 style={{ marginTop: 0, fontSize: '1.05rem' }}>{gap.prompt}</h2>
              <p className="muted">
                {/* Why they are being asked, in the words that caused it — so
                    the question is visibly about a sentence, not about them. */}
                Because of something you said
                {gap.memoryId ? (
                  <>
                    {' '}
                    in{' '}
                    <Link href={`/archives/${archiveId}/memories/${gap.memoryId}`}>this story</Link>
                  </>
                ) : null}
                .
              </p>

              {openId === gap.id ? (
                <div className="stack">
                  <label htmlFor={`gap-answer-${gap.id}`}>Your answer</label>
                  <textarea
                    id={`gap-answer-${gap.id}`}
                    rows={5}
                    maxLength={20000}
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                  <p className="muted">
                    This is kept as a source in your archive, in your words. Anything it suggests
                    goes to your review queue — nothing is added until you approve it.
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={pending === gap.id || answer.trim().length === 0}
                      onClick={() => void submit(gap.id)}
                    >
                      Save this
                    </button>
                    <button type="button" className="btn" onClick={() => setOpenId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="row">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setOpenId(gap.id);
                      setAnswer('');
                      setSaved(null);
                    }}
                  >
                    Say more
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={pending === gap.id}
                    onClick={() => void dismiss(gap.id, 'snooze')}
                  >
                    Not now
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={pending === gap.id}
                    onClick={() => void dismiss(gap.id, 'never')}
                  >
                    Never ask again
                  </button>
                </div>
              )}
            </Card>
          ))}

          {gaps.length > SHOWN && !showAll ? (
            <div className="row">
              <button type="button" className="btn btn-quiet" onClick={() => setShowAll(true)}>
                {/* Deliberately not "12 more". A number here is a backlog. */}
                Show me the rest
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
