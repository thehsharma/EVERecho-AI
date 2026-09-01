'use client';

import { useState, type FormEvent } from 'react';
import { api, ApiRequestError } from '@/lib/api';
import type { GeneratedResponse } from '@everecho/contracts';
import { Card, EvidenceClassTag, Tag } from './ui';

interface Turn {
  question: string;
  response?: GeneratedResponse;
  error?: { message: string; reasonCode?: string };
}

const REASON_HELP: Record<string, string> = {
  restricted_topic:
    'The storyteller asked for this topic to be kept out of the archive’s answers. That is their decision to make, and the system will not work around it.',
  sensitivity_above_grant: 'This material is more private than what you have been given access to.',
  membership_revoked: 'Your access to this archive was withdrawn.',
  consent_mode_insufficient:
    'The storyteller has not enabled composed answers for this archive. You may still be able to search it.',
  source_embargoed: 'The storyteller has held this material back until a later date.',
};

const SUGGESTIONS = [
  'Where did they grow up?',
  'What did they do for work?',
  'Who mattered most to them?',
  'What advice would they pass on?',
];

export function AskPanel({ archiveId, subjectName }: { archiveId: string; subjectName: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState(false);
  const [openCitation, setOpenCitation] = useState<string | null>(null);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    setPending(true);
    setQuestion('');
    setTurns((prev) => [...prev, { question: trimmed }]);

    try {
      const result = await api.post<{ response: GeneratedResponse }>(
        `/v1/archives/${archiveId}/questions`,
        { question: trimmed },
      );
      setTurns((prev) =>
        prev.map((turn, index) =>
          index === prev.length - 1 ? { ...turn, response: result.response } : turn,
        ),
      );
    } catch (caught) {
      const error =
        caught instanceof ApiRequestError
          ? { message: caught.message, reasonCode: caught.reasonCode }
          : { message: 'We could not reach the server. Please try again.' };
      setTurns((prev) =>
        prev.map((turn, index) => (index === prev.length - 1 ? { ...turn, error } : turn)),
      );
    } finally {
      setPending(false);
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask(question);
  }

  return (
    <div className="stack-lg">
      <Card>
        <form onSubmit={onSubmit} className="stack">
          <div>
            <label htmlFor="question">Your question</label>
            <textarea
              id="question"
              value={question}
              rows={2}
              maxLength={1000}
              placeholder={`What did ${subjectName} say about…`}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void ask(question);
                }
              }}
            />
          </div>
          <div className="row">
            <button type="submit" className="btn btn-primary" disabled={pending || !question.trim()}>
              {pending ? <span className="spinner-text">Looking</span> : 'Ask'}
            </button>
            {turns.length === 0
              ? SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="btn btn-quiet small"
                    onClick={() => void ask(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))
              : null}
          </div>
        </form>
      </Card>

      {/* Announced politely so a screen-reader user hears the answer arrive. */}
      <div aria-live="polite" className="stack-lg">
        {[...turns].reverse().map((turn, index) => (
          <Card key={`${turn.question}-${index}`}>
            <h2 style={{ fontSize: '1.0625rem' }}>{turn.question}</h2>

            {turn.error ? (
              <div className="notice notice-warn" role="status">
                <strong>{turn.error.message}</strong>
                {turn.error.reasonCode && REASON_HELP[turn.error.reasonCode] ? (
                  <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>
                    {REASON_HELP[turn.error.reasonCode]}
                  </p>
                ) : null}
              </div>
            ) : !turn.response ? (
              <p className="muted spinner-text">Searching what they said</p>
            ) : turn.response.abstained ? (
              <div className="notice notice-warn">
                <p style={{ marginBottom: 0 }}>{turn.response.answerText}</p>
              </div>
            ) : (
              <div className="stack">
                <p className="row" style={{ gap: '0.35rem' }}>
                  <Tag kind="ai">AI-assisted</Tag>
                  <Tag>Written about {subjectName}, not as them</Tag>
                </p>

                <div>
                  {turn.response.claims.map((claim) => {
                    const key = `${turn.response!.id}-${claim.index}`;
                    return (
                      <div className="claim" key={key}>
                        <p style={{ marginBottom: '0.35rem' }}>
                          {claim.text}
                          <button
                            type="button"
                            className="citation"
                            aria-expanded={openCitation === key}
                            aria-controls={`citation-${key}`}
                            onClick={() => setOpenCitation(openCitation === key ? null : key)}
                          >
                            {claim.citations.length} source
                            {claim.citations.length === 1 ? '' : 's'}
                          </button>
                        </p>

                        <p className="row small" style={{ gap: '0.35rem', marginBottom: 0 }}>
                          <EvidenceClassTag evidenceClass={claim.evidenceClass} />
                          {claim.contradictionIds.length > 0 ? (
                            <Tag kind="draft">The recordings disagree about this</Tag>
                          ) : null}
                        </p>

                        {openCitation === key ? (
                          <div id={`citation-${key}`} className="stack" style={{ marginTop: '0.75rem' }}>
                            {claim.citations.map((citation, citationIndex) => (
                              <div key={`${citation.sourceId}-${citationIndex}`}>
                                <blockquote className="quote">“{citation.quotedText}”</blockquote>
                                <p className="small muted" style={{ marginTop: '0.35rem', marginBottom: 0 }}>
                                  From {citation.sourceFilename} ({citation.sourceKind})
                                  {citation.locator.startMs !== undefined
                                    ? ` at ${formatTimestamp(citation.locator.startMs)}`
                                    : citation.locator.page !== undefined
                                      ? `, page ${citation.locator.page}`
                                      : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <p className="small muted" style={{ marginBottom: 0 }}>
                  Composed by {turn.response.modelAndPromptVersion} under consent{' '}
                  {turn.response.policyVersion}.
                </p>
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatTimestamp(ms: number | undefined): string {
  if (ms === undefined) return '';
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
