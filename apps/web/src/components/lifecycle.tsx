'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DeletionRequest } from '@everecho/contracts';
import { api, ApiRequestError } from '@/lib/api';
import { Card, Tag } from './ui';

export function ExportButton({ archiveId }: { archiveId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestExport() {
    setPending(true);
    setError(null);
    try {
      await api.post(`/v1/archives/${archiveId}/exports`, {
        includeOriginals: true,
        includeTranscripts: true,
        includeProvenance: true,
        format: 'zip',
      });
      setTimeout(() => router.refresh(), 1500);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      {error ? (
        <div className="notice notice-danger" role="alert">
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className="btn btn-primary btn-lg"
        onClick={() => void requestExport()}
        disabled={pending}
      >
        {pending ? <span className="spinner-text">Preparing</span> : 'Prepare an export'}
      </button>
    </div>
  );
}

/**
 * Deletion progress is shown step by step rather than as a spinner. Someone who
 * has just asked us to destroy their memories deserves to watch it happen.
 */
export function DeletionPanel({
  archiveId,
  archiveName,
  requests,
}: {
  archiveId: string;
  archiveName: string;
  requests: DeletionRequest[];
}) {
  const router = useRouter();
  const [phrase, setPhrase] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = requests.find((r) => r.status !== 'completed' && r.status !== 'cancelled');
  const completed = requests.find((r) => r.status === 'completed');

  async function requestDeletion() {
    setPending(true);
    setError(null);
    try {
      await api.post(`/v1/archives/${archiveId}/deletion-requests`, {
        scope: 'archive',
        confirmationPhrase: phrase,
      });
      setTimeout(() => router.refresh(), 1500);
    } catch (caught) {
      setError(caught instanceof ApiRequestError ? caught.message : 'That did not work.');
    } finally {
      setPending(false);
    }
  }

  if (completed) {
    return (
      <Card>
        <h2>This archive has been deleted</h2>
        <ul className="list-plain">
          {completed.steps.map((step) => (
            <li key={step.key} className="spread">
              <span>{step.label}</span>
              <Tag kind="approved">
                done{step.affectedCount !== null ? ` · ${step.affectedCount}` : ''}
              </Tag>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (active) {
    return (
      <Card>
        <h2>Deleting</h2>
        <ul className="list-plain" aria-live="polite">
          {active.steps.map((step) => (
            <li key={step.key} className="spread">
              <span>{step.label}</span>
              <Tag
                kind={
                  step.status === 'done'
                    ? 'approved'
                    : step.status === 'failed'
                      ? 'danger'
                      : 'draft'
                }
              >
                {step.status}
              </Tag>
            </li>
          ))}
        </ul>
        <button type="button" className="btn" onClick={() => router.refresh()}>
          Check again
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <div className="stack">
        {error ? (
          <div className="notice notice-danger" role="alert">
            {error}
          </div>
        ) : null}
        <div>
          <label htmlFor="confirm">
            To confirm, type the archive’s name exactly: <strong>{archiveName}</strong>
          </label>
          <input
            id="confirm"
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
          />
        </div>
        <button
          type="button"
          className="btn btn-danger btn-lg"
          onClick={() => void requestDeletion()}
          disabled={pending || phrase.trim() !== archiveName.trim()}
        >
          {pending ? (
            <span className="spinner-text">Starting</span>
          ) : (
            'Delete this archive permanently'
          )}
        </button>
      </div>
    </Card>
  );
}
